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

            $items = array_values($data['items']);
            $productIds = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
            $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
                ->orderBy('id')->lockForUpdate()->get(['id', 'track_expiry', 'avg_cost'])->keyBy('id');
            $locations = DB::table('locations')
                ->where('store_id', $storeId)
                ->whereIn('id', collect($items)->pluck('location_id')->map(fn ($id) => (int) $id)->unique()->all())
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
                $normalized[] = [
                    'product_id' => $productId,
                    'batch_id' => $batchId,
                    'location_id' => $locationId,
                    'shelf_position_id' => $positionId,
                    'source_bucket' => $sourceBucket,
                    'qty' => Decimal::qtyString(Decimal::qty((string) $item['qty'])),
                    'unit_cost' => $product->avg_cost,
                ];
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $id = DB::table('supplier_returns')->insertGetId([
                'store_id' => $storeId,
                'doc_number' => DocumentNumber::format('RET', $this->sequences->next($storeId, 'RET')),
                'supplier_id' => $supplier->id,
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
            $this->inventory->quarantineSupplierReturn($storeId, $id, $items, $actor->id);
            $this->inventory->synchronizeAutomaticPurchaseRequisitions(
                $actor,
                $storeId,
                array_values(array_unique(array_map('intval', array_column($items, 'product_id')))),
            );
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
            if ($accepted) {
                $this->inventory->closeSupplierReturn($storeId, $id, $items, $actor->id, 'supplier_return_out');
                $this->inventory->synchronizeAutomaticPurchaseRequisitions(
                    $actor,
                    $storeId,
                    array_values(array_unique(array_map('intval', array_column($items, 'product_id')))),
                );
            }

            DB::table('supplier_returns')->where('id', $id)->update([
                'status' => $accepted ? 'accepted' : 'rejected',
                'decided_by' => $actor->id,
                'decided_at' => $this->nowUtc(),
                'decision_note' => $data['note'] ?? null,
                'loss_amount' => $lossAmount,
            ]);
            $this->audit->log(
                $accepted ? 'supplier_return.accept' : 'supplier_return.reject',
                'supplier_return',
                $id,
                before: ['status' => 'submitted'],
                after: [
                    'status' => $accepted ? 'accepted' : 'rejected',
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

        DB::transaction(function () use ($actor, $storeId, $id, $receiptItems) {
            $return = $this->lock($storeId, $id);
            if ($return->status !== 'accepted') {
                throw ValidationException::withMessages(['status' => ['Penerimaan barang pengganti hanya untuk retur yang diterima supplier.']]);
            }

            $returnItems = $this->itemsForUpdate($id);
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

            usort($returnItems, fn ($a, $b) => [$a['product_id'], $a['id']] <=> [$b['product_id'], $b['id']]);
            foreach ($returnItems as $item) {
                $receiptItem = $inputById[$item['id']];
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

                $location = DB::table('locations')->where('store_id', $storeId)->where('id', $item['location_id'])
                    ->where('is_active', 1)->first(['id']);
                if ($location === null) {
                    throw ValidationException::withMessages(['items' => ['Lokasi penerimaan tidak ditemukan atau nonaktif.']]);
                }

                StockAuthorityPolicy::assertScope($actor, $storeId, 'supplier_return', (int) $item['location_id']);
                $positionId = isset($receiptItem['shelf_position_id'])
                    ? (int) $receiptItem['shelf_position_id']
                    : ($item['shelf_position_id'] === null ? null : (int) $item['shelf_position_id']);
                if ($positionId !== null && ! $this->positionBelongsToLocation($positionId, (int) $item['location_id'])) {
                    throw ValidationException::withMessages([
                        "items.{$item['id']}.shelf_position_id" => ['Posisi tidak valid untuk lokasi penerimaan.'],
                    ]);
                }

                $received = $this->inventory->receive(
                    storeId: $storeId,
                    productId: (int) $item['product_id'],
                    qty: (string) $item['qty'],
                    unitCost: (string) ($item['unit_cost'] ?? '0.0000'),
                    expiryDate: $expiryDate,
                    batchCode: $receiptItem['batch_code'] ?? null,
                    goodsReceiptItemId: null,
                    refType: 'supplier_return',
                    refId: $id,
                    actorId: $actor->id,
                    locationId: (int) $item['location_id'],
                    positionId: $positionId,
                    movementType: 'supplier_replacement_in',
                );
                DB::table('supplier_return_items')->where('id', $item['id'])
                    ->update(['replacement_batch_id' => $received['batch_id']]);
            }

            $this->inventory->synchronizeAutomaticPurchaseRequisitions(
                $actor,
                $storeId,
                array_values(array_unique(array_map('intval', array_column($returnItems, 'product_id')))),
            );

            DB::table('supplier_returns')->where('id', $id)->update(['status' => 'replacement_received']);
            $this->audit->log(
                'supplier_return.replacement_received',
                'supplier_return',
                $id,
                before: ['status' => 'accepted'],
                after: ['status' => 'replacement_received', 'items_count' => count($returnItems)],
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id) ?? [];
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
            ->leftJoin('shelf_positions as sp', 'sp.id', '=', 'i.shelf_position_id')
            ->leftJoin('shelves as s', 's.id', '=', 'sp.shelf_id')
            ->where('i.supplier_return_id', $id)->orderBy('i.id')
            ->get([
                'i.id', 'i.product_id', 'p.sku', 'p.name as product_name', 'p.unit_name', 'i.batch_id',
                'b.batch_code', 'b.expiry_date', 'i.location_id', 'l.name as location_name', 'i.shelf_position_id',
                's.code as shelf_code', 'sp.level', 'sp.slot', 'i.source_bucket', 'i.qty', 'i.unit_cost',
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
            ->where('sr.store_id', $storeId)
            ->select(
                'sr.*',
                's.name as supplier_name',
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
