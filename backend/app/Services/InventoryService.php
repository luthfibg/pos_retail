<?php

namespace App\Services;

use App\Exceptions\InsufficientStockException;
use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use Carbon\Carbon;
use Closure;
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
 *  - unit_cost master produk mengikuti biaya masuk terbaru; biaya pergerakan dan penjualan tetap disnapshot
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

    public function __construct(
        private AuditLogger $audit,
        private NumberSequence $sequences,
        private PurchaseRequisitionService $requisitions,
        private OpnameLockService $opnameLocks,
    ) {}

    /**
     * Run a multi-product stock mutation after one batched opname-lock check.
     * The authorization is scoped to this callback and current transaction only.
     *
     * @param  list<int>  $productIds
     */
    public function withUnlockedProducts(int $storeId, array $productIds, Closure $callback): mixed
    {
        $this->requireTransaction();
        $productIds = array_values(array_unique(array_map('intval', $productIds)));
        sort($productIds);
        $this->lockStockRows($productIds);
        $this->opnameLocks->assertUnlocked($storeId, $productIds);

        $previous = $this->authorizedStockMutation;
        $this->authorizedStockMutation = [
            'store_id' => $storeId,
            'product_ids' => $productIds,
            'transaction_level' => DB::transactionLevel(),
        ];

        try {
            return $callback();
        } finally {
            $this->authorizedStockMutation = $previous;
        }
    }

    /**
     * Apply one opname difference and record exactly one movement for the source session.
     * The caller owns the transaction and has already frozen the session snapshot.
     */
    public function postOpnameAdjustment(
        User $actor,
        int $storeId,
        int $sessionId,
        int $productId,
        string $diffQty,
        ?string $unitCost,
    ): int {
        return $this->postOpnameAdjustments($actor, $storeId, $sessionId, [[
            'product_id' => $productId,
            'diff_qty' => $diffQty,
            'unit_cost' => $unitCost,
        ]])[$productId];
    }

    /**
     * Apply a batch after one lock validation and write one movement per differing product.
     *
     * @param  list<array{product_id: int, diff_qty: string, unit_cost: ?string}>  $lines
     * @return array<int, int> product id => movement id
     */
    public function postOpnameAdjustments(User $actor, int $storeId, int $sessionId, array $lines): array
    {
        $this->requireTransaction();
        if ($lines === []) {
            return [];
        }

        $productIds = array_map(fn (array $line) => (int) $line['product_id'], $lines);
        if (count(array_unique($productIds)) !== count($productIds)) {
            throw new LogicException('Produk opname duplikat pada posting stok.');
        }
        sort($productIds);
        $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
            ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        if ($products->count() !== count($productIds)) {
            abort(404, 'Produk opname tidak ditemukan.');
        }

        $this->lockStockRows($productIds);
        $this->opnameLocks->assertUnlocked($storeId, $productIds, 'stock_opname', $sessionId);
        $balances = DB::table('inventory_balances')->whereIn('product_id', $productIds)
            ->orderBy('product_id')->orderBy('id')->lockForUpdate()
            ->get(['id', 'product_id', 'qty_sellable', 'qty_quarantine', 'qty_damaged'])
            ->groupBy('product_id');
        $hasIncrease = collect($lines)->contains(fn (array $line) => Decimal::qty($line['diff_qty']) > 0);
        $locationId = $hasIncrease ? $this->sellingLocationId($storeId) : null;
        $movementIds = [];
        $now = $this->now();

        usort($lines, fn (array $a, array $b) => $a['product_id'] <=> $b['product_id']);
        foreach ($lines as $line) {
            $productId = (int) $line['product_id'];
            $units = Decimal::qty($line['diff_qty']);
            if ($units === 0) {
                throw new LogicException('Selisih nol tidak dapat diposting.');
            }
            $product = $products->get($productId);
            if ($units > 0) {
                $result = $this->stockIn(
                    storeId: $storeId,
                    product: $product,
                    locationId: $locationId,
                    positionId: null,
                    qty: Decimal::qtyString($units),
                    unitCost: $line['unit_cost'],
                    expiryDate: null,
                    batchCode: null,
                    goodsReceiptItemId: null,
                    isOpening: false,
                    type: 'adjustment',
                    refType: 'stock_opname',
                    refId: $sessionId,
                    actorId: $actor->id,
                    updateProductCost: false,
                );
                $movementIds[$productId] = $result['movement_id'];

                continue;
            }

            $productBalances = $balances->get($productId, collect());
            $remaining = abs($units);
            $available = 0;
            foreach ($productBalances as $balance) {
                foreach (['damaged', 'quarantine', 'sellable'] as $bucket) {
                    $available += Decimal::qty((string) $balance->{'qty_'.$bucket});
                }
            }
            if ($available < $remaining) {
                throw ValidationException::withMessages([
                    'stock' => ['stock_changed_during_opname: stok tidak mencukupi untuk menerapkan selisih.'],
                ]);
            }

            foreach ($productBalances as $balance) {
                foreach (['damaged', 'quarantine', 'sellable'] as $bucket) {
                    $balanceUnits = Decimal::qty((string) $balance->{'qty_'.$bucket});
                    $take = min($remaining, $balanceUnits);
                    if ($take > 0) {
                        $this->decreaseBalance((int) $balance->id, $bucket, $take);
                        $remaining -= $take;
                    }
                    if ($remaining === 0) {
                        break 2;
                    }
                }
            }

            $movementIds[$productId] = (int) DB::table('inventory_movements')->insertGetId([
                'store_id' => $storeId,
                'product_id' => $productId,
                'qty' => Decimal::qtyString(abs($units)),
                'movement_type' => 'write_off',
                'unit_cost' => $line['unit_cost'],
                'ref_type' => 'stock_opname',
                'ref_id' => $sessionId,
                'occurred_at' => $now,
                'created_by' => $actor->id,
            ]);
        }

        return $movementIds;
    }

    /** @var array{store_id: int, product_ids: list<int>, transaction_level: int}|null */
    private ?array $authorizedStockMutation = null;

    /** @param list<int>|null $productIds */
    public function synchronizeAutomaticPurchaseRequisitions(User $actor, int $storeId, ?array $productIds = null): ?array
    {
        return $this->requisitions->synchronizeAutomatic($actor, $storeId, $productIds);
    }

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

            $this->assertStockUnlocked($storeId, $ids);
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

            $this->synchronizeAutomaticPurchaseRequisitions($actor, $storeId, $ids);

            return ['document_no' => $documentNo, 'items' => $lines];
        });
    }

    // ------------------------------------------------------------------ penerimaan

    /**
     * Barang masuk dari penerimaan PO atau GR pengganti. Produk track_expiry wajib bertanggal kadaluarsa.
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
        string $movementType = 'receipt',
        string $bucket = 'sellable',
    ): array {
        $this->requireTransaction();

        if (! in_array($movementType, ['receipt', 'supplier_replacement_in', 'adjustment'], true)) {
            throw new LogicException('Jenis pergerakan stok masuk tidak valid.');
        }

        $product = DB::table('products')->where('store_id', $storeId)->where('id', $productId)->lockForUpdate()->first();
        abort_if($product === null, 404, 'Produk tidak ditemukan.');
        $this->assertStockUnlocked($storeId, [$productId], $refType, $refId);

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
            type: $movementType,
            refType: $refType,
            refId: $refId,
            actorId: $actorId,
            bucket: $bucket,
        );
    }

    /**
     * Apply one manual adjustment at the active store-floor location. Expiry-tracked
     * increases create an expiry bucket without exposing batch identity to the user.
     *
     * @return array{stock_before: string, stock_after: string, allocations: list<array<string, mixed>>, movement_ids: list<int>}
     */
    public function recordDirectAdjustment(
        int $storeId,
        int $adjustmentId,
        int $productId,
        string $type,
        int $quantity,
        string $reasonCode,
        ?string $expiryDate,
        int $actorId,
    ): array {
        $this->requireTransaction();

        $product = DB::table('products')
            ->where('store_id', $storeId)
            ->where('id', $productId)
            ->lockForUpdate()
            ->first();
        abort_if($product === null, 404, 'Produk tidak ditemukan.');
        $this->assertStockUnlocked($storeId, [$productId], 'stock_adjustment', $adjustmentId);
        if ($product->status !== 'active') {
            throw ValidationException::withMessages(['product_id' => ['Produk harus berstatus aktif.']]);
        }
        if ($type === 'increase' && $product->track_expiry && $expiryDate === null) {
            throw ValidationException::withMessages(['expiry_date' => ['Tanggal kedaluwarsa wajib diisi untuk produk ini.']]);
        }

        $locationId = $this->sellingLocationId($storeId);
        $rows = DB::table('inventory_balances as bal')
            ->leftJoin('product_batches as pb', 'pb.id', '=', 'bal.batch_id')
            ->where('bal.product_id', $productId)
            ->where('bal.location_id', $locationId)
            ->where('bal.qty_sellable', '>', 0)
            ->orderByRaw('pb.expiry_date IS NULL')
            ->orderBy('pb.expiry_date')
            ->orderBy('pb.received_at')
            ->orderBy('bal.id')
            ->lockForUpdate()
            ->get([
                'bal.id', 'bal.batch_id', 'bal.shelf_position_id', 'bal.qty_sellable',
                'pb.expiry_date',
            ]);

        $stockBeforeUnits = 0;
        foreach ($rows as $row) {
            $stockBeforeUnits += Decimal::qty((string) $row->qty_sellable);
        }
        $amount = Decimal::qty((string) $quantity);
        if ($type === 'decrease' && $stockBeforeUnits < $amount) {
            throw new InsufficientStockException('Stok saat ini tidak mencukupi untuk pengurangan tersebut.');
        }

        $allocations = [];
        $movementIds = [];
        if ($type === 'increase') {
            $received = $this->stockIn(
                storeId: $storeId,
                product: $product,
                locationId: $locationId,
                positionId: null,
                qty: Decimal::qtyString($amount),
                unitCost: $product->unit_cost === null ? null : (string) $product->unit_cost,
                expiryDate: $expiryDate,
                batchCode: null,
                goodsReceiptItemId: null,
                isOpening: false,
                type: 'adjustment',
                refType: 'stock_adjustment',
                refId: $adjustmentId,
                actorId: $actorId,
            );
            $allocations[] = [
                'product_id' => $productId,
                'batch_id' => $received['batch_id'],
                'location_id' => $locationId,
                'shelf_position_id' => null,
                'qty_before' => '0.000',
                'qty_counted' => Decimal::qtyString($amount),
                'qty_diff' => Decimal::qtyString($amount),
                'stock_movement_id' => $received['movement_id'],
            ];
            $movementIds[] = $received['movement_id'];
        } else {
            $remaining = $amount;
            foreach ($rows as $row) {
                if ($remaining <= 0) {
                    break;
                }

                $available = Decimal::qty((string) $row->qty_sellable);
                $taken = min($remaining, $available);
                $remaining -= $taken;
                $this->decreaseBalance((int) $row->id, 'sellable', $taken);
                $movesToDamaged = $reasonCode === 'damaged';
                if ($movesToDamaged) {
                    $this->increaseBalance((int) $row->id, 'damaged', $taken);
                }

                $movementId = DB::table('inventory_movements')->insertGetId([
                    'store_id' => $storeId,
                    'product_id' => $productId,
                    'batch_id' => $row->batch_id,
                    'from_location_id' => $locationId,
                    'from_position_id' => $row->shelf_position_id,
                    'from_bucket' => 'sellable',
                    'to_location_id' => $movesToDamaged ? $locationId : null,
                    'to_position_id' => $movesToDamaged ? $row->shelf_position_id : null,
                    'to_bucket' => $movesToDamaged ? 'damaged' : null,
                    'qty' => Decimal::qtyString($taken),
                    'movement_type' => in_array($reasonCode, ['lost', 'expired'], true) ? 'write_off' : 'adjustment',
                    'unit_cost' => $product->unit_cost,
                    'ref_type' => 'stock_adjustment',
                    'ref_id' => $adjustmentId,
                    'occurred_at' => $this->now(),
                    'created_by' => $actorId,
                ]);
                $movementIds[] = (int) $movementId;
                $allocations[] = [
                    'product_id' => $productId,
                    'batch_id' => $row->batch_id,
                    'location_id' => $locationId,
                    'shelf_position_id' => $row->shelf_position_id,
                    'qty_before' => $row->qty_sellable,
                    'qty_counted' => Decimal::qtyString($available - $taken),
                    'qty_diff' => Decimal::qtyString(-$taken),
                    'stock_movement_id' => (int) $movementId,
                ];
            }
        }

        $stockAfterUnits = $type === 'increase'
            ? $stockBeforeUnits + $amount
            : $stockBeforeUnits - $amount;

        return [
            'stock_before' => Decimal::qtyString($stockBeforeUnits),
            'stock_after' => Decimal::qtyString($stockAfterUnits),
            'allocations' => $allocations,
            'movement_ids' => $movementIds,
        ];
    }

    /**
     * Memindahkan barang yang diklaim ke karantina sampai supplier mengambil keputusan.
     *
     * @param  list<array<string, mixed>>  $items
     */
    public function quarantineSupplierReturn(int $storeId, int $returnId, array $items, int $actorId): void
    {
        $this->requireTransaction();

        $productIds = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
        DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
            ->orderBy('id')->lockForUpdate()->get(['id']);
        $this->assertStockUnlocked($storeId, $productIds, 'supplier_return', $returnId);

        $balances = [];
        $errors = [];
        foreach ($items as $index => $item) {
            $balance = DB::table('inventory_balances')
                ->where('product_id', (int) $item['product_id'])
                ->where('location_id', (int) $item['location_id'])
                ->whereRaw('position_key = ?', [$item['shelf_position_id'] ?? 0])
                ->whereRaw('batch_key = ?', [$item['batch_id'] ?? 0])
                ->lockForUpdate()
                ->first();
            $bucket = (string) $item['source_bucket'];
            $column = self::BUCKET_COLUMNS[$bucket];
            $available = Decimal::qty((string) ($balance->{$column} ?? '0'));
            $qty = Decimal::qty((string) $item['qty']);
            if ($balance === null || $available < $qty) {
                $errors["items.{$index}.qty"] = ['Stok berubah atau tidak mencukupi untuk mengajukan retur.'];

                continue;
            }
            $balances[$index] = (int) $balance->id;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        foreach ($items as $index => $item) {
            $qty = Decimal::qty((string) $item['qty']);
            $bucket = (string) $item['source_bucket'];
            $this->decreaseBalance($balances[$index], $bucket, $qty);
            $this->increaseBalance($balances[$index], 'quarantine', $qty);
            DB::table('inventory_movements')->insert([
                'store_id' => $storeId,
                'product_id' => (int) $item['product_id'],
                'batch_id' => $item['batch_id'],
                'from_location_id' => (int) $item['location_id'],
                'from_position_id' => $item['shelf_position_id'],
                'from_bucket' => $bucket,
                'to_location_id' => (int) $item['location_id'],
                'to_position_id' => $item['shelf_position_id'],
                'to_bucket' => 'quarantine',
                'qty' => Decimal::qtyString($qty),
                'movement_type' => 'adjustment',
                'unit_cost' => $item['unit_cost'],
                'ref_type' => 'supplier_return',
                'ref_id' => $returnId,
                'occurred_at' => $this->now(),
                'created_by' => $actorId,
            ]);
        }
    }

    /**
     * Removes claimed stock from quarantine after supplier acceptance or approved write-off.
     *
     * @param  list<array<string, mixed>>  $items
     */
    public function closeSupplierReturn(
        int $storeId,
        int $returnId,
        array $items,
        int $actorId,
        string $movementType,
    ): void {
        $this->requireTransaction();

        if (! in_array($movementType, ['supplier_return_out', 'write_off'], true)) {
            throw new LogicException('Jenis pergerakan stok keluar tidak valid.');
        }

        $productIds = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
        DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
            ->orderBy('id')->lockForUpdate()->get(['id']);
        $this->assertStockUnlocked($storeId, $productIds, 'supplier_return', $returnId);

        $balances = [];
        $errors = [];
        foreach ($items as $index => $item) {
            $balance = DB::table('inventory_balances')
                ->where('product_id', (int) $item['product_id'])
                ->where('location_id', (int) $item['location_id'])
                ->whereRaw('position_key = ?', [$item['shelf_position_id'] ?? 0])
                ->whereRaw('batch_key = ?', [$item['batch_id'] ?? 0])
                ->lockForUpdate()
                ->first();
            $available = Decimal::qty((string) ($balance->qty_quarantine ?? '0'));
            $qty = Decimal::qty((string) $item['qty']);
            if ($balance === null || $available < $qty) {
                $errors["items.{$index}.qty"] = ['Stok karantina retur berubah atau tidak mencukupi.'];

                continue;
            }
            $balances[$index] = (int) $balance->id;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        foreach ($items as $index => $item) {
            $qty = Decimal::qty((string) $item['qty']);
            $this->decreaseBalance($balances[$index], 'quarantine', $qty);
            DB::table('inventory_movements')->insert([
                'store_id' => $storeId,
                'product_id' => (int) $item['product_id'],
                'batch_id' => $item['batch_id'],
                'from_location_id' => (int) $item['location_id'],
                'from_position_id' => $item['shelf_position_id'],
                'from_bucket' => 'quarantine',
                'qty' => Decimal::qtyString($qty),
                'movement_type' => $movementType,
                'unit_cost' => $item['unit_cost'],
                'ref_type' => 'supplier_return',
                'ref_id' => $returnId,
                'occurred_at' => $this->now(),
                'created_by' => $actorId,
            ]);
        }
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
        $this->assertStockUnlocked($storeId, [$productId], $refType, $refId);

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
                'unit_cost' => $product->unit_cost,
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
                'unit_cost' => $product->unit_cost,
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
        $this->assertStockUnlocked($storeId, $productIds, $refType, $refId);

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
        $this->assertStockUnlocked($storeId, $productIds, $refType, $refId);

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
                'unit_cost' => $product->unit_cost,
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

    // ------------------------------------------------------------------ baca

    /**
     * Ringkasan kedaluwarsa untuk banner global dan status per produk pada daftar master.
     *
     * @param  list<int>  $productIds  Opsional; membatasi rincian status produk yang dikembalikan
     * @return array<string, mixed>
     */
    public function expiryMonitoring(int $storeId, array $productIds = []): array
    {
        $warnDays = $this->expiryWarningDays($storeId);
        $today = Carbon::now('Asia/Jakarta')->startOfDay();
        $todayDate = $today->toDateString();
        $cutoff = $today->copy()->addDays($warnDays)->toDateString();

        $alertCounts = DB::table('inventory_balances as bal')
            ->join('products as p', 'p.id', '=', 'bal.product_id')
            ->join('product_batches as pb', 'pb.id', '=', 'bal.batch_id')
            ->where('p.store_id', $storeId)
            ->where('p.status', 'active')
            ->where('p.track_expiry', true)
            ->where('bal.qty_sellable', '>', 0)
            ->whereNotNull('pb.expiry_date')
            ->where('pb.expiry_date', '<=', $cutoff)
            ->selectRaw('COUNT(DISTINCT CASE WHEN pb.expiry_date < ? THEN pb.id END) as expired', [$todayDate])
            ->selectRaw('COUNT(DISTINCT CASE WHEN pb.expiry_date >= ? THEN pb.id END) as near_expiry', [$todayDate])
            ->first();

        $products = [];
        if ($productIds !== []) {
            $productRows = DB::table('products')
                ->where('store_id', $storeId)
                ->whereIn('id', $productIds)
                ->orderBy('id')
                ->get(['id', 'track_expiry']);
            $statusById = [];
            $priority = [
                'not_tracked' => 0,
                'no_stock' => 1,
                'ok' => 2,
                'none' => 3,
                'near_expiry' => 4,
                'expired' => 5,
            ];
            $trackedIds = [];

            foreach ($productRows as $product) {
                $id = (int) $product->id;
                $isTracked = (bool) $product->track_expiry;
                $statusById[$id] = $isTracked ? 'no_stock' : 'not_tracked';
                if ($isTracked) {
                    $trackedIds[] = $id;
                }
            }

            if ($trackedIds !== []) {
                $stockRows = DB::table('inventory_balances as bal')
                    ->join('products as p', 'p.id', '=', 'bal.product_id')
                    ->leftJoin('product_batches as pb', 'pb.id', '=', 'bal.batch_id')
                    ->where('p.store_id', $storeId)
                    ->whereIn('p.id', $trackedIds)
                    ->whereRaw('(bal.qty_sellable > 0 or bal.qty_quarantine > 0 or bal.qty_damaged > 0)')
                    ->get(['p.id as product_id', 'pb.expiry_date']);

                foreach ($stockRows as $row) {
                    $id = (int) $row->product_id;
                    $status = $this->expiryStatus($row->expiry_date, $today, $warnDays);
                    if ($priority[$status] > $priority[$statusById[$id]]) {
                        $statusById[$id] = $status;
                    }
                }
            }

            foreach ($statusById as $productId => $status) {
                $products[] = ['product_id' => $productId, 'expiry_status' => $status];
            }
        }

        $expiredCount = (int) ($alertCounts->expired ?? 0);
        $nearExpiryCount = (int) ($alertCounts->near_expiry ?? 0);

        return [
            'warning_days' => $warnDays,
            'alert_counts' => [
                'expired' => $expiredCount,
                'near_expiry' => $nearExpiryCount,
                'total' => $expiredCount + $nearExpiryCount,
            ],
            'products' => $products,
        ];
    }

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
            'unit_cost' => $product->unit_cost,
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
            ->leftJoin('stock_opname_sessions as os', function ($join) {
                $join->on('os.id', '=', 'm.ref_id')->where('m.ref_type', '=', 'stock_opname');
            })
            ->where('m.store_id', $storeId)
            ->orderByDesc('m.occurred_at')
            ->orderByDesc('m.id')
            ->select([
                'm.id', 'm.product_id', 'p.sku', 'p.name as product_name', 'm.batch_id', 'pb.batch_code', 'pb.expiry_date',
                'm.movement_type', 'm.qty', 'm.unit_cost',
                'm.from_location_id', 'm.from_position_id', 'm.from_bucket',
                'm.to_location_id', 'm.to_position_id', 'm.to_bucket',
                'm.ref_type', 'm.ref_id', 'm.occurred_at', 'm.created_by', 'u.name as created_by_name',
                'os.number as opname_number',
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
                'ref_label' => $row->opname_number === null ? "{$row->ref_type} #{$row->ref_id}" : 'Opname '.$row->opname_number,
                'occurred_at' => $row->occurred_at,
                'created_by' => $row->created_by === null ? null : (int) $row->created_by,
                'created_by_name' => $row->created_by_name,
            ];
        });
    }

    // ------------------------------------------------------------------ internal

    /**
     * Barang masuk ke bucket sellable: batch baru, saldo, pergerakan, dan pembaruan Harga Modal terbaru.
     *
     * @return array{batch_id: int, balance_id: int, movement_id: int}
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
        string $bucket = 'sellable',
        bool $updateProductCost = true,
    ): array {
        $units = Decimal::qty($qty);
        if ($units <= 0) {
            throw ValidationException::withMessages(['qty' => ['Jumlah harus lebih dari nol.']]);
        }
        if (! array_key_exists($bucket, self::BUCKET_COLUMNS)) {
            throw new LogicException('Bucket stok masuk tidak valid.');
        }
        $qtyText = Decimal::qtyString($units);
        $now = $this->now();

        $batchId = DB::table('product_batches')->insertGetId([
            'product_id' => $product->id,
            'goods_receipt_item_id' => $goodsReceiptItemId,
            'batch_code' => $batchCode,
            'expiry_date' => $expiryDate,
            'received_at' => $now,
            'is_opening' => $isOpening ? 1 : 0,
        ]);

        $balanceId = $this->lockOrCreateBalance((int) $product->id, $locationId, $positionId, $batchId);
        $this->increaseBalance($balanceId, $bucket, $units);

        $movementId = DB::table('inventory_movements')->insertGetId([
            'store_id' => $storeId,
            'product_id' => $product->id,
            'batch_id' => $batchId,
            'to_location_id' => $locationId,
            'to_position_id' => $positionId,
            'to_bucket' => $bucket,
            'qty' => $qtyText,
            'movement_type' => $type,
            'unit_cost' => $unitCost,
            'ref_type' => $refType,
            'ref_id' => $refId,
            'occurred_at' => $now,
            'created_by' => $actorId,
        ]);

        if ($unitCost !== null && $updateProductCost) {
            DB::update(
                'UPDATE products SET unit_cost = ROUND(CAST(? AS DECIMAL(18,4)), 4) WHERE id = ?',
                [$unitCost, $product->id],
            );
        }

        return ['batch_id' => $batchId, 'balance_id' => $balanceId, 'movement_id' => (int) $movementId];
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

    /** @param list<int> $productIds */
    private function assertStockUnlocked(
        int $storeId,
        array $productIds,
        ?string $sourceRefType = null,
        ?int $sourceRefId = null,
    ): void {
        $productIds = array_values(array_unique(array_map('intval', $productIds)));
        sort($productIds);
        if ($productIds === []) {
            return;
        }

        if (
            $this->authorizedStockMutation !== null
            && $this->authorizedStockMutation['store_id'] === $storeId
            && $this->authorizedStockMutation['transaction_level'] === DB::transactionLevel()
            && array_diff($productIds, $this->authorizedStockMutation['product_ids']) === []
        ) {
            return;
        }

        $this->lockStockRows($productIds);
        $this->opnameLocks->assertUnlocked($storeId, $productIds, $sourceRefType, $sourceRefId);
    }

    /** @param list<int> $productIds */
    private function lockStockRows(array $productIds): void
    {
        if ($productIds === []) {
            return;
        }

        DB::table('inventory_balances')
            ->whereIn('product_id', $productIds)
            ->orderBy('product_id')
            ->orderBy('id')
            ->lockForUpdate()
            ->get(['id']);
    }
}
