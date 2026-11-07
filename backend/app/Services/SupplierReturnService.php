<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use App\Support\StockAuthorityPolicy;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SupplierReturnService
{
    public function __construct(
        private InventoryService $inventory,
        private NumberSequence $sequences,
        private AuditLogger $audit,
        private PermissionResolver $permissions,
        private ReauthService $reauth,
    ) {}

    /** @param array<string, mixed> $filters */
    public function search(User $user, int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $this->assertCanView($user, $storeId);
        $query = $this->headerQuery($storeId)->orderByDesc('sr.id');

        if (! empty($filters['status'])) {
            $query->where('sr.status', $filters['status']);
        }
        if (! empty($filters['return_type'])) {
            $query->where('sr.return_type', $filters['return_type']);
        }
        if (! empty($filters['supplier_id'])) {
            $query->where('sr.supplier_id', (int) $filters['supplier_id']);
        }
        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where('sr.doc_number', 'like', "{$term}%");
        }

        return $query->paginate($perPage)->through(fn ($row) => $this->presentHeader($row));
    }

    /** @return array<string, mixed>|null */
    public function find(User $user, int $storeId, int $id): ?array
    {
        $this->assertCanView($user, $storeId);
        $header = $this->headerQuery($storeId)->where('sr.id', $id)->first();

        return $header === null ? null : $this->load($storeId, $id);
    }

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $this->assertCanCreate($actor, $storeId);

        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            $supplier = DB::table('suppliers')
                ->where('store_id', $storeId)
                ->where('id', (int) $data['supplier_id'])
                ->where('is_active', 1)
                ->lockForUpdate()
                ->first(['id']);
            if ($supplier === null) {
                throw ValidationException::withMessages(['supplier_id' => ['Supplier tidak ditemukan atau nonaktif pada toko ini.']]);
            }

            if (($data['return_type'] ?? 'outgoing') === 'incoming') {
                return $this->createIncomingReturn($actor, $storeId, $supplier, $data);
            }

            $items = array_values($data['items']);
            $productIds = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
            $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
                ->orderBy('id')->lockForUpdate()->get(['id', 'name', 'track_expiry', 'unit_cost'])->keyBy('id');
            $locations = DB::table('locations')
                ->where('store_id', $storeId)
                ->whereIn('id', collect($items)->pluck('location_id')->filter()->map(fn ($id) => (int) $id)->unique()->all())
                ->where('is_active', 1)
                ->orderBy('id')
                ->lockForUpdate()
                ->get(['id'])
                ->keyBy('id');

            $errors = [];
            $normalized = [];
            $seen = [];
            foreach ($items as $index => $item) {
                $productId = (int) $item['product_id'];
                $product = $products->get($productId);
                if ($product === null) {
                    $errors["items.{$index}.product_id"] = ['Produk tidak ditemukan pada toko ini.'];

                    continue;
                }

                if (! isset($item['location_id'])) {
                    if (! DB::table('product_suppliers')->where('product_id', $productId)->where('supplier_id', $supplier->id)->exists()) {
                        $errors["items.{$index}.product_id"] = ['Produk tidak terkait dengan supplier yang dipilih.'];

                        continue;
                    }

                    $remainingQty = Decimal::qty((string) $item['qty']);
                    $sourceBuckets = isset($item['source_bucket'])
                        ? [$item['source_bucket']]
                        : ['damaged', 'sellable'];

                    foreach ($sourceBuckets as $sourceBucket) {
                        $column = $sourceBucket === 'sellable' ? 'qty_sellable' : 'qty_damaged';
                        $balances = DB::table('inventory_balances as ib')
                            ->where('ib.product_id', $productId)
                            ->where("ib.{$column}", '>', 0)
                            ->orderBy('ib.location_id')
                            ->orderBy('ib.batch_id')
                            ->orderBy('ib.id')
                            ->lockForUpdate()
                            ->get(['ib.batch_id', 'ib.location_id', 'ib.shelf_position_id', "ib.{$column} as available"]);

                        foreach ($balances as $balance) {
                            if ($remainingQty <= 0) {
                                break;
                            }
                            $locationId = (int) $balance->location_id;
                            StockAuthorityPolicy::assertScope($actor, $storeId, 'supplier_return', $locationId);
                            $batchId = $balance->batch_id === null ? null : (int) $balance->batch_id;
                            if ((bool) $product->track_expiry && $batchId === null) {
                                continue;
                            }
                            $allocated = min($remainingQty, Decimal::qty((string) $balance->available));
                            $sourcePoItemId = $batchId === null ? null : DB::table('product_batches as b')
                                ->join('goods_receipt_items as gri', 'gri.id', '=', 'b.goods_receipt_item_id')
                                ->where('b.id', $batchId)
                                ->value('gri.po_item_id');
                            $normalized[] = [
                                'product_id' => $productId,
                                'batch_id' => $batchId,
                                'location_id' => $locationId,
                                'shelf_position_id' => $balance->shelf_position_id === null ? null : (int) $balance->shelf_position_id,
                                'source_bucket' => $sourceBucket,
                                'qty' => Decimal::qtyString($allocated),
                                'unit_cost' => $product->unit_cost,
                                'source_po_item_id' => $sourcePoItemId === null ? null : (int) $sourcePoItemId,
                            ];
                            $remainingQty -= $allocated;
                        }
                    }

                    if ($remainingQty > 0) {
                        $errors["items.{$index}.qty"] = ["Stok {$product->name} tidak mencukupi untuk jumlah retur."];
                    }

                    continue;
                }

                $locationId = (int) $item['location_id'];
                if (! $locations->has($locationId)) {
                    $errors["items.{$index}.location_id"] = ['Lokasi tidak ditemukan atau nonaktif pada toko ini.'];

                    continue;
                }
                StockAuthorityPolicy::assertScope($actor, $storeId, 'supplier_return', $locationId);

                $batchId = isset($item['batch_id']) ? (int) $item['batch_id'] : null;
                if ((bool) $product->track_expiry && $batchId === null) {
                    $errors["items.{$index}.batch_id"] = ['Batch wajib dipilih untuk produk yang melacak tanggal kedaluwarsa.'];

                    continue;
                }
                if ($batchId !== null && ! DB::table('product_batches')
                    ->where('id', $batchId)->where('product_id', $productId)->exists()) {
                    $errors["items.{$index}.batch_id"] = ['Batch tidak ditemukan untuk produk ini.'];

                    continue;
                }

                $positionId = isset($item['shelf_position_id']) ? (int) $item['shelf_position_id'] : null;
                if ($positionId !== null && ! $this->positionBelongsToLocation($positionId, $locationId)) {
                    $errors["items.{$index}.shelf_position_id"] = ['Posisi tidak valid untuk lokasi tersebut.'];

                    continue;
                }

                $sourceBucket = $item['source_bucket'] ?? 'sellable';
                $balanceKey = "{$productId}:{$batchId}:{$locationId}:{$positionId}:{$sourceBucket}";
                if (isset($seen[$balanceKey])) {
                    $errors["items.{$index}.product_id"] = ['Setiap kombinasi produk, batch, lokasi, posisi, dan bucket hanya boleh dicatat sekali.'];

                    continue;
                }
                $seen[$balanceKey] = true;
                $sourcePoItemId = $batchId === null ? null : DB::table('product_batches as b')
                    ->join('goods_receipt_items as gri', 'gri.id', '=', 'b.goods_receipt_item_id')
                    ->where('b.id', $batchId)
                    ->value('gri.po_item_id');
                $normalized[] = [
                    'product_id' => $productId,
                    'batch_id' => $batchId,
                    'location_id' => $locationId,
                    'shelf_position_id' => $positionId,
                    'source_bucket' => $sourceBucket,
                    'qty' => Decimal::qtyString(Decimal::qty((string) $item['qty'])),
                    'unit_cost' => $product->unit_cost,
                    'source_po_item_id' => $sourcePoItemId === null ? null : (int) $sourcePoItemId,
                ];
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $id = DB::table('supplier_returns')->insertGetId([
                'store_id' => $storeId,
                'doc_number' => DocumentNumber::format('RET', $this->sequences->next($storeId, 'RET')),
                'supplier_id' => $supplier->id,
                'return_type' => 'outgoing',
                'status' => 'draft',
                'requested_by' => $actor->id,
                'note' => $data['note'] ?? null,
            ]);
            foreach ($normalized as $item) {
                DB::table('supplier_return_items')->insert(['supplier_return_id' => $id] + $item);
            }

            $this->audit->log(
                'supplier_return.create',
                'supplier_return',
                $id,
                after: ['supplier_id' => (int) $supplier->id, 'items_count' => count($normalized)],
                reason: $data['note'] ?? null,
                actorId: $actor->id,
                storeId: $storeId,
            );

            return $id;
        });

        return $this->load($storeId, $id) ?? [];
    }

    /**
     * Creates the linked return draft as part of a final goods receipt transaction.
     */
    public function createFromGoodsReceipt(User $actor, int $storeId, int $goodsReceiptId): ?int
    {
        $receipt = DB::table('goods_receipts')
            ->where('store_id', $storeId)
            ->where('id', $goodsReceiptId)
            ->lockForUpdate()
            ->first();

        if ($receipt === null) {
            throw ValidationException::withMessages(['goods_receipt_id' => ['Penerimaan tidak ditemukan.']]);
        }

        $damagedItems = DB::table('goods_receipt_items as gri')
            ->join('products as p', 'p.id', '=', 'gri.product_id')
            ->where('gri.gr_id', $goodsReceiptId)
            ->where('gri.qty_damaged', '>', 0)
            ->orderBy('gri.id')
            ->lockForUpdate()
            ->get([
                'gri.id', 'gri.po_item_id', 'gri.product_id', 'gri.qty_damaged',
                'gri.unit_cost', 'p.unit_cost as product_unit_cost',
            ]);

        if ($damagedItems->isEmpty()) {
            return null;
        }

        if (DB::table('supplier_returns')
            ->where('goods_receipt_id', $goodsReceiptId)
            ->where('return_type', 'incoming')
            ->whereNotIn('status', ['cancelled'])
            ->exists()) {
            throw ValidationException::withMessages([
                'goods_receipt_id' => ['Penerimaan ini sudah memiliki dokumen Retur Barang.'],
            ]);
        }

        $id = DB::table('supplier_returns')->insertGetId([
            'store_id' => $storeId,
            'doc_number' => DocumentNumber::format('RET', $this->sequences->next($storeId, 'RET')),
            'supplier_id' => $receipt->supplier_id,
            'return_type' => 'incoming',
            'goods_receipt_id' => $goodsReceiptId,
            'invoice_no' => $receipt->invoice_no,
            'status' => 'draft',
            'requested_by' => $actor->id,
            'note' => null,
        ]);

        foreach ($damagedItems as $item) {
            DB::table('goods_receipt_items')->where('id', $item->id)
                ->update(['damage_disposition' => 'quarantine']);
            $returnItemId = DB::table('supplier_return_items')->insertGetId([
                'supplier_return_id' => $id,
                'goods_receipt_item_id' => $item->id,
                'source_po_item_id' => $item->po_item_id,
                'product_id' => $item->product_id,
                'batch_id' => null,
                'location_id' => $receipt->receiving_location_id,
                'shelf_position_id' => null,
                'source_bucket' => 'damaged',
                'disposition' => 'quarantine',
                'qty' => $item->qty_damaged,
                'unit_cost' => $item->product_unit_cost ?? $item->unit_cost,
            ]);
            DB::table('goods_receipt_items')->where('id', $item->id)
                ->update(['supplier_return_item_id' => $returnItemId]);
        }

        $this->audit->log(
            'supplier_return.incoming_create',
            'supplier_return',
            $id,
            after: [
                'goods_receipt_id' => $goodsReceiptId,
                'return_type' => 'incoming',
                'items_count' => $damagedItems->count(),
                'automatic' => true,
            ],
            actorId: $actor->id,
            storeId: $storeId,
        );

        return $id;
    }

    /**
     * Menambahkan produk ke draft retur keluar dan mengalokasikan stok secara atomik.
     *
     * @param  list<array{product_id: int, qty: string|int|float}>  $items
     * @return array<string, mixed>
     */
    public function merge(User $actor, int $storeId, int $id, array $items): array
    {
        $this->assertCanCreate($actor, $storeId);

        DB::transaction(function () use ($actor, $storeId, $id, $items) {
            $return = DB::table('supplier_returns')
                ->where('store_id', $storeId)
                ->where('id', $id)
                ->lockForUpdate()
                ->first();
            if ($return === null) {
                abort(404, 'Draft retur tidak ditemukan.');
            }
            if ($return->return_type !== 'outgoing' || $return->status !== 'draft') {
                throw ValidationException::withMessages([
                    'status' => ['Barang hanya dapat digabungkan ke draft Retur Keluar.'],
                ]);
            }

            $productIds = collect($items)->pluck('product_id')->map(fn ($productId) => (int) $productId)->all();
            if (count($productIds) !== count(array_unique($productIds))) {
                throw ValidationException::withMessages([
                    'items' => ['Setiap produk hanya boleh ditambahkan satu kali dalam proses penggabungan.'],
                ]);
            }

            $existingItemCount = DB::table('supplier_return_items')
                ->where('supplier_return_id', $id)
                ->count();
            if ($existingItemCount + count($items) > 200) {
                throw ValidationException::withMessages([
                    'items' => ['Draft retur maksimal memuat 200 baris barang.'],
                ]);
            }

            $products = DB::table('products')
                ->where('store_id', $storeId)
                ->whereIn('id', $productIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get(['id', 'name', 'status', 'track_expiry', 'unit_cost'])
                ->keyBy('id');
            $normalized = [];
            $errors = [];

            foreach ($items as $index => $item) {
                $productId = (int) $item['product_id'];
                $product = $products->get($productId);
                if ($product === null || $product->status === 'inactive') {
                    $errors["items.{$index}.product_id"] = ['Produk tidak ditemukan atau nonaktif pada toko ini.'];

                    continue;
                }
                if (! DB::table('product_suppliers')
                    ->where('product_id', $productId)
                    ->where('supplier_id', $return->supplier_id)
                    ->exists()) {
                    $errors["items.{$index}.product_id"] = ['Produk tidak terkait dengan supplier draft retur.'];

                    continue;
                }

                $remainingQty = Decimal::qty((string) $item['qty']);
                foreach (['damaged' => 'qty_damaged', 'sellable' => 'qty_sellable'] as $sourceBucket => $column) {
                    $balances = DB::table('inventory_balances as ib')
                        ->where('ib.product_id', $productId)
                        ->where("ib.{$column}", '>', 0)
                        ->orderBy('ib.location_id')
                        ->orderBy('ib.batch_id')
                        ->orderBy('ib.id')
                        ->lockForUpdate()
                        ->get(['ib.batch_id', 'ib.location_id', 'ib.shelf_position_id', "ib.{$column} as available"]);

                    foreach ($balances as $balance) {
                        if ($remainingQty <= 0) {
                            break;
                        }
                        $locationId = (int) $balance->location_id;
                        StockAuthorityPolicy::assertScope($actor, $storeId, 'supplier_return', $locationId);
                        $batchId = $balance->batch_id === null ? null : (int) $balance->batch_id;
                        if ((bool) $product->track_expiry && $batchId === null) {
                            continue;
                        }

                        $allocated = min($remainingQty, Decimal::qty((string) $balance->available));
                        $sourcePoItemId = $batchId === null ? null : DB::table('product_batches as b')
                            ->join('goods_receipt_items as gri', 'gri.id', '=', 'b.goods_receipt_item_id')
                            ->where('b.id', $batchId)
                            ->value('gri.po_item_id');
                        $normalized[] = [
                            'product_id' => $productId,
                            'batch_id' => $batchId,
                            'location_id' => $locationId,
                            'shelf_position_id' => $balance->shelf_position_id === null ? null : (int) $balance->shelf_position_id,
                            'source_bucket' => $sourceBucket,
                            'qty' => Decimal::qtyString($allocated),
                            'unit_cost' => $product->unit_cost,
                            'source_po_item_id' => $sourcePoItemId === null ? null : (int) $sourcePoItemId,
                        ];
                        $remainingQty -= $allocated;
                    }
                }

                if ($remainingQty > 0) {
                    $errors["items.{$index}.qty"] = ["Stok {$product->name} tidak mencukupi untuk jumlah retur."];
                }
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }
            if ($existingItemCount + count($normalized) > 200) {
                throw ValidationException::withMessages([
                    'items' => ['Draft retur maksimal memuat 200 baris alokasi stok. Kurangi kuantitas atau buat retur baru.'],
                ]);
            }

            foreach ($normalized as $item) {
                DB::table('supplier_return_items')->insert($item + [
                    'supplier_return_id' => $id,
                ]);
            }
            DB::table('supplier_returns')->where('id', $id)->update(['updated_at' => $this->nowUtc()]);

            $this->audit->log(
                'supplier_return.merge',
                'supplier_return',
                $id,
                before: ['items_count' => $existingItemCount],
                after: ['items_count' => $existingItemCount + count($normalized), 'added_items_count' => count($normalized)],
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id) ?? [];
    }

    /**
     * @param  object{id: int}  $supplier
     * @param  array<string, mixed>  $data
     */
    private function createIncomingReturn(User $actor, int $storeId, object $supplier, array $data): int
    {
        $receipt = DB::table('goods_receipts')
            ->where('store_id', $storeId)
            ->where('id', (int) $data['goods_receipt_id'])
            ->lockForUpdate()
            ->first();

        if ($receipt === null || $receipt->status !== 'draft' || (int) $receipt->supplier_id !== (int) $supplier->id) {
            throw ValidationException::withMessages([
                'goods_receipt_id' => ['Pilih GR draft dari supplier yang sama.'],
            ]);
        }

        if (DB::table('supplier_returns')
            ->where('goods_receipt_id', $receipt->id)
            ->where('return_type', 'incoming')
            ->whereNotIn('status', ['cancelled'])
            ->exists()) {
            throw ValidationException::withMessages([
                'goods_receipt_id' => ['GR ini sudah memiliki dokumen Retur Masuk.'],
            ]);
        }

        $damagedItems = DB::table('goods_receipt_items as gri')
            ->join('products as p', 'p.id', '=', 'gri.product_id')
            ->where('gri.gr_id', $receipt->id)
            ->where('gri.qty_damaged', '>', 0)
            ->orderBy('gri.id')
            ->lockForUpdate()
            ->get([
                'gri.id', 'gri.po_item_id', 'gri.product_id', 'gri.qty_damaged',
                'gri.damage_disposition', 'gri.unit_cost', 'p.unit_cost as product_unit_cost',
            ]);

        if ($damagedItems->isEmpty()) {
            throw ValidationException::withMessages([
                'goods_receipt_id' => ['GR ini tidak memiliki barang rusak untuk diretur.'],
            ]);
        }

        $inputByReceiptItem = [];
        foreach (array_values($data['items'] ?? []) as $index => $returnItem) {
            $receiptItemId = (int) $returnItem['goods_receipt_item_id'];
            if (isset($inputByReceiptItem[$receiptItemId])) {
                throw ValidationException::withMessages([
                    "items.{$index}.goods_receipt_item_id" => ['Baris barang rusak hanya boleh dipilih sekali.'],
                ]);
            }
            $inputByReceiptItem[$receiptItemId] = $returnItem;
        }

        if (count($inputByReceiptItem) !== $damagedItems->count()) {
            throw ValidationException::withMessages([
                'items' => ['Pilih seluruh barang rusak yang tercatat pada GR ini.'],
            ]);
        }

        foreach ($damagedItems as $index => $item) {
            $selection = $inputByReceiptItem[(int) $item->id] ?? null;
            if ($selection === null) {
                throw ValidationException::withMessages([
                    "items.{$index}.goods_receipt_item_id" => ['Baris tidak cocok dengan barang rusak pada GR.'],
                ]);
            }
            $disposition = $selection['disposition'] ?? $item->damage_disposition;
            if (! in_array($disposition, ['direct_return', 'quarantine'], true)) {
                throw ValidationException::withMessages([
                    "items.{$index}.disposition" => ['Pilih apakah barang rusak dikembalikan langsung atau masuk karantina.'],
                ]);
            }
            DB::table('goods_receipt_items')->where('id', $item->id)
                ->update(['damage_disposition' => $disposition]);
        }

        $id = DB::table('supplier_returns')->insertGetId([
            'store_id' => $storeId,
            'doc_number' => DocumentNumber::format('RET', $this->sequences->next($storeId, 'RET')),
            'supplier_id' => $supplier->id,
            'return_type' => 'incoming',
            'goods_receipt_id' => $receipt->id,
            'invoice_no' => $data['invoice_no'] ?? $receipt->invoice_no,
            'status' => 'draft',
            'requested_by' => $actor->id,
            'note' => $data['note'] ?? null,
        ]);

        foreach ($damagedItems as $item) {
            DB::table('supplier_return_items')->insert([
                'supplier_return_id' => $id,
                'goods_receipt_item_id' => $item->id,
                'source_po_item_id' => $item->po_item_id,
                'product_id' => $item->product_id,
                'batch_id' => null,
                'location_id' => $receipt->receiving_location_id,
                'shelf_position_id' => null,
                'source_bucket' => 'damaged',
                'disposition' => $inputByReceiptItem[(int) $item->id]['disposition'] ?? $item->damage_disposition,
                'qty' => $item->qty_damaged,
                'unit_cost' => $item->product_unit_cost ?? $item->unit_cost,
            ]);
        }

        $this->audit->log(
            'supplier_return.incoming_create',
            'supplier_return',
            $id,
            after: [
                'goods_receipt_id' => (int) $receipt->id,
                'return_type' => 'incoming',
                'items_count' => $damagedItems->count(),
            ],
            reason: $data['note'] ?? null,
            actorId: $actor->id,
            storeId: $storeId,
        );

        return $id;
    }

    /** @return array<string, mixed> */
    public function submit(User $actor, int $storeId, int $id): array
    {
        $this->assertCanCreate($actor, $storeId);
        DB::transaction(function () use ($actor, $storeId, $id) {
            $return = $this->lock($storeId, $id);
            if ($return->status !== 'draft') {
                throw ValidationException::withMessages(['status' => ['Hanya retur Draft yang dapat diajukan ke supplier.']]);
            }

            $items = $this->itemsForUpdate($id);
            $this->assertScopes($actor, $storeId, $items);
            if ($return->return_type === 'incoming') {
                $receipt = DB::table('goods_receipts')
                    ->where('store_id', $storeId)
                    ->where('id', $return->goods_receipt_id)
                    ->lockForUpdate()
                    ->first(['status']);
                if ($receipt === null || ! in_array($receipt->status, ['draft', 'posted'], true)) {
                    throw ValidationException::withMessages([
                        'goods_receipt_id' => ['Retur hanya dapat dikirim jika penerimaan asal masih aktif.'],
                    ]);
                }
            }
            if ($return->return_type === 'outgoing') {
                $this->inventory->quarantineSupplierReturn($storeId, $id, $items, $actor->id);
                $this->inventory->synchronizeAutomaticPurchaseRequisitions(
                    $actor,
                    $storeId,
                    array_values(array_unique(array_map('intval', array_column($items, 'product_id')))),
                );
            }
            DB::table('supplier_returns')->where('id', $id)->update([
                'status' => 'submitted',
                'submitted_at' => $this->nowUtc(),
            ]);
            $this->audit->log(
                'supplier_return.submit',
                'supplier_return',
                $id,
                before: ['status' => 'draft'],
                after: ['status' => 'submitted', 'items_count' => count($items)],
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id) ?? [];
    }

    /** @param array{decision: string, note?: string} $data
     * @return array<string, mixed>
     */
    public function supplierDecision(User $actor, int $storeId, int $id, array $data): array
    {
        $this->assertCanCreate($actor, $storeId);

        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $return = $this->lock($storeId, $id);
            if ($return->status !== 'submitted') {
                throw ValidationException::withMessages(['status' => ['Keputusan supplier hanya dapat dicatat untuk retur yang menunggu keputusan.']]);
            }

            $items = $this->itemsForUpdate($id);
            $this->assertScopes($actor, $storeId, $items);
            $accepted = $data['decision'] === 'accept';
            $lossAmount = $accepted ? null : $this->lossAmount($items);
            $nextStatus = $accepted ? 'accepted' : 'rejected';

            if ($return->return_type === 'incoming') {
                $receipt = DB::table('goods_receipts')
                    ->where('store_id', $storeId)
                    ->where('id', $return->goods_receipt_id)
                    ->lockForUpdate()
                    ->first(['status']);
                if ($receipt === null || $receipt->status !== 'posted') {
                    throw ValidationException::withMessages([
                        'goods_receipt_id' => ['Posting GR asal terlebih dahulu sebelum mencatat keputusan retur masuk.'],
                    ]);
                }

                $quarantinedItems = array_values(array_filter(
                    $items,
                    fn (array $item): bool => $item['disposition'] === 'quarantine',
                ));
                if ($accepted && $quarantinedItems !== []) {
                    $this->inventory->closeSupplierReturn(
                        $storeId,
                        $id,
                        $quarantinedItems,
                        $actor->id,
                        'supplier_return_out',
                    );
                }

                if ($accepted) {
                    foreach ($items as $item) {
                        $sourceReceiptItem = DB::table('goods_receipt_items')
                            ->where('id', $item['goods_receipt_item_id'])
                            ->first(['product_id', 'expiry_date', 'batch_code', 'shelf_position_id']);
                        if ($sourceReceiptItem === null) {
                            throw ValidationException::withMessages([
                                'items' => ['Baris GR sumber tidak ditemukan untuk penerimaan barang pengganti.'],
                            ]);
                        }

                        $replacement = $this->inventory->receive(
                            $storeId,
                            (int) $item['product_id'],
                            (string) $item['qty'],
                            (string) $item['unit_cost'],
                            $sourceReceiptItem->expiry_date,
                            $sourceReceiptItem->batch_code,
                            (int) $item['goods_receipt_item_id'],
                            'supplier_return',
                            $id,
                            $actor->id,
                            (int) $item['location_id'],
                            $sourceReceiptItem->shelf_position_id === null ? null : (int) $sourceReceiptItem->shelf_position_id,
                            movementType: 'supplier_replacement_in',
                        );
                        DB::table('supplier_return_items')->where('id', $item['id'])
                            ->update(['replacement_batch_id' => $replacement['batch_id']]);
                    }
                    $nextStatus = 'replacement_received';
                }
            } elseif ($accepted) {
                $this->inventory->closeSupplierReturn($storeId, $id, $items, $actor->id, 'supplier_return_out');
            }

            DB::table('supplier_returns')->where('id', $id)->update([
                'status' => $nextStatus,
                'decided_by' => $actor->id,
                'decided_at' => $this->nowUtc(),
                'decision_note' => $data['note'] ?? null,
                'loss_amount' => $lossAmount,
            ]);
            if ($accepted) {
                $this->inventory->synchronizeAutomaticPurchaseRequisitions(
                    $actor,
                    $storeId,
                    array_values(array_unique(array_map('intval', array_column($items, 'product_id')))),
                );
            }
            $this->audit->log(
                $accepted ? 'supplier_return.accept' : 'supplier_return.reject',
                'supplier_return',
                $id,
                before: ['status' => 'submitted'],
                after: [
                    'status' => $nextStatus,
                    'loss_amount' => $lossAmount,
                ],
                reason: $data['note'] ?? null,
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id) ?? [];
    }

    /**
     * @param  list<array<string, mixed>>  $receiptItems
     * @return array<string, mixed>
     */
    public function receiveReplacement(User $actor, int $storeId, int $id, array $receiptItems): array
    {
        $this->assertCanCreate($actor, $storeId);

        $receipts = DB::transaction(function () use ($actor, $storeId, $id, $receiptItems) {
            $return = $this->lock($storeId, $id);
            if ($return->return_type !== 'outgoing' || $return->status !== 'accepted') {
                throw ValidationException::withMessages(['status' => ['Penerimaan barang pengganti hanya untuk retur yang diterima supplier.']]);
            }

            $returnItems = $this->itemsForUpdate($id);
            $this->assertScopes($actor, $storeId, $returnItems);
            $byId = collect($returnItems)->keyBy('id');
            $inputById = [];
            $errors = [];
            foreach ($receiptItems as $index => $receiptItem) {
                $itemId = (int) $receiptItem['return_item_id'];
                if (! $byId->has($itemId) || isset($inputById[$itemId])) {
                    $errors["items.{$index}.return_item_id"] = ['Baris retur tidak valid atau muncul lebih dari sekali.'];

                    continue;
                }
                $inputById[$itemId] = $receiptItem;
            }
            if (count($inputById) !== count($returnItems)) {
                $errors['items'] = ['Seluruh baris retur harus diterima dalam satu penerimaan barang pengganti.'];
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $groups = [];
            usort($returnItems, fn ($a, $b) => [$a['source_po_item_id'] ?? 0, $a['product_id'], $a['id']] <=> [$b['source_po_item_id'] ?? 0, $b['product_id'], $b['id']]);
            foreach ($returnItems as $item) {
                $receiptItem = $inputById[$item['id']];
                if ($item['source_po_item_id'] === null) {
                    throw ValidationException::withMessages([
                        "items.{$item['id']}.return_item_id" => ['Stok retur tidak memiliki referensi PO asal. Penerimaan pengganti harus terkait dengan PO asal.'],
                    ]);
                }

                $poItem = DB::table('purchase_order_items as poi')
                    ->join('purchase_orders as po', 'po.id', '=', 'poi.po_id')
                    ->where('poi.id', $item['source_po_item_id'])
                    ->where('po.store_id', $storeId)
                    ->where('po.supplier_id', $return->supplier_id)
                    ->first(['poi.id', 'poi.po_id', 'poi.product_id', 'poi.qty_ordered']);
                if ($poItem === null || (int) $poItem->product_id !== (int) $item['product_id']) {
                    throw ValidationException::withMessages([
                        "items.{$item['id']}.return_item_id" => ['Referensi PO asal produk tidak valid atau supplier berbeda.'],
                    ]);
                }

                $product = DB::table('products')->where('store_id', $storeId)->where('id', $item['product_id'])
                    ->first(['status', 'track_expiry']);
                if ($product === null || $product->status === 'inactive') {
                    throw ValidationException::withMessages([
                        "items.{$item['id']}.return_item_id" => ['Produk tidak ditemukan atau nonaktif; barang pengganti tidak dapat diterima.'],
                    ]);
                }

                $expiryDate = $receiptItem['expiry_date'] ?? null;
                if ($product->track_expiry && $expiryDate === null) {
                    throw ValidationException::withMessages([
                        "items.{$item['id']}.expiry_date" => ['Tanggal kedaluwarsa wajib diisi untuk produk ini.'],
                    ]);
                }
                if ($expiryDate !== null && $expiryDate < now('Asia/Jakarta')->toDateString()) {
                    throw ValidationException::withMessages([
                        "items.{$item['id']}.expiry_date" => ['Barang pengganti sudah kedaluwarsa.'],
                    ]);
                }

                $locationId = (int) $item['location_id'];
                $location = DB::table('locations')->where('store_id', $storeId)->where('id', $locationId)
                    ->where('is_active', 1)->first(['id']);
                if ($location === null) {
                    throw ValidationException::withMessages(['items' => ['Lokasi penerimaan tidak ditemukan atau nonaktif.']]);
                }
                StockAuthorityPolicy::assertScope($actor, $storeId, 'receipt', $locationId);

                $positionId = null;

                $groups[$poItem->po_id]['po_id'] = (int) $poItem->po_id;
                $groups[$poItem->po_id]['location_id'] ??= $locationId;
                $groups[$poItem->po_id]['items'][] = [
                    'return_item_id' => (int) $item['id'],
                    'po_item_id' => (int) $poItem->id,
                    'product_id' => (int) $item['product_id'],
                    'qty' => (string) $item['qty'],
                    'unit_cost' => (string) ($item['unit_cost'] ?? '0.0000'),
                    'expiry_date' => $expiryDate,
                    'batch_code' => $receiptItem['batch_code'] ?? null,
                    'shelf_position_id' => $positionId,
                ];
            }

            $created = [];
            foreach ($groups as $group) {
                $period = now('Asia/Jakarta')->format('Ym');
                $grId = DB::table('goods_receipts')->insertGetId([
                    'store_id' => $storeId,
                    'doc_number' => DocumentNumber::format('GR', $this->sequences->next($storeId, 'GR', $period), $period),
                    'po_id' => $group['po_id'],
                    'supplier_return_id' => $id,
                    'supplier_id' => $return->supplier_id,
                    'receiving_location_id' => $group['location_id'],
                    'status' => 'draft',
                    'document_status' => 'pending',
                    'received_by' => $actor->id,
                    'note' => "Pengganti retur {$return->doc_number}",
                ]);
                foreach ($group['items'] as $line) {
                    $grItemId = DB::table('goods_receipt_items')->insertGetId([
                        'gr_id' => $grId,
                        'po_item_id' => $line['po_item_id'],
                        'supplier_return_item_id' => $line['return_item_id'],
                        'product_id' => $line['product_id'],
                        'qty_ordered' => $line['qty'],
                        'qty_received' => $line['qty'],
                        'qty_damaged' => '0.000',
                        'qty_short' => '0.000',
                        'unit_cost' => $line['unit_cost'],
                        'expiry_date' => $line['expiry_date'],
                        'batch_code' => $line['batch_code'],
                        'shelf_position_id' => $line['shelf_position_id'],
                    ]);
                    DB::table('supplier_return_items')->where('id', $line['return_item_id'])
                        ->update(['replacement_goods_receipt_item_id' => $grItemId]);
                }

                $created[] = [
                    'id' => (int) $grId,
                    'doc_number' => DB::table('goods_receipts')->where('id', $grId)->value('doc_number'),
                    'po_id' => (int) $group['po_id'],
                ];
            }

            $this->audit->log(
                'supplier_return.replacement_gr_created',
                'supplier_return',
                $id,
                before: ['status' => 'accepted'],
                after: ['status' => 'accepted', 'goods_receipts' => $created],
                actorId: $actor->id,
                storeId: $storeId,
            );

            return $created;
        });

        return ($this->load($storeId, $id) ?? []) + ['replacement_goods_receipts' => $receipts];
    }

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function writeOff(User $actor, int $storeId, int $id, array $data): array
    {
        abort_unless($this->permissions->allows($actor, 'inventory.adjust.approve', $storeId), 403, 'Anda tidak berwenang menyetujui write-off.');
        $return = DB::table('supplier_returns')->where('store_id', $storeId)->where('id', $id)->first();
        abort_if($return === null, 404, 'Retur supplier tidak ditemukan.');
        if ($return->status !== 'rejected') {
            throw ValidationException::withMessages(['status' => ['Write-off hanya dapat disetujui setelah supplier menolak retur.']]);
        }

        $this->reauth->assertProvided($data, $actor, 'Autentikasi ulang Owner diperlukan untuk menyetujui write-off retur.');
        $approver = $this->reauth->confirm(
            (string) $data['approver_username'],
            (string) ($data['approver_password'] ?? ''),
            'inventory.adjust.approve',
            $actor,
            $data['approver_key'] ?? null,
        );

        DB::transaction(function () use ($actor, $approver, $storeId, $id, $data) {
            $return = $this->lock($storeId, $id);
            if ($return->status !== 'rejected') {
                throw ValidationException::withMessages(['status' => ['Write-off hanya dapat disetujui setelah supplier menolak retur.']]);
            }

            $items = $this->itemsForUpdate($id);
            $this->inventory->closeSupplierReturn($storeId, $id, $items, $approver->id, 'write_off');
            $this->inventory->synchronizeAutomaticPurchaseRequisitions(
                $actor,
                $storeId,
                array_values(array_unique(array_map('intval', array_column($items, 'product_id')))),
            );
            DB::table('supplier_returns')->where('id', $id)->update([
                'status' => 'written_off',
                'approved_by' => $approver->id,
                'approved_at' => $this->nowUtc(),
                'reauth_at' => $this->nowUtc(),
            ]);
            $this->audit->log(
                'supplier_return.write_off',
                'supplier_return',
                $id,
                before: ['status' => 'rejected'],
                after: [
                    'status' => 'written_off',
                    'loss_amount' => $return->loss_amount,
                    'approved_by' => $approver->id,
                ],
                reason: $data['note'] ?? $return->decision_note,
                selfApproval: (int) $return->requested_by === $approver->id,
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id) ?? [];
    }

    /** @return array<string, mixed> */
    public function cancel(User $actor, int $storeId, int $id, ?string $reason): array
    {
        $this->assertCanCreate($actor, $storeId);
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $return = $this->lock($storeId, $id);
            if ($return->status !== 'draft') {
                throw ValidationException::withMessages(['status' => ['Hanya retur Draft yang dapat dibatalkan.']]);
            }

            DB::table('supplier_returns')->where('id', $id)->update(['status' => 'cancelled']);
            $this->audit->log(
                'supplier_return.cancel',
                'supplier_return',
                $id,
                before: ['status' => 'draft'],
                after: ['status' => 'cancelled'],
                reason: $reason,
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id) ?? [];
    }

    private function assertCanCreate(User $user, int $storeId): void
    {
        abort_unless($this->permissions->allows($user, 'supplier_return.create', $storeId), 403, 'Anda tidak berwenang mengelola retur supplier.');
    }

    private function assertCanView(User $user, int $storeId): void
    {
        abort_unless(
            $this->permissions->allows($user, 'supplier_return.create', $storeId)
                || $this->permissions->allows($user, 'inventory.adjust.approve', $storeId),
            403,
            'Anda tidak berwenang melihat retur supplier.',
        );
    }

    /** @param list<array<string, mixed>> $items */
    private function assertScopes(User $actor, int $storeId, array $items): void
    {
        foreach ($items as $item) {
            $locationId = (int) $item['location_id'];
            $isActive = DB::table('locations')
                ->where('store_id', $storeId)
                ->where('id', $locationId)
                ->where('is_active', 1)
                ->exists();
            if (! $isActive) {
                throw ValidationException::withMessages([
                    'items' => ['Lokasi retur tidak ditemukan atau nonaktif pada toko ini.'],
                ]);
            }

            StockAuthorityPolicy::assertScope($actor, $storeId, 'supplier_return', $locationId);
        }
    }

    /** @return list<array<string, mixed>> */
    private function itemsForUpdate(int $id): array
    {
        return DB::table('supplier_return_items')->where('supplier_return_id', $id)->orderBy('id')->lockForUpdate()
            ->get()->map(fn ($item) => (array) $item)->all();
    }

    private function lock(int $storeId, int $id): object
    {
        $return = DB::table('supplier_returns')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
        abort_if($return === null, 404, 'Retur supplier tidak ditemukan.');

        return $return;
    }

    /** @return array<string, mixed>|null */
    private function load(int $storeId, int $id): ?array
    {
        $header = $this->headerQuery($storeId)->where('sr.id', $id)->first();
        if ($header === null) {
            return null;
        }

        $items = DB::table('supplier_return_items as i')
            ->join('products as p', 'p.id', '=', 'i.product_id')
            ->join('locations as l', 'l.id', '=', 'i.location_id')
            ->leftJoin('product_batches as b', 'b.id', '=', 'i.batch_id')
            ->leftJoin('product_batches as rb', 'rb.id', '=', 'i.replacement_batch_id')
            ->leftJoin('goods_receipt_items as source_gri', 'source_gri.id', '=', 'i.goods_receipt_item_id')
            ->leftJoin('purchase_order_items as poi', 'poi.id', '=', 'i.source_po_item_id')
            ->leftJoin('purchase_orders as po', 'po.id', '=', 'poi.po_id')
            ->leftJoin('shelf_positions as sp', 'sp.id', '=', 'i.shelf_position_id')
            ->leftJoin('shelves as s', 's.id', '=', 'sp.shelf_id')
            ->where('i.supplier_return_id', $id)->orderBy('i.id')
            ->get([
                'i.id', 'i.product_id', 'p.sku', 'p.name as product_name', 'p.unit_name', 'i.batch_id',
                'b.batch_code', 'b.expiry_date', 'i.location_id', 'l.name as location_name', 'i.shelf_position_id',
                's.code as shelf_code', 'sp.level', 'sp.slot', 'i.source_bucket', 'i.qty', 'i.unit_cost',
                'i.goods_receipt_item_id', 'i.source_po_item_id', 'i.disposition', 'po.doc_number as source_po_doc_number',
                'source_gri.qty_received as source_qty_received', 'source_gri.qty_damaged as source_qty_damaged',
                'source_gri.note as source_note',
                'i.replacement_batch_id', 'rb.batch_code as replacement_batch_code', 'rb.expiry_date as replacement_expiry_date',
            ])
            ->map(fn ($item) => [
                'id' => (int) $item->id,
                'product_id' => (int) $item->product_id,
                'sku' => $item->sku,
                'product_name' => $item->product_name,
                'unit_name' => $item->unit_name,
                'batch_id' => $item->batch_id === null ? null : (int) $item->batch_id,
                'batch_code' => $item->batch_code,
                'expiry_date' => $item->expiry_date,
                'location_id' => (int) $item->location_id,
                'location_name' => $item->location_name,
                'shelf_position_id' => $item->shelf_position_id === null ? null : (int) $item->shelf_position_id,
                'shelf_position' => $item->shelf_code === null ? null : "{$item->shelf_code} / L{$item->level}-S{$item->slot}",
                'source_bucket' => $item->source_bucket,
                'disposition' => $item->disposition,
                'goods_receipt_item_id' => $item->goods_receipt_item_id === null ? null : (int) $item->goods_receipt_item_id,
                'source_po_item_id' => $item->source_po_item_id === null ? null : (int) $item->source_po_item_id,
                'source_po_doc_number' => $item->source_po_doc_number,
                'qty_received_safe' => $item->source_qty_received,
                'qty_damaged_at_receipt' => $item->source_qty_damaged,
                'receipt_note' => $item->source_note,
                'qty' => $item->qty,
                'unit_cost' => $item->unit_cost,
                'replacement_batch_id' => $item->replacement_batch_id === null ? null : (int) $item->replacement_batch_id,
                'replacement_batch_code' => $item->replacement_batch_code,
                'replacement_expiry_date' => $item->replacement_expiry_date,
            ])->all();

        return $this->presentHeader($header) + ['items' => $items];
    }

    private function headerQuery(int $storeId)
    {
        return DB::table('supplier_returns as sr')
            ->join('suppliers as s', 's.id', '=', 'sr.supplier_id')
            ->join('users as requester', 'requester.id', '=', 'sr.requested_by')
            ->leftJoin('users as decider', 'decider.id', '=', 'sr.decided_by')
            ->leftJoin('users as approver', 'approver.id', '=', 'sr.approved_by')
            ->leftJoin('goods_receipts as gr', 'gr.id', '=', 'sr.goods_receipt_id')
            ->where('sr.store_id', $storeId)
            ->select(
                'sr.*',
                's.name as supplier_name',
                'gr.doc_number as goods_receipt_doc_number',
                'requester.name as requested_by_name',
                'decider.name as decided_by_name',
                'approver.name as approved_by_name',
            );
    }

    /** @return array<string, mixed> */
    private function presentHeader(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'supplier_id' => (int) $row->supplier_id,
            'supplier_name' => $row->supplier_name,
            'return_type' => $row->return_type,
            'goods_receipt_id' => $row->goods_receipt_id === null ? null : (int) $row->goods_receipt_id,
            'goods_receipt_doc_number' => $row->goods_receipt_doc_number,
            'invoice_no' => $row->invoice_no,
            'status' => $row->status,
            'requested_by' => (int) $row->requested_by,
            'requested_by_name' => $row->requested_by_name,
            'submitted_at' => $row->submitted_at,
            'decided_by' => $row->decided_by === null ? null : (int) $row->decided_by,
            'decided_by_name' => $row->decided_by_name,
            'decided_at' => $row->decided_at,
            'decision_note' => $row->decision_note,
            'loss_amount' => $row->loss_amount,
            'approved_by' => $row->approved_by === null ? null : (int) $row->approved_by,
            'approved_by_name' => $row->approved_by_name,
            'approved_at' => $row->approved_at,
            'reauth_at' => $row->reauth_at,
            'note' => $row->note,
            'created_at' => $row->created_at,
        ];
    }

    /** @param list<array<string, mixed>> $items */
    private function lossAmount(array $items): string
    {
        $scaledTotal = 0;
        foreach ($items as $item) {
            if ($item['unit_cost'] !== null) {
                $scaledTotal += Decimal::qty((string) $item['qty']) * Decimal::toUnits((string) $item['unit_cost'], 4);
            }
        }

        return Decimal::moneyString(intdiv($scaledTotal + 50_000, 100_000));
    }

    private function positionBelongsToLocation(int $positionId, int $locationId): bool
    {
        return DB::table('shelf_positions as sp')
            ->join('shelves as s', 's.id', '=', 'sp.shelf_id')
            ->where('sp.id', $positionId)
            ->where('s.location_id', $locationId)
            ->exists();
    }

    private function nowUtc(): string
    {
        return now('UTC')->format('Y-m-d H:i:s.v');
    }
}
