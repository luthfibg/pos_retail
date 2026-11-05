<?php

namespace App\Services;

use App\Models\User;
use App\Support\Ean13;
use App\Support\StockStatus;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Master produk. Aturan utama:
 *  - satu produk = satu barcode (pcs); SKU dan barcode TIDAK dapat diubah (barcode tidak boleh dipakai ulang)
 *  - Kasir hanya dapat membuat produk berstatus pending_price tanpa harga; barcode/SKU dibuat otomatis bila kosong
 *  - harga jual dan Harga Modal hanya diubah oleh pemegang price.change
 *    (harga jual tercatat di price_history; semua perubahan tercatat di audit log)
 *  - produk aktif wajib berharga; produk dengan stok tidak boleh dinonaktifkan
 */
class ProductService
{
    private const PLAIN_FIELDS = ['name', 'category_id', 'unit_name', 'unit_cost', 'min_stock', 'critical_stock', 'restock_quantity'];

    public function __construct(
        private AuditLogger $audit,
        private NumberSequence $sequences,
        private PurchaseRequisitionService $requisitions,
    ) {}

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $query = $this->baseQuery($storeId);

        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where(function ($q) use ($term) {
                $q->where('products.name', 'like', "%{$term}%")
                    ->orWhere('products.sku', 'like', "%{$term}%")
                    ->orWhere('products.barcode', 'like', "{$term}%");
            });
        }

        if (! empty($filters['category_id'])) {
            $query->where('products.category_id', (int) $filters['category_id']);
        }

        if (! empty($filters['status'])) {
            $query->where('products.status', $filters['status']);
        }

        $products = $query->orderBy('products.name')->paginate($perPage);
        $supplierMap = $this->suppliersByProduct($products->getCollection()->pluck('id')->map(fn ($id) => (int) $id)->all());

        return $products->through(fn ($row) => $this->present($row, $supplierMap[(int) $row->id] ?? []));
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId, int $id): ?array
    {
        $row = $this->baseQuery($storeId)->where('products.id', $id)->first();

        if ($row === null) {
            return null;
        }

        $supplierMap = $this->suppliersByProduct([(int) $row->id]);

        return $this->present($row, $supplierMap[(int) $row->id] ?? []);
    }

    /** @return array<string, mixed>|null */
    public function findByBarcode(int $storeId, string $barcode): ?array
    {
        $row = $this->baseQuery($storeId)->where('products.barcode', $barcode)->first();

        if ($row === null) {
            return null;
        }

        $supplierMap = $this->suppliersByProduct([(int) $row->id]);

        return $this->present($row, $supplierMap[(int) $row->id] ?? []);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data, bool $canSetPrice, bool $canActivate): array
    {
        $price = $data['sell_price'] ?? null;

        abort_if($price !== null && ! $canSetPrice, 403, 'Anda tidak berwenang menetapkan harga jual.');

        $min = $data['min_stock'] ?? 0;
        $critical = $data['critical_stock'] ?? 0;
        $this->assertThresholds((float) $min, (float) $critical);

        try {
            $id = DB::transaction(function () use ($actor, $storeId, $data, $price, $min, $critical, $canActivate) {
                $supplierIds = $this->validatedSupplierIds($storeId, $data['supplier_ids']);
                $sku = $data['sku'] ?? $this->generateSku($storeId);
                $barcode = $data['barcode'] ?? $this->generateBarcode($storeId);
                $status = ($price !== null && $canActivate) ? 'active' : 'pending_price';

                $id = DB::table('products')->insertGetId([
                    'store_id' => $storeId,
                    'sku' => $sku,
                    'barcode' => $barcode,
                    'name' => $data['name'],
                    'category_id' => $data['category_id'] ?? null,
                    'unit_name' => $data['unit_name'] ?? 'pcs',
                    'track_expiry' => ! empty($data['track_expiry']) ? 1 : 0,
                    'sell_price' => $price,
                    'unit_cost' => $data['unit_cost'],
                    'min_stock' => $min,
                    'critical_stock' => $critical,
                    'restock_quantity' => $data['restock_quantity'] ?? '0.000',
                    'status' => $status,
                    'created_by' => $actor->id,
                ]);
                $this->replaceSuppliers($id, $supplierIds);

                if ($price !== null) {
                    DB::table('price_history')->insert([
                        'product_id' => $id,
                        'old_price' => null,
                        'new_price' => $price,
                        'changed_by' => $actor->id,
                    ]);
                }

                $this->audit->log(
                    'product.create',
                    'product',
                    $id,
                    after: [
                        'sku' => $sku,
                        'barcode' => $barcode,
                        'name' => $data['name'],
                        'status' => $status,
                        'sell_price' => $price,
                        'unit_cost' => $data['unit_cost'],
                        'restock_quantity' => $data['restock_quantity'] ?? '0.000',
                        'supplier_ids' => $supplierIds,
                    ],
                    storeId: $storeId,
                    actorId: $actor->id,
                );

                $this->requisitions->synchronizeAutomatic($actor, $storeId, [$id]);

                return $id;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([
                'barcode' => ['SKU atau barcode sudah dipakai produk lain.'],
            ]);
        }

        return $this->find($storeId, $id);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data, bool $canSetPrice, bool $canChangeStatus): array
    {
        abort_if(array_key_exists('sell_price', $data) && ! $canSetPrice, 403, 'Anda tidak berwenang mengubah harga jual.');
        abort_if(array_key_exists('unit_cost', $data) && ! $canSetPrice, 403, 'Anda tidak berwenang mengubah Harga Modal.');
        abort_if(array_key_exists('status', $data) && ! $canChangeStatus, 403, 'Anda tidak berwenang mengubah status produk.');

        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $current = DB::table('products')
                ->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();

            abort_if($current === null, 404, 'Produk tidak ditemukan.');
            $currentSupplierIds = DB::table('product_suppliers')
                ->where('product_id', $id)
                ->orderBy('supplier_id')
                ->pluck('supplier_id')
                ->map(fn ($supplierId) => (int) $supplierId)
                ->all();
            if ($currentSupplierIds === [] && ! array_key_exists('supplier_ids', $data)) {
                throw ValidationException::withMessages([
                    'supplier_ids' => ['Pilih minimal satu supplier untuk produk ini.'],
                ]);
            }
            $supplierIdsChanged = false;
            $supplierIds = $currentSupplierIds;
            if (array_key_exists('supplier_ids', $data)) {
                $supplierIds = $this->validatedSupplierIds($storeId, $data['supplier_ids'], $currentSupplierIds);
                $supplierIdsChanged = $supplierIds !== $currentSupplierIds;
            }

            // 1. kolom biasa
            $changes = [];
            foreach (self::PLAIN_FIELDS as $field) {
                if (array_key_exists($field, $data) && $this->differs($current->{$field}, $data[$field])) {
                    $changes[$field] = $data[$field];
                }
            }
            if (array_key_exists('track_expiry', $data) && $this->differs($current->track_expiry, $data['track_expiry'] ? 1 : 0)) {
                $changes['track_expiry'] = $data['track_expiry'] ? 1 : 0;
            }

            $this->assertThresholds(
                (float) ($changes['min_stock'] ?? $current->min_stock),
                (float) ($changes['critical_stock'] ?? $current->critical_stock),
            );

            // 2. harga
            $priceChanged = array_key_exists('sell_price', $data) && $this->differs($current->sell_price, $data['sell_price']);
            $newPrice = $priceChanged ? $data['sell_price'] : $current->sell_price;

            // 3. status
            $statusChanged = array_key_exists('status', $data) && $data['status'] !== $current->status;

            if ($statusChanged) {
                if ($data['status'] === 'active' && $newPrice === null) {
                    throw ValidationException::withMessages([
                        'status' => ['Harga jual harus diisi sebelum produk diaktifkan.'],
                    ]);
                }

                if ($data['status'] === 'inactive' && $this->totalStock($id) > 0) {
                    throw ValidationException::withMessages([
                        'status' => ['Produk masih memiliki stok. Selesaikan lewat adjustment/write-off atau retur sebelum menonaktifkan.'],
                    ]);
                }
            }

            // 4. tulis
            $columns = $changes;
            if ($priceChanged) {
                $columns['sell_price'] = $newPrice;
            }
            if ($statusChanged) {
                $columns['status'] = $data['status'];
            }

            if ($columns === [] && ! $supplierIdsChanged) {
                return;
            }

            if ($columns !== []) {
                DB::table('products')->where('id', $id)->update($columns);
            }

            if ($supplierIdsChanged) {
                $this->replaceSuppliers($id, $supplierIds);
                $this->audit->log(
                    'product.suppliers_update',
                    'product',
                    $id,
                    before: ['supplier_ids' => $currentSupplierIds],
                    after: ['supplier_ids' => $supplierIds],
                    storeId: $storeId,
                    actorId: $actor->id,
                );
            }

            if ($changes !== []) {
                $before = [];
                foreach (array_keys($changes) as $field) {
                    $before[$field] = $current->{$field};
                }
                $this->audit->log('product.update', 'product', $id, before: $before, after: $changes, storeId: $storeId, actorId: $actor->id);
            }

            if ($priceChanged) {
                DB::table('price_history')->insert([
                    'product_id' => $id,
                    'old_price' => $current->sell_price,
                    'new_price' => $newPrice,
                    'changed_by' => $actor->id,
                ]);
                $this->audit->log(
                    'product.price_change',
                    'product',
                    $id,
                    before: ['sell_price' => $current->sell_price],
                    after: ['sell_price' => $newPrice],
                    storeId: $storeId,
                    actorId: $actor->id,
                );
            }

            if ($statusChanged) {
                $this->audit->log(
                    'product.status_change',
                    'product',
                    $id,
                    before: ['status' => $current->status],
                    after: ['status' => $data['status']],
                    reason: $data['reason'] ?? null,
                    storeId: $storeId,
                    actorId: $actor->id,
                );
            }

            if (array_key_exists('restock_quantity', $changes) || array_key_exists('unit_cost', $changes) || $statusChanged || $supplierIdsChanged) {
                $this->requisitions->synchronizeAutomatic($actor, $storeId, [$id]);
            }
        });

        return $this->find($storeId, $id);
    }

    private function baseQuery(int $storeId)
    {
        return DB::table('products')
            ->leftJoin('categories as c', 'c.id', '=', 'products.category_id')
            ->where('products.store_id', $storeId)
            ->selectRaw(
                'products.*, c.name as category_name, '.
                '(select coalesce(sum(b.qty_sellable), 0) from inventory_balances b where b.product_id = products.id) as stock_sellable'
            );
    }

    /** @return array<string, mixed> */
    private function present(object $row, array $suppliers): array
    {
        $stock = (string) $row->stock_sellable;

        return [
            'id' => (int) $row->id,
            'sku' => $row->sku,
            'barcode' => $row->barcode,
            'name' => $row->name,
            'category_id' => $row->category_id === null ? null : (int) $row->category_id,
            'category_name' => $row->category_name,
            'unit_name' => $row->unit_name,
            'track_expiry' => (bool) $row->track_expiry,
            'sell_price' => $row->sell_price,
            'unit_cost' => $row->unit_cost,
            'suppliers' => $suppliers,
            'min_stock' => $row->min_stock,
            'critical_stock' => $row->critical_stock,
            'restock_quantity' => $row->restock_quantity,
            'status' => $row->status,
            'stock_sellable' => $stock,
            'stock_status' => StockStatus::for($stock, $row->min_stock, $row->critical_stock),
        ];
    }

    /**
     * @param  list<mixed>  $supplierIds
     * @param  list<int>  $existingSupplierIds
     * @return list<int>
     */
    private function validatedSupplierIds(int $storeId, array $supplierIds, array $existingSupplierIds = []): array
    {
        $ids = array_values(array_unique(array_map('intval', $supplierIds)));
        $suppliers = DB::table('suppliers')
            ->where('store_id', $storeId)
            ->whereIn('id', $ids)
            ->get(['id', 'is_active']);

        if ($suppliers->count() !== count($ids)) {
            throw ValidationException::withMessages([
                'supplier_ids' => ['Supplier tidak ditemukan di toko ini.'],
            ]);
        }

        foreach ($suppliers as $supplier) {
            if (! $supplier->is_active && ! in_array((int) $supplier->id, $existingSupplierIds, true)) {
                throw ValidationException::withMessages([
                    'supplier_ids' => ['Supplier baru harus berstatus aktif.'],
                ]);
            }
        }

        sort($ids);

        return $ids;
    }

    /** @param list<int> $supplierIds */
    private function replaceSuppliers(int $productId, array $supplierIds): void
    {
        DB::table('product_suppliers')->where('product_id', $productId)->delete();
        foreach ($supplierIds as $supplierId) {
            DB::table('product_suppliers')->insert([
                'product_id' => $productId,
                'supplier_id' => $supplierId,
            ]);
        }
    }

    /**
     * @param  list<int>  $productIds
     * @return array<int, list<array{id: int, code: string, name: string, is_active: bool, default_payment_terms: string}>>
     */
    private function suppliersByProduct(array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        return DB::table('product_suppliers as ps')
            ->join('suppliers as s', 's.id', '=', 'ps.supplier_id')
            ->whereIn('ps.product_id', $productIds)
            ->orderBy('s.name')
            ->get([
                'ps.product_id',
                's.id',
                's.code',
                's.name',
                's.is_active',
                's.default_payment_terms',
            ])
            ->groupBy('product_id')
            ->map(fn ($rows) => $rows->map(fn ($supplier) => [
                'id' => (int) $supplier->id,
                'code' => $supplier->code,
                'name' => $supplier->name,
                'is_active' => (bool) $supplier->is_active,
                'default_payment_terms' => $supplier->default_payment_terms,
            ])->values()->all())
            ->all();
    }

    private function totalStock(int $productId): float
    {
        return (float) DB::table('inventory_balances')
            ->where('product_id', $productId)
            ->selectRaw('coalesce(sum(qty_sellable + qty_quarantine + qty_damaged), 0) as total')
            ->value('total');
    }

    private function generateSku(int $storeId): string
    {
        do {
            $sku = sprintf('P-%06d', $this->sequences->next($storeId, 'SKU'));
        } while (DB::table('products')->where('store_id', $storeId)->where('sku', $sku)->exists());

        return $sku;
    }

    /** Barcode internal EAN-13: prefix 20 + 10 digit urutan + digit cek. */
    private function generateBarcode(int $storeId): string
    {
        do {
            $body = '20'.str_pad((string) $this->sequences->next($storeId, 'BARCODE'), 10, '0', STR_PAD_LEFT);
            $barcode = Ean13::withCheckDigit($body);
        } while (DB::table('products')->where('barcode', $barcode)->exists());

        return $barcode;
    }

    private function assertThresholds(float $min, float $critical): void
    {
        if ($critical > $min) {
            throw ValidationException::withMessages([
                'critical_stock' => ['Batas kritis tidak boleh lebih besar dari batas minimum.'],
            ]);
        }
    }

    private function differs(mixed $old, mixed $new): bool
    {
        if ($old === null || $new === null) {
            return $old !== $new;
        }

        if (is_numeric($old) && is_numeric($new)) {
            return (float) $old !== (float) $new;
        }

        return (string) $old !== (string) $new;
    }
}
