<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class FinancialService
{
    public function __construct(
        private AuditLogger $audit,
        private ReportService $reports,
    ) {}

    /** @param array{date_from: string, date_to: string} $filters
     * @return array<string, mixed>
     */
    public function report(int $storeId, array $filters): array
    {
        [$start, $end] = $this->boundaries($filters);
        $fund = $this->mainCash($storeId);
        $fundId = (int) $fund->id;

        $openingBalance = $this->ledgerBalance($fundId, '<', $start);
        $closingBalance = $this->ledgerBalance($fundId, '<=', $end);

        $cashTotals = DB::table('fund_ledger_entries')
            ->where('fund_account_id', $fundId)
            ->whereBetween('occurred_at', [$start, $end])
            ->selectRaw('coalesce(sum(case when amount > 0 then amount else 0 end), 0) as cash_in')
            ->selectRaw('coalesce(sum(case when amount < 0 then -amount else 0 end), 0) as cash_out')
            ->first();
        $cashIn = Decimal::money((string) $cashTotals->cash_in);
        $cashOut = Decimal::money((string) $cashTotals->cash_out);

        $expenseRows = DB::table('financial_expenses')
            ->where('store_id', $storeId)
            ->whereBetween('paid_at', [$start, $end])
            ->selectRaw('category, coalesce(sum(amount), 0) as total')
            ->groupBy('category')
            ->pluck('total', 'category');
        $operatingExpenses = Decimal::money((string) ($expenseRows->get('operational') ?? '0'));
        $payrollExpenses = Decimal::money((string) ($expenseRows->get('payroll') ?? '0'));

        $returnLosses = Decimal::money((string) DB::table('supplier_returns')
            ->where('store_id', $storeId)
            ->where('status', 'written_off')
            ->whereBetween('approved_at', [$start, $end])
            ->selectRaw('coalesce(sum(loss_amount), 0) as total')
            ->value('total'));
        $supplierPayments = Decimal::money((string) DB::table('purchase_order_payments')
            ->where('store_id', $storeId)
            ->whereBetween('paid_at', [$start, $end])
            ->selectRaw('coalesce(sum(amount), 0) as total')
            ->value('total'));

        $profit = $this->reports->profit($storeId, $filters);
        $grossProfit = Decimal::money((string) $profit['total_gross_profit']);

        return [
            'period' => $filters,
            'cash' => [
                'account_name' => $fund->name,
                'opening_balance' => Decimal::moneyString($openingBalance),
                'cash_in' => Decimal::moneyString($cashIn),
                'cash_out' => Decimal::moneyString($cashOut),
                'closing_balance' => Decimal::moneyString($closingBalance),
            ],
            'profit' => [
                'gross_profit' => Decimal::moneyString($grossProfit),
                'operating_expenses' => Decimal::moneyString($operatingExpenses),
                'payroll_expenses' => Decimal::moneyString($payrollExpenses),
                'approved_return_losses' => Decimal::moneyString($returnLosses),
                'net_profit' => Decimal::moneyString($grossProfit - $operatingExpenses - $payrollExpenses - $returnLosses),
            ],
            'supplier_payments' => Decimal::moneyString($supplierPayments),
        ];
    }

    /** @return LengthAwarePaginator<array<string, mixed>> */
    public function purchaseOrders(int $storeId, int $perPage): LengthAwarePaginator
    {
        return DB::table('purchase_orders as po')
            ->join('suppliers as s', 's.id', '=', 'po.supplier_id')
            ->where('po.store_id', $storeId)
            ->whereIn('po.status', ['approved', 'sent', 'partially_received', 'received'])
            ->whereIn('po.payment_status', ['unpaid', 'partial'])
            ->orderByDesc('po.id')
            ->paginate($perPage, [
                'po.id', 'po.doc_number', 'po.status', 'po.payment_terms', 'po.total',
                'po.amount_paid', 'po.payment_status', 's.name as supplier_name',
            ])
            ->through(fn ($po) => [
                'id' => (int) $po->id,
                'doc_number' => $po->doc_number,
                'status' => $po->status,
                'payment_terms' => $po->payment_terms,
                'payment_status' => $po->payment_status,
                'supplier_name' => $po->supplier_name,
                'total' => $po->total,
                'amount_paid' => $po->amount_paid,
                'amount_remaining' => Decimal::moneyString(Decimal::money((string) $po->total) - Decimal::money((string) $po->amount_paid)),
            ]);
    }

    /** @param array{amount: string, paid_on: ?string, reference: ?string, note: ?string} $data
     * @return array<string, mixed>
     */
    public function recordPurchaseOrderPayment(User $actor, int $storeId, int $poId, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $poId, $data) {
            $po = DB::table('purchase_orders')
                ->where('store_id', $storeId)
                ->where('id', $poId)
                ->lockForUpdate()
                ->first();
            abort_if($po === null, 404, 'PO tidak ditemukan.');

            if (! in_array($po->status, ['approved', 'sent', 'partially_received', 'received'], true)) {
                throw ValidationException::withMessages(['po_id' => ['PO ini belum dapat dibayar atau sudah dibatalkan.']]);
            }

            $amount = Decimal::money((string) $data['amount']);
            $paid = Decimal::money((string) $po->amount_paid);
            $remaining = Decimal::money((string) $po->total) - $paid;
            if ($amount <= 0 || $amount > $remaining) {
                throw ValidationException::withMessages(['amount' => ['Pembayaran harus lebih dari nol dan tidak melebihi sisa PO ('.Decimal::moneyString($remaining).').']]);
            }

            $paidAt = $this->paidAt($data['paid_on'] ?? null);
            $fund = $this->lockedMainCash($storeId);
            $balance = $this->ledgerBalance((int) $fund->id);
            if ($amount > $balance) {
                throw ValidationException::withMessages(['amount' => ['Saldo Kas Besar tidak cukup.']]);
            }

            return $this->createPurchaseOrderPayment(
                $actor,
                $storeId,
                $po,
                $fund,
                $amount,
                $paidAt,
                $data['reference'] ?? null,
                $data['note'] ?? null,
            );
        });
    }

    /** Settle the remaining PO balance as part of a fully posted receipt; cash may go negative.
     * @return array<string, mixed>|null
     */
    public function settleOnFullReceipt(User $actor, int $storeId, int $poId, string $receiptDocNo, string $paidAt): ?array
    {
        return DB::transaction(function () use ($actor, $storeId, $poId, $receiptDocNo, $paidAt) {
            $po = DB::table('purchase_orders')
                ->where('store_id', $storeId)
                ->where('id', $poId)
                ->lockForUpdate()
                ->first();
            abort_if($po === null, 404, 'PO tidak ditemukan.');
            if ($po->status !== 'received' || $po->receipt_status !== 'complete') {
                throw ValidationException::withMessages(['status' => ['Pelunasan otomatis hanya berlaku untuk PO yang diterima penuh.']]);
            }

            $total = Decimal::money((string) $po->total);
            $paid = Decimal::money((string) $po->amount_paid);
            $remaining = $total - $paid;
            if ($remaining < 0) {
                throw ValidationException::withMessages(['amount_paid' => ['Pembayaran PO melebihi total pesanan.']]);
            }
            if ($remaining === 0) {
                return null;
            }

            return $this->createPurchaseOrderPayment(
                $actor,
                $storeId,
                $po,
                $this->lockedMainCash($storeId),
                $remaining,
                $paidAt,
                $receiptDocNo,
                'Pelunasan otomatis setelah penerimaan penuh '.$receiptDocNo,
            );
        });
    }

    /** @param array{category: string, description: string, amount: string, paid_on: ?string} $data
     * @return array<string, mixed>
     */
    public function recordExpense(User $actor, int $storeId, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $data) {
            $description = trim($data['description']);
            if ($description === '') {
                throw ValidationException::withMessages(['description' => ['Keterangan wajib diisi.']]);
            }

            $amount = Decimal::money((string) $data['amount']);
            if ($amount <= 0) {
                throw ValidationException::withMessages(['amount' => ['Jumlah harus lebih dari nol.']]);
            }

            $paidAt = $this->paidAt($data['paid_on'] ?? null);
            $fund = $this->lockedMainCash($storeId);
            $balance = $this->ledgerBalance((int) $fund->id);
            if ($amount > $balance) {
                throw ValidationException::withMessages(['amount' => ['Saldo Kas Besar tidak cukup.']]);
            }

            $expenseId = DB::table('financial_expenses')->insertGetId([
                'store_id' => $storeId,
                'category' => $data['category'],
                'description' => $description,
                'amount' => Decimal::moneyString($amount),
                'paid_at' => $paidAt,
                'recorded_by' => $actor->id,
            ]);
            DB::table('fund_ledger_entries')->insert([
                'fund_account_id' => $fund->id,
                'entry_type' => $data['category'] === 'payroll' ? 'payroll_expense' : 'operating_expense',
                'amount' => Decimal::moneyString(-$amount),
                'ref_type' => 'financial_expense',
                'ref_id' => $expenseId,
                'occurred_at' => $paidAt,
                'created_by' => $actor->id,
                'note' => $description,
            ]);
            $this->audit->log(
                'financial.expense.create',
                'financial_expense',
                $expenseId,
                after: [
                    'category' => $data['category'],
                    'description' => $description,
                    'amount' => Decimal::moneyString($amount),
                    'paid_at' => $paidAt,
                ],
                actorId: $actor->id,
                storeId: $storeId,
            );

            return [
                'id' => $expenseId,
                'category' => $data['category'],
                'description' => $description,
                'amount' => Decimal::moneyString($amount),
                'paid_at' => $paidAt,
            ];
        });
    }

    private function mainCash(int $storeId): object
    {
        $fund = DB::table('fund_accounts')
            ->where('store_id', $storeId)
            ->where('type', 'main_cash')
            ->where('is_active', true)
            ->orderBy('id')
            ->first(['id', 'name']);
        if ($fund === null) {
            throw ValidationException::withMessages(['fund_account' => ['Akun Kas Besar aktif belum tersedia.']]);
        }

        return $fund;
    }

    private function lockedMainCash(int $storeId): object
    {
        $fund = DB::table('fund_accounts')
            ->where('store_id', $storeId)
            ->where('type', 'main_cash')
            ->where('is_active', true)
            ->orderBy('id')
            ->lockForUpdate()
            ->first(['id', 'name']);
        if ($fund === null) {
            throw ValidationException::withMessages(['fund_account' => ['Akun Kas Besar aktif belum tersedia.']]);
        }

        return $fund;
    }

    /** @return array<string, mixed> */
    private function createPurchaseOrderPayment(
        User $actor,
        int $storeId,
        object $po,
        object $fund,
        int $amount,
        string $paidAt,
        ?string $reference,
        ?string $note,
    ): array {
        $paid = Decimal::money((string) $po->amount_paid);
        $newPaid = $paid + $amount;
        $status = $newPaid >= Decimal::money((string) $po->total) ? 'paid' : 'partial';
        $paymentId = DB::table('purchase_order_payments')->insertGetId([
            'store_id' => $storeId,
            'po_id' => $po->id,
            'amount' => Decimal::moneyString($amount),
            'paid_at' => $paidAt,
            'reference' => $reference,
            'note' => $note,
            'recorded_by' => $actor->id,
        ]);
        DB::table('purchase_orders')->where('id', $po->id)->update([
            'amount_paid' => Decimal::moneyString($newPaid),
            'payment_status' => $status,
        ]);
        DB::table('fund_ledger_entries')->insert([
            'fund_account_id' => $fund->id,
            'entry_type' => 'purchase_order_payment',
            'amount' => Decimal::moneyString(-$amount),
            'ref_type' => 'purchase_order_payment',
            'ref_id' => $paymentId,
            'occurred_at' => $paidAt,
            'created_by' => $actor->id,
            'note' => $note ?: 'Pembayaran PO '.$po->doc_number,
        ]);
        $this->audit->log(
            'financial.purchase_order_payment',
            'purchase_order',
            (int) $po->id,
            before: ['amount_paid' => Decimal::moneyString($paid), 'payment_status' => $po->payment_status],
            after: ['amount_paid' => Decimal::moneyString($newPaid), 'payment_status' => $status, 'payment_id' => $paymentId],
            reason: $note,
            actorId: $actor->id,
            storeId: $storeId,
        );

        return [
            'id' => $paymentId,
            'po_id' => (int) $po->id,
            'amount' => Decimal::moneyString($amount),
            'amount_paid' => Decimal::moneyString($newPaid),
            'amount_remaining' => Decimal::moneyString(Decimal::money((string) $po->total) - $newPaid),
            'payment_status' => $status,
        ];
    }

    private function ledgerBalance(int $fundId, ?string $operator = null, ?string $date = null): int
    {
        return Decimal::money((string) DB::table('fund_ledger_entries')
            ->where('fund_account_id', $fundId)
            ->when($operator !== null && $date !== null, fn ($query) => $query->where('occurred_at', $operator, $date))
            ->selectRaw('coalesce(sum(amount), 0) as balance')
            ->value('balance'));
    }

    private function paidAt(?string $date): string
    {
        $today = now('Asia/Jakarta')->toDateString();
        $paidOn = $date ?? $today;
        if ($paidOn > $today) {
            throw ValidationException::withMessages(['paid_on' => ['Tanggal pembayaran tidak boleh di masa depan.']]);
        }

        return Carbon::parse($paidOn, 'Asia/Jakarta')->startOfDay()->utc()->format('Y-m-d H:i:s.v');
    }

    /** @param array{date_from: string, date_to: string} $filters
     * @return array{0: string, 1: string}
     */
    private function boundaries(array $filters): array
    {
        $start = Carbon::parse($filters['date_from'], 'Asia/Jakarta')->startOfDay()->utc()->format('Y-m-d H:i:s.u');
        $end = Carbon::parse($filters['date_to'], 'Asia/Jakarta')->endOfDay()->utc()->format('Y-m-d H:i:s.u');

        return [$start, $end];
    }
}
