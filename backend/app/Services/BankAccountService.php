<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class BankAccountService
{
    public function __construct(private AuditLogger $audit) {}

    /** @return list<array<string, mixed>> */
    public function list(int $storeId): array
    {
        return DB::table('bank_accounts as a')
            ->where('a.store_id', $storeId)
            ->orderBy('a.bank_name')->orderBy('a.account_name')
            ->get(['a.id', 'a.bank_name', 'a.account_name', 'a.account_number', 'a.is_active'])
            ->map(function ($row) {
                $balance = $this->balance((int) $row->id);
                $reserved = $this->reserved((int) $row->id);
                $accountNumber = (string) $row->account_number;

                return [
                    'id' => (int) $row->id,
                    'bank_name' => $row->bank_name,
                    'account_name' => $row->account_name,
                    'account_number_masked' => strlen($accountNumber) <= 4
                        ? str_repeat('•', strlen($accountNumber))
                        : '••••'.substr($accountNumber, -4),
                    'is_active' => (bool) $row->is_active,
                    'balance' => $balance,
                    'reserved_for_purchase_fund' => $reserved,
                    'available_balance' => Decimal::moneyString(Decimal::money($balance) - Decimal::money($reserved)),
                ];
            })->all();
    }

    /** @param array{bank_name: string, account_name: string, account_number: string, opening_balance: string, reason: string} $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            $duplicate = DB::table('bank_accounts')->where('store_id', $storeId)
                ->where('account_number', $data['account_number'])->exists();
            if ($duplicate) {
                throw ValidationException::withMessages(['account_number' => ['Nomor rekening sudah terdaftar di toko ini.']]);
            }

            $id = DB::table('bank_accounts')->insertGetId([
                'store_id' => $storeId,
                'bank_name' => trim($data['bank_name']),
                'account_name' => trim($data['account_name']),
                'account_number' => trim($data['account_number']),
                'created_by' => $actor->id,
            ]);
            $opening = Decimal::money($data['opening_balance']);
            if ($opening > 0) {
                $this->entry($id, 'opening_balance', $opening, $data['reason'], $actor->id);
            }

            $this->audit->log('bank_account.create', 'bank_account', $id,
                after: ['bank_name' => $data['bank_name'], 'account_name' => $data['account_name'], 'opening_balance' => Decimal::moneyString($opening)],
                reason: $data['reason'],
                storeId: $storeId, actorId: $actor->id);

            return $id;
        });

        return collect($this->list($storeId))->firstWhere('id', $id);
    }

    /** @param array{direction: string, amount: string, reason: string} $data
     * @return array<string, mixed>
     */
    public function adjust(User $actor, int $storeId, int $accountId, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $accountId, $data) {
            $account = DB::table('bank_accounts')->where('store_id', $storeId)->where('id', $accountId)
                ->lockForUpdate()->first();
            abort_if($account === null, 404, 'Rekening bank tidak ditemukan.');
            if (! $account->is_active) {
                throw ValidationException::withMessages(['account' => ['Rekening bank nonaktif tidak dapat disesuaikan.']]);
            }

            $amount = Decimal::money($data['amount']);
            $delta = $data['direction'] === 'decrease' ? -$amount : $amount;
            $balance = Decimal::money((string) (DB::table('bank_account_ledger_entries')
                ->where('bank_account_id', $accountId)->sum('amount') ?? '0'));
            $reserved = Decimal::money($this->reserved($accountId));
            if ($balance + $delta < $reserved) {
                throw ValidationException::withMessages(['amount' => ['Saldo rekening setelah penyesuaian tidak boleh lebih rendah daripada dana yang sudah dialokasikan ke PO.']]);
            }

            $this->entry($accountId, 'manual_adjustment', $delta, $data['reason'], $actor->id);
            $this->audit->log('bank_account.adjust', 'bank_account', $accountId,
                before: ['balance' => Decimal::moneyString($balance)],
                after: ['balance' => Decimal::moneyString($balance + $delta), 'change' => Decimal::moneyString($delta)],
                reason: $data['reason'], storeId: $storeId, actorId: $actor->id);
        });

        return collect($this->list($storeId))->firstWhere('id', $accountId);
    }

    public function entry(int $accountId, string $type, int $amount, string $note, int $actorId, ?string $refType = null, ?int $refId = null): void
    {
        DB::table('bank_account_ledger_entries')->insert([
            'bank_account_id' => $accountId,
            'entry_type' => $type,
            'amount' => Decimal::moneyString($amount),
            'ref_type' => $refType,
            'ref_id' => $refId,
            'note' => $note,
            'created_by' => $actorId,
            'occurred_at' => now('UTC')->format('Y-m-d H:i:s.v'),
        ]);
    }

    private function balance(int $accountId): string
    {
        return Decimal::moneyString(Decimal::money((string) (DB::table('bank_account_ledger_entries')
            ->where('bank_account_id', $accountId)->sum('amount') ?? '0')));
    }

    private function reserved(int $accountId): string
    {
        return Decimal::moneyString(Decimal::money((string) (DB::table('purchase_fund_allocations as a')
            ->join('purchase_orders as po', 'po.id', '=', 'a.purchase_order_id')
            ->where('a.bank_account_id', $accountId)->where('a.status', 'reserved')
            ->where('po.status', '<>', 'cancelled')->sum('a.amount') ?? '0')));
    }
}
