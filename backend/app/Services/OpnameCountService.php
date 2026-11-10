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
     * @param  array{item_id: int, mode: string, quantity: int, client_request_id: string}  $data
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
                ->where('store_id', $storeId)->where('id', $sessionId)->lockForUpdate()->first(['id', 'status']);
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
            $systemQty = 0;
            foreach ($balances as $balance) {
                $systemQty += Decimal::qty((string) $balance->qty_sellable);
                $systemQty += Decimal::qty((string) $balance->qty_quarantine);
                $systemQty += Decimal::qty((string) $balance->qty_damaged);
            }

            $before = $item->counted_qty === null ? null : (int) $item->counted_qty;
            $quantity = (int) $data['quantity'];
            $after = $data['mode'] === 'add' ? ($before ?? 0) + $quantity : $quantity;
            if ($after > 1000000) {
                throw ValidationException::withMessages(['quantity' => ['Jumlah hasil hitung tidak boleh melebihi 1.000.000.']]);
            }

            $now = Carbon::now('UTC')->format('Y-m-d H:i:s.v');
            DB::table('stock_opname_items')->where('id', $item->id)->update([
                'counted_qty' => $after,
                'system_qty_at_count' => Decimal::qtyString($systemQty),
                'counted_at' => $now,
                'counted_by' => $actor->id,
                'updated_at' => $now,
            ]);
            DB::table('stock_opname_count_logs')->insert([
                'session_id' => $sessionId,
                'item_id' => (int) $item->id,
                'product_id' => (int) $item->product_id,
                'action' => $data['mode'],
                'input_qty' => $quantity,
                'counted_before' => $before,
                'counted_after' => $after,
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

            $before = $item->counted_qty === null ? null : (int) $item->counted_qty;
            $now = Carbon::now('UTC')->format('Y-m-d H:i:s.v');
            DB::table('stock_opname_items')->where('id', $itemId)->update([
                'counted_qty' => null,
                'system_qty_at_count' => null,
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
                'counted_before' => $before,
                'counted_after' => null,
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
                'l.id', 'l.item_id', 'l.action', 'l.input_qty', 'l.counted_after', 'l.created_at',
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
            'input_qty' => $row->input_qty === null ? null : (int) $row->input_qty,
            'counted_after' => $row->counted_after === null ? null : (int) $row->counted_after,
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
