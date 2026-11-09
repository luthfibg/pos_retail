<?php

namespace App\Services;

use App\Exceptions\StockLockedByOpnameException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OpnameLockService
{
    /**
     * @param  list<int>  $productIds
     * @return array<int, array{session_id: int, session_number: string}>
     */
    public function lockedProducts(
        int $storeId,
        array $productIds,
        ?string $sourceRefType = null,
        ?int $sourceRefId = null,
    ): array {
        $productIds = array_values(array_unique(array_filter(array_map('intval', $productIds), fn (int $id) => $id > 0)));
        if ($productIds === []) {
            return [];
        }

        $sourceSessionId = null;
        if ($sourceRefType === 'stock_adjustment' && $sourceRefId !== null) {
            $sourceAdjustment = DB::table('stock_adjustments')
                ->where('store_id', $storeId)
                ->where('id', $sourceRefId)
                ->first(['source', 'opname_session_id']);
            if ($sourceAdjustment?->source === 'opname') {
                $sourceSessionId = $sourceAdjustment->opname_session_id === null
                    ? null
                    : (int) $sourceAdjustment->opname_session_id;
                $activeSession = $sourceSessionId === null ? null : DB::table('stock_opname_sessions')
                    ->where('store_id', $storeId)
                    ->where('id', $sourceSessionId)
                    ->whereIn('status', ['in_progress', 'pending_approval'])
                    ->exists();
                $sessionProducts = $sourceSessionId === null ? 0 : DB::table('stock_opname_items')
                    ->where('session_id', $sourceSessionId)
                    ->whereIn('product_id', $productIds)
                    ->count();

                if (! $activeSession || $sessionProducts !== count($productIds)) {
                    throw ValidationException::withMessages([
                        'opname_session_id' => ['Referensi opname tidak aktif atau tidak mencakup produk yang disesuaikan.'],
                    ]);
                }
            }
        }

        $locks = DB::table('stock_opname_sessions as s')
            ->leftJoin('stock_opname_items as i', function ($join) use ($productIds) {
                $join->on('i.session_id', '=', 's.id')->whereIn('i.product_id', $productIds);
            })
            ->where('s.store_id', $storeId)
            ->whereIn('s.status', ['in_progress', 'pending_approval'])
            ->where(function ($query) {
                $query->where('s.scope_type', 'all')->orWhereNotNull('i.product_id');
            })
            ->orderBy('s.id')
            ->get(['s.id as session_id', 's.number as session_number', 's.scope_type', 'i.product_id']);

        $locked = [];
        foreach ($locks as $row) {
            foreach ($productIds as $productId) {
                $matchesProduct = $row->product_id === null || (int) $row->product_id === $productId;
                if (! $matchesProduct) {
                    continue;
                }
                if ($sourceSessionId === (int) $row->session_id && $row->product_id !== null && (int) $row->product_id === $productId) {
                    continue;
                }

                $locked[$productId] ??= [
                    'session_id' => (int) $row->session_id,
                    'session_number' => $row->session_number,
                ];
            }
        }

        return $locked;
    }

    /**
     * @param  list<int>  $productIds
     */
    public function assertUnlocked(int $storeId, array $productIds, ?string $sourceRefType = null, ?int $sourceRefId = null): void
    {
        $locked = $this->lockedProducts($storeId, $productIds, $sourceRefType, $sourceRefId);
        if ($locked === []) {
            return;
        }

        $names = DB::table('products')
            ->where('store_id', $storeId)
            ->whereIn('id', array_keys($locked))
            ->pluck('name', 'id');
        $payload = [];
        foreach ($locked as $productId => $lock) {
            $payload[] = [
                'product_id' => (int) $productId,
                'name' => (string) ($names[$productId] ?? 'Produk'),
                'session_number' => $lock['session_number'],
            ];
        }

        throw new StockLockedByOpnameException($payload);
    }

    public function hasStoreWideLock(int $storeId): ?object
    {
        return DB::table('stock_opname_sessions')
            ->where('store_id', $storeId)
            ->where('scope_type', 'all')
            ->whereIn('status', ['in_progress', 'pending_approval'])
            ->orderBy('id')
            ->first(['id', 'number']);
    }

    /**
     * @return list<array{number: string, scope_summary: string}>
     */
    public function activeSessionsSummary(int $storeId): array
    {
        $sessions = DB::table('stock_opname_sessions')
            ->where('store_id', $storeId)
            ->whereIn('status', ['in_progress', 'pending_approval'])
            ->orderBy('id')
            ->get(['id', 'number', 'scope_type']);

        if ($sessions->isEmpty()) {
            return [];
        }

        $categories = DB::table('stock_opname_session_categories as sc')
            ->join('categories as c', 'c.id', '=', 'sc.category_id')
            ->whereIn('sc.session_id', $sessions->where('scope_type', 'categories')->pluck('id'))
            ->orderBy('c.name')
            ->get(['sc.session_id', 'c.name'])
            ->groupBy('session_id');

        return $sessions->map(function (object $session) use ($categories) {
            if ($session->scope_type === 'all') {
                $summary = 'Seluruh toko';
            } else {
                $names = $categories->get($session->id, collect())->pluck('name')->all();
                $summary = $names === [] ? 'Kategori sesi' : 'Kategori: '.implode(', ', array_slice($names, 0, 3));
                if (count($names) > 3) {
                    $summary .= ' dan '.(count($names) - 3).' lainnya';
                }
            }

            return ['number' => $session->number, 'scope_summary' => $summary];
        })->all();
    }
}
