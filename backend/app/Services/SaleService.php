<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use Carbon\Carbon;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Posting penjualan POS. Satu transaksi database: sale, item, batch FEFO, pembayaran, ledger kas kecil, audit.
 *
 * Aturan utama:
 *  - hanya pada shift AKTIF milik kasir sendiri; shift berstatus counting memblokir penjualan baru
 *  - harga dan HPP = snapshot saat transaksi; kasir tidak bisa mengubah harga atau memberi diskon manual (P-12)
 *  - diskon = aturan Admin (tabel discounts, produk atau kategori); dipilih yang paling besar per baris [ASUMSI];
 *    tipe 'amount' = nominal per unit [ASUMSI]
 *  - idempotency_key (uuid dari frontend): pengiriman ulang mengembalikan struk yang sama, bukan ganda
 *  - tunai: uang diterima >= total; masuk ledger kas kecil; PPN bila diaktifkan (setting vat_enabled, R-04)
 *  - kredit potong gaji: wajib karyawan aktif dengan batas terisi (R-09); total baru + pemakaian belum ditagih
 *    tidak boleh melebihi batas, kecuali pengecualian Admin (re-auth, catatan wajib, bertanda over_limit_flag, R-02);
 *    PPN kredit dihitung saat invoice, bukan di struk
 *  - stok kurang -> seluruh transaksi gagal (anti-negatif), pesan di items.N.qty
 *  - VOID (sales.void, Admin): dokumen sale_voids + status 'voided', bukan hapus. Stok kembali ke batch asal (voidSale),
 *    kredit hanya bila belum ditagihkan, tunai hanya selama shift struk itu masih open (uang kembali dari laci yang sama,
 *    ledger Kas Kecil dibalik) [ASUMSI]; struk tunai dari shift yang sudah ditutup = retur pelanggan (Paket 2)
 */
class SaleService
{
    public function __construct(
        private InventoryService $inventory,
        private NumberSequence $sequences,
        private AuditLogger $audit,
        private ReauthService $reauth,
    ) {
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{0: array<string, mixed>, 1: bool}  [struk, baru dibuat?]
     */
    public function post(User $actor, int $storeId, array $data): array
    {
        $key = (string) $data['idempotency_key'];

        if ($existing = $this->replay($actor, $storeId, $key)) {
            return [$existing, false];
        }

        $isCredit = $data['payment_mode'] === 'payroll_credit';

        // re-auth di luar transaksi agar catatan percobaan gagalnya tidak ikut ter-rollback
        $approver = null;
        if ($isCredit && ! empty($data['credit_exception'])) {
            $exception = $data['credit_exception'];
            $approver = $this->reauth->confirm(
                (string) $exception['approver_username'],
                (string) $exception['approver_password'],
                'sales.credit_exception',
                $actor,
            );
        }

        try {
            $saleId = DB::transaction(fn () => $this->postInTransaction($actor, $storeId, $data, $approver));
        } catch (UniqueConstraintViolationException $e) {
            if ($existing = $this->replay($actor, $storeId, $key)) {
                return [$existing, false];
            }
            throw $e;
        }

        return [$this->find($actor, $storeId, $saleId, true) ?? [], true];
    }

    /** @return array<string, mixed>|null */
    public function find(User $actor, int $storeId, int $id, bool $canSeeAll, bool $asCopy = false): ?array
    {
        $sale = $this->saleQuery($storeId)->where('s.id', $id)->first();

        if ($sale === null || (! $canSeeAll && (int) $sale->cashier_id !== $actor->id)) {
            return null;
        }

        $items = DB::table('sale_items as i')->join('products as p', 'p.id', '=', 'i.product_id')
            ->where('i.sale_id', $id)->orderBy('i.id')
            ->get(['i.id', 'i.product_id', 'p.sku', 'p.name', 'p.unit_name', 'i.qty', 'i.unit_price', 'i.discount_amount', 'i.line_total'])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'product_id' => (int) $row->product_id,
                'sku' => $row->sku,
                'name' => $row->name,
                'unit_name' => $row->unit_name,
                'qty' => $row->qty,
                'unit_price' => $row->unit_price,
                'discount_amount' => $row->discount_amount,
                'line_total' => $row->line_total,
            ])->all();

        $payment = DB::table('payments')->where('sale_id', $id)->first(['amount_tendered', 'change_given', 'amount_applied']);

        return $this->present($sale) + [
            'items' => $items,
            'payment' => $payment === null ? null : [
                'method' => 'cash',
                'amount_tendered' => $payment->amount_tendered,
                'change_given' => $payment->change_given,
                'amount_applied' => $payment->amount_applied,
            ],
            'receipt' => [
                'store_name' => DB::table('stores')->where('id', $storeId)->value('name'),
                'is_copy' => $asCopy,
                'copy_label' => $asCopy ? 'SALINAN' : null,
                'note' => $sale->payment_mode === 'payroll_credit' ? 'Belum dibayar. Ditagihkan lewat potong gaji.' : null,
                'is_void' => $sale->status === 'voided',
                'void_label' => $sale->status === 'voided' ? 'DIBATALKAN' : null,
            ],
        ];
    }

    /** Cetak ulang: selalu berlabel SALINAN dan tercatat (log + audit). @return array<string, mixed>|null */
    public function reprint(User $actor, int $storeId, int $id, bool $canSeeAll): ?array
    {
        $receipt = $this->find($actor, $storeId, $id, $canSeeAll, true);

        if ($receipt === null) {
            return null;
        }

        DB::transaction(function () use ($actor, $storeId, $id) {
            DB::table('receipt_print_logs')->insert(['sale_id' => $id, 'print_type' => 'copy', 'printed_by' => $actor->id, 'printed_at' => $this->now()]);
            $this->audit->log('receipt.reprint', 'sale', $id, storeId: $storeId, actorId: $actor->id);
        });

        return $receipt;
    }

    /**
     * Batalkan penjualan terposting (dokumen reversal). Stok kembali, kas/kredit dikoreksi, semua atomik.
     *
     * @return array<string, mixed>
     */
    public function void(User $actor, int $storeId, int $id, string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $sale = DB::table('sales')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($sale === null, 404, 'Penjualan tidak ditemukan.');

            if ($sale->status !== 'posted') {
                throw ValidationException::withMessages(['status' => ['Struk ini bukan penjualan terposting atau sudah dibatalkan.']]);
            }

            $isCredit = $sale->payment_mode === 'payroll_credit';
            $shift = DB::table('cash_shifts')->where('id', $sale->shift_id)->lockForUpdate()->first();

            if ($isCredit) {
                if ($sale->billing_period_id !== null || $sale->billing_status !== 'unbilled') {
                    throw ValidationException::withMessages(['status' => ['Struk kredit ini sudah ditagihkan; pembatalan memerlukan credit note (belum tersedia).']]);
                }
                // karyawan dikunci agar pemeriksaan batas kredit transaksi lain konsisten
                if ($sale->customer_id !== null) {
                    DB::table('customers')->where('id', $sale->customer_id)->lockForUpdate()->first();
                }
            } elseif ($shift->status !== 'open') {
                throw ValidationException::withMessages(['status' => ['Struk tunai dari shift yang sudah ditutup tidak dapat dibatalkan; gunakan retur pelanggan (belum tersedia).']]);
            }

            // kembalikan stok ke batch/saldo asal
            $locationId = $this->inventory->sellingLocationId($storeId);
            $rows = DB::table('sale_item_batches as b')->join('sale_items as i', 'i.id', '=', 'b.sale_item_id')
                ->where('i.sale_id', $id)->orderBy('i.product_id')->orderBy('b.id')
                ->get(['i.product_id', 'i.cost_snapshot', 'b.batch_id', 'b.shelf_position_id', 'b.qty']);

            $allocations = [];
            foreach ($rows as $row) {
                $balance = DB::table('inventory_balances')->where('product_id', $row->product_id)->where('location_id', $locationId)
                    ->whereRaw('position_key = ?', [$row->shelf_position_id ?? 0])->whereRaw('batch_key = ?', [$row->batch_id ?? 0])->first();
                abort_if($balance === null, 422, 'Saldo stok asal tidak ditemukan; pembatalan dihentikan.');

                $allocations[] = [
                    'product_id' => (int) $row->product_id, 'balance_id' => (int) $balance->id,
                    'batch_id' => $row->batch_id === null ? null : (int) $row->batch_id, 'location_id' => $locationId,
                    'shelf_position_id' => $row->shelf_position_id === null ? null : (int) $row->shelf_position_id,
                    'qty' => $row->qty, 'unit_cost' => $row->cost_snapshot,
                ];
            }
            $this->inventory->voidSale($storeId, $allocations, 'sale', $id, $actor->id);

            // tunai: balikkan ledger Kas Kecil (uang kembali ke pembeli dari laci shift yang sama)
            if (! $isCredit) {
                $fundId = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'petty_cash')
                    ->where('register_id', $shift->register_id)->where('is_active', 1)->value('id');
                abort_if($fundId === null, 422, 'Akun kas kecil untuk kasir ini belum tersedia.');

                DB::table('fund_ledger_entries')->insert([
                    'fund_account_id' => $fundId, 'entry_type' => 'sale_void', 'amount' => Decimal::moneyString(-Decimal::money($sale->total)),
                    'ref_type' => 'sale', 'ref_id' => $id, 'occurred_at' => $this->now(), 'created_by' => $actor->id,
                ]);
            }

            DB::table('sale_voids')->insert(['sale_id' => $id, 'reason' => $reason, 'requested_by' => $actor->id, 'approved_by' => $actor->id]);
            DB::table('sales')->where('id', $id)->update(['status' => 'voided']);

            $this->audit->log('sale.void', 'sale', $id,
                before: ['status' => 'posted', 'total' => $sale->total],
                after: ['status' => 'voided', 'payment_mode' => $sale->payment_mode],
                reason: $reason, storeId: $storeId, actorId: $actor->id);
        });

        return $this->find($actor, $storeId, $id, true) ?? [];
    }

    /** @param array<string, mixed> $filters */
    public function search(User $actor, int $storeId, array $filters, int $perPage, bool $canSeeAll): LengthAwarePaginator
    {
        $query = $this->saleQuery($storeId)->orderByDesc('s.id');

        if (! $canSeeAll) {
            $query->where('s.cashier_id', $actor->id);
        }
        foreach (['shift_id', 'customer_id'] as $field) {
            if (! empty($filters[$field])) {
                $query->where("s.{$field}", (int) $filters[$field]);
            }
        }
        foreach (['status', 'payment_mode'] as $field) {
            if (! empty($filters[$field])) {
                $query->where("s.{$field}", $filters[$field]);
            }
        }
        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where('s.doc_number', 'like', "%{$term}%");
        }
        if (! empty($filters['date_from'])) {
            $query->where('s.posted_at', '>=', Carbon::parse($filters['date_from'], 'Asia/Jakarta')->startOfDay()->utc());
        }
        if (! empty($filters['date_to'])) {
            $query->where('s.posted_at', '<=', Carbon::parse($filters['date_to'], 'Asia/Jakarta')->endOfDay()->utc());
        }

        return $query->paginate($perPage)->through(fn ($row) => $this->present($row));
    }

    // ------------------------------------------------------------------ posting

    /** @param array<string, mixed> $data */
    private function postInTransaction(User $actor, int $storeId, array $data, ?User $approver): int
    {
        $isCredit = $data['payment_mode'] === 'payroll_credit';
        $now = $this->now();

        // 1. shift aktif milik kasir
        $shift = DB::table('cash_shifts')->where('store_id', $storeId)->where('cashier_id', $actor->id)
            ->whereIn('status', ['open', 'counting'])->lockForUpdate()->first();

        if ($shift === null) {
            throw ValidationException::withMessages(['shift' => ['Buka shift terlebih dahulu sebelum berjualan.']]);
        }
        if ($shift->status === 'counting') {
            throw ValidationException::withMessages(['shift' => ['Shift sedang dihitung; penjualan baru diblokir.']]);
        }

        // 2. karyawan (dikunci agar pemeriksaan batas kredit tidak balapan)
        $customer = null;
        if (! empty($data['customer_id'])) {
            $customer = DB::table('customers')->where('store_id', $storeId)->where('id', (int) $data['customer_id'])->lockForUpdate()->first();
            if ($customer === null) {
                throw ValidationException::withMessages(['customer_id' => ['Karyawan tidak ditemukan.']]);
            }
        }
        if ($isCredit) {
            $this->assertCreditCustomer($customer);
        }

        // 3. baris: gabungkan produk sama, kunci berurutan id
        $lines = [];
        foreach ($data['items'] as $index => $item) {
            $productId = (int) $item['product_id'];
            if (isset($lines[$productId])) {
                $lines[$productId]['qty'] += Decimal::qty($item['qty']);
            } else {
                $lines[$productId] = ['index' => $index, 'product_id' => $productId, 'qty' => Decimal::qty($item['qty'])];
            }
        }
        ksort($lines);

        $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', array_keys($lines))->orderBy('id')->lockForUpdate()->get()->keyBy('id');

        $errors = [];
        foreach ($lines as $line) {
            $product = $products->get($line['product_id']);
            if ($product === null) {
                $errors["items.{$line['index']}.product_id"] = ['Produk tidak ditemukan.'];
            } elseif ($product->status !== 'active' || $product->sell_price === null) {
                $errors["items.{$line['index']}.product_id"] = ["Produk {$product->name} belum dapat dijual."];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        // 4. harga, diskon, total (bilangan bulat sen)
        $discounts = $this->activeDiscounts($storeId, $products);
        $computed = [];
        $subtotal = 0;
        $discountTotal = 0;

        foreach ($lines as $line) {
            $product = $products->get($line['product_id']);
            $price = Decimal::money($product->sell_price);
            $gross = intdiv($price * $line['qty'] + 500, 1000);

            $best = ['amount' => 0, 'id' => null];
            foreach ($discounts as $discount) {
                $matches = ($discount->target_type === 'product' && (int) $discount->target_id === (int) $product->id)
                    || ($discount->target_type === 'category' && $product->category_id !== null && (int) $discount->target_id === (int) $product->category_id);
                if (! $matches) {
                    continue;
                }
                $value = Decimal::money($discount->value);
                $amount = $discount->discount_type === 'percent'
                    ? intdiv($gross * $value + 5000, 10000)
                    : intdiv($value * $line['qty'] + 500, 1000);
                $amount = min($amount, $gross);
                if ($amount > $best['amount']) {
                    $best = ['amount' => $amount, 'id' => (int) $discount->id];
                }
            }

            $subtotal += $gross;
            $discountTotal += $best['amount'];
            $computed[] = $line + [
                'price' => $price, 'gross' => $gross, 'discount' => $best['amount'], 'discount_id' => $best['id'],
                'line_total' => $gross - $best['amount'],
            ];
        }

        $net = $subtotal - $discountTotal;
        [$taxAmount, $taxRate, $total] = $isCredit ? [0, null, $net] : $this->cashTax($storeId, $net);

        // 5. pembayaran / kredit
        $tendered = null;
        $overLimit = false;
        if ($isCredit) {
            $overLimit = $this->checkCreditLimit($customer, $total, $approver, $data['credit_exception']['note'] ?? null);
        } else {
            $tendered = Decimal::money($data['amount_tendered'] ?? 0);
            if ($tendered < $total) {
                throw ValidationException::withMessages(['amount_tendered' => ['Uang diterima kurang dari total belanja.']]);
            }
        }

        // 6. dokumen
        $period = Carbon::now('Asia/Jakarta')->format('Ym');
        $docNo = DocumentNumber::format('SALE', $this->sequences->next($storeId, 'SALE', $period), $period);

        $saleId = DB::table('sales')->insertGetId([
            'store_id' => $storeId,
            'doc_number' => $docNo,
            'shift_id' => $shift->id,
            'cashier_id' => $actor->id,
            'customer_id' => $customer?->id,
            'payment_mode' => $data['payment_mode'],
            'subtotal' => Decimal::moneyString($subtotal),
            'discount_total' => Decimal::moneyString($discountTotal),
            'tax_rate_snapshot' => $taxRate,
            'tax_amount' => Decimal::moneyString($taxAmount),
            'total' => Decimal::moneyString($total),
            'status' => 'posted',
            'billing_status' => $isCredit ? 'unbilled' : 'not_applicable',
            'over_limit_flag' => $overLimit ? 1 : 0,
            'credit_exception_by' => $overLimit ? $approver->id : null,
            'credit_exception_note' => $overLimit ? mb_substr((string) $data['credit_exception']['note'], 0, 255) : null,
            'idempotency_key' => $data['idempotency_key'],
            'posted_at' => $now,
        ]);

        // 7. baris + stok FEFO
        foreach ($computed as $line) {
            $product = $products->get($line['product_id']);

            $itemId = DB::table('sale_items')->insertGetId([
                'sale_id' => $saleId,
                'product_id' => $product->id,
                'qty' => Decimal::qtyString($line['qty']),
                'unit_price' => Decimal::moneyString($line['price']),
                'discount_id' => $line['discount_id'],
                'discount_amount' => Decimal::moneyString($line['discount']),
                'line_total' => Decimal::moneyString($line['line_total']),
                'cost_snapshot' => $product->avg_cost ?? '0.0000',
            ]);

            try {
                $allocations = $this->inventory->sell($storeId, (int) $product->id, Decimal::qtyString($line['qty']), 'sale', $saleId, $actor->id);
            } catch (ValidationException $e) {
                throw ValidationException::withMessages(["items.{$line['index']}.qty" => $e->errors()['qty'] ?? ['Stok tidak mencukupi.']]);
            }

            foreach ($allocations as $allocation) {
                DB::table('sale_item_batches')->insert([
                    'sale_item_id' => $itemId,
                    'batch_id' => $allocation['batch_id'],
                    'shelf_position_id' => $allocation['shelf_position_id'],
                    'qty' => $allocation['qty'],
                ]);
            }
        }

        // 8. tunai: pembayaran + ledger kas kecil
        if (! $isCredit) {
            DB::table('payments')->insert([
                'sale_id' => $saleId,
                'shift_id' => $shift->id,
                'method' => 'cash',
                'amount_tendered' => Decimal::moneyString($tendered),
                'change_given' => Decimal::moneyString($tendered - $total),
                'amount_applied' => Decimal::moneyString($total),
            ]);

            $fundId = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'petty_cash')
                ->where('register_id', $shift->register_id)->where('is_active', 1)->value('id');
            abort_if($fundId === null, 422, 'Akun kas kecil untuk kasir ini belum tersedia.');

            DB::table('fund_ledger_entries')->insert([
                'fund_account_id' => $fundId,
                'entry_type' => 'sale_cash',
                'amount' => Decimal::moneyString($total),
                'ref_type' => 'sale',
                'ref_id' => $saleId,
                'occurred_at' => $now,
                'created_by' => $actor->id,
            ]);
        }

        // 9. audit
        $this->audit->log('sale.post', 'sale', $saleId, after: [
            'doc_number' => $docNo, 'payment_mode' => $data['payment_mode'], 'total' => Decimal::moneyString($total),
            'customer_id' => $customer?->id, 'over_limit' => $overLimit,
        ], storeId: $storeId, actorId: $actor->id);

        if ($overLimit) {
            $this->audit->log(
                'sale.credit_exception', 'sale', $saleId,
                after: ['customer_id' => $customer->id, 'total' => Decimal::moneyString($total), 'approved_by' => $approver->id],
                reason: (string) $data['credit_exception']['note'],
                selfApproval: $approver->id === $actor->id,
                storeId: $storeId, actorId: $actor->id,
            );
        }

        return $saleId;
    }

    private function assertCreditCustomer(?object $customer): void
    {
        if ($customer === null) {
            throw ValidationException::withMessages(['customer_id' => ['Pilih karyawan untuk penjualan kredit.']]);
        }
        if ($customer->status === 'pending_verification') {
            throw ValidationException::withMessages(['customer_id' => ['Karyawan belum diverifikasi Admin; hanya dapat membayar tunai.']]);
        }
        if ($customer->status === 'inactive') {
            throw ValidationException::withMessages(['customer_id' => ['Karyawan nonaktif tidak dapat berbelanja kredit.']]);
        }
    }

    /** Mengembalikan true bila melebihi batas DAN pengecualian sah; melempar bila melebihi tanpa pengecualian. */
    private function checkCreditLimit(object $customer, int $total, ?User $approver, ?string $note): bool
    {
        $limit = DB::table('customer_credit_limits')->where('customer_id', $customer->id)
            ->orderByDesc('effective_from')->orderByDesc('id')->value('limit_amount');

        if ($limit === null) {
            throw ValidationException::withMessages(['customer_id' => ['Batas kredit karyawan belum ditetapkan Admin; hanya dapat membayar tunai.']]);
        }

        $used = DB::table('sales')->where('customer_id', $customer->id)->where('payment_mode', 'payroll_credit')
            ->where('status', 'posted')->whereNull('billing_period_id')->sum('total');

        $remaining = Decimal::money((string) $limit) - Decimal::money((string) $used);

        if ($total <= $remaining) {
            return false;
        }

        if ($approver === null) {
            throw ValidationException::withMessages(['credit_limit' => [sprintf(
                'Melebihi batas kredit. Sisa batas Rp %s, total belanja Rp %s. Gunakan tunai atau minta pengecualian Admin.',
                Decimal::moneyString(max(0, $remaining)),
                Decimal::moneyString($total),
            )]]);
        }

        if ($note === null || trim($note) === '') {
            throw ValidationException::withMessages(['credit_exception.note' => ['Catatan pengecualian wajib diisi.']]);
        }

        return true;
    }

    /** @return array{0: int, 1: string|null, 2: int} [pajak, tarif, total akhir] */
    private function cashTax(int $storeId, int $net): array
    {
        $enabled = DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'vat_enabled')->value('setting_value');
        if ($enabled === null || json_decode((string) $enabled, true) !== true) {
            return [0, null, $net];
        }

        $rate = DB::table('tax_rates')->where('store_id', $storeId)->where('effective_from', '<=', Carbon::now('Asia/Jakarta')->toDateString())
            ->orderByDesc('effective_from')->orderByDesc('id')->first();

        if ($rate === null || $rate->price_includes_tax === null) {
            throw ValidationException::withMessages(['payment_mode' => ['Konfigurasi PPN belum lengkap (tarif atau status harga termasuk PPN).']]);
        }

        $units = Decimal::money($rate->rate);   // 11.00 -> 1100
        if ($rate->price_includes_tax) {
            $tax = intdiv($net * $units + intdiv(10000 + $units, 2), 10000 + $units);

            return [$tax, $rate->rate, $net];
        }

        $tax = intdiv($net * $units + 5000, 10000);

        return [$tax, $rate->rate, $net + $tax];
    }

    /** @return \Illuminate\Support\Collection<int, object> */
    private function activeDiscounts(int $storeId, $products)
    {
        $now = $this->now();
        $productIds = $products->pluck('id')->all();
        $categoryIds = $products->pluck('category_id')->filter()->unique()->all();

        return DB::table('discounts')->where('store_id', $storeId)->where('is_active', 1)
            ->where('starts_at', '<=', $now)
            ->where(function ($q) use ($now) {
                $q->whereNull('ends_at')->orWhere('ends_at', '>=', $now);
            })
            ->where(function ($q) use ($productIds, $categoryIds) {
                $q->where(fn ($p) => $p->where('target_type', 'product')->whereIn('target_id', $productIds))
                    ->orWhere(fn ($c) => $c->where('target_type', 'category')->whereIn('target_id', $categoryIds));
            })
            ->get();
    }

    /** @return array<string, mixed>|null */
    private function replay(User $actor, int $storeId, string $key): ?array
    {
        $existing = DB::table('sales')->where('idempotency_key', $key)->first(['id', 'cashier_id', 'store_id']);

        if ($existing === null) {
            return null;
        }

        if ((int) $existing->store_id !== $storeId || (int) $existing->cashier_id !== $actor->id) {
            throw ValidationException::withMessages(['idempotency_key' => ['Kunci idempotensi sudah dipakai transaksi lain.']]);
        }

        return $this->find($actor, $storeId, (int) $existing->id, true);
    }

    private function saleQuery(int $storeId)
    {
        return DB::table('sales as s')
            ->join('users as u', 'u.id', '=', 's.cashier_id')
            ->leftJoin('customers as c', 'c.id', '=', 's.customer_id')
            ->where('s.store_id', $storeId)
            ->select(['s.*', 'u.name as cashier_name', 'c.name as customer_name', 'c.customer_no']);
    }

    /** @return array<string, mixed> */
    private function present(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'shift_id' => (int) $row->shift_id,
            'cashier_id' => (int) $row->cashier_id,
            'cashier_name' => $row->cashier_name,
            'customer_id' => $row->customer_id === null ? null : (int) $row->customer_id,
            'customer_name' => $row->customer_name,
            'customer_no' => $row->customer_no,
            'payment_mode' => $row->payment_mode,
            'subtotal' => $row->subtotal,
            'discount_total' => $row->discount_total,
            'tax_rate' => $row->tax_rate_snapshot,
            'tax_amount' => $row->tax_amount,
            'total' => $row->total,
            'status' => $row->status,
            'billing_status' => $row->billing_status,
            'over_limit' => (bool) $row->over_limit_flag,
            'posted_at' => $row->posted_at,
        ];
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
