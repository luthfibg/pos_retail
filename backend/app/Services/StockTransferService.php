<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class StockTransferService
{
    public function __construct(private InventoryService $inventory, private AuditLogger $audit, private NumberSequence $sequences) {}

    /** @param array{from_location_id: int, to_location_id: int, items: list<array<string, mixed>>} $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            $fromLocationId = (int) $data['from_location_id'];
            $toLocationId = (int) $data['to_location_id'];
            $this->locations($storeId, $fromLocationId, $toLocationId, true);
            $items = $this->validateItems($storeId, $fromLocationId, $toLocationId, $data['items']);

            $number = $this->sequences->next($storeId, 'TRF');
            $docNumber = DocumentNumber::format('TRF', $number);
            $id = DB::table('stock_transfers')->insertGetId([
                'store_id' => $storeId,
                'doc_number' => $docNumber,
                'from_location_id' => $fromLocationId,
                'to_location_id' => $toLocationId,
                'status' => 'draft',
                'created_by' => $actor->id,
            ]);

            foreach ($items as $item) {
                DB::table('stock_transfer_items')->insert($item + ['transfer_id' => $id]);
            }

            $this->audit->log(
                'stock_transfer.create',
                'stock_transfer',
                $id,
                after: [
                    'doc_number' => $docNumber,
                    'from_location_id' => $fromLocationId,
                    'to_location_id' => $toLocationId,
                    'items_count' => count($items),
                ],
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $id;
        });

        return $this->find($storeId, $id) ?? [];
    }

    /** @return array<string, mixed> */
    public function post(User $actor, int $storeId, int $id): array
    {
        DB::transaction(function () use ($actor, $storeId, $id) {
            $transfer = $this->lock($storeId, $id);
            if ($transfer->status !== 'draft') {
                throw ValidationException::withMessages(['status' => ['Hanya transfer Draft yang dapat diposting.']]);
            }

            $lines = DB::table('stock_transfer_items')->where('transfer_id', $id)->orderBy('id')->get();
            $items = $lines->map(fn ($item) => [
                'product_id' => (int) $item->product_id,
                'batch_id' => $item->batch_id === null ? null : (int) $item->batch_id,
                'from_position_id' => $item->from_position_id === null ? null : (int) $item->from_position_id,
                'to_position_id' => $item->to_position_id === null ? null : (int) $item->to_position_id,
                'qty' => $item->qty,
            ])->all();

            $this->locations($storeId, (int) $transfer->from_location_id, (int) $transfer->to_location_id, true);
            $items = $this->validateItems(
                $storeId,
                (int) $transfer->from_location_id,
                (int) $transfer->to_location_id,
                $items,
            );
            $this->inventory->transfer(
                $storeId,
                (int) $transfer->from_location_id,
                (int) $transfer->to_location_id,
                $items,
                'stock_transfer',
                $id,
                $actor->id,
            );

            $postedAt = Carbon::now('UTC')->format('Y-m-d H:i:s.v');
            DB::table('stock_transfers')->where('id', $id)->update([
                'status' => 'posted',
                'posted_by' => $actor->id,
                'posted_at' => $postedAt,
            ]);

            $this->audit->log(
                'stock_transfer.post',
                'stock_transfer',
                $id,
                before: ['status' => 'draft'],
                after: ['status' => 'posted', 'items_count' => count($items)],
                storeId: $storeId,
                actorId: $actor->id,
            );
        });

        return $this->find($storeId, $id) ?? [];
    }

    /** @return array<string, mixed> */
    public function cancel(User $actor, int $storeId, int $id, ?string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $transfer = $this->lock($storeId, $id);
            if ($transfer->status !== 'draft') {
                throw ValidationException::withMessages(['status' => ['Hanya transfer Draft yang dapat dibatalkan.']]);
            }

            DB::table('stock_transfers')->where('id', $id)->update(['status' => 'cancelled']);
            $this->audit->log(
                'stock_transfer.cancel',
                'stock_transfer',
                $id,
                before: ['status' => 'draft'],
                after: ['status' => 'cancelled'],
                reason: $reason,
                storeId: $storeId,
                actorId: $actor->id,
            );
        });

        return $this->find($storeId, $id) ?? [];
    }

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $query = $this->headerQuery($storeId)->orderByDesc('t.id');

        if (! empty($filters['status'])) {
            $query->where('t.status', $filters['status']);
        }
        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where('t.doc_number', 'like', "{$term}%");
        }

        return $query->paginate($perPage)->through(fn ($row) => $this->presentHeader($row));
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId, int $id): ?array
    {
        $transfer = $this->headerQuery($storeId)->where('t.id', $id)->first();
        if ($transfer === null) {
            return null;
        }

        $items = DB::table('stock_transfer_items as i')
            ->join('products as p', 'p.id', '=', 'i.product_id')
            ->leftJoin('product_batches as b', 'b.id', '=', 'i.batch_id')
            ->leftJoin('shelf_positions as fp', 'fp.id', '=', 'i.from_position_id')
            ->leftJoin('shelves as fs', 'fs.id', '=', 'fp.shelf_id')
            ->leftJoin('shelf_positions as tp', 'tp.id', '=', 'i.to_position_id')
            ->leftJoin('shelves as ts', 'ts.id', '=', 'tp.shelf_id')
            ->where('i.transfer_id', $id)
            ->orderBy('i.id')
            ->get([
                'i.id', 'i.product_id', 'p.sku', 'p.name as product_name', 'i.batch_id',
                'b.batch_code', 'b.expiry_date', 'i.from_position_id', 'fs.code as from_shelf_code',
                'fs.name as from_shelf_name', 'fp.level as from_level', 'fp.slot as from_slot',
                'i.to_position_id', 'ts.code as to_shelf_code', 'ts.name as to_shelf_name',
                'tp.level as to_level', 'tp.slot as to_slot', 'i.qty',
            ])
            ->map(fn ($item) => [
                'id' => (int) $item->id,
                'product_id' => (int) $item->product_id,
                'sku' => $item->sku,
                'product_name' => $item->product_name,
                'batch_id' => $item->batch_id === null ? null : (int) $item->batch_id,
                'batch_code' => $item->batch_code,
                'expiry_date' => $item->expiry_date,
                'from_position_id' => $item->from_position_id === null ? null : (int) $item->from_position_id,
                'from_position' => $this->positionLabel($item->from_shelf_code, $item->from_shelf_name, $item->from_level, $item->from_slot),
                'to_position_id' => $item->to_position_id === null ? null : (int) $item->to_position_id,
                'to_position' => $this->positionLabel($item->to_shelf_code, $item->to_shelf_name, $item->to_level, $item->to_slot),
                'qty' => $item->qty,
            ])->all();

        return $this->presentHeader($transfer) + ['items' => $items];
    }

    /** @return list<array<string, mixed>> */
    private function validateItems(int $storeId, int $fromLocationId, int $toLocationId, array $items): array
    {
        $productIds = collect($items)->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
        $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', $productIds)
            ->orderBy('id')->lockForUpdate()->get(['id'])->keyBy('id');
        $errors = [];
        $normalized = [];

        foreach (array_values($items) as $index => $item) {
            $productId = (int) $item['product_id'];
            if (! $products->has($productId)) {
                $errors["items.{$index}.product_id"] = ['Produk tidak ditemukan pada toko ini.'];

                continue;
            }

            $batchId = isset($item['batch_id']) ? (int) $item['batch_id'] : null;
            if ($batchId !== null && ! DB::table('product_batches')->where('id', $batchId)->where('product_id', $productId)->exists()) {
                $errors["items.{$index}.batch_id"] = ['Batch tidak ditemukan untuk produk ini.'];

                continue;
            }

            $fromPositionId = isset($item['from_position_id']) ? (int) $item['from_position_id'] : null;
            $toPositionId = isset($item['to_position_id']) ? (int) $item['to_position_id'] : null;
            if ($fromPositionId !== null && ! $this->positionBelongsToLocation($fromPositionId, $fromLocationId, false)) {
                $errors["items.{$index}.from_position_id"] = ['Posisi asal tidak valid untuk lokasi asal.'];
            }
            if ($toPositionId !== null && ! $this->positionBelongsToLocation($toPositionId, $toLocationId, true)) {
                $errors["items.{$index}.to_position_id"] = ['Posisi tujuan tidak valid atau rak tujuan nonaktif.'];
            }
            if ($fromLocationId === $toLocationId && $fromPositionId === $toPositionId) {
                $errors["items.{$index}.to_position_id"] = ['Posisi tujuan harus berbeda dari posisi asal.'];
            }

            $qty = Decimal::qty((string) $item['qty']);
            if ($qty <= 0) {
                $errors["items.{$index}.qty"] = ['Jumlah harus lebih dari nol.'];

                continue;
            }

            $normalized[] = [
                'product_id' => $productId,
                'batch_id' => $batchId,
                'from_position_id' => $fromPositionId,
                'to_position_id' => $toPositionId,
                'qty' => Decimal::qtyString($qty),
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $normalized;
    }

    /** @return array{object, object} */
    private function locations(int $storeId, int $fromLocationId, int $toLocationId, bool $lock): array
    {
        $query = DB::table('locations')->where('store_id', $storeId)
            ->whereIn('id', array_values(array_unique([$fromLocationId, $toLocationId])))
            ->orderBy('id');
        if ($lock) {
            $query->lockForUpdate();
        }
        $locations = $query->get()->keyBy('id');
        $errors = [];

        foreach (['from' => $fromLocationId, 'to' => $toLocationId] as $side => $locationId) {
            $location = $locations->get($locationId);
            if ($location === null || ! (bool) $location->is_active) {
                $errors["{$side}_location_id"] = ['Lokasi tidak ditemukan atau nonaktif pada toko ini.'];
            } elseif (! $this->warehouseEnabled($storeId) && $location->type === 'warehouse') {
                $errors["{$side}_location_id"] = ['Transfer yang melibatkan gudang tidak tersedia saat warehouse_enabled nonaktif.'];
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return [$locations->get($fromLocationId), $locations->get($toLocationId)];
    }

    private function warehouseEnabled(int $storeId): bool
    {
        $value = DB::table('settings')->where('store_id', $storeId)
            ->where('setting_key', 'warehouse_enabled')->value('setting_value');

        return $value === null ? false : (bool) json_decode((string) $value, true);
    }

    private function positionBelongsToLocation(int $positionId, int $locationId, bool $mustBeActive): bool
    {
        $query = DB::table('shelf_positions as sp')
            ->join('shelves as s', 's.id', '=', 'sp.shelf_id')
            ->where('sp.id', $positionId)
            ->where('s.location_id', $locationId);
        if ($mustBeActive) {
            $query->where('s.is_active', 1);
        }

        return $query->exists();
    }

    private function lock(int $storeId, int $id): object
    {
        $transfer = DB::table('stock_transfers')->where('store_id', $storeId)->where('id', $id)
            ->lockForUpdate()->first();
        abort_if($transfer === null, 404, 'Transfer stok tidak ditemukan.');

        return $transfer;
    }

    private function headerQuery(int $storeId)
    {
        return DB::table('stock_transfers as t')
            ->join('locations as fl', 'fl.id', '=', 't.from_location_id')
            ->join('locations as tl', 'tl.id', '=', 't.to_location_id')
            ->join('users as c', 'c.id', '=', 't.created_by')
            ->leftJoin('users as p', 'p.id', '=', 't.posted_by')
            ->where('t.store_id', $storeId)
            ->select([
                't.id', 't.doc_number', 't.from_location_id', 'fl.name as from_location_name',
                't.to_location_id', 'tl.name as to_location_name', 't.status',
                't.created_by', 'c.name as created_by_name', 't.posted_by',
                'p.name as posted_by_name', 't.posted_at', 't.created_at',
            ]);
    }

    /** @return array<string, mixed> */
    private function presentHeader(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'from_location_id' => (int) $row->from_location_id,
            'from_location_name' => $row->from_location_name,
            'to_location_id' => (int) $row->to_location_id,
            'to_location_name' => $row->to_location_name,
            'status' => $row->status,
            'created_by' => (int) $row->created_by,
            'created_by_name' => $row->created_by_name,
            'posted_by' => $row->posted_by === null ? null : (int) $row->posted_by,
            'posted_by_name' => $row->posted_by_name,
            'posted_at' => $row->posted_at,
            'created_at' => $row->created_at,
        ];
    }

    private function positionLabel(?string $code, ?string $name, ?int $level, ?int $slot): ?string
    {
        if ($code === null) {
            return null;
        }

        return "{$code} ({$name}) / L{$level}-S{$slot}";
    }
}
