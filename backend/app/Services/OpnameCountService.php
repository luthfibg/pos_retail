<?php

namespace App\Services;

use App\Exceptions\OpnameCountConflictException;
use App\Exceptions\OpnameLookupException;
use App\Models\User;
use App\Support\Decimal;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OpnameCountService
{
    public function __construct(private OpnameProgressService $progress) {}

    /**
     * @param  array{item_id: int, mode: string, quantity?: int, good_quantity?: int|float, damaged_quantity?: int|float, client_request_id: string}  $data
     * @return array{item: array<string, mixed>, summary: array<string, int>, nodes: list<array<string, mixed>>}
     */
    public function store(
        User $actor,
        int $storeId,
        int $sessionId,
        array $data,
        bool $viaBatch = false,
        ?string $clientCreatedAt = null,
        ?bool &$duplicate = null,
    ): array
    {
        $duplicate = false;

        return DB::transaction(function () use ($actor, $storeId, $sessionId, $data, $viaBatch, $clientCreatedAt, &$duplicate) {
            $session = DB::table('stock_opname_sessions')
                ->where('store_id', $storeId)->where('id', $sessionId)->lockForUpdate()->first(['id', 'status', 'condition_counting']);
            abort_if($session === null, 404, 'Sesi opname tidak ditemukan.');
            if ($session->status !== 'in_progress') {
                throw new OpnameCountConflictException('opname_session_not_countable', 'Sesi opname tidak sedang berjalan dan tidak dapat dihitung.');
            }

            $existing = DB::table('stock_opname_count_logs')
                ->where('client_request_id', $data['client_request_id'])
                ->first(['session_id', 'item_id', 'created_by']);
            if ($existing !== null) {
                if (
                    (int) $existing->session_id !== $sessionId
                    || (int) $existing->item_id !== (int) $data['item_id']
                    || (int) $existing->created_by !== $actor->id
                ) {
                    throw new OpnameCountConflictException('idempotency_key_conflict', 'Kunci permintaan hitungan sudah digunakan untuk permintaan lain.');
                }

                $duplicate = true;

                return $this->result($storeId, $sessionId, (int) $data['item_id']);
            }

            $item = DB::table('stock_opname_items')
                ->where('session_id', $sessionId)->where('id', (int) $data['item_id'])
                ->lockForUpdate()->first();
            abort_if($item === null, 404, 'Produk bukan bagian dari sesi opname ini.');

            DB::table('products')
                ->where('store_id', $storeId)->where('id', $item->product_id)
                ->lockForUpdate()->first(['id']);
            $balances = DB::table('inventory_balances')
                ->where('product_id', $item->product_id)
                ->orderBy('id')
                ->lockForUpdate()
                ->get(['qty_sellable', 'qty_quarantine', 'qty_damaged']);
            $systemGoodQty = 0;
            $systemDamagedQty = 0;
            foreach ($balances as $balance) {
                $systemGoodQty += Decimal::qty((string) $balance->qty_sellable);
                $systemDamagedQty += Decimal::qty((string) $balance->qty_quarantine);
                $systemDamagedQty += Decimal::qty((string) $balance->qty_damaged);
            }

            $splitCounts = (bool) $session->condition_counting;
            if ($splitCounts && (! isset($data['good_quantity']) || ! isset($data['damaged_quantity']))) {
                throw ValidationException::withMessages([
                    'good_quantity' => ['Jumlah barang bagus dan rusak wajib diisi untuk sesi opname ini.'],
                ]);
            }
            $before = $item->counted_qty === null ? null : Decimal::qty((string) $item->counted_qty);
            $beforeGood = $item->counted_good_qty === null ? null : Decimal::qty((string) $item->counted_good_qty);
            $beforeDamaged = $item->counted_damaged_qty === null ? null : Decimal::qty((string) $item->counted_damaged_qty);
            if ($splitCounts) {
                $inputGood = Decimal::qty((string) $data['good_quantity']);
                $inputDamaged = Decimal::qty((string) $data['damaged_quantity']);
                $afterGood = $data['mode'] === 'add' ? ($beforeGood ?? 0) + $inputGood : $inputGood;
                $afterDamaged = $data['mode'] === 'add' ? ($beforeDamaged ?? 0) + $inputDamaged : $inputDamaged;
                $after = $afterGood + $afterDamaged;
                $quantity = $inputGood + $inputDamaged;
                if ($data['mode'] === 'add' && $quantity < 1) {
                    throw ValidationException::withMessages([
                        'good_quantity' => ['Jumlah penambahan harus lebih dari nol.'],
                    ]);
                }
            } else {
                $quantity = Decimal::qty((string) ($data['quantity'] ?? 0));
                $after = $data['mode'] === 'add' ? ($before ?? 0) + $quantity : $quantity;
                $afterGood = null;
                $afterDamaged = null;
                $inputGood = null;
                $inputDamaged = null;
            }
            if ($after > 1000000 * 1000) {
                throw ValidationException::withMessages(['quantity' => ['Jumlah hasil hitung tidak boleh melebihi 1.000.000.']]);
            }

            $now = Carbon::now('UTC')->format('Y-m-d H:i:s.v');
            $updates = [
                'counted_qty' => Decimal::qtyString($after),
                'system_qty_at_count' => Decimal::qtyString($systemGoodQty + $systemDamagedQty),
                'counted_at' => $now,
                'counted_by' => $actor->id,
                'updated_at' => $now,
            ];
            if ($splitCounts) {
                $updates += [
                    'counted_good_qty' => Decimal::qtyString($afterGood),
                    'counted_damaged_qty' => Decimal::qtyString($afterDamaged),
                    'system_good_qty_at_count' => Decimal::qtyString($systemGoodQty),
                    'system_damaged_qty_at_count' => Decimal::qtyString($systemDamagedQty),
                    'diff_good_qty' => Decimal::qtyString($afterGood - $systemGoodQty),
                    'diff_damaged_qty' => Decimal::qtyString($afterDamaged - $systemDamagedQty),
                ];
            }
            DB::table('stock_opname_items')->where('id', $item->id)->update($updates);
            DB::table('stock_opname_count_logs')->insert([
                'session_id' => $sessionId,
                'item_id' => (int) $item->id,
                'product_id' => (int) $item->product_id,
                'action' => $data['mode'],
                'input_qty' => Decimal::qtyString($quantity),
                'counted_before' => $before === null ? null : Decimal::qtyString($before),
                'counted_after' => Decimal::qtyString($after),
                'input_good_qty' => $inputGood === null ? null : Decimal::qtyString($inputGood),
                'input_damaged_qty' => $inputDamaged === null ? null : Decimal::qtyString($inputDamaged),
                'counted_good_before' => $beforeGood === null ? null : Decimal::qtyString($beforeGood),
                'counted_good_after' => $afterGood === null ? null : Decimal::qtyString($afterGood),
                'counted_damaged_before' => $beforeDamaged === null ? null : Decimal::qtyString($beforeDamaged),
                'counted_damaged_after' => $afterDamaged === null ? null : Decimal::qtyString($afterDamaged),
                'client_request_id' => $data['client_request_id'],
                'created_by' => $actor->id,
                'client_created_at' => $clientCreatedAt === null ? null : Carbon::parse($clientCreatedAt)->utc()->format('Y-m-d H:i:s.v'),
                'via_batch' => $viaBatch,
                'created_at' => $now,
            ]);

            return $this->result($storeId, $sessionId, (int) $item->id);
        }, 3);
    }

    /** @return array{item: array<string, mixed>, summary: array<string, int>, nodes: list<array<string, mixed>>} */
    public function clear(
        User $actor,
        int $storeId,
        int $sessionId,
        int $itemId,
        string $requestId,
        bool $viaBatch = false,
        ?string $clientCreatedAt = null,
        ?bool &$duplicate = null,
    ): array
    {
        $duplicate = false;

        return DB::transaction(function () use ($actor, $storeId, $sessionId, $itemId, $requestId, $viaBatch, $clientCreatedAt, &$duplicate) {
            $session = DB::table('stock_opname_sessions')
                ->where('store_id', $storeId)->where('id', $sessionId)->lockForUpdate()->first(['id', 'status']);
            abort_if($session === null, 404, 'Sesi opname tidak ditemukan.');
            if ($session->status !== 'in_progress') {
                throw new OpnameCountConflictException('opname_session_not_countable', 'Sesi opname tidak sedang berjalan dan tidak dapat dikoreksi.');
            }

            $existing = DB::table('stock_opname_count_logs')
                ->where('client_request_id', $requestId)
                ->first(['session_id', 'item_id', 'created_by']);
            if ($existing !== null) {
                if ((int) $existing->session_id !== $sessionId || (int) $existing->item_id !== $itemId || (int) $existing->created_by !== $actor->id) {
                    throw new OpnameCountConflictException('idempotency_key_conflict', 'Kunci permintaan hitungan sudah digunakan untuk permintaan lain.');
                }

                $duplicate = true;

                return $this->result($storeId, $sessionId, $itemId);
            }

            $item = DB::table('stock_opname_items')
                ->where('session_id', $sessionId)->where('id', $itemId)
                ->lockForUpdate()->first();
            abort_if($item === null, 404, 'Produk bukan bagian dari sesi opname ini.');

            $before = $item->counted_qty === null ? null : Decimal::qty((string) $item->counted_qty);
            $now = Carbon::now('UTC')->format('Y-m-d H:i:s.v');
            DB::table('stock_opname_items')->where('id', $itemId)->update([
                'counted_qty' => null,
                'counted_good_qty' => null,
                'counted_damaged_qty' => null,
                'system_qty_at_count' => null,
                'system_good_qty_at_count' => null,
                'system_damaged_qty_at_count' => null,
                'diff_good_qty' => null,
                'diff_damaged_qty' => null,
                'counted_at' => null,
                'counted_by' => null,
                'updated_at' => $now,
            ]);
            DB::table('stock_opname_count_logs')->insert([
                'session_id' => $sessionId,
                'item_id' => $itemId,
                'product_id' => (int) $item->product_id,
                'action' => 'clear',
                'input_qty' => null,
                'counted_before' => $before === null ? null : Decimal::qtyString($before),
                'counted_after' => null,
                'input_good_qty' => null,
                'input_damaged_qty' => null,
                'counted_good_before' => $item->counted_good_qty,
                'counted_good_after' => null,
                'counted_damaged_before' => $item->counted_damaged_qty,
                'counted_damaged_after' => null,
                'client_request_id' => $requestId,
                'created_by' => $actor->id,
                'client_created_at' => $clientCreatedAt === null ? null : Carbon::parse($clientCreatedAt)->utc()->format('Y-m-d H:i:s.v'),
                'via_batch' => $viaBatch,
                'created_at' => $now,
            ]);

            return $this->result($storeId, $sessionId, $itemId);
        }, 3);
    }

    /**
     * @return array{data: list<array<string, mixed>>}
     */
    public function lookup(int $storeId, int $sessionId, string $query, string $mode): array
    {
        try {
            return ['data' => $this->progress->lookup($storeId, $sessionId, $query, $mode)];
        } catch (OpnameLookupException $exception) {
            throw $exception;
        }
    }

    /** @return array{data: list<array<string, mixed>>} */
    public function recent(int $storeId, int $sessionId, int $limit): array
    {
        abort_unless(DB::table('stock_opname_sessions')->where('store_id', $storeId)->where('id', $sessionId)->exists(), 404, 'Sesi opname tidak ditemukan.');

        $rows = DB::table('stock_opname_count_logs as l')
            ->join('stock_opname_items as i', 'i.id', '=', 'l.item_id')
            ->join('users as u', 'u.id', '=', 'l.created_by')
            ->where('l.session_id', $sessionId)
            ->orderByDesc('l.created_at')->orderByDesc('l.id')
            ->limit($limit)
            ->get([
                'l.id', 'l.item_id', 'l.action', 'l.input_qty', 'l.counted_after',
                'l.input_good_qty', 'l.input_damaged_qty', 'l.counted_good_after', 'l.counted_damaged_after', 'l.created_at',
                'l.created_by', 'u.name as created_by_name', 'i.product_name_snapshot', 'i.barcode_snapshot',
            ]);

        return ['data' => $rows->map(fn (object $row) => [
            'log_id' => (int) $row->id,
            'item' => [
                'id' => (int) $row->item_id,
                'name' => $row->product_name_snapshot,
                'barcode' => $row->barcode_snapshot,
            ],
            'action' => $row->action,
            'input_qty' => $row->input_qty,
            'counted_after' => $row->counted_after,
            'input_good_qty' => $row->input_good_qty,
            'input_damaged_qty' => $row->input_damaged_qty,
            'counted_good_after' => $row->counted_good_after,
            'counted_damaged_after' => $row->counted_damaged_after,
            'created_at' => $row->created_at,
            'created_by' => ['id' => (int) $row->created_by, 'name' => $row->created_by_name],
        ])->all()];
    }

    /** @return array{item: array<string, mixed>, summary: array<string, int>, nodes: list<array<string, mixed>>} */
    private function result(int $storeId, int $sessionId, int $itemId): array
    {
        $item = $this->progress->item($storeId, $sessionId, $itemId);
        abort_if($item === null, 404, 'Produk bukan bagian dari sesi opname ini.');
        $tree = $this->progress->tree($storeId, $sessionId);
        abort_if($tree === null, 404, 'Sesi opname tidak ditemukan.');

        $flat = [];
        $flatten = function (array $nodes) use (&$flatten, &$flat): void {
            foreach ($nodes as $node) {
                $flat[(string) $node['id']] = $node;
                $flatten($node['children'] ?? []);
            }
        };
        $flatten($tree['nodes']);
        $nodeId = $item['category_id'] === null ? 'other' : (string) $item['category_id'];
        $nodes = [];
        while (isset($flat[$nodeId])) {
            $node = $flat[$nodeId];
            $nodes[] = array_intersect_key($node, array_flip([
                'id', 'counted_count', 'product_count', 'status', 'variance_count',
                'direct_product_count', 'direct_counted_count',
            ]));
            if ($node['parent_id'] === null) {
                break;
            }
            $nodeId = (string) $node['parent_id'];
        }

        return [
            'item' => $item,
            'summary' => $tree['summary'],
            'nodes' => $nodes,
        ];
    }
}
