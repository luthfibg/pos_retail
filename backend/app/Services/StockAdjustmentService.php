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
    ) {}

    /** @return array{types: list<array{code: string, label: string}>, reasons: list<array{code: string, label: string, requires_notes: bool, selectable: bool}>} */
    public function meta(User $user, int $storeId): array
    {
        $this->assertCanUse($user, $storeId);

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
    public function search(User $user, int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $this->assertCanUse($user, $storeId);

        $query = $this->headerQuery($storeId);
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
            ->paginate($perPage)->through(fn ($row) => $this->present($row));
    }

    /** @return array<string, mixed>|null */
    public function find(User $user, int $storeId, int $id): ?array
    {
        $this->assertCanUse($user, $storeId);
        $row = $this->headerQuery($storeId)->where('a.id', $id)->first();

        return $row === null ? null : $this->present($row, true);
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
        $this->assertCanUse($actor, $storeId);

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

                    return ['adjustment' => $this->find($actor, $storeId, (int) $existing->id) ?? [], 'created' => false];
                }
            }

            if ($source === 'manual' && array_key_exists('target_quantity', $data)) {
                $locationId = $this->inventory->sellingLocationId($storeId);
                $stock = DB::table('inventory_balances')
                    ->where('product_id', (int) $product->id)
                    ->where('location_id', $locationId)
                    ->sum('qty_sellable');
                $difference = Decimal::qty((string) $data['target_quantity'])
                    - Decimal::qty((string) ($stock ?? 0));

                if ($difference === 0) {
                    throw ValidationException::withMessages([
                        'target_quantity' => ['Jumlah sama dengan stok saat ini; tidak ada perubahan untuk disimpan.'],
                    ]);
                }

                $absoluteDifference = abs($difference);
                if ($absoluteDifference % 1000 !== 0 || intdiv($absoluteDifference, 1000) > 999999999) {
                    throw ValidationException::withMessages([
                        'target_quantity' => ['Selisih adjustment harus berupa bilangan bulat maksimal 999.999.999.'],
                    ]);
                }

                $data['type'] = $difference > 0 ? 'increase' : 'decrease';
                $data['quantity'] = intdiv($absoluteDifference, 1000);
            }

            $reasonCode = (string) $data['reason_code'];
            $meta = collect($this->meta($actor, $storeId)['reasons'])->keyBy('code');
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

            return ['adjustment' => $this->find($actor, $storeId, $id) ?? [], 'created' => true];
        });
    }

    private function assertCanUse(User $user, int $storeId): void
    {
        abort_unless(
            array_intersect(['Admin', 'Owner', 'Kasir'], StockAuthorityPolicy::roleNames($user->id, $storeId)) !== [],
            403,
            'Adjustment hanya dapat digunakan oleh Admin, Owner, atau Kasir.',
        );
    }

    private function headerQuery(int $storeId)
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
    private function present(object $row, bool $detail = false): array
    {
        $reasons = collect($this->metaReasons())->keyBy('code');
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
    private function metaReasons(): array
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

    private function nowUtc(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
