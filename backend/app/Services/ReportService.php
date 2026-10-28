<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\StockStatus;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class ReportService
{
    /** @param array<string, mixed> $filters */
    public function dashboard(User $actor, int $storeId, array $filters, bool $canSeeAll): array
    {
        return [
            'period' => ['date_from' => $filters['date_from'], 'date_to' => $filters['date_to']],
            'sales' => $this->salesDaily($actor, $storeId, $filters, $canSeeAll),
            'inventory' => $this->inventory($storeId, []),
            'cash' => $this->cashSummary($actor, $storeId, $filters, $canSeeAll),
        ];
    }

    /** @param array<string, mixed> $filters */
    public function salesDaily(User $actor, int $storeId, array $filters, bool $canSeeAll): array
    {
        [$start, $end] = $this->boundaries($filters);
        $cashierId = $this->cashierId($actor, $filters, $canSeeAll);

        $query = DB::table('sales as s')
            ->where('s.store_id', $storeId)
            ->where('s.status', 'posted')
            ->whereBetween('s.posted_at', [$start, $end]);

        if ($cashierId !== null) {
            $query->where('s.cashier_id', $cashierId);
        }

        $rows = $query->clone()
            ->selectRaw('DATE(CONVERT_TZ(s.posted_at, "+00:00", "+07:00")) as report_date')
            ->selectRaw('count(*) as transaction_count')
            ->selectRaw('coalesce(sum(s.subtotal), 0) as gross_sales')
            ->selectRaw('coalesce(sum(s.discount_total), 0) as discount_total')
            ->selectRaw('coalesce(sum(s.tax_amount), 0) as tax_amount')
            ->selectRaw('coalesce(sum(s.total), 0) as net_sales')
            ->groupByRaw('DATE(CONVERT_TZ(s.posted_at, "+00:00", "+07:00"))')
            ->orderBy('report_date')
            ->get()
            ->keyBy('report_date');

        $paymentRows = $query->clone()
            ->selectRaw('s.payment_mode')
            ->selectRaw('coalesce(sum(s.total), 0) as net_sales')
            ->selectRaw('count(*) as transaction_count')
            ->groupBy('s.payment_mode')
            ->get()
            ->keyBy('payment_mode');

        $daily = [];
        $grossUnits = $discountUnits = $taxUnits = $netUnits = $transactions = 0;
        $cursor = Carbon::parse($filters['date_from'], 'Asia/Jakarta')->startOfDay();
        $last = Carbon::parse($filters['date_to'], 'Asia/Jakarta')->startOfDay();

        while ($cursor <= $last) {
            $date = $cursor->toDateString();
            $row = $rows->get($date);
            $count = (int) ($row->transaction_count ?? 0);
            $gross = Decimal::money((string) ($row->gross_sales ?? 0));
            $discount = Decimal::money((string) ($row->discount_total ?? 0));
            $tax = Decimal::money((string) ($row->tax_amount ?? 0));
            $net = Decimal::money((string) ($row->net_sales ?? 0));
            $transactions += $count;
            $grossUnits += $gross;
            $discountUnits += $discount;
            $taxUnits += $tax;
            $netUnits += $net;
            $daily[] = [
                'date' => $date,
                'transaction_count' => $count,
                'gross_sales' => Decimal::moneyString($gross),
                'discount_total' => Decimal::moneyString($discount),
                'tax_amount' => Decimal::moneyString($tax),
                'net_sales' => Decimal::moneyString($net),
            ];
            $cursor = $cursor->addDay();
        }

        $cash = $paymentRows->get('cash');
        $credit = $paymentRows->get('payroll_credit');

        return [
            'summary' => [
                'transaction_count' => $transactions,
                'gross_sales' => Decimal::moneyString($grossUnits),
                'discount_total' => Decimal::moneyString($discountUnits),
                'tax_amount' => Decimal::moneyString($taxUnits),
                'net_sales' => Decimal::moneyString($netUnits),
            ],
            'by_payment_mode' => [
                'cash' => [
                    'transaction_count' => (int) ($cash->transaction_count ?? 0),
                    'net_sales' => Decimal::moneyString(Decimal::money((string) ($cash->net_sales ?? 0))),
                ],
                'payroll_credit' => [
                    'transaction_count' => (int) ($credit->transaction_count ?? 0),
                    'net_sales' => Decimal::moneyString(Decimal::money((string) ($credit->net_sales ?? 0))),
                ],
            ],
            'daily' => $daily,
        ];
    }

    /** @param array<string, mixed> $filters */
    public function inventory(int $storeId, array $filters): array
    {
        $rows = DB::table('products as p')
            ->leftJoin('inventory_balances as b', 'b.product_id', '=', 'p.id')
            ->where('p.store_id', $storeId)
            ->where('p.status', 'active')
            ->groupBy('p.id', 'p.sku', 'p.name', 'p.unit_name', 'p.min_stock', 'p.critical_stock')
            ->selectRaw('p.id, p.sku, p.name, p.unit_name, p.min_stock, p.critical_stock')
            ->selectRaw('coalesce(sum(b.qty_sellable), 0) as qty_sellable')
            ->havingRaw('coalesce(sum(b.qty_sellable), 0) <= p.min_stock')
            ->orderByRaw('CASE WHEN coalesce(sum(b.qty_sellable), 0) <= 0 THEN 0 WHEN coalesce(sum(b.qty_sellable), 0) < p.critical_stock THEN 1 ELSE 2 END')
            ->orderBy('p.name')
            ->get()
            ->map(fn ($row) => [
                'product_id' => (int) $row->id,
                'sku' => $row->sku,
                'name' => $row->name,
                'unit_name' => $row->unit_name,
                'qty_sellable' => $row->qty_sellable,
                'min_stock' => $row->min_stock,
                'critical_stock' => $row->critical_stock,
                'status' => StockStatus::for($row->qty_sellable, $row->min_stock, $row->critical_stock),
            ])->all();

        $warningDays = (int) ($filters['expiry_days'] ?? DB::table('settings')
            ->where('store_id', $storeId)->where('setting_key', 'expiry_warning_days')->value('setting_value') ?? 30);
        $includeExpired = (bool) ($filters['include_expired'] ?? true);
        $today = Carbon::now('Asia/Jakarta')->startOfDay();
        $cutoff = $today->copy()->addDays($warningDays)->toDateString();

        $expiryQuery = DB::table('inventory_balances as b')
            ->join('products as p', 'p.id', '=', 'b.product_id')
            ->join('product_batches as pb', 'pb.id', '=', 'b.batch_id')
            ->where('p.store_id', $storeId)
            ->where('p.status', 'active')
            ->where('p.track_expiry', true)
            ->where('b.qty_sellable', '>', 0)
            ->where('pb.expiry_date', '<=', $cutoff);
        if (! $includeExpired) {
            $expiryQuery->where('pb.expiry_date', '>=', $today->toDateString());
        }

        $expiring = $expiryQuery
            ->orderByRaw('pb.expiry_date IS NULL')
            ->orderBy('pb.expiry_date')
            ->orderBy('p.name')
            ->get(['b.id as balance_id', 'p.id as product_id', 'p.sku', 'p.name', 'p.unit_name', 'pb.id as batch_id', 'pb.batch_code', 'pb.expiry_date', 'b.qty_sellable'])
            ->map(function ($row) use ($today) {
                $expiry = Carbon::parse($row->expiry_date, 'Asia/Jakarta')->startOfDay();

                return [
                    'balance_id' => (int) $row->balance_id,
                    'product_id' => (int) $row->product_id,
                    'sku' => $row->sku,
                    'name' => $row->name,
                    'unit_name' => $row->unit_name,
                    'batch_id' => (int) $row->batch_id,
                    'batch_code' => $row->batch_code,
                    'expiry_date' => $row->expiry_date,
                    'days_to_expiry' => $today->diffInDays($expiry, false),
                    'qty_sellable' => $row->qty_sellable,
                    'status' => $expiry->lt($today) ? 'kedaluwarsa' : ($expiry->equalTo($today) ? 'hari_ini' : 'akan_kedaluwarsa'),
                ];
            })->all();

        return [
            'warning_days' => $warningDays,
            'low_stock' => $rows,
            'expiring_batches' => $expiring,
            'counts' => ['low_stock' => count($rows), 'expiring_batches' => count($expiring)],
        ];
    }

    /** @param array<string, mixed> $filters */
    public function cashSummary(User $actor, int $storeId, array $filters, bool $canSeeAll): array
    {
        [$start, $end] = $this->boundaries($filters);
        $cashierId = $this->cashierId($actor, $filters, $canSeeAll);

        $sales = DB::table('sales')
            ->where('store_id', $storeId)->where('status', 'posted')
            ->whereBetween('posted_at', [$start, $end]);
        $movements = DB::table('cash_movements as m')->join('cash_shifts as s', 's.id', '=', 'm.shift_id')
            ->where('s.store_id', $storeId)->whereBetween('m.created_at', [$start, $end]);
        $deposits = DB::table('cash_deposits as d')->join('cash_shifts as s', 's.id', '=', 'd.shift_id')
            ->where('d.store_id', $storeId)->whereBetween('d.created_at', [$start, $end]);
        $shifts = DB::table('cash_shifts')->where('store_id', $storeId)->whereBetween('opened_at', [$start, $end]);

        if ($cashierId !== null) {
            $sales->where('cashier_id', $cashierId);
            $movements->where('s.cashier_id', $cashierId);
            $deposits->where('s.cashier_id', $cashierId);
            $shifts->where('cashier_id', $cashierId);
        }

        $saleRows = $sales->selectRaw("coalesce(sum(case when payment_mode = 'cash' then total else 0 end), 0) as cash_sales")
            ->selectRaw("coalesce(sum(case when payment_mode = 'payroll_credit' then total else 0 end), 0) as credit_sales")
            ->selectRaw('count(*) as sale_count')->first();
        $movementRows = $movements->selectRaw("coalesce(sum(case when type = 'in' then amount else 0 end), 0) as cash_in")
            ->selectRaw("coalesce(sum(case when type = 'out' then amount else 0 end), 0) as cash_out")
            ->first();
        $depositRows = $deposits->selectRaw('coalesce(sum(d.counted_amount), 0) as counted_amount')
            ->selectRaw("coalesce(sum(case when d.status in ('received', 'corrected') then d.received_amount else 0 end), 0) as received_amount")
            ->selectRaw("coalesce(sum(case when d.status in ('submitted', 'received', 'discrepancy', 'corrected') then d.deposit_amount else 0 end), 0) as deposit_amount")
            ->first();

        $cashSales = Decimal::money((string) $saleRows->cash_sales);
        $cashIn = Decimal::money((string) $movementRows->cash_in);
        $cashOut = Decimal::money((string) $movementRows->cash_out);
        $depositsAmount = Decimal::money((string) $depositRows->deposit_amount);

        $balances = [];
        if ($canSeeAll) {
            $balances = DB::table('fund_accounts as f')
                ->leftJoin('fund_ledger_entries as e', 'e.fund_account_id', '=', 'f.id')
                ->where('f.store_id', $storeId)->where('f.is_active', true)
                ->groupBy('f.id', 'f.type', 'f.name')
                ->orderBy('f.id')
                ->get(['f.id', 'f.type', 'f.name'])->map(function ($row) {
                    $balance = DB::table('fund_ledger_entries')->where('fund_account_id', $row->id)->sum('amount');

                    return ['id' => (int) $row->id, 'type' => $row->type, 'name' => $row->name, 'balance' => Decimal::moneyString(Decimal::money((string) $balance))];
                })->all();
        }

        return [
            'sales' => [
                'transaction_count' => (int) $saleRows->sale_count,
                'cash' => Decimal::moneyString($cashSales),
                'payroll_credit' => Decimal::moneyString(Decimal::money((string) $saleRows->credit_sales)),
            ],
            'movements' => [
                'cash_in' => Decimal::moneyString($cashIn),
                'cash_out' => Decimal::moneyString($cashOut),
            ],
            'deposits' => [
                'counted_amount' => Decimal::moneyString(Decimal::money((string) $depositRows->counted_amount)),
                'settled_amount' => Decimal::moneyString(Decimal::money((string) $depositRows->deposit_amount)),
                'received_amount' => Decimal::moneyString(Decimal::money((string) $depositRows->received_amount)),
            ],
            'net_cash_movement' => Decimal::moneyString($cashSales + $cashIn - $cashOut - $depositsAmount),
            'shift_count' => (int) $shifts->count(),
            'fund_balances' => $balances,
        ];
    }

    /** @param array<string, mixed> $filters @return array{0: string, 1: string} */
    private function boundaries(array $filters): array
    {
        $start = Carbon::parse($filters['date_from'], 'Asia/Jakarta')->startOfDay()->utc()->format('Y-m-d H:i:s.u');
        $end = Carbon::parse($filters['date_to'], 'Asia/Jakarta')->endOfDay()->utc()->format('Y-m-d H:i:s.u');

        return [$start, $end];
    }

    /** @param array<string, mixed> $filters */
    private function cashierId(User $actor, array $filters, bool $canSeeAll): ?int
    {
        if (! $canSeeAll) {
            return $actor->id;
        }

        return isset($filters['cashier_id']) ? (int) $filters['cashier_id'] : null;
    }
}
