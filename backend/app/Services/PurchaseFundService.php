<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PurchaseFundService
{
    public function __construct(
        private BankAccountService $banks,
        private AuditLogger $audit,
    ) {}

    /** @return array<string, mixed> */
    public function summary(int $storeId): array
    {
        $fund = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'purchase_fund')
            ->where('is_active', true)->first();
        abort_if($fund === null, 422, 'Akun Kas Pembelian aktif belum tersedia.');

        $balance = Decimal::money((string) (DB::table('fund_ledger_entries')->where('fund_account_id', $fund->id)->sum('amount') ?? '0'));
        $reserved = DB::table('purchase_fund_allocations as a')
            ->join('purchase_orders as po', 'po.id', '=', 'a.purchase_order_id')
            ->where('a.store_id', $storeId)->where('a.status', 'reserved')
            ->where('po.status', '<>', 'cancelled')
            ->select(['a.id', 'a.purchase_order_id', 'a.amount', 'po.doc_number', 'po.status'])
            ->orderByDesc('a.id')->get()
            ->map(fn ($row) => [
                'allocation_id' => (int) $row->id,
                'purchase_order_id' => (int) $row->purchase_order_id,
                'po_doc_number' => $row->doc_number,
                'po_status' => $row->status,
                'amount' => $row->amount,
            ])->all();

        return [
            'balance' => Decimal::moneyString($balance),
            'reserved_total' => Decimal::moneyString(array_sum(array_map(fn ($row) => Decimal::money($row['amount']), $reserved))),
            'bank_accounts' => $this->banks->list($storeId),
            'allocations' => $reserved,
        ];
    }

    /** @return array<string, mixed> */
    public function allocate(User $actor, int $storeId, int $poId, int $bankAccountId): array
    {
        return DB::transaction(function () use ($actor, $storeId, $poId, $bankAccountId) {
            $po = DB::table('purchase_orders')->where('store_id', $storeId)->where('id', $poId)->lockForUpdate()->first();
            abort_if($po === null, 404, 'PO tidak ditemukan.');
            if ($po->status !== 'draft') {
                throw ValidationException::withMessages(['status' => ['Dana hanya dapat dialokasikan pada PO draft sebelum diajukan ke Owner.']]);
            }
            $amount = Decimal::money((string) $po->total);
            if ($amount <= 0) {
                throw ValidationException::withMessages(['amount' => ['Total PO harus lebih dari nol.']]);
            }

            $bank = DB::table('bank_accounts')->where('store_id', $storeId)->where('id', $bankAccountId)
                ->where('is_active', true)->lockForUpdate()->first();
            if ($bank === null) {
                throw ValidationException::withMessages(['bank_account_id' => ['Rekening bank tidak ditemukan atau nonaktif.']]);
            }

            if (DB::table('purchase_fund_allocations')->where('purchase_order_id', $poId)->where('status', 'reserved')->exists()) {
                throw ValidationException::withMessages(['allocation' => ['PO ini sudah memiliki alokasi dana aktif.']]);
            }

            $bankBalance = Decimal::money((string) (DB::table('bank_account_ledger_entries')->where('bank_account_id', $bank->id)->sum('amount') ?? '0'));
            $reserved = Decimal::money((string) (DB::table('purchase_fund_allocations as a')
                ->join('purchase_orders as po', 'po.id', '=', 'a.purchase_order_id')
                ->where('a.bank_account_id', $bank->id)->where('a.status', 'reserved')
                ->where('po.status', '<>', 'cancelled')->sum('a.amount') ?? '0'));
            $available = $bankBalance - $reserved;
            if ($available < $amount) {
                throw ValidationException::withMessages(['bank_account_id' => [
                    'Saldo rekening yang belum dialokasikan tidak cukup. Tersedia '.Decimal::moneyString($available).'; kebutuhan PO '.Decimal::moneyString($amount).'.',
                ]]);
            }

            $fund = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'purchase_fund')
                ->where('is_active', true)->lockForUpdate()->first();
            if ($fund === null) {
                throw ValidationException::withMessages(['fund_account' => ['Akun Kas Pembelian aktif belum tersedia.']]);
            }

            $allocationId = DB::table('purchase_fund_allocations')->insertGetId([
                'store_id' => $storeId,
                'purchase_order_id' => $poId,
                'bank_account_id' => $bank->id,
                'amount' => Decimal::moneyString($amount),
                'status' => 'reserved',
                'allocated_by' => $actor->id,
            ]);
            DB::table('fund_ledger_entries')->insert([
                'fund_account_id' => $fund->id,
                'entry_type' => 'purchase_allocation_in',
                'amount' => Decimal::moneyString($amount),
                'ref_type' => 'purchase_fund_allocation',
                'ref_id' => $allocationId,
                'occurred_at' => now('UTC')->format('Y-m-d H:i:s.v'),
                'created_by' => $actor->id,
                'note' => 'Reservasi sistem untuk '.$po->doc_number.'; tidak mengirim transfer bank.',
            ]);

            $this->audit->log('purchase_fund.allocate', 'purchase_order', $poId,
                after: ['allocation_id' => $allocationId, 'bank_account_id' => (int) $bank->id, 'amount' => Decimal::moneyString($amount)],
                reason: 'Alokasi tercatat di sistem; bukan transfer bank.',
                storeId: $storeId, actorId: $actor->id);

            return [
                'id' => $allocationId,
                'purchase_order_id' => $poId,
                'bank_account_id' => (int) $bank->id,
                'bank_name' => $bank->bank_name,
                'account_name' => $bank->account_name,
                'amount' => Decimal::moneyString($amount),
                'status' => 'reserved',
                'allocated_by' => $actor->id,
            ];
        });
    }

    public function releaseForPo(User $actor, int $storeId, int $poId, string $reason): void
    {
        $allocation = DB::table('purchase_fund_allocations')
            ->where('store_id', $storeId)->where('purchase_order_id', $poId)->where('status', 'reserved')
            ->lockForUpdate()->first();
        if ($allocation === null) {
            return;
        }

        $amount = Decimal::money((string) $allocation->amount);
        $bank = DB::table('bank_accounts')->where('store_id', $storeId)->where('id', $allocation->bank_account_id)
            ->lockForUpdate()->first();
        $fund = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'purchase_fund')
            ->where('is_active', true)->lockForUpdate()->first();
        abort_if($bank === null || $fund === null, 422, 'Akun alokasi dana PO tidak tersedia.');

        DB::table('purchase_fund_allocations')->where('id', $allocation->id)->update([
            'status' => 'released',
            'released_by' => $actor->id,
            'release_reason' => $reason,
            'released_at' => now('UTC')->format('Y-m-d H:i:s.v'),
        ]);
        DB::table('fund_ledger_entries')->insert([
            'fund_account_id' => $fund->id,
            'entry_type' => 'purchase_allocation_out',
            'amount' => Decimal::moneyString(-$amount),
            'ref_type' => 'purchase_fund_allocation',
            'ref_id' => $allocation->id,
            'occurred_at' => now('UTC')->format('Y-m-d H:i:s.v'),
            'created_by' => $actor->id,
            'note' => $reason,
        ]);
        $this->audit->log('purchase_fund.release', 'purchase_order', $poId,
            after: ['allocation_id' => (int) $allocation->id, 'amount' => Decimal::moneyString($amount)],
            reason: $reason, storeId: $storeId, actorId: $actor->id);
    }
}
