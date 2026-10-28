<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

/**
 * Inti persediaan. Aturan:
 *  - inventory_movements append-only = sumber kebenaran; inventory_balances turunannya (diubah di sini saja)
 *  - stok negatif DILARANG (cek di service + CHECK constraint di database)
 *  - penjualan memakai FEFO: batch dengan kadaluarsa terdekat keluar lebih dulu; tanpa tanggal = terakhir
 *    (lalu urut received_at, jadi produk tanpa kadaluarsa berperilaku FIFO). Batch yang SUDAH kadaluarsa tidak dijual [ASUMSI]
 *  - HPP rata-rata bergerak per produk (bukan per batch), dihitung di SQL (DECIMAL) agar eksak
 *  - qty dihitung sebagai bilangan bulat satuan 0,001 (Decimal) agar bebas galat float
 *
 * SEMUA metode yang mengubah stok WAJIB dipanggil di dalam DB::transaction milik pemanggil
 * (penjualan, penerimaan, dst.), supaya stok dan dokumen sumbernya atomik. Kunci diambil berurutan:
 * baris products dulu, baru inventory_balances. Bila satu transaksi menyentuh banyak produk,
 * urutkan produk menurut id sebelum memanggil (mencegah deadlock).
 */
class InventoryService
{
    private const BUCKET_COLUMNS = [
        'sellable' => 'qty_sellable',
        'quarantine' => 'qty_quarantine',
        'damaged' => 'qty_damaged',
    ];

    public function __construct(private AuditLogger $audit, private NumberSequence $sequences) {}

    // ------------------------------------------------------------------ lokasi

    /** Lokasi tempat barang dijual/diterima: toko (store_floor) yang aktif. */
    public function sellingLocationId(int $storeId): int
    {
        $id = DB::table('locations')
            ->where('store_id', $storeId)->where('type', 'store_floor')->where('is_active', 1)
            ->orderBy('id')->value('id');

        abort_if($id === null, 422, 'Lokasi toko aktif belum tersedia.');

        return (int) $id;
    }

    // ------------------------------------------------------------------ stok awal

    /**
     * Stok awal (cut-over / input manual). Satu dokumen berisi banyak baris; semuanya atau tidak sama sekali.
     * Aturan [ASUMSI]: hanya untuk produk yang belum punya pergerakan selain opening_balance
     * (koreksi setelah operasional berjalan lewat adjustment). Baris tambahan untuk produk yang sama
     * (mis. batch/kadaluarsa lain) diperbolehkan selama masih fase stok awal.
     *
     * @param  list<array<string, mixed>>  $items  product_id, qty, unit_cost?, expiry_date?, batch_code?, shelf_position_id?
     * @return array<string, mixed>
     */
    public function openingBalance(User $actor, int $storeId, array $items, ?string $note = null): array
    {
        return DB::transaction(function () use ($actor, $storeId, $items, $note) {
            $locationId = $this->sellingLocationId($storeId);

            // kunci produk berurutan id (anti-deadlock)
            $ids = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
            $products = DB::table('products')
                ->where('store_id', $storeId)->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

            $errors = [];
            foreach ($items as $i => $item) {
                $product = $products->get((int) $item['product_id']);

                if ($product === null) {
                    $errors["items.{$i}.product_id"] = ['Produk tidak ditemukan.'];

                    continue;
                }

                if ($product->status === 'inactive') {
                    $errors["items.{$i}.product_id"] = ["Produk {$product->name} nonaktif."];

                    continue;
                }

                $hasOperations = DB::table('inventory_movements')
                    ->where('product_id', $product->id)->where('movement_type', '<>', 'opening_balance')->exists();
                if ($hasOperations) {
                    $errors["items.{$i}.product_id"] = ["Produk {$product->name} sudah memiliki pergerakan stok operasional; gunakan adjustment."];

                    continue;
                }

                if (! empty($item['shelf_position_id']) && ! $this->positionBelongsToLocation((int) $item['shelf_position_id'], $locationId)) {
                    $errors["items.{$i}.shelf_position_id"] = ['Posisi rak tidak valid untuk lokasi toko.'];
                }
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $number = $this->sequences->next($storeId, 'OPEN');
            $documentNo = DocumentNumber::format('OPEN', $number);
            $lines = [];

            foreach ($items as $item) {
                $product = $products->get((int) $item['product_id']);

                $in = $this->stockIn(
                    storeId: $storeId,
                    product: $product,
                    locationId: $locationId,
                    positionId: ! empty($item['shelf_position_id']) ? (int) $item['shelf_position_id'] : null,
                    qty: (string) $item['qty'],
                    unitCost: isset($item['unit_cost']) ? (string) $item['unit_cost'] : null,
                    expiryDate: $item['expiry_date'] ?? null,
                    batchCode: $item['batch_code'] ?? null,
                    goodsReceiptItemId: null,
                    isOpening: true,
                    type: 'opening_balance',
                    refType: 'opening_balance',
                    refId: $number,
                    actorId: $actor->id,
                );

                $lines[] = [
                    'product_id' => (int) $product->id,
                    'batch_id' => $in['batch_id'],
                    'qty' => Decimal::qtyString(Decimal::qty($item['qty'])),
                ];
            }

            $this->audit->log(
                'inventory.opening_balance',
                'opening_balance',
                $number,
                after: ['document_no' => $documentNo, 'lines' => $lines],
                reason: $note,
                storeId: $storeId,
                actorId: $actor->id,
            );

            return ['document_no' => $documentNo, 'items' => $lines];
        });
    }

    // ------------------------------------------------------------------ penerimaan (dipakai WS penerimaan barang)

    /**
     * Barang masuk dari penerimaan (goods receipt). Produk track_expiry wajib bertanggal kadaluarsa.
     *
     * @return array{batch_id: int, balance_id: int}
     */
    public function receive(
        int $storeId,
        int $productId,
        string $qty,
        string $unitCost,
        ?string $expiryDate,
        ?string $batchCode,
        ?int $goodsReceiptItemId,
        string $refType,
        int $refId,
        ?int $actorId,
        ?int $locationId = null,
        ?int $positionId = null,
    ): array {
        $this->requireTransaction();

        $product = DB::table('products')->where('store_id', $storeId)->where('id', $productId)->lockForUpdate()->first();
        abort_if($product === null, 404, 'Produk tidak ditemukan.');

        if ($product->track_expiry && $expiryDate === null) {
            throw ValidationException::withMessages(['expiry_date' => ["Tanggal kadaluarsa wajib diisi untuk {$product->name}."]]);
        }

        return $this->stockIn(
            storeId: $storeId,
            product: $product,
            locationId: $locationId ?? $this->sellingLocationId($storeId),
            positionId: $positionId,
            qty: $qty,
            unitCost: $unitCost,
            expiryDate: $expiryDate,
            batchCode: $batchCode,
            goodsReceiptItemId: $goodsReceiptItemId,
            isOpening: false,
            type: 'receipt',
            refType: $refType,
            refId: $refId,
            actorId: $actorId,
        );
    }

    // ------------------------------------------------------------------ penjualan (FEFO)

    /** Jumlah stok layak jual FEFO saat ini; tidak mengunci atau mengubah stok. */
    public function availableSellableQty(int $storeId, int $productId): string
    {
        $locationId = $this->sellingLocationId($storeId);
        $today = Carbon::now('Asia/Jakarta')->toDateString();

        return DB::table('inventory_balances as bal')
            ->leftJoin('product_batches as pb', 'pb.id', '=', 'bal.batch_id')
            ->where('bal.product_id', $productId)
            ->where('bal.location_id', $locationId)
            ->where('bal.qty_sellable', '>', 0)
            ->where(function ($q) use ($today) {
                $q->whereNull('pb.expiry_date')->orWhere('pb.expiry_date', '>=', $today);
            })
            ->sum('bal.qty_sellable');
    }

    /**
     * Mengurangi stok sellable secara FEFO. Mengembalikan alokasi per batch untuk disimpan
     * di sale_item_batches (dan dipakai void). Gagal (ValidationException) bila stok kurang.
     *
     * @return list<array{product_id: int, balance_id: int, batch_id: int|null, location_id: int, shelf_position_id: int|null, expiry_date: string|null, qty: string, unit_cost: string|null}>
     */
    public function sell(
        int $storeId,
        int $productId,
        string $qty,
        string $refType,
        int $refId,
        ?int $actorId = null,
        ?int $locationId = null,
    ): array {
        $this->requireTransaction();

        $need = Decimal::qty($qty);
        if ($need <= 0) {
            throw ValidationException::withMessages(['qty' => ['Jumlah harus lebih dari nol.']]);
        }

        $product = DB::table('products')->where('store_id', $storeId)->where('id', $productId)->lockForUpdate()->first();
        abort_if($product === null, 404, 'Produk tidak ditemukan.');

        $locationId ??= $this->sellingLocationId($storeId);
        $today = Carbon::now('Asia/Jakarta')->toDateString();

        $rows = DB::table('inventory_balances as bal')
            ->leftJoin('product_batches as pb', 'pb.id', '=', 'bal.batch_id')
            ->where('bal.product_id', $productId)
            ->where('bal.location_id', $locationId)
            ->where('bal.qty_sellable', '>', 0)
            ->where(function ($q) use ($today) {
                $q->whereNull('pb.expiry_date')->orWhere('pb.expiry_date', '>=', $today);
            })
            ->orderByRaw('pb.expiry_date IS NULL')
            ->orderBy('pb.expiry_date')
            ->orderBy('pb.received_at')
            ->orderBy('bal.id')
            ->lockForUpdate()
            ->get(['bal.id', 'bal.batch_id', 'bal.shelf_position_id', 'bal.qty_sellable', 'pb.expiry_date']);

        $available = 0;
        foreach ($rows as $row) {
            $available += Decimal::qty($row->qty_sellable);
        }

        if ($available < $need) {
            throw ValidationException::withMessages([
                'qty' => [sprintf(
                    'Stok %s tidak mencukupi: tersedia %s, diminta %s.',
                    $product->name,
                    Decimal::qtyString($available),
                    Decimal::qtyString($need),
                )],
            ]);
        }

        $allocations = [];
        $remaining = $need;
        $now = $this->now();

        foreach ($rows as $row) {
            if ($remaining <= 0) {
                break;
            }

            $take = min($remaining, Decimal::qty($row->qty_sellable));
            $remaining -= $take;

            $this->decreaseBalance((int) $row->id, 'sellable', $take);

            DB::table('inventory_movements')->insert([
                'store_id' => $storeId,
                'product_id' => $productId,
                'batch_id' => $row->batch_id,
                'from_location_id' => $locationId,
                'from_position_id' => $row->shelf_position_id,
                'from_bucket' => 'sellable',
                'qty' => Decimal::qtyString($take),
                'movement_type' => 'sale',
                'unit_cost' => $product->avg_cost,
                'ref_type' => $refType,
                'ref_id' => $refId,
                'occurred_at' => $now,
                'created_by' => $actorId,
            ]);

            $allocations[] = [
                'product_id' => $productId,
                'balance_id' => (int) $row->id,
                'batch_id' => $row->batch_id === null ? null : (int) $row->batch_id,
                'location_id' => $locationId,
                'shelf_position_id' => $row->shelf_position_id === null ? null : (int) $row->shelf_position_id,
                'expiry_date' => $row->expiry_date,
                'qty' => Decimal::qtyString($take),
                'unit_cost' => $product->avg_cost,
            ];
        }

        return $allocations;
    }

    /**
     * Mengembalikan stok sesuai alokasi hasil sell() (pembatalan penjualan). Tiap batch kembali
     * ke baris saldo asalnya.
     *
     * @param  list<array<string, mixed>>  $allocations
     */
    public function voidSale(int $storeId, array $allocations, string $refType, int $refId, ?int $actorId = null): void
    {
        $this->requireTransaction();

        // kunci berurutan: produk dulu (urut id), lalu baris saldo
        $productIds = collect($allocations)->pluck('product_id')->unique()->sort()->values()->all();
        DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)->orderBy('id')->lockForUpdate()->get(['id']);

        $now = $this->now();

        foreach ($allocations as $allocation) {
            $units = Decimal::qty($allocation['qty']);

            DB::table('inventory_balances')->where('id', $allocation['balance_id'])->lockForUpdate()->first();
            $this->increaseBalance((int) $allocation['balance_id'], 'sellable', $units);

            DB::table('inventory_movements')->insert([
                'store_id' => $storeId,
                'product_id' => $allocation['product_id'],
                'batch_id' => $allocation['batch_id'],
                'to_location_id' => $allocation['location_id'],
                'to_position_id' => $allocation['shelf_position_id'],
                'to_bucket' => 'sellable',
                'qty' => Decimal::qtyString($units),
                'movement_type' => 'sale_void',
                'unit_cost' => $allocation['unit_cost'],
                'ref_type' => $refType,
                'ref_id' => $refId,
                'occurred_at' => $now,
                'created_by' => $actorId,
            ]);
        }
    }

    /**
     * Memindahkan stok layak jual antarposisi/lokasi. Setiap baris menghasilkan movement keluar
     * dan masuk; batch dan HPP tetap sama.
     *
     * @param  list<array{product_id: int, batch_id: int|null, from_position_id: int|null, to_position_id: int|null, qty: string}>  $items
     */
    public function transfer(
        int $storeId,
        int $fromLocationId,
        int $toLocationId,
        array $items,
        string $refType,
        int $refId,
        ?int $actorId = null,
    ): void {
        $this->requireTransaction();

        $productIds = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
        $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
            ->orderBy('id')->lockForUpdate()->get()->keyBy('id');

        $errors = [];
        $sourceBalances = [];
        $sourceByItem = [];
        $requiredByBalance = [];
        foreach ($items as $index => $item) {
            $productId = (int) $item['product_id'];
            $product = $products->get($productId);
            if ($product === null) {
                $errors["items.{$index}.product_id"] = ['Produk tidak ditemukan.'];

                continue;
            }

            $batchId = $item['batch_id'] === null ? null : (int) $item['batch_id'];
            if ($batchId !== null && ! DB::table('product_batches')->where('id', $batchId)->where('product_id', $productId)->exists()) {
                $errors["items.{$index}.batch_id"] = ['Batch tidak ditemukan untuk produk ini.'];

                continue;
            }

            $fromPositionId = $item['from_position_id'] === null ? null : (int) $item['from_position_id'];
            $source = DB::table('inventory_balances')
                ->where('product_id', $productId)
                ->where('location_id', $fromLocationId)
                ->whereRaw('position_key = ?', [$fromPositionId ?? 0])
                ->whereRaw('batch_key = ?', [$batchId ?? 0])
                ->lockForUpdate()
                ->first(['id', 'qty_sellable']);

            if ($source === null) {
                $errors["items.{$index}.qty"] = ['Tidak ada stok layak jual pada batch dan posisi asal.'];

                continue;
            }

            $units = Decimal::qty((string) $item['qty']);
            $sourceBalances[$source->id] = $source;
            $sourceByItem[$index] = $source;
            $requiredByBalance[$source->id]['units'] = ($requiredByBalance[$source->id]['units'] ?? 0) + $units;
            $requiredByBalance[$source->id]['indexes'][] = $index;
        }

        foreach ($requiredByBalance as $balanceId => $required) {
            $available = Decimal::qty($sourceBalances[$balanceId]->qty_sellable);
            if ($required['units'] > $available) {
                $index = $required['indexes'][0];
                $errors["items.{$index}.qty"] = [sprintf(
                    'Stok asal tidak mencukupi: tersedia %s, diminta %s.',
                    Decimal::qtyString($available),
                    Decimal::qtyString($required['units']),
                )];
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $now = $this->now();
        foreach ($items as $index => $item) {
            $productId = (int) $item['product_id'];
            $product = $products->get($productId);
            $batchId = $item['batch_id'] === null ? null : (int) $item['batch_id'];
            $fromPositionId = $item['from_position_id'] === null ? null : (int) $item['from_position_id'];
            $toPositionId = $item['to_position_id'] === null ? null : (int) $item['to_position_id'];
            $units = Decimal::qty((string) $item['qty']);
            $qty = Decimal::qtyString($units);
            $source = $sourceByItem[$index];

            $this->decreaseBalance((int) $source->id, 'sellable', $units);
            $destinationId = $this->lockOrCreateBalance($productId, $toLocationId, $toPositionId, $batchId);
            $this->increaseBalance($destinationId, 'sellable', $units);

            $common = [
                'store_id' => $storeId,
                'product_id' => $productId,
                'batch_id' => $batchId,
                'qty' => $qty,
                'movement_type' => 'transfer',
                'unit_cost' => $product->avg_cost,
                'ref_type' => $refType,
                'ref_id' => $refId,
                'occurred_at' => $now,
                'created_by' => $actorId,
            ];
            DB::table('inventory_movements')->insert($common + [
                'from_location_id' => $fromLocationId,
                'from_position_id' => $fromPositionId,
                'from_bucket' => 'sellable',
            ]);
            DB::table('inventory_movements')->insert($common + [
                'to_location_id' => $toLocationId,
                'to_position_id' => $toPositionId,
                'to_bucket' => 'sellable',
            ]);
        }
    }

    /**
     * Reconcile counted sellable stock against its snapshot. The caller must own the
     * adjustment transaction so approval, balances, movements, and document status commit together.
     *
     * @param  list<array{product_id: int, batch_id: int|null, location_id: int, shelf_position_id: int|null, qty_before: string, qty_counted: string, qty_diff: string}>  $items
     */
    public function adjust(int $storeId, int $adjustmentId, string $reason, array $items, int $actorId): void
    {
        $this->requireTransaction();

        $productIds = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
        $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
            ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        $balances = [];
        $errors = [];

        foreach ($items as $index => $item) {
            $productId = (int) $item['product_id'];
            $product = $products->get($productId);
            if ($product === null) {
                $errors["items.{$index}.product_id"] = ['Produk tidak ditemukan pada toko ini.'];

                continue;
            }

            $balanceId = $this->lockOrCreateBalance(
                $productId,
                (int) $item['location_id'],
                $item['shelf_position_id'] === null ? null : (int) $item['shelf_position_id'],
                $item['batch_id'] === null ? null : (int) $item['batch_id'],
            );
            $balance = DB::table('inventory_balances')->where('id', $balanceId)->lockForUpdate()->first();
            $balances[$index] = ['id' => $balanceId, 'row' => $balance, 'product' => $product];

            $before = Decimal::qty((string) $item['qty_before']);
            $current = Decimal::qty((string) $balance->qty_sellable);
            if ($current !== $before) {
                $errors["items.{$index}.qty_counted"] = [
                    'Saldo stok berubah sejak opname dibuat. Buat adjustment baru berdasarkan saldo terbaru.',
                ];
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $now = $this->now();
        foreach ($items as $index => $item) {
            $diff = Decimal::qty((string) $item['qty_diff']);
            if ($diff === 0) {
                continue;
            }

            $balanceId = $balances[$index]['id'];
            $product = $balances[$index]['product'];
            $isDamage = $diff < 0 && $reason === 'damage';
            $isWriteOff = $diff < 0 && in_array($reason, ['loss', 'expired'], true);
            if ($diff < 0) {
                $this->decreaseBalance($balanceId, 'sellable', abs($diff));
                if ($isDamage) {
                    $this->increaseBalance($balanceId, 'damaged', abs($diff));
                }
            } else {
                $this->increaseBalance($balanceId, 'sellable', $diff);
            }

            DB::table('inventory_movements')->insert([
                'store_id' => $storeId,
                'product_id' => (int) $item['product_id'],
                'batch_id' => $item['batch_id'],
                'from_location_id' => $diff < 0 ? (int) $item['location_id'] : null,
                'from_position_id' => $diff < 0 ? $item['shelf_position_id'] : null,
                'from_bucket' => $diff < 0 ? 'sellable' : null,
                'to_location_id' => $diff > 0 || $isDamage ? (int) $item['location_id'] : null,
                'to_position_id' => $diff > 0 || $isDamage ? $item['shelf_position_id'] : null,
                'to_bucket' => $diff > 0 ? 'sellable' : ($isDamage ? 'damaged' : null),
                'qty' => Decimal::qtyString(abs($diff)),
                'movement_type' => $isWriteOff ? 'write_off' : 'adjustment',
                'unit_cost' => $product->avg_cost,
                'ref_type' => 'stock_adjustment',
                'ref_id' => $adjustmentId,
                'occurred_at' => $now,
                'created_by' => $actorId,
            ]);
        }
    }

    // ------------------------------------------------------------------ baca

    /**
     * Rincian stok satu produk per batch/posisi + total.
     *
     * @return array<string, mixed>|null
     */
    public function productStock(int $storeId, int $productId): ?array
    {
        $product = DB::table('products')->where('store_id', $storeId)->where('id', $productId)->first();

        if ($product === null) {
            return null;
        }

        $warnDays = $this->expiryWarningDays($storeId);
        $today = Carbon::now('Asia/Jakarta')->startOfDay();

        $rows = DB::table('inventory_balances as bal')
            ->leftJoin('product_batches as pb', 'pb.id', '=', 'bal.batch_id')
            ->where('bal.product_id', $productId)
            ->whereRaw('(bal.qty_sellable > 0 or bal.qty_quarantine > 0 or bal.qty_damaged > 0)')
            ->orderByRaw('pb.expiry_date IS NULL')
            ->orderBy('pb.expiry_date')
            ->orderBy('pb.received_at')
            ->orderBy('bal.id')
            ->get([
                'bal.id', 'bal.location_id', 'bal.shelf_position_id', 'bal.batch_id',
                'bal.qty_sellable', 'bal.qty_quarantine', 'bal.qty_damaged',
                'pb.batch_code', 'pb.expiry_date', 'pb.is_opening', 'pb.received_at',
            ]);

        $totals = ['sellable' => 0, 'quarantine' => 0, 'damaged' => 0];

        $batches = $rows->map(function ($row) use (&$totals, $today, $warnDays) {
            $totals['sellable'] += Decimal::qty($row->qty_sellable);
            $totals['quarantine'] += Decimal::qty($row->qty_quarantine);
            $totals['damaged'] += Decimal::qty($row->qty_damaged);

            return [
                'balance_id' => (int) $row->id,
                'batch_id' => $row->batch_id === null ? null : (int) $row->batch_id,
                'batch_code' => $row->batch_code,
                'expiry_date' => $row->expiry_date,
                'expiry_status' => $this->expiryStatus($row->expiry_date, $today, $warnDays),
                'is_opening' => (bool) $row->is_opening,
                'received_at' => $row->received_at,
                'location_id' => (int) $row->location_id,
                'shelf_position_id' => $row->shelf_position_id === null ? null : (int) $row->shelf_position_id,
                'qty_sellable' => $row->qty_sellable,
                'qty_quarantine' => $row->qty_quarantine,
                'qty_damaged' => $row->qty_damaged,
            ];
        })->all();

        return [
            'product_id' => (int) $product->id,
            'sku' => $product->sku,
            'name' => $product->name,
            'unit_name' => $product->unit_name,
            'track_expiry' => (bool) $product->track_expiry,
            'avg_cost' => $product->avg_cost,
            'totals' => [
                'qty_sellable' => Decimal::qtyString($totals['sellable']),
                'qty_quarantine' => Decimal::qtyString($totals['quarantine']),
                'qty_damaged' => Decimal::qtyString($totals['damaged']),
            ],
            'batches' => $batches,
        ];
    }

    /**
     * Riwayat pergerakan stok (terbaru dulu).
     *
     * @param  array<string, mixed>  $filters  product_id, movement_type, date_from, date_to (tanggal WIB)
     */
    public function movements(int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $query = DB::table('inventory_movements as m')
            ->join('products as p', 'p.id', '=', 'm.product_id')
            ->leftJoin('product_batches as pb', 'pb.id', '=', 'm.batch_id')
            ->leftJoin('users as u', 'u.id', '=', 'm.created_by')
            ->where('m.store_id', $storeId)
            ->orderByDesc('m.occurred_at')
            ->orderByDesc('m.id')
            ->select([
                'm.id', 'm.product_id', 'p.sku', 'p.name as product_name', 'm.batch_id', 'pb.batch_code', 'pb.expiry_date',
                'm.movement_type', 'm.qty', 'm.unit_cost',
                'm.from_location_id', 'm.from_position_id', 'm.from_bucket',
                'm.to_location_id', 'm.to_position_id', 'm.to_bucket',
                'm.ref_type', 'm.ref_id', 'm.occurred_at', 'm.created_by', 'u.name as created_by_name',
            ]);

        if (! empty($filters['product_id'])) {
            $query->where('m.product_id', (int) $filters['product_id']);
        }
        if (! empty($filters['movement_type'])) {
            $query->where('m.movement_type', $filters['movement_type']);
        }
        // tanggal WIB -> rentang UTC
        if (! empty($filters['date_from'])) {
            $query->where('m.occurred_at', '>=', Carbon::parse($filters['date_from'], 'Asia/Jakarta')->startOfDay()->utc());
        }
        if (! empty($filters['date_to'])) {
            $query->where('m.occurred_at', '<=', Carbon::parse($filters['date_to'], 'Asia/Jakarta')->endOfDay()->utc());
        }

        return $query->paginate($perPage)->through(function ($row) {
            return [
                'id' => (int) $row->id,
                'product_id' => (int) $row->product_id,
                'sku' => $row->sku,
                'product_name' => $row->product_name,
                'batch_id' => $row->batch_id === null ? null : (int) $row->batch_id,
                'batch_code' => $row->batch_code,
                'expiry_date' => $row->expiry_date,
                'movement_type' => $row->movement_type,
                'qty' => $row->qty,
                'unit_cost' => $row->unit_cost,
                'from_location_id' => $row->from_location_id === null ? null : (int) $row->from_location_id,
                'from_bucket' => $row->from_bucket,
                'to_location_id' => $row->to_location_id === null ? null : (int) $row->to_location_id,
                'to_bucket' => $row->to_bucket,
                'ref_type' => $row->ref_type,
                'ref_id' => (int) $row->ref_id,
                'occurred_at' => $row->occurred_at,
                'created_by' => $row->created_by === null ? null : (int) $row->created_by,
                'created_by_name' => $row->created_by_name,
            ];
        });
    }

    // ------------------------------------------------------------------ internal

    /**
     * Barang masuk ke bucket sellable: batch baru, saldo, pergerakan, dan HPP rata-rata bergerak.
     *
     * @return array{batch_id: int, balance_id: int}
     */
    private function stockIn(
        int $storeId,
        object $product,
        int $locationId,
        ?int $positionId,
        string $qty,
        ?string $unitCost,
        ?string $expiryDate,
        ?string $batchCode,
        ?int $goodsReceiptItemId,
        bool $isOpening,
        string $type,
        string $refType,
        int $refId,
        ?int $actorId,
    ): array {
        $units = Decimal::qty($qty);
        if ($units <= 0) {
            throw ValidationException::withMessages(['qty' => ['Jumlah harus lebih dari nol.']]);
        }
        $qtyText = Decimal::qtyString($units);
        $now = $this->now();

        // stok sebelum masuk (semua bucket) untuk HPP; baris produk sudah dikunci pemanggil
        $onHandBefore = $this->onHand((int) $product->id);

        $batchId = DB::table('product_batches')->insertGetId([
            'product_id' => $product->id,
            'goods_receipt_item_id' => $goodsReceiptItemId,
            'batch_code' => $batchCode,
            'expiry_date' => $expiryDate,
            'received_at' => $now,
            'is_opening' => $isOpening ? 1 : 0,
        ]);

        $balanceId = $this->lockOrCreateBalance((int) $product->id, $locationId, $positionId, $batchId);
        $this->increaseBalance($balanceId, 'sellable', $units);

        DB::table('inventory_movements')->insert([
            'store_id' => $storeId,
            'product_id' => $product->id,
            'batch_id' => $batchId,
            'to_location_id' => $locationId,
            'to_position_id' => $positionId,
            'to_bucket' => 'sellable',
            'qty' => $qtyText,
            'movement_type' => $type,
            'unit_cost' => $unitCost,
            'ref_type' => $refType,
            'ref_id' => $refId,
            'occurred_at' => $now,
            'created_by' => $actorId,
        ]);

        if ($unitCost !== null) {
            // HPP baru = (stok_lama x hpp_lama + qty x biaya) / (stok_lama + qty), dibulatkan 4 desimal
            DB::update(
                'UPDATE products SET '.
                'avg_cost = ROUND((CAST(? AS DECIMAL(18,3)) * avg_cost + CAST(? AS DECIMAL(18,3)) * CAST(? AS DECIMAL(18,4))) '.
                '/ (CAST(? AS DECIMAL(18,3)) + CAST(? AS DECIMAL(18,3))), 4), '.
                'last_cost = ROUND(CAST(? AS DECIMAL(18,4)), 2) '.
                'WHERE id = ?',
                [$onHandBefore, $qtyText, $unitCost, $onHandBefore, $qtyText, $unitCost, $product->id],
            );
        }

        return ['batch_id' => $batchId, 'balance_id' => $balanceId];
    }

    private function onHand(int $productId): string
    {
        $total = DB::table('inventory_balances')
            ->where('product_id', $productId)
            ->selectRaw('COALESCE(SUM(qty_sellable + qty_quarantine + qty_damaged), 0) as total')
            ->value('total');

        return Decimal::qtyString(Decimal::qty((string) $total));
    }

    private function lockOrCreateBalance(int $productId, int $locationId, ?int $positionId, ?int $batchId): int
    {
        $find = fn () => DB::table('inventory_balances')
            ->where('product_id', $productId)
            ->where('location_id', $locationId)
            ->whereRaw('position_key = ?', [$positionId ?? 0])
            ->whereRaw('batch_key = ?', [$batchId ?? 0])
            ->lockForUpdate()
            ->first();

        $row = $find();

        if ($row === null) {
            DB::table('inventory_balances')->insertOrIgnore([
                'product_id' => $productId,
                'location_id' => $locationId,
                'shelf_position_id' => $positionId,
                'batch_id' => $batchId,
            ]);
            $row = $find();
        }

        return (int) $row->id;
    }

    /** $units dari Decimal (hanya digit), aman disisipkan sebagai literal. */
    private function increaseBalance(int $balanceId, string $bucket, int $units): void
    {
        $column = self::BUCKET_COLUMNS[$bucket];

        DB::table('inventory_balances')->where('id', $balanceId)
            ->update([$column => DB::raw("{$column} + ".Decimal::qtyString($units))]);
    }

    private function decreaseBalance(int $balanceId, string $bucket, int $units): void
    {
        $column = self::BUCKET_COLUMNS[$bucket];
        $amount = Decimal::qtyString($units);

        $affected = DB::table('inventory_balances')
            ->where('id', $balanceId)
            ->whereRaw("{$column} >= {$amount}")
            ->update([$column => DB::raw("{$column} - {$amount}")]);

        if ($affected !== 1) {
            // baris sudah dikunci; ini hanya jaring pengaman terakhir terhadap stok negatif
            throw new LogicException('Pengurangan stok ditolak: saldo tidak mencukupi.');
        }
    }

    private function positionBelongsToLocation(int $positionId, int $locationId): bool
    {
        return DB::table('shelf_positions as sp')
            ->join('shelves as s', 's.id', '=', 'sp.shelf_id')
            ->where('sp.id', $positionId)->where('s.location_id', $locationId)
            ->exists();
    }

    private function expiryWarningDays(int $storeId): int
    {
        $value = DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'expiry_warning_days')->value('setting_value');

        return $value === null ? 30 : max(0, (int) json_decode((string) $value, true));
    }

    private function expiryStatus(?string $expiryDate, Carbon $today, int $warnDays): string
    {
        if ($expiryDate === null) {
            return 'none';
        }

        $expiry = Carbon::parse($expiryDate, 'Asia/Jakarta')->startOfDay();

        if ($expiry->lt($today)) {
            return 'expired';
        }

        return $today->diffInDays($expiry) <= $warnDays ? 'near_expiry' : 'ok';
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }

    private function requireTransaction(): void
    {
        if (DB::transactionLevel() < 1) {
            throw new LogicException('Operasi stok harus dijalankan di dalam DB::transaction.');
        }
    }
}
