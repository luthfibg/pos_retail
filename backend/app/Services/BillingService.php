<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Tagihan HRD (kredit potong gaji).
 *  - periode: satu terbuka per toko; Admin menutup pada hari gaji; menutup = mengikat semua struk kredit terposting
 *    yang belum terikat (billing_period_id) ke periode itu, lalu periode berikutnya langsung dibuka
 *  - invoice: satu per periode tertutup, satu baris per struk (receivable_invoice_lines), dikelompokkan per karyawan saat tampil
 *  - PPN kredit dihitung di invoice (bila vat_enabled + tarif lengkap, R-04); struk kredit tidak memuat PPN
 *  - alur status invoice: draft -> issued -> handed_to_hr -> partially_paid -> paid (pembayaran HRD boleh sebagian [ASUMSI])
 *  - struk yang sudah di-invoice tidak dapat di-void (butuh credit note, Paket 2)
 */
class BillingService
{
    private const PAYABLE = ['issued', 'handed_to_hr', 'partially_paid'];

    private const ANNUAL_REPORT_SETTING = 'receivable_annual_report_print_on';

    public function __construct(private AuditLogger $audit, private NumberSequence $sequences) {}

    // ------------------------------------------------------------------ periode

    public function periods(int $storeId, int $perPage): LengthAwarePaginator
    {
        return $this->periodQuery($storeId)->orderByDesc('p.id')->paginate($perPage)->through(fn ($r) => $this->presentPeriod($r));
    }

    /** @return array<string, mixed>|null */
    public function currentPeriod(int $storeId): ?array
    {
        $row = $this->periodQuery($storeId)->where('p.status', 'open')->first();

        return $row === null ? null : $this->presentPeriod($row);
    }

    /** @return array<string, mixed> */
    public function findPeriod(int $storeId, int $id): array
    {
        $row = $this->periodQuery($storeId)->where('p.id', $id)->first();
        abort_if($row === null, 404, 'Periode tagihan tidak ditemukan.');

        $out = $this->presentPeriod($row);
        $out['customers'] = $this->customerSummary($id);

        return $out;
    }

    /**
     * @param  array<string, mixed>  $data  label?, period_month?, scheduled_close_date?
     * @return array<string, mixed>
     */
    public function openPeriod(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            if (DB::table('billing_periods')->where('store_id', $storeId)->where('status', 'open')->lockForUpdate()->exists()) {
                throw ValidationException::withMessages(['status' => ['Masih ada periode tagihan yang terbuka. Tutup dulu sebelum membuka yang baru.']]);
            }

            $id = $this->insertOpenPeriod(
                $storeId,
                $this->now(),
                $data['label'] ?? null,
                $data['scheduled_close_date'] ?? null,
                $this->defaultPeriodMonth($storeId),
            );

            $this->audit->log('billing_period.open', 'billing_period', $id,
                after: ['label' => $data['label'] ?? null, 'scheduled_close_date' => $data['scheduled_close_date'] ?? null],
                storeId: $storeId, actorId: $actor->id);

            return $id;
        });

        return $this->findPeriod($storeId, $id);
    }

    /**
     * Ubah label / bulan periode / tanggal gaji terjadwal. Hanya periode terbuka.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function updatePeriod(User $actor, int $storeId, int $id, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $p = DB::table('billing_periods')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($p === null, 404, 'Periode tagihan tidak ditemukan.');

            if ($p->status !== 'open') {
                throw ValidationException::withMessages(['status' => ['Hanya periode yang masih terbuka yang dapat diubah.']]);
            }

            $changes = [];
            foreach (['label', 'period_month', 'scheduled_close_date'] as $f) {
                if (array_key_exists($f, $data) && $data[$f] !== $p->{$f}) {
                    $changes[$f] = $data[$f];
                }
            }
            if (isset($changes['period_month'])
                && $p->label === $this->periodLabel(Carbon::parse($p->period_month, 'Asia/Jakarta'))
                && (! array_key_exists('label', $data) || $data['label'] === $p->label)) {
                $changes['label'] = $this->periodLabel(Carbon::parse($changes['period_month'], 'Asia/Jakarta'));
            }
            if ($changes === []) {
                return;
            }

            DB::table('billing_periods')->where('id', $id)->update($changes);
            $this->audit->log('billing_period.update', 'billing_period', $id,
                before: array_intersect_key((array) $p, $changes), after: $changes, storeId: $storeId, actorId: $actor->id);
        });

        return $this->findPeriod($storeId, $id);
    }

    /**
     * Tutup periode: struk kredit terposting yang belum terikat (dan sudah terposting sampai saat ini) diikat ke periode ini.
     * Periode berikutnya dibuka otomatis; struk kredit baru otomatis masuk ke sana.
     *
     * @return array<string, mixed>
     */
    public function closePeriod(User $actor, int $storeId, int $id): array
    {
        DB::transaction(function () use ($actor, $storeId, $id) {
            $p = DB::table('billing_periods')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($p === null, 404, 'Periode tagihan tidak ditemukan.');

            if ($p->status !== 'open') {
                throw ValidationException::withMessages(['status' => ['Periode ini sudah ditutup.']]);
            }

            $now = $this->now();

            $bound = DB::table('sales')
                ->where('store_id', $storeId)->where('payment_mode', 'payroll_credit')->where('status', 'posted')
                ->whereNull('billing_period_id')->where('posted_at', '<=', $now)
                ->update(['billing_period_id' => $id]);

            DB::table('billing_periods')->where('id', $id)->update(['status' => 'closed', 'closed_at' => $now, 'closed_by' => $actor->id]);

            $nextMonth = Carbon::parse($p->period_month, 'Asia/Jakarta')->startOfMonth()->addMonthNoOverflow();
            $nextId = $this->insertOpenPeriod($storeId, $now, null, null, $nextMonth);

            $this->audit->log('billing_period.close', 'billing_period', $id,
                before: ['status' => 'open'], after: ['status' => 'closed', 'sales_bound' => $bound, 'next_period_id' => $nextId],
                storeId: $storeId, actorId: $actor->id);
        });

        return $this->findPeriod($storeId, $id);
    }

    public function cancelPeriod(User $actor, int $storeId, int $id, string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            DB::table('stores')->where('id', $storeId)->lockForUpdate()->first();
            $period = DB::table('billing_periods')
                ->where('store_id', $storeId)
                ->where('id', $id)
                ->lockForUpdate()
                ->first();
            abort_if($period === null, 404, 'Periode tagihan tidak ditemukan.');

            if (! in_array($period->status, ['open', 'closed'], true)) {
                throw ValidationException::withMessages(['status' => ['Hanya periode terbuka atau ditutup yang dapat dibatalkan.']]);
            }

            $hasInvoice = DB::table('receivable_invoices')->where('billing_period_id', $id)->exists();
            $hasBoundSales = DB::table('sales')
                ->where('store_id', $storeId)
                ->where('billing_period_id', $id)
                ->where('payment_mode', 'payroll_credit')
                ->where('status', 'posted')
                ->exists();
            $hasUnboundSales = $period->status === 'open' && DB::table('sales')
                ->where('store_id', $storeId)
                ->whereNull('billing_period_id')
                ->where('payment_mode', 'payroll_credit')
                ->where('status', 'posted')
                ->exists();

            if ($hasInvoice || $hasBoundSales || $hasUnboundSales) {
                throw ValidationException::withMessages([
                    'status' => ['Periode hanya dapat dibatalkan jika belum memiliki invoice atau struk kredit terposting.'],
                ]);
            }

            DB::table('billing_periods')->where('id', $id)->update(['status' => 'cancelled']);
            $this->audit->log(
                'billing_period.cancel',
                'billing_period',
                $id,
                before: ['status' => $period->status, 'label' => $period->label],
                after: ['status' => 'cancelled'],
                reason: $reason,
                storeId: $storeId,
                actorId: $actor->id,
            );
        });

        return $this->findPeriod($storeId, $id);
    }

    // ------------------------------------------------------------------ invoice

    /**
     * Buat invoice gabungan dari periode tertutup (status draft). Struk ditandai invoiced agar tidak dapat di-void.
     *
     * @param  array<string, mixed>  $data  bill_to?
     * @return array<string, mixed>
     */
    public function generateInvoice(User $actor, int $storeId, int $periodId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $periodId, $data) {
            $p = DB::table('billing_periods')->where('store_id', $storeId)->where('id', $periodId)->lockForUpdate()->first();
            abort_if($p === null, 404, 'Periode tagihan tidak ditemukan.');

            if ($p->status === 'cancelled') {
                throw ValidationException::withMessages(['status' => ['Periode ini telah dibatalkan dan tidak dapat dibuatkan invoice.']]);
            }
            if ($p->status === 'open') {
                throw ValidationException::withMessages(['status' => ['Tutup periode dulu sebelum membuat invoice.']]);
            }
            if ($p->status === 'invoiced' || DB::table('receivable_invoices')->where('billing_period_id', $periodId)->exists()) {
                throw ValidationException::withMessages(['status' => ['Periode ini sudah memiliki invoice.']]);
            }

            $sales = DB::table('sales')
                ->where('billing_period_id', $periodId)->where('payment_mode', 'payroll_credit')->where('status', 'posted')
                ->orderBy('customer_id')->orderBy('id')->lockForUpdate()
                ->get(['id', 'customer_id', 'total']);

            if ($sales->isEmpty()) {
                throw ValidationException::withMessages(['status' => ['Tidak ada struk kredit pada periode ini.']]);
            }

            $subtotal = 0;
            foreach ($sales as $s) {
                $subtotal += Decimal::money((string) $s->total);
            }

            [$tax, $rate, $total] = $this->invoiceTax($storeId, $subtotal);

            $period = Carbon::now('Asia/Jakarta')->format('Ym');
            $docNo = DocumentNumber::format('INV', $this->sequences->next($storeId, 'INV', $period), $period);

            $invoiceId = DB::table('receivable_invoices')->insertGetId([
                'store_id' => $storeId,
                'doc_number' => $docNo,
                'billing_period_id' => $periodId,
                'bill_to' => $data['bill_to'] ?? 'HRD',
                'subtotal' => Decimal::moneyString($subtotal),
                'tax_rate_snapshot' => $rate,
                'tax_amount' => Decimal::moneyString($tax),
                'total' => Decimal::moneyString($total),
                'amount_paid' => '0.00',
                'status' => 'draft',
                'created_by' => $actor->id,
            ]);

            $rows = [];
            foreach ($sales as $s) {
                $rows[] = ['invoice_id' => $invoiceId, 'customer_id' => $s->customer_id, 'sale_id' => $s->id, 'amount' => $s->total];
            }
            foreach (array_chunk($rows, 200) as $chunk) {
                DB::table('receivable_invoice_lines')->insert($chunk);
            }

            DB::table('sales')->whereIn('id', $sales->pluck('id')->all())->update(['invoice_id' => $invoiceId, 'billing_status' => 'invoiced']);
            DB::table('billing_periods')->where('id', $periodId)->update(['status' => 'invoiced']);

            $this->audit->log('invoice.generate', 'receivable_invoice', $invoiceId,
                after: ['document_no' => $docNo, 'period_id' => $periodId, 'lines' => count($rows), 'subtotal' => Decimal::moneyString($subtotal), 'tax' => Decimal::moneyString($tax), 'total' => Decimal::moneyString($total)],
                storeId: $storeId, actorId: $actor->id);

            return $invoiceId;
        });

        return $this->findInvoice($storeId, $id);
    }

    /** @return array<string, mixed> */
    public function issueInvoice(User $actor, int $storeId, int $id): array
    {
        return $this->transition($actor, $storeId, $id, ['draft'], 'issued', 'invoice.issue', 'issued_at');
    }

    /** Invoice diserahkan ke HRD (penanda). */
    public function handOver(User $actor, int $storeId, int $id): array
    {
        return $this->transition($actor, $storeId, $id, ['issued'], 'handed_to_hr', 'invoice.hand_over', 'handed_at');
    }

    /**
     * Catat pembayaran dari HRD (potong gaji). Boleh sebagian [ASUMSI]; tidak boleh melebihi sisa tagihan.
     *
     * @param  array<string, mixed>  $data  amount, received_on?, reference?, note?
     * @return array<string, mixed>
     */
    public function recordPayment(User $actor, int $storeId, int $id, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $inv = DB::table('receivable_invoices')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($inv === null, 404, 'Invoice tidak ditemukan.');

            if (! in_array($inv->status, self::PAYABLE, true)) {
                throw ValidationException::withMessages(['status' => ['Pembayaran hanya dapat dicatat untuk invoice yang sudah diterbitkan dan belum lunas.']]);
            }

            $amount = Decimal::money((string) $data['amount']);
            $remaining = Decimal::money((string) $inv->total) - Decimal::money((string) $inv->amount_paid);

            if ($amount <= 0 || $amount > $remaining) {
                throw ValidationException::withMessages(['amount' => [sprintf('Jumlah harus lebih dari nol dan tidak melebihi sisa tagihan (%s).', Decimal::moneyString($remaining))]]);
            }

            $receivedAt = isset($data['received_on'])
                ? Carbon::parse($data['received_on'], 'Asia/Jakarta')->startOfDay()->utc()->format('Y-m-d H:i:s.v')
                : $this->now();

            $paymentId = DB::table('invoice_payments')->insertGetId([
                'invoice_id' => $id,
                'amount' => Decimal::moneyString($amount),
                'received_at' => $receivedAt,
                'reference' => $data['reference'] ?? null,
                'note' => $data['note'] ?? null,
                'recorded_by' => $actor->id,
            ]);

            $fund = DB::table('fund_accounts')
                ->where('store_id', $storeId)
                ->where('type', 'main_cash')
                ->where('is_active', true)
                ->lockForUpdate()
                ->first();
            if ($fund === null) {
                throw ValidationException::withMessages(['fund_account' => ['Akun kas besar aktif untuk penerimaan Finance belum tersedia.']]);
            }

            DB::table('fund_ledger_entries')->insert([
                'fund_account_id' => $fund->id,
                'entry_type' => 'invoice_payment_in',
                'amount' => Decimal::moneyString($amount),
                'ref_type' => 'invoice_payment',
                'ref_id' => $paymentId,
                'occurred_at' => $receivedAt,
                'created_by' => $actor->id,
                'note' => 'Pembayaran HRD '.$inv->doc_number,
            ]);

            $paid = Decimal::money((string) $inv->amount_paid) + $amount;
            $status = $paid >= Decimal::money((string) $inv->total) ? 'paid' : 'partially_paid';

            DB::table('receivable_invoices')->where('id', $id)->update(['amount_paid' => Decimal::moneyString($paid), 'status' => $status]);

            if ($status === 'paid') {
                DB::table('sales')->where('invoice_id', $id)->update(['billing_status' => 'paid']);
            }

            $this->audit->log('invoice.record_payment', 'receivable_invoice', $id,
                before: ['status' => $inv->status, 'amount_paid' => $inv->amount_paid],
                after: ['status' => $status, 'amount_paid' => Decimal::moneyString($paid), 'payment_id' => $paymentId, 'amount' => Decimal::moneyString($amount)],
                reason: $data['note'] ?? null, storeId: $storeId, actorId: $actor->id);
        });

        return $this->findInvoice($storeId, $id);
    }

    /** @return array{current_year: int, years: list<array{year: int, is_current: bool, print_enabled: bool}>} */
    public function annualReportYears(int $storeId): array
    {
        $timezone = $this->storeTimezone($storeId);
        $currentYear = Carbon::now($timezone)->year;
        $years = DB::table('sales as s')
            ->join('billing_periods as p', 'p.id', '=', 's.billing_period_id')
            ->where('s.store_id', $storeId)
            ->where('s.payment_mode', 'payroll_credit')
            ->where('s.status', 'posted')
            ->whereYear('p.period_month', '>=', 2000)
            ->whereYear('p.period_month', '<=', $currentYear)
            ->distinct()
            ->selectRaw('YEAR(p.period_month) as year')
            ->orderByDesc('year')
            ->pluck('year')
            ->map(fn ($year) => (int) $year)
            ->unique()
            ->values()
            ->all();

        if (! in_array($currentYear, $years, true)) {
            $years[] = $currentYear;
        }

        rsort($years);
        $printOn = $this->annualReportSetting($storeId)['print_on'];

        return [
            'current_year' => $currentYear,
            'years' => array_map(fn (int $year) => [
                'year' => $year,
                'is_current' => $year === $currentYear,
                'print_enabled' => $this->annualReportPrintEnabled($year, $currentYear, $printOn, $timezone),
            ], $years),
        ];
    }

    /** @return array<string, mixed> */
    public function annualReport(int $storeId, int $year): array
    {
        $timezone = $this->storeTimezone($storeId);
        $currentYear = Carbon::now($timezone)->year;
        abort_if($year < 2000 || $year > $currentYear, 404, 'Laporan tahunan tidak ditemukan.');

        $asOf = $year === $currentYear
            ? Carbon::now($timezone)
            : Carbon::create($year, 12, 31, 0, 0, 0, $timezone)->endOfDay();
        $cutoff = $asOf->copy()->utc()->format('Y-m-d H:i:s.v');
        $periodEnd = $year === $currentYear
            ? min($asOf->toDateString(), $year.'-12-31')
            : $year.'-12-31';

        $customers = [];
        $sales = DB::table('sales as s')
            ->join('billing_periods as p', 'p.id', '=', 's.billing_period_id')
            ->join('customers as c', 'c.id', '=', 's.customer_id')
            ->where('s.store_id', $storeId)
            ->where('s.payment_mode', 'payroll_credit')
            ->where('s.status', 'posted')
            ->whereBetween('p.period_month', [$year.'-01-01', $periodEnd])
            ->groupBy('c.id', 'c.customer_no', 'c.name', 'c.department')
            ->orderBy('c.name')
            ->selectRaw('c.id, c.customer_no, c.name, c.department, count(*) as sales_count, sum(s.total) as billed')
            ->get();

        foreach ($sales as $sale) {
            $customerId = (int) $sale->id;
            $customers[$customerId] = [
                'customer_id' => $customerId,
                'customer_no' => $sale->customer_no,
                'name' => $sale->name,
                'department' => $sale->department,
                'sales_count' => (int) $sale->sales_count,
                'billed_units' => Decimal::money((string) $sale->billed),
                'paid_units' => 0,
            ];
        }

        $invoices = DB::table('receivable_invoices as i')
            ->join('billing_periods as p', 'p.id', '=', 'i.billing_period_id')
            ->where('i.store_id', $storeId)
            ->whereBetween('p.period_month', [$year.'-01-01', $periodEnd])
            ->where('i.status', '<>', 'cancelled')
            ->get(['i.id', 'i.subtotal', 'i.total']);
        $invoiceIds = $invoices->pluck('id')->all();
        $linesByInvoice = [];

        if ($invoiceIds !== []) {
            $lines = DB::table('receivable_invoice_lines as l')
                ->join('customers as c', 'c.id', '=', 'l.customer_id')
                ->whereIn('l.invoice_id', $invoiceIds)
                ->orderBy('c.name')
                ->get(['l.invoice_id', 'l.customer_id', 'l.amount', 'c.customer_no', 'c.name', 'c.department']);

            foreach ($lines as $line) {
                $customerId = (int) $line->customer_id;
                if (! isset($customers[$customerId])) {
                    $customers[$customerId] = [
                        'customer_id' => $customerId,
                        'customer_no' => $line->customer_no,
                        'name' => $line->name,
                        'department' => $line->department,
                        'sales_count' => 0,
                        'billed_units' => 0,
                        'paid_units' => 0,
                    ];
                }
                $linesByInvoice[$line->invoice_id][$customerId] =
                    ($linesByInvoice[$line->invoice_id][$customerId] ?? 0) + Decimal::money((string) $line->amount);
            }
        }

        $paymentsByInvoice = [];
        if ($invoiceIds !== []) {
            $paymentsByInvoice = DB::table('invoice_payments')
                ->whereIn('invoice_id', $invoiceIds)
                ->where('received_at', '<=', $cutoff)
                ->groupBy('invoice_id')
                ->selectRaw('invoice_id, sum(amount) as paid')
                ->pluck('paid', 'invoice_id')
                ->all();
        }

        foreach ($invoices as $invoice) {
            $weights = $linesByInvoice[$invoice->id] ?? [];
            if ($weights === []) {
                continue;
            }

            $taxUnits = Decimal::money((string) $invoice->total) - Decimal::money((string) $invoice->subtotal);
            $taxAllocation = $this->allocateProportionally($taxUnits, $weights);
            foreach ($taxAllocation as $customerId => $allocated) {
                $customers[$customerId]['billed_units'] += $allocated;
            }

            $grossWeights = [];
            foreach ($weights as $customerId => $principal) {
                $grossWeights[$customerId] = $principal + ($taxAllocation[$customerId] ?? 0);
            }
            $paidAllocation = $this->allocateProportionally(
                min(
                    Decimal::money((string) ($paymentsByInvoice[$invoice->id] ?? '0.00')),
                    array_sum($grossWeights),
                ),
                $grossWeights,
            );
            foreach ($paidAllocation as $customerId => $allocated) {
                $customers[$customerId]['paid_units'] += $allocated;
            }
        }

        $customerRows = array_map(static function (array $customer): array {
            return [
                'customer_id' => $customer['customer_id'],
                'customer_no' => $customer['customer_no'],
                'name' => $customer['name'],
                'department' => $customer['department'],
                'sales_count' => $customer['sales_count'],
                'billed' => Decimal::moneyString($customer['billed_units']),
                'paid' => Decimal::moneyString($customer['paid_units']),
                'outstanding' => Decimal::moneyString($customer['billed_units'] - $customer['paid_units']),
            ];
        }, array_values($customers));
        usort($customerRows, static fn (array $a, array $b) => strcasecmp($a['name'], $b['name']));

        $billedTotal = array_sum(array_column($customers, 'billed_units'));
        $paidTotal = array_sum(array_column($customers, 'paid_units'));
        $printOn = $this->annualReportSetting($storeId)['print_on'];

        return [
            'year' => $year,
            'start_date' => $year.'-01-01',
            'end_date' => $periodEnd,
            'as_of' => $asOf->format('Y-m-d H:i:s'),
            'is_current' => $year === $currentYear,
            'print_enabled' => $this->annualReportPrintEnabled($year, $currentYear, $printOn, $timezone),
            'totals' => [
                'billed' => Decimal::moneyString($billedTotal),
                'paid' => Decimal::moneyString($paidTotal),
                'outstanding' => Decimal::moneyString($billedTotal - $paidTotal),
                'customers' => count($customerRows),
                'sales_count' => array_sum(array_column($customerRows, 'sales_count')),
            ],
            'customers' => $customerRows,
        ];
    }

    /** @return array{print_on: string} */
    public function annualReportSetting(int $storeId): array
    {
        $value = DB::table('settings')
            ->where('store_id', $storeId)
            ->where('setting_key', self::ANNUAL_REPORT_SETTING)
            ->value('setting_value');

        return ['print_on' => $value === null ? '12-31' : (string) json_decode((string) $value, true)];
    }

    /** @param array{print_on: string} $data
     * @return array{print_on: string}
     */
    public function updateAnnualReportSetting(User $actor, int $storeId, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $data) {
            $before = $this->annualReportSetting($storeId);
            $after = ['print_on' => $data['print_on']];

            if ($before === $after) {
                return $after;
            }

            DB::table('settings')->upsert(
                [[
                    'store_id' => $storeId,
                    'setting_key' => self::ANNUAL_REPORT_SETTING,
                    'setting_value' => json_encode($after['print_on']),
                    'updated_by' => $actor->id,
                ]],
                ['store_id', 'setting_key'],
                ['setting_value', 'updated_by'],
            );

            $this->audit->log(
                'settings.annual_receivable_report',
                'setting',
                null,
                before: $before,
                after: $after,
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $after;
        });
    }

    public function invoices(int $storeId, ?string $status, int $perPage): LengthAwarePaginator
    {
        return DB::table('receivable_invoices as i')
            ->join('billing_periods as p', 'p.id', '=', 'i.billing_period_id')
            ->where('i.store_id', $storeId)
            ->when($status !== null, fn ($q) => $q->where('i.status', $status))
            ->orderByDesc('i.id')
            ->select(['i.*', 'p.label as period_label'])
            ->paginate($perPage)->through(fn ($r) => $this->presentInvoice($r));
    }

    /** @return array<string, mixed> */
    public function findInvoice(int $storeId, int $id): array
    {
        $row = DB::table('receivable_invoices as i')
            ->join('billing_periods as p', 'p.id', '=', 'i.billing_period_id')
            ->where('i.store_id', $storeId)->where('i.id', $id)
            ->select(['i.*', 'p.label as period_label'])->first();
        abort_if($row === null, 404, 'Invoice tidak ditemukan.');

        $out = $this->presentInvoice($row);

        $lines = DB::table('receivable_invoice_lines as l')
            ->join('customers as c', 'c.id', '=', 'l.customer_id')
            ->join('sales as s', 's.id', '=', 'l.sale_id')
            ->where('l.invoice_id', $id)->orderBy('c.name')->orderBy('l.id')
            ->get(['l.customer_id', 'c.customer_no', 'c.name', 'c.department', 's.id as sale_id', 's.doc_number', 's.posted_at', 'l.amount']);

        $groups = [];
        foreach ($lines as $l) {
            $g = &$groups[$l->customer_id];
            $g ??= ['customer_id' => (int) $l->customer_id, 'customer_no' => $l->customer_no, 'name' => $l->name, 'department' => $l->department, 'subtotal_units' => 0, 'sales' => []];
            $g['subtotal_units'] += Decimal::money((string) $l->amount);
            $g['sales'][] = ['sale_id' => (int) $l->sale_id, 'doc_number' => $l->doc_number, 'posted_at' => $l->posted_at, 'amount' => $l->amount];
            unset($g);
        }

        $out['customers'] = array_values(array_map(function ($g) {
            $g['subtotal'] = Decimal::moneyString($g['subtotal_units']);
            unset($g['subtotal_units']);

            return $g;
        }, $groups));

        $out['payments'] = DB::table('invoice_payments as pay')
            ->join('users as u', 'u.id', '=', 'pay.recorded_by')
            ->where('pay.invoice_id', $id)->orderBy('pay.id')
            ->get(['pay.id', 'pay.amount', 'pay.received_at', 'pay.reference', 'pay.note', 'u.name as recorded_by_name'])
            ->map(fn ($r) => ['id' => (int) $r->id, 'amount' => $r->amount, 'received_at' => $r->received_at, 'reference' => $r->reference, 'note' => $r->note, 'recorded_by_name' => $r->recorded_by_name])
            ->all();

        return $out;
    }

    // ------------------------------------------------------------------ internal

    /** @param array<int, int> $weights
     * @return array<int, int>
     */
    private function allocateProportionally(int $amount, array $weights): array
    {
        $weightTotal = array_sum($weights);
        if ($weightTotal <= 0 || $weights === []) {
            return [];
        }

        $allocation = [];
        $remainders = [];
        $allocatedTotal = 0;
        foreach ($weights as $key => $weight) {
            [$allocated, $remainder] = $this->multiplyDivideRemainder($amount, $weight, $weightTotal);
            $allocation[$key] = $allocated;
            $allocatedTotal += $allocated;
            $remainders[] = ['key' => $key, 'remainder' => $remainder];
        }

        usort($remainders, static fn (array $a, array $b) => $b['remainder'] <=> $a['remainder'] ?: $a['key'] <=> $b['key']);
        $remaining = $amount - $allocatedTotal;
        for ($index = 0; $index < $remaining; $index++) {
            $allocation[$remainders[$index]['key']]++;
        }

        return $allocation;
    }

    /** @return array{int, int} Quotient and remainder without overflowing the intermediate product. */
    private function multiplyDivideRemainder(int $amount, int $weight, int $weightTotal): array
    {
        $bits = [];
        for ($remaining = $weight; $remaining > 0; $remaining = intdiv($remaining, 2)) {
            $bits[] = $remaining % 2;
        }

        $quotient = 0;
        $remainder = 0;
        foreach (array_reverse($bits) as $bit) {
            if ($remainder >= $weightTotal - $remainder) {
                $remainder -= $weightTotal - $remainder;
                $quotient = $quotient * 2 + 1;
            } else {
                $remainder *= 2;
                $quotient *= 2;
            }

            if ($bit === 1) {
                $quotient += intdiv($amount, $weightTotal);
                $addRemainder = $amount % $weightTotal;
                if ($remainder >= $weightTotal - $addRemainder) {
                    $remainder -= $weightTotal - $addRemainder;
                    $quotient++;
                } else {
                    $remainder += $addRemainder;
                }
            }
        }

        return [$quotient, $remainder];
    }

    private function annualReportPrintEnabled(int $year, int $currentYear, string $printOn, string $timezone): bool
    {
        if ($year < $currentYear) {
            return true;
        }
        if ($year > $currentYear) {
            return false;
        }

        [$month, $day] = array_map('intval', explode('-', $printOn));
        $printDate = Carbon::create($year, $month, 1, 0, 0, 0, $timezone);
        $printDate->day = min($day, $printDate->daysInMonth);

        return Carbon::now($timezone)->startOfDay()->greaterThanOrEqualTo($printDate);
    }

    private function storeTimezone(int $storeId): string
    {
        return (string) (DB::table('stores')->where('id', $storeId)->value('timezone') ?: 'Asia/Jakarta');
    }

    /** @param list<string> $from */
    private function transition(User $actor, int $storeId, int $id, array $from, string $to, string $action, string $timeColumn): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $from, $to, $action, $timeColumn) {
            $inv = DB::table('receivable_invoices')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($inv === null, 404, 'Invoice tidak ditemukan.');

            if (! in_array($inv->status, $from, true)) {
                throw ValidationException::withMessages(['status' => ["Status invoice saat ini ({$inv->status}) tidak dapat diubah ke {$to}."]]);
            }

            DB::table('receivable_invoices')->where('id', $id)->update(['status' => $to, $timeColumn => $this->now()]);
            $this->audit->log($action, 'receivable_invoice', $id, before: ['status' => $inv->status], after: ['status' => $to], storeId: $storeId, actorId: $actor->id);
        });

        return $this->findInvoice($storeId, $id);
    }

    private function insertOpenPeriod(
        int $storeId,
        string $startsAt,
        ?string $label,
        ?string $scheduledClose,
        ?Carbon $periodMonth = null,
    ): int {
        $periodMonth ??= Carbon::now('Asia/Jakarta')->startOfMonth();
        $periodMonth = $periodMonth->copy()->startOfMonth();

        return (int) DB::table('billing_periods')->insertGetId([
            'store_id' => $storeId,
            'period_month' => $periodMonth->toDateString(),
            'label' => $label ?? $this->periodLabel($periodMonth),
            'scheduled_close_date' => $scheduledClose,
            'starts_at' => $startsAt,
            'status' => 'open',
        ]);
    }

    private function defaultPeriodMonth(int $storeId): Carbon
    {
        $currentMonth = Carbon::now('Asia/Jakarta')->startOfMonth();
        $previous = DB::table('billing_periods')
            ->where('store_id', $storeId)
            ->orderByDesc('id')
            ->first(['period_month', 'status']);

        if ($previous === null) {
            return $currentMonth;
        }

        $month = Carbon::parse($previous->period_month, 'Asia/Jakarta')->startOfMonth();
        if ($previous->status !== 'cancelled') {
            $month->addMonthNoOverflow();
        }

        return $month->greaterThan($currentMonth) ? $month : $currentMonth;
    }

    private function periodLabel(Carbon $periodMonth): string
    {
        return 'Periode '.$this->monthName($periodMonth->month);
    }

    private function monthName(int $month): string
    {
        return [
            1 => 'Januari',
            2 => 'Februari',
            3 => 'Maret',
            4 => 'April',
            5 => 'Mei',
            6 => 'Juni',
            7 => 'Juli',
            8 => 'Agustus',
            9 => 'September',
            10 => 'Oktober',
            11 => 'November',
            12 => 'Desember',
        ][$month];
    }

    /** @return array{0: int, 1: string|null, 2: int} [pajak, tarif, total] */
    private function invoiceTax(int $storeId, int $subtotal): array
    {
        $enabled = DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'vat_enabled')->value('setting_value');
        if ($enabled === null || json_decode((string) $enabled, true) !== true) {
            return [0, null, $subtotal];
        }

        $rate = DB::table('tax_rates')->where('store_id', $storeId)->where('effective_from', '<=', Carbon::now('Asia/Jakarta')->toDateString())
            ->orderByDesc('effective_from')->orderByDesc('id')->first();

        if ($rate === null || $rate->price_includes_tax === null) {
            throw ValidationException::withMessages(['status' => ['Konfigurasi PPN belum lengkap (tarif atau status harga termasuk PPN); invoice belum dapat dibuat.']]);
        }

        $units = Decimal::money((string) $rate->rate);

        if ($rate->price_includes_tax) {
            $tax = intdiv($subtotal * $units + intdiv(10000 + $units, 2), 10000 + $units);

            return [$tax, (string) $rate->rate, $subtotal];
        }

        $tax = intdiv($subtotal * $units + 5000, 10000);

        return [$tax, (string) $rate->rate, $subtotal + $tax];
    }

    private function periodQuery(int $storeId)
    {
        return DB::table('billing_periods as p')
            ->where('p.store_id', $storeId)
            ->selectRaw(
                'p.*, '.
                "(select count(*) from sales s where s.store_id = p.store_id and s.payment_mode = 'payroll_credit' and s.status = 'posted' and (s.billing_period_id = p.id or (p.status = 'open' and s.billing_period_id is null))) as sales_count, ".
                "(select coalesce(sum(s.total), 0) from sales s where s.store_id = p.store_id and s.payment_mode = 'payroll_credit' and s.status = 'posted' and (s.billing_period_id = p.id or (p.status = 'open' and s.billing_period_id is null))) as sales_total, ".
                '(select i.id from receivable_invoices i where i.billing_period_id = p.id limit 1) as invoice_id'
            );
    }

    /** @return list<array<string, mixed>> */
    private function customerSummary(int $periodId): array
    {
        $period = DB::table('billing_periods')->where('id', $periodId)->first(['store_id', 'status']);
        if ($period === null) {
            return [];
        }

        $sales = DB::table('sales as s')
            ->join('customers as c', 'c.id', '=', 's.customer_id')
            ->where('s.store_id', $period->store_id)->where('s.payment_mode', 'payroll_credit')->where('s.status', 'posted');
        if ($period->status === 'open') {
            $sales->whereNull('s.billing_period_id');
        } else {
            $sales->where('s.billing_period_id', $periodId);
        }

        return $sales
            ->groupBy('c.id', 'c.customer_no', 'c.name', 'c.department')->orderBy('c.name')
            ->selectRaw('c.id, c.customer_no, c.name, c.department, count(*) as sales_count, sum(s.total) as total')
            ->get()
            ->map(fn ($r) => ['customer_id' => (int) $r->id, 'customer_no' => $r->customer_no, 'name' => $r->name, 'department' => $r->department,
                'sales_count' => (int) $r->sales_count, 'total' => Decimal::moneyString(Decimal::money((string) $r->total))])
            ->all();
    }

    /** @return array<string, mixed> */
    private function presentPeriod(object $r): array
    {
        return [
            'id' => (int) $r->id,
            'label' => $r->label,
            'period_month' => $r->period_month,
            'status' => $r->status,
            'scheduled_close_date' => $r->scheduled_close_date,
            'starts_at' => $r->starts_at,
            'closed_at' => $r->closed_at,
            'sales_count' => (int) $r->sales_count,
            'sales_total' => Decimal::moneyString(Decimal::money((string) $r->sales_total)),
            'invoice_id' => $r->invoice_id === null ? null : (int) $r->invoice_id,
        ];
    }

    /** @return array<string, mixed> */
    private function presentInvoice(object $r): array
    {
        $remaining = Decimal::money((string) $r->total) - Decimal::money((string) $r->amount_paid);

        return [
            'id' => (int) $r->id,
            'document_no' => $r->doc_number,
            'billing_period_id' => (int) $r->billing_period_id,
            'period_label' => $r->period_label,
            'bill_to' => $r->bill_to,
            'subtotal' => $r->subtotal,
            'tax_rate' => $r->tax_rate_snapshot,
            'tax_amount' => $r->tax_amount,
            'total' => $r->total,
            'amount_paid' => $r->amount_paid,
            'amount_remaining' => Decimal::moneyString($remaining),
            'status' => $r->status,
            'issued_at' => $r->issued_at,
            'handed_at' => $r->handed_at,
            'created_at' => $r->created_at,
        ];
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
