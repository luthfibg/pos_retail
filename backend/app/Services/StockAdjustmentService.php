<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use App\Support\StockAuthorityPolicy;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class StockAdjustmentService
{
    public function __construct(
        private InventoryService $inventory,
        private AuditLogger $audit,
        private NumberSequence $sequences,
        private PermissionResolver $permissions,
        private ReauthService $reauth,
    ) {}

    /** @return array{types: list<array{code: string, label: string}>, reasons: list<array{code: string, label: string, requires_notes: bool, selectable: bool}>} */
    public function directMeta(User $user, int $storeId): array
    {
        $this->assertCanUseDirectAdjustment($user, $storeId);

        return [
            'types' => [
                ['code' => 'increase', 'label' => 'Tambah'],
                ['code' => 'decrease', 'label' => 'Kurang'],
            ],
            'reasons' => [
                ['code' => 'damaged', 'label' => 'Barang rusak', 'requires_notes' => false, 'selectable' => true],
                ['code' => 'expired', 'label' => 'Kedaluwarsa', 'requires_notes' => false, 'selectable' => true],
                ['code' => 'lost', 'label' => 'Hilang', 'requires_notes' => false, 'selectable' => true],
                ['code' => 'found', 'label' => 'Barang ditemukan', 'requires_notes' => false, 'selectable' => true],
                ['code' => 'input_correction', 'label' => 'Koreksi kesalahan input', 'requires_notes' => false, 'selectable' => true],
                ['code' => 'own_use', 'label' => 'Dipakai sendiri', 'requires_notes' => false, 'selectable' => true],
                ['code' => 'sample', 'label' => 'Sampel', 'requires_notes' => false, 'selectable' => true],
                ['code' => 'other', 'label' => 'Lainnya', 'requires_notes' => true, 'selectable' => true],
                ['code' => 'opname_result', 'label' => 'Hasil stock opname', 'requires_notes' => false, 'selectable' => false],
            ],
        ];
    }

    /** @param array<string, mixed> $filters */
    public function searchDirect(User $user, int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $this->assertCanUseDirectAdjustment($user, $storeId);

        $query = $this->directHeaderQuery($storeId);
        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where(function ($builder) use ($term) {
                $builder->where('a.doc_number', 'like', "%{$term}%")
                    ->orWhere('p.name', 'like', "%{$term}%")
                    ->orWhere('p.barcode', 'like', "{$term}%");
            });
        }
        foreach (['type', 'reason_code', 'source'] as $column) {
            if (! empty($filters[$column])) {
                $query->where("a.{$column}", $filters[$column]);
            }
        }
        if (! empty($filters['date_from'])) {
            $query->whereDate('a.created_at', '>=', $filters['date_from']);
        }
        if (! empty($filters['date_to'])) {
            $query->whereDate('a.created_at', '<=', $filters['date_to']);
        }

        $direction = ($filters['sort'] ?? 'newest') === 'oldest' ? 'asc' : 'desc';

        return $query->orderBy('a.created_at', $direction)->orderBy('a.id', $direction)
            ->paginate($perPage)->through(fn ($row) => $this->presentDirect($row));
    }

    /** @return array<string, mixed>|null */
    public function findDirect(User $user, int $storeId, int $id): ?array
    {
        $this->assertCanUseDirectAdjustment($user, $storeId);
        $row = $this->directHeaderQuery($storeId)->where('a.id', $id)->first();

        return $row === null ? null : $this->presentDirect($row, true);
    }

    /**
     * The `source` parameter also supports Handoff #6's internal opname posting.
     *
     * @param  array<string, mixed>  $data
     * @return array{adjustment: array<string, mixed>, created: bool}
     */
    public function record(
        User $actor,
        int $storeId,
        array $data,
        string $source = 'manual',
        ?int $opnameSessionId = null,
    ): array {
        $this->assertCanUseDirectAdjustment($actor, $storeId);

        return DB::transaction(function () use ($actor, $storeId, $data, $source, $opnameSessionId) {
            $product = DB::table('products')->where('store_id', $storeId)
                ->where('id', (int) $data['product_id'])->lockForUpdate()->first(['id', 'status']);
            if ($product === null || $product->status !== 'active') {
                throw ValidationException::withMessages(['product_id' => ['Pilih produk aktif yang tersedia di toko ini.']]);
            }

            if ($source === 'manual' && isset($data['client_request_id'])) {
                $existing = DB::table('stock_adjustments')
                    ->where('client_request_id', $data['client_request_id'])
                    ->first(['id', 'store_id']);
                if ($existing !== null) {
                    if ((int) $existing->store_id !== $storeId) {
                        abort(409, 'Kunci permintaan adjustment sudah digunakan.');
                    }

                    return ['adjustment' => $this->findDirect($actor, $storeId, (int) $existing->id) ?? [], 'created' => false];
                }
            }

            $reasonCode = (string) $data['reason_code'];
            $meta = collect($this->directMeta($actor, $storeId)['reasons'])->keyBy('code');
            if (! $meta->has($reasonCode) || ($source === 'manual' && ! $meta->get($reasonCode)['selectable'])) {
                throw ValidationException::withMessages(['reason_code' => ['Alasan adjustment tidak dapat dipilih.']]);
            }
            if ($meta->get($reasonCode)['requires_notes'] && trim((string) ($data['notes'] ?? '')) === '') {
                throw ValidationException::withMessages(['notes' => ['Catatan wajib diisi untuk alasan ini.']]);
            }

            $legacyReason = match ($reasonCode) {
                'damaged' => 'damage',
                'expired' => 'expired',
                'lost' => 'loss',
                'opname_result' => 'opname',
                default => 'other',
            };
            $number = $this->sequences->next($storeId, 'ADJ');
            $docNumber = DocumentNumber::format('ADJ', $number);
            $id = DB::table('stock_adjustments')->insertGetId([
                'store_id' => $storeId,
                'product_id' => (int) $product->id,
                'doc_number' => $docNumber,
                'reason' => $legacyReason,
                'type' => $data['type'],
                'quantity' => (int) $data['quantity'],
                'reason_code' => $reasonCode,
                'source' => $source,
                'opname_session_id' => $opnameSessionId,
                'client_request_id' => $source === 'manual' ? ($data['client_request_id'] ?? null) : null,
                'status' => 'posted',
                'requested_by' => $actor->id,
                'note' => isset($data['notes']) ? trim((string) $data['notes']) : null,
                'created_at' => $this->nowUtc(),
                'updated_at' => $this->nowUtc(),
            ]);

            $result = $this->inventory->recordDirectAdjustment(
                $storeId,
                $id,
                (int) $product->id,
                (string) $data['type'],
                (int) $data['quantity'],
                $reasonCode,
                isset($data['expiry_date']) ? (string) $data['expiry_date'] : null,
                $actor->id,
            );
            foreach ($result['allocations'] as $allocation) {
                DB::table('stock_adjustment_items')->insert([
                    'adjustment_id' => $id,
                    'product_id' => $allocation['product_id'],
                    'batch_id' => $allocation['batch_id'],
                    'location_id' => $allocation['location_id'],
                    'shelf_position_id' => $allocation['shelf_position_id'],
                    'qty_before' => $allocation['qty_before'],
                    'qty_counted' => $allocation['qty_counted'],
                    'qty_diff' => $allocation['qty_diff'],
                    'stock_movement_id' => $allocation['stock_movement_id'],
                ]);
            }

            DB::table('stock_adjustments')->where('id', $id)->update([
                'stock_before' => $result['stock_before'],
                'stock_after' => $result['stock_after'],
                'stock_movement_id' => $result['movement_ids'][0] ?? null,
                'updated_at' => $this->nowUtc(),
            ]);
            $this->inventory->synchronizeAutomaticPurchaseRequisitions($actor, $storeId, [(int) $product->id]);
            $this->audit->log(
                'stock_adjustment.direct_create',
                'stock_adjustment',
                $id,
                after: [
                    'doc_number' => $docNumber,
                    'source' => $source,
                    'product_id' => (int) $product->id,
                    'type' => $data['type'],
                    'quantity' => (int) $data['quantity'],
                    'stock_before' => $result['stock_before'],
                    'stock_after' => $result['stock_after'],
                    'movement_ids' => $result['movement_ids'],
                ],
                reason: $data['notes'] ?? null,
                actorId: $actor->id,
                storeId: $storeId,
            );

            return ['adjustment' => $this->findDirect($actor, $storeId, $id) ?? [], 'created' => true];
        });
    }

    /** @param array<string, mixed> $filters */
    public function search(User $user, int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $this->assertCanView($user, $storeId);

        $query = $this->headerQuery($storeId)->orderByDesc('a.id');
        if (! $this->permissions->allows($user, 'inventory.adjust.approve', $storeId)) {
            $query->where('a.requested_by', $user->id);
        }
        foreach (['status', 'reason'] as $column) {
            if (! empty($filters[$column])) {
                $query->where("a.{$column}", $filters[$column]);
            }
        }
        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where('a.doc_number', 'like', "{$term}%");
        }

        return $query->paginate($perPage)->through(fn ($row) => $this->presentHeader($row));
    }

    /** @return array<string, mixed>|null */
    public function find(User $user, int $storeId, int $id): ?array
    {
        $this->assertCanView($user, $storeId);

        $header = $this->headerQuery($storeId)->where('a.id', $id)->first();
        if ($header === null || (
            ! $this->permissions->allows($user, 'inventory.adjust.approve', $storeId)
            && (int) $header->requested_by !== $user->id
        )) {
            return null;
        }

        $items = DB::table('stock_adjustment_items as i')
            ->join('products as p', 'p.id', '=', 'i.product_id')
            ->join('locations as l', 'l.id', '=', 'i.location_id')
            ->leftJoin('product_batches as b', 'b.id', '=', 'i.batch_id')
            ->leftJoin('shelf_positions as sp', 'sp.id', '=', 'i.shelf_position_id')
            ->leftJoin('shelves as s', 's.id', '=', 'sp.shelf_id')
            ->where('i.adjustment_id', $id)
            ->orderBy('i.id')
            ->get([
                'i.id', 'i.product_id', 'p.sku', 'p.name as product_name', 'i.batch_id',
                'b.batch_code', 'b.expiry_date', 'i.location_id', 'l.name as location_name',
                'i.shelf_position_id', 's.code as shelf_code', 'sp.level', 'sp.slot',
                'i.qty_before', 'i.qty_counted', 'i.qty_diff',
            ])
            ->map(fn ($item) => [
                'id' => (int) $item->id,
                'product_id' => (int) $item->product_id,
                'sku' => $item->sku,
                'product_name' => $item->product_name,
                'batch_id' => $item->batch_id === null ? null : (int) $item->batch_id,
                'batch_code' => $item->batch_code,
                'expiry_date' => $item->expiry_date,
                'location_id' => (int) $item->location_id,
                'location_name' => $item->location_name,
                'shelf_position_id' => $item->shelf_position_id === null ? null : (int) $item->shelf_position_id,
                'shelf_position' => $item->shelf_code === null ? null : "{$item->shelf_code} / L{$item->level}-S{$item->slot}",
                'qty_before' => $item->qty_before,
                'qty_counted' => $item->qty_counted,
                'qty_diff' => $item->qty_diff,
            ])->all();

        return $this->presentHeader($header) + ['items' => $items];
    }

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            $items = array_values($data['items']);
            $this->validateLocations($storeId, $items, true);
            foreach (collect($items)->pluck('location_id')->map(fn ($l) => (int) $l)->unique()->sort()->values() as $scopeLocationId) {
                StockAuthorityPolicy::assertScope($actor, $storeId, 'adjustment_request', $scopeLocationId);
            }

            $productIds = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)
                ->unique()->sort()->values()->all();
            $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
                ->orderBy('id')->lockForUpdate()->get(['id', 'track_expiry'])->keyBy('id');
            $errors = [];
            $normalized = [];
            $seenBalances = [];

            foreach ($items as $index => $item) {
                $productId = (int) $item['product_id'];
                if (! $products->has($productId)) {
                    $errors["items.{$index}.product_id"] = ['Produk tidak ditemukan pada toko ini.'];

                    continue;
                }

                if ((bool) $products->get($productId)->track_expiry && empty($item['batch_id'])) {
                    $errors["items.{$index}.batch_id"] = ['Batch wajib dipilih untuk produk yang melacak tanggal kedaluwarsa.'];

                    continue;
                }

                $batchId = isset($item['batch_id']) ? (int) $item['batch_id'] : null;
                if ($batchId !== null && ! DB::table('product_batches')
                    ->where('id', $batchId)->where('product_id', $productId)->exists()) {
                    $errors["items.{$index}.batch_id"] = ['Batch tidak ditemukan untuk produk ini.'];

                    continue;
                }

                $locationId = (int) $item['location_id'];
                $positionId = isset($item['shelf_position_id']) ? (int) $item['shelf_position_id'] : null;
                if ($positionId !== null && ! $this->positionBelongsToLocation($positionId, $locationId)) {
                    $errors["items.{$index}.shelf_position_id"] = ['Posisi tidak valid untuk lokasi tersebut.'];

                    continue;
                }

                $balanceKey = "{$productId}:{$locationId}:".($positionId ?? 0).':'.($batchId ?? 0);
                if (isset($seenBalances[$balanceKey])) {
                    $errors["items.{$index}.product_id"] = ['Setiap kombinasi produk, batch, lokasi, dan posisi hanya boleh dicatat sekali.'];

                    continue;
                }
                $seenBalances[$balanceKey] = true;

                $balance = DB::table('inventory_balances')
                    ->where('product_id', $productId)
                    ->where('location_id', $locationId)
                    ->whereRaw('position_key = ?', [$positionId ?? 0])
                    ->whereRaw('batch_key = ?', [$batchId ?? 0])
                    ->lockForUpdate()
                    ->first(['qty_sellable']);
                $before = Decimal::qty((string) ($balance->qty_sellable ?? '0'));
                $counted = Decimal::qty((string) $item['qty_counted']);
                $normalized[] = [
                    'product_id' => $productId,
                    'batch_id' => $batchId,
                    'location_id' => $locationId,
                    'shelf_position_id' => $positionId,
                    'qty_before' => Decimal::qtyString($before),
                    'qty_counted' => Decimal::qtyString($counted),
                    'qty_diff' => Decimal::qtyString($counted - $before),
                ];
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $number = $this->sequences->next($storeId, 'ADJ');
            $docNumber = DocumentNumber::format('ADJ', $number);
            $id = DB::table('stock_adjustments')->insertGetId([
                'store_id' => $storeId,
                'doc_number' => $docNumber,
                'reason' => $data['reason'],
                'status' => 'draft',
                'requested_by' => $actor->id,
                'note' => isset($data['note']) ? trim((string) $data['note']) : null,
            ]);

            foreach ($normalized as $item) {
                DB::table('stock_adjustment_items')->insert($item + ['adjustment_id' => $id]);
            }

            $this->audit->log(
                'stock_adjustment.create',
                'stock_adjustment',
                $id,
                after: ['doc_number' => $docNumber, 'reason' => $data['reason'], 'items_count' => count($normalized)],
                reason: $data['note'] ?? null,
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $id;
        });

        return $this->find($actor, $storeId, $id) ?? [];
    }

    /** @return array<string, mixed> */
    public function request(User $actor, int $storeId, int $id): array
    {
        DB::transaction(function () use ($actor, $storeId, $id) {
            $adjustment = $this->lock($storeId, $id);
            $this->assertCanManage($actor, $storeId, $adjustment);
            if ($adjustment->status !== 'draft') {
                throw ValidationException::withMessages(['status' => ['Hanya adjustment Draft yang dapat diajukan.']]);
            }

            DB::table('stock_adjustments')->where('id', $id)->update(['status' => 'requested']);
            $this->audit->log(
                'stock_adjustment.request',
                'stock_adjustment',
                $id,
                before: ['status' => 'draft'],
                after: ['status' => 'requested'],
                reason: $adjustment->note,
                storeId: $storeId,
                actorId: $actor->id,
            );
        });

        return $this->find($actor, $storeId, $id) ?? [];
    }

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function approve(User $actor, int $storeId, int $id, array $data): array
    {
        $decision = $data['decision'] ?? 'approve';
        $approve = $decision === 'approve';
        $note = isset($data['note']) ? trim((string) $data['note']) : null;
        if (! $approve && ($note === null || $note === '')) {
            throw ValidationException::withMessages(['note' => ['Alasan penolakan wajib diisi.']]);
        }

        $record = DB::table('stock_adjustments')->where('store_id', $storeId)->where('id', $id)->first();
        abort_if($record === null, 404, 'Adjustment stok tidak ditemukan.');
        if ($record->status !== 'requested') {
            throw ValidationException::withMessages(['status' => ['Hanya adjustment yang diajukan dapat disetujui atau ditolak.']]);
        }

        $needsReauth = $approve && in_array($record->reason, ['loss', 'expired'], true);
        if ($needsReauth) {
            $this->reauth->assertProvided($data, $actor, 'Autentikasi ulang pemberi persetujuan diperlukan untuk kehilangan atau barang kedaluwarsa.');
            $approver = $this->reauth->confirm(
                (string) $data['approver_username'],
                (string) ($data['approver_password'] ?? ''),
                'inventory.adjust.approve',
                $actor,
                $data['approver_key'] ?? null,
            );
        } else {
            $approver = $actor;
        }

        DB::transaction(function () use ($actor, $approver, $storeId, $id, $approve, $note, $needsReauth) {
            $adjustment = $this->lock($storeId, $id);
            if ($adjustment->status !== 'requested') {
                throw ValidationException::withMessages(['status' => ['Hanya adjustment yang diajukan dapat disetujui atau ditolak.']]);
            }

            $selfApproval = (int) $adjustment->requested_by === $approver->id;
            if (! $approve) {
                DB::table('stock_adjustments')->where('id', $id)->update(['status' => 'rejected']);
                $this->audit->log(
                    'stock_adjustment.reject',
                    'stock_adjustment',
                    $id,
                    before: ['status' => 'requested'],
                    after: ['status' => 'rejected', 'approved_by' => $approver->id],
                    reason: $note,
                    selfApproval: $selfApproval,
                    actorId: $approver->id,
                    storeId: $storeId,
                );

                return;
            }

            DB::table('stock_adjustments')->where('id', $id)->update([
                'status' => 'approved',
                'approved_by' => $approver->id,
                'approved_at' => $this->nowUtc(),
                'reauth_at' => $needsReauth ? $this->nowUtc() : null,
            ]);
            $this->audit->log(
                'stock_adjustment.approve',
                'stock_adjustment',
                $id,
                before: ['status' => 'requested'],
                after: ['status' => 'approved', 'approved_by' => $approver->id],
                reason: $note ?? $adjustment->note,
                selfApproval: $selfApproval,
                actorId: $approver->id,
                storeId: $storeId,
            );

            $items = DB::table('stock_adjustment_items')->where('adjustment_id', $id)->orderBy('id')->get()
                ->map(fn ($item) => [
                    'product_id' => (int) $item->product_id,
                    'batch_id' => $item->batch_id === null ? null : (int) $item->batch_id,
                    'location_id' => (int) $item->location_id,
                    'shelf_position_id' => $item->shelf_position_id === null ? null : (int) $item->shelf_position_id,
                    'qty_before' => $item->qty_before,
                    'qty_counted' => $item->qty_counted,
                    'qty_diff' => $item->qty_diff,
                ])->all();
            $this->validateLocations($storeId, $items, true);
            $this->inventory->adjust($storeId, $id, $adjustment->reason, $items, $approver->id);
            $this->inventory->synchronizeAutomaticPurchaseRequisitions(
                $actor,
                $storeId,
                array_values(array_unique(array_map('intval', array_column($items, 'product_id')))),
            );

            DB::table('stock_adjustments')->where('id', $id)->update(['status' => 'posted']);
            $this->audit->log(
                'stock_adjustment.post',
                'stock_adjustment',
                $id,
                before: ['status' => 'approved'],
                after: ['status' => 'posted', 'items_count' => count($items)],
                reason: $note ?? $adjustment->note,
                selfApproval: $selfApproval,
                actorId: $approver->id,
                storeId: $storeId,
            );
        });

        return $this->find($actor, $storeId, $id) ?? [];
    }

    /** @return array<string, mixed> */
    public function cancel(User $actor, int $storeId, int $id, ?string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $adjustment = $this->lock($storeId, $id);
            $this->assertCanManage($actor, $storeId, $adjustment);
            if (! in_array($adjustment->status, ['draft', 'requested'], true)) {
                throw ValidationException::withMessages(['status' => ['Hanya adjustment Draft atau yang diajukan dapat dibatalkan.']]);
            }

            DB::table('stock_adjustments')->where('id', $id)->update(['status' => 'cancelled']);
            $this->audit->log(
                'stock_adjustment.cancel',
                'stock_adjustment',
                $id,
                before: ['status' => $adjustment->status],
                after: ['status' => 'cancelled'],
                reason: $reason,
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->find($actor, $storeId, $id) ?? [];
    }

    /** @param list<array<string, mixed>> $items */
    private function validateLocations(int $storeId, array $items, bool $lock): void
    {
        $ids = collect($items)->pluck('location_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
        $query = DB::table('locations')->where('store_id', $storeId)->whereIn('id', $ids)->orderBy('id');
        if ($lock) {
            $query->lockForUpdate();
        }
        $locations = $query->get(['id', 'is_active'])->keyBy('id');
        $errors = [];
        foreach ($items as $index => $item) {
            $locationId = (int) $item['location_id'];
            $location = $locations->get($locationId);
            if ($location === null || ! (bool) $location->is_active) {
                $errors["items.{$index}.location_id"] = ['Lokasi tidak ditemukan atau nonaktif pada toko ini.'];

                continue;
            }
            if (isset($item['shelf_position_id']) && $item['shelf_position_id'] !== null
                && ! $this->positionBelongsToLocation((int) $item['shelf_position_id'], $locationId)) {
                $errors["items.{$index}.shelf_position_id"] = ['Posisi tidak valid untuk lokasi tersebut.'];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    private function positionBelongsToLocation(int $positionId, int $locationId): bool
    {
        return DB::table('shelf_positions as sp')->join('shelves as s', 's.id', '=', 'sp.shelf_id')
            ->where('sp.id', $positionId)->where('s.location_id', $locationId)->exists();
    }

    private function assertCanManage(User $actor, int $storeId, object $adjustment): void
    {
        if ((int) $adjustment->requested_by !== $actor->id
            && ! $this->permissions->allows($actor, 'inventory.adjust.approve', $storeId)) {
            abort(404, 'Adjustment stok tidak ditemukan.');
        }
    }

    private function assertCanView(User $user, int $storeId): void
    {
        abort_unless(
            $this->permissions->allows($user, 'inventory.adjust.request', $storeId)
                || $this->permissions->allows($user, 'inventory.adjust.approve', $storeId),
            403,
            'Anda tidak memiliki izin untuk melihat adjustment stok.',
        );
    }

    private function assertCanUseDirectAdjustment(User $user, int $storeId): void
    {
        abort_unless(
            array_intersect(['Admin', 'Owner', 'Kasir'], StockAuthorityPolicy::roleNames($user->id, $storeId)) !== [],
            403,
            'Adjustment hanya dapat digunakan oleh Admin, Owner, atau Kasir.',
        );
    }

    private function directHeaderQuery(int $storeId)
    {
        return DB::table('stock_adjustments as a')
            ->join('products as p', 'p.id', '=', 'a.product_id')
            ->join('users as creator', 'creator.id', '=', 'a.requested_by')
            ->leftJoin('inventory_movements as movement', 'movement.id', '=', 'a.stock_movement_id')
            ->where('a.store_id', $storeId)
            ->whereNotNull('a.reason_code')
            ->select([
                'a.id', 'a.doc_number', 'a.product_id', 'p.name as product_name', 'p.barcode',
                'p.unit_name', 'a.type', 'a.quantity', 'a.reason_code', 'a.note', 'a.stock_before',
                'a.stock_after', 'a.source', 'a.opname_session_id', 'a.stock_movement_id',
                'creator.id as created_by_id', 'creator.name as created_by_name', 'a.created_at',
            ]);
    }

    /** @return array<string, mixed> */
    private function presentDirect(object $row, bool $detail = false): array
    {
        $reasons = collect($this->directMetaReasons())->keyBy('code');
        $record = [
            'id' => (int) $row->id,
            'number' => $row->doc_number,
            'product' => [
                'id' => (int) $row->product_id,
                'name' => $row->product_name,
                'barcode' => $row->barcode,
            ],
            'type' => $row->type,
            'quantity' => (int) $row->quantity,
            'reason_code' => $row->reason_code,
            'reason_label' => $reasons->get($row->reason_code)['label'] ?? $row->reason_code,
            'notes' => $row->note,
            'stock_before' => $row->stock_before,
            'stock_after' => $row->stock_after,
            'source' => $row->source,
            'opname_session_id' => $row->opname_session_id === null ? null : (int) $row->opname_session_id,
            'stock_movement_id' => $row->stock_movement_id === null ? null : (int) $row->stock_movement_id,
            'created_by' => [
                'id' => (int) $row->created_by_id,
                'name' => $row->created_by_name,
            ],
            'created_at' => $row->created_at,
        ];

        if ($detail) {
            $record['stock_movement_ids'] = DB::table('stock_adjustment_items')
                ->where('adjustment_id', $row->id)
                ->whereNotNull('stock_movement_id')
                ->orderBy('id')
                ->pluck('stock_movement_id')
                ->map(fn ($id) => (int) $id)
                ->all();
        }

        return $record;
    }

    /** @return list<array{code: string, label: string}> */
    private function directMetaReasons(): array
    {
        return [
            ['code' => 'damaged', 'label' => 'Barang rusak'],
            ['code' => 'expired', 'label' => 'Kedaluwarsa'],
            ['code' => 'lost', 'label' => 'Hilang'],
            ['code' => 'found', 'label' => 'Barang ditemukan'],
            ['code' => 'input_correction', 'label' => 'Koreksi kesalahan input'],
            ['code' => 'own_use', 'label' => 'Dipakai sendiri'],
            ['code' => 'sample', 'label' => 'Sampel'],
            ['code' => 'other', 'label' => 'Lainnya'],
            ['code' => 'opname_result', 'label' => 'Hasil stock opname'],
        ];
    }

    private function lock(int $storeId, int $id): object
    {
        $adjustment = DB::table('stock_adjustments')->where('store_id', $storeId)->where('id', $id)
            ->lockForUpdate()->first();
        abort_if($adjustment === null, 404, 'Adjustment stok tidak ditemukan.');

        return $adjustment;
    }

    private function headerQuery(int $storeId)
    {
        return DB::table('stock_adjustments as a')
            ->join('users as r', 'r.id', '=', 'a.requested_by')
            ->leftJoin('users as p', 'p.id', '=', 'a.approved_by')
            ->where('a.store_id', $storeId)
            ->select([
                'a.id', 'a.doc_number', 'a.reason', 'a.status', 'a.requested_by',
                'r.name as requested_by_name', 'a.approved_by', 'p.name as approved_by_name',
                'a.approved_at', 'a.reauth_at', 'a.note', 'a.created_at',
            ]);
    }

    /** @return array<string, mixed> */
    private function presentHeader(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'reason' => $row->reason,
            'status' => $row->status,
            'requested_by' => (int) $row->requested_by,
            'requested_by_name' => $row->requested_by_name,
            'approved_by' => $row->approved_by === null ? null : (int) $row->approved_by,
            'approved_by_name' => $row->approved_by_name,
            'approved_at' => $row->approved_at,
            'reauth_at' => $row->reauth_at,
            'note' => $row->note,
            'created_at' => $row->created_at,
        ];
    }

    private function nowUtc(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
