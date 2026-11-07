<?php

namespace App\Services;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class OpnameProgressService
{
    public function __construct(private OpnameDisplayPolicy $displayPolicy) {}

    /** @return array<string, mixed>|null */
    public function tree(int $storeId, int $sessionId): ?array
    {
        $session = $this->session($storeId, $sessionId);
        if ($session === null) {
            return null;
        }

        $reveals = $this->displayPolicy->revealsSystemQty($storeId);
        $groups = $this->itemGroups($sessionId);
        $categories = DB::table('categories')->where('store_id', $storeId)->orderBy('name')->get(['id', 'parent_id', 'name']);
        $categoryById = $categories->keyBy('id');
        $children = [];
        foreach ($categories as $category) {
            $parentId = $category->parent_id === null ? 0 : (int) $category->parent_id;
            $children[$parentId][] = (int) $category->id;
        }

        $direct = [];
        $other = $this->emptyCounts();
        $staleCategoryIds = [];
        foreach ($groups as $group) {
            $categoryId = $group->category_id === null ? null : (int) $group->category_id;
            $category = $categoryId === null ? null : $categoryById->get($categoryId);
            $currentParentName = $category?->parent_id === null
                ? null
                : $categoryById->get((int) $category->parent_id)?->name;
            $isStale = $categoryId !== null && (
                $category === null
                || $category->name !== $group->category_name_snapshot
                || $currentParentName !== $group->category_parent_name_snapshot
            );
            $counts = $this->countsFromGroup($group);
            if ($isStale || $categoryId === null) {
                if ($categoryId !== null) {
                    $staleCategoryIds[$categoryId] = true;
                }
                $this->addCounts($other, $counts);
            } else {
                $direct[$categoryId] ??= $this->emptyCounts();
                $this->addCounts($direct[$categoryId], $counts);
            }
        }

        $build = function (int $parentId, int $depth = 0) use (&$build, $children, $categoryById, $direct, $reveals): array {
            $nodes = [];
            foreach ($children[$parentId] ?? [] as $categoryId) {
                $childNodes = $build($categoryId, $depth + 1);
                $directCounts = $direct[$categoryId] ?? $this->emptyCounts();
                $total = $directCounts;
                foreach ($childNodes as $child) {
                    $this->addCounts($total, [
                        'product_count' => $child['product_count'],
                        'counted_count' => $child['counted_count'],
                        'variance_count' => $child['variance_count'] ?? 0,
                    ]);
                }
                if ($total['product_count'] === 0) {
                    continue;
                }
                $category = $categoryById->get($categoryId);
                $node = [
                    'id' => $categoryId,
                    'name' => $category->name,
                    'parent_id' => $category->parent_id === null ? null : (int) $category->parent_id,
                    'depth' => $depth,
                    'product_count' => $total['product_count'],
                    'counted_count' => $total['counted_count'],
                    'status' => $this->nodeStatus($total['product_count'], $total['counted_count']),
                    'direct_product_count' => $directCounts['product_count'],
                    'direct_counted_count' => $directCounts['counted_count'],
                    'children' => $childNodes,
                ];
                if ($reveals) {
                    $node['variance_count'] = $total['variance_count'];
                }
                $nodes[] = $node;
            }

            return $nodes;
        };

        $nodes = $build(0);
        $total = $this->emptyCounts();
        foreach ($direct as $counts) {
            $this->addCounts($total, $counts);
        }
        $this->addCounts($total, $other);
        if ($other['product_count'] > 0) {
            $otherNode = [
                'id' => 'other',
                'name' => 'Lainnya',
                'parent_id' => null,
                'depth' => 0,
                'product_count' => $other['product_count'],
                'counted_count' => $other['counted_count'],
                'status' => $this->nodeStatus($other['product_count'], $other['counted_count']),
                'direct_product_count' => $other['product_count'],
                'direct_counted_count' => $other['counted_count'],
                'children' => [],
            ];
            if ($reveals) {
                $otherNode['variance_count'] = $other['variance_count'];
            }
            $nodes[] = $otherNode;
        }

        $tree = [
            'session' => [
                'id' => (int) $session->id,
                'number' => $session->number,
                'status' => $session->status,
            ],
            'display' => ['reveals_system_qty' => $reveals],
            'summary' => [
                'total_products' => $total['product_count'],
                'counted_products' => $total['counted_count'],
            ],
            'nodes' => $nodes,
        ];

        return $tree;
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public function items(int $storeId, int $sessionId, array $filters, int $perPage): LengthAwarePaginator
    {
        $session = $this->session($storeId, $sessionId);
        abort_if($session === null, 404, 'Sesi opname tidak ditemukan.');
        $reveals = $this->displayPolicy->revealsSystemQty($storeId);
        $staleCategoryIds = $this->staleCategoryIds($sessionId, $storeId);
        $categoryMap = DB::table('categories')->where('store_id', $storeId)
            ->get(['id', 'parent_id', 'name'])->keyBy('id');
        $query = DB::table('stock_opname_items as i')
            ->where('i.session_id', $sessionId);

        if (array_key_exists('category_id', $filters)) {
            $categoryId = (int) $filters['category_id'];
            if ($categoryId === 0) {
                $query->where(function ($builder) use ($staleCategoryIds) {
                    $builder->whereNull('i.category_id');
                    if ($staleCategoryIds !== []) {
                        $builder->orWhereIn('i.category_id', $staleCategoryIds);
                    }
                });
            } else {
                $categoryIds = [$categoryId];
                if (($filters['scope'] ?? 'direct') === 'all') {
                    $categoryIds = $this->categoryDescendants($storeId, $categoryId);
                }
                $categoryIds = array_values(array_diff($categoryIds, $staleCategoryIds));
                $query->whereIn('i.category_id', $categoryIds === [] ? [-1] : $categoryIds);
            }
        }
        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where(function ($builder) use ($term) {
                $builder->where('i.product_name_snapshot', 'like', "%{$term}%")
                    ->orWhere('i.barcode_snapshot', 'like', "{$term}%");
            });
        }
        if (! empty($filters['only_uncounted'])) {
            $query->whereNull('i.counted_qty');
        }
        if (! empty($filters['q'])) {
            $query->orderByRaw('CASE WHEN i.barcode_snapshot = ? THEN 0 ELSE 1 END', [(string) $filters['q']]);
        }

        $page = $query->orderBy('i.product_name_snapshot')->orderBy('i.id')
            ->paginate($perPage)->through(function (object $item) use ($reveals, $staleCategoryIds, $categoryMap) {
                $row = [
                    'id' => (int) $item->id,
                    'product_id' => (int) $item->product_id,
                    'name' => $item->product_name_snapshot,
                    'barcode' => $item->barcode_snapshot,
                    'category_path' => $this->categoryPath($item, $staleCategoryIds, $categoryMap),
                    'status' => $this->displayPolicy->itemStatus($item, $reveals),
                    'counted_qty' => $item->counted_qty,
                ];
                if ($reveals) {
                    $row['system_qty'] = $item->system_qty_at_count ?? $item->system_qty_at_start;
                }

                return $row;
            });

        return $page;
    }

    /** @return list<object> */
    private function itemGroups(int $sessionId): array
    {
        return DB::table('stock_opname_items')
            ->where('session_id', $sessionId)
            ->groupBy('category_id', 'category_name_snapshot', 'category_parent_name_snapshot')
            ->selectRaw('category_id, category_name_snapshot, category_parent_name_snapshot')
            ->selectRaw('COUNT(*) as product_count')
            ->selectRaw('SUM(CASE WHEN counted_qty IS NOT NULL THEN 1 ELSE 0 END) as counted_count')
            ->selectRaw('SUM(CASE WHEN counted_qty IS NOT NULL AND COALESCE(system_qty_at_count, system_qty_at_start) <> counted_qty THEN 1 ELSE 0 END) as variance_count')
            ->get()->all();
    }

    /** @return array{product_count: int, counted_count: int, variance_count: int} */
    private function emptyCounts(): array
    {
        return ['product_count' => 0, 'counted_count' => 0, 'variance_count' => 0];
    }

    /** @return array{product_count: int, counted_count: int, variance_count: int} */
    private function countsFromGroup(object $group): array
    {
        return [
            'product_count' => (int) $group->product_count,
            'counted_count' => (int) $group->counted_count,
            'variance_count' => (int) $group->variance_count,
        ];
    }

    /** @param array{product_count: int, counted_count: int, variance_count: int} $target
     * @param  array{product_count: int, counted_count: int, variance_count: int}  $source
     */
    private function addCounts(array &$target, array $source): void
    {
        $target['product_count'] += $source['product_count'];
        $target['counted_count'] += $source['counted_count'];
        $target['variance_count'] += $source['variance_count'];
    }

    private function nodeStatus(int $total, int $counted): string
    {
        if ($counted === 0) {
            return 'not_started';
        }

        return $counted === $total ? 'done' : 'partial';
    }

    private function session(int $storeId, int $sessionId): ?object
    {
        return DB::table('stock_opname_sessions')
            ->where('store_id', $storeId)->where('id', $sessionId)->first(['id', 'number', 'status']);
    }

    /** @return list<int> */
    private function staleCategoryIds(int $sessionId, int $storeId): array
    {
        $groups = $this->itemGroups($sessionId);
        $categoryIds = array_values(array_unique(array_filter(array_map(
            fn (object $group) => $group->category_id === null ? null : (int) $group->category_id,
            $groups,
        ))));
        if ($categoryIds === []) {
            return [];
        }

        $categories = DB::table('categories as c')
            ->leftJoin('categories as p', 'p.id', '=', 'c.parent_id')
            ->where('c.store_id', $storeId)->whereIn('c.id', $categoryIds)
            ->get(['c.id', 'c.name', 'p.name as parent_name'])->keyBy('id');
        $stale = [];
        foreach ($groups as $group) {
            if ($group->category_id === null) {
                continue;
            }
            $categoryId = (int) $group->category_id;
            $category = $categories->get($categoryId);
            if (
                $category === null
                || $category->name !== $group->category_name_snapshot
                || $category->parent_name !== $group->category_parent_name_snapshot
            ) {
                $stale[$categoryId] = true;
            }
        }

        return array_map('intval', array_keys($stale));
    }

    /** @return list<int> */
    private function categoryDescendants(int $storeId, int $categoryId): array
    {
        $categories = DB::table('categories')->where('store_id', $storeId)->get(['id', 'parent_id']);
        $children = [];
        foreach ($categories as $category) {
            $children[$category->parent_id === null ? 0 : (int) $category->parent_id][] = (int) $category->id;
        }

        $collect = function (int $id) use (&$collect, $children): array {
            $ids = [$id];
            foreach ($children[$id] ?? [] as $childId) {
                array_push($ids, ...$collect($childId));
            }

            return $ids;
        };

        return $collect($categoryId);
    }

    /** @param list<int> $staleCategoryIds @return list<string> */
    private function categoryPath(object $item, array $staleCategoryIds, Collection $categories): array
    {
        $categoryId = $item->category_id === null ? null : (int) $item->category_id;
        if ($categoryId === null || in_array($categoryId, $staleCategoryIds, true)) {
            return array_values(array_filter(array_unique([
                $item->category_parent_name_snapshot,
                $item->category_name_snapshot,
            ]), fn (?string $name) => $name !== null && $name !== ''));
        }

        $path = [];
        $cursor = $categoryId;
        while ($cursor !== null && isset($categories[$cursor])) {
            $category = $categories[$cursor];
            array_unshift($path, $category->name);
            $cursor = $category->parent_id === null ? null : (int) $category->parent_id;
        }

        return $path;
    }
}
