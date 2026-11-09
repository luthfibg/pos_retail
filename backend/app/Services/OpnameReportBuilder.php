<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use Illuminate\Support\Facades\DB;

class OpnameReportBuilder
{
    public function __construct(
        private OpnameApprovalSettingsService $approvalSettings,
        private OpnameApprovalEvaluator $approvalEvaluator,
        private PermissionResolver $permissions,
    ) {}

    /** @return array<string, mixed>|null */
    public function build(User $user, int $storeId, int $sessionId): ?array
    {
        $session = DB::table('stock_opname_sessions')
            ->where('store_id', $storeId)->where('id', $sessionId)
            ->first();
        if ($session === null) {
            return null;
        }

        $items = DB::table('stock_opname_items as i')
            ->leftJoin('products as p', 'p.id', '=', 'i.product_id')
            ->where('i.session_id', $sessionId)
            ->orderBy('i.product_name_snapshot')
            ->get([
                'i.id', 'i.product_id', 'i.category_id', 'i.product_name_snapshot',
                'i.barcode_snapshot', 'i.category_name_snapshot', 'i.category_parent_name_snapshot',
                'i.counted_qty', 'i.system_qty_at_count', 'i.diff_qty', 'i.unit_cost_snapshot',
                'i.diff_value', 'i.revision_count', 'p.unit_cost',
            ]);
        $totalProducts = $items->count();
        $countedProducts = $items->whereNotNull('counted_qty')->count();
        if ($countedProducts !== $totalProducts) {
            return [
                'session' => ['id' => (int) $session->id, 'status' => $session->status],
                'complete' => false,
                'progress' => [
                    'products_counted' => $countedProducts,
                    'products_total' => $totalProducts,
                    'counted_products' => $countedProducts,
                    'total_products' => $totalProducts,
                ],
            ];
        }

        $hasFrozenValues = in_array($session->status, ['pending_approval', 'posted'], true);
        $canViewValue = $this->permissions->allows($user, 'opname.view_value', $storeId);
        $thresholds = $this->approvalSettings->thresholds($storeId);
        $countsByCategory = [];
        $countLogCounts = DB::table('stock_opname_count_logs')
            ->where('session_id', $sessionId)
            ->groupBy('item_id')
            ->selectRaw('item_id, COUNT(*) as count')
            ->pluck('count', 'item_id');
        $totals = [
            'variance_products' => 0,
            'short_count' => 0,
            'over_count' => 0,
            'short_qty' => 0,
            'over_qty' => 0,
            'short_value' => 0,
            'over_value' => 0,
            'abs_value' => 0,
        ];

        foreach ($items as $item) {
            $categoryId = $item->category_id === null ? null : (int) $item->category_id;
            $countsByCategory[$categoryId ?? 0] ??= [
                'counted_products' => 0, 'variance_count' => 0, 'short_qty' => 0, 'over_qty' => 0, 'lines' => [],
            ];
            $countsByCategory[$categoryId ?? 0]['counted_products']++;

            $diffUnits = $hasFrozenValues && $item->diff_qty !== null
                ? Decimal::qty((string) $item->diff_qty)
                : Decimal::qty((string) $item->counted_qty) - Decimal::qty((string) $item->system_qty_at_count);
            if ($diffUnits === 0) {
                continue;
            }

            $unitCost = $hasFrozenValues
                ? ($item->unit_cost_snapshot === null ? null : (string) $item->unit_cost_snapshot)
                : ($item->unit_cost === null ? null : (string) $item->unit_cost);
            $costUnits = $unitCost === null ? 0 : Decimal::toUnits($unitCost, 4);
            $valueUnits = $costUnits <= 0 ? null : intdiv(abs($diffUnits) * $costUnits + 50000, 100000);
            $countsByCategory[$categoryId ?? 0]['variance_count']++;
            $totals['variance_products']++;
            if ($diffUnits < 0) {
                $totals['short_qty'] += abs($diffUnits);
                $totals['short_count']++;
                $countsByCategory[$categoryId ?? 0]['short_qty'] += abs($diffUnits);
                $totals['short_value'] += $valueUnits ?? 0;
            } else {
                $totals['over_qty'] += $diffUnits;
                $totals['over_count']++;
                $countsByCategory[$categoryId ?? 0]['over_qty'] += $diffUnits;
                $totals['over_value'] += $valueUnits ?? 0;
            }
            $totals['abs_value'] += $valueUnits ?? 0;

            $line = [
                'item_id' => (int) $item->id,
                'product_id' => (int) $item->product_id,
                'name' => $item->product_name_snapshot,
                'barcode' => $item->barcode_snapshot,
                'system_qty' => (string) $item->system_qty_at_count,
                'counted_qty' => (string) $item->counted_qty,
                'diff_qty' => Decimal::qtyString($diffUnits),
                'direction' => $diffUnits < 0 ? 'short' : 'over',
                'revised' => max(0, (int) $countLogCounts->get($item->id, 0) - 1) > 0,
            ];
            if ($canViewValue) {
                $line['unit_cost'] = $unitCost;
                $line['value'] = $valueUnits === null ? null : Decimal::moneyString($valueUnits);
                $line['cost_missing'] = $valueUnits === null;
            }
            $countsByCategory[$categoryId ?? 0]['lines'][] = $line;
        }

        $categoryNodes = $this->categoryTree($storeId, $countsByCategory);
        $snapshot = ['item_values' => [], 'totals' => [
            'abs_value' => Decimal::moneyString($totals['abs_value']),
        ]];
        foreach ($items as $item) {
            $diffUnits = $hasFrozenValues && $item->diff_qty !== null
                ? Decimal::qty((string) $item->diff_qty)
                : Decimal::qty((string) $item->counted_qty) - Decimal::qty((string) $item->system_qty_at_count);
            $unitCost = $hasFrozenValues
                ? ($item->unit_cost_snapshot === null ? null : (string) $item->unit_cost_snapshot)
                : ($item->unit_cost === null ? null : (string) $item->unit_cost);
            $costUnits = $unitCost === null ? 0 : Decimal::toUnits($unitCost, 4);
            $snapshot['item_values'][(int) $item->id] = [
                'diff_qty' => Decimal::qtyString($diffUnits),
                'cost' => $costUnits <= 0 ? null : $unitCost,
                'value' => $costUnits <= 0 ? null : intdiv(abs($diffUnits) * $costUnits + 50000, 100000),
                'revisions' => (int) $item->revision_count,
            ];
        }
        $approvalReasons = $hasFrozenValues
            ? (json_decode((string) $session->approval_reasons, true) ?? [])
            : $this->approvalEvaluator->evaluate($storeId, $items->all(), $snapshot, $thresholds);
        $approvalRequired = $hasFrozenValues
            ? (bool) $session->approval_required
            : $approvalReasons !== [];
        $report = [
            'session' => [
                'id' => (int) $session->id,
                'number' => $session->number,
                'status' => $session->status,
            ],
            'complete' => true,
            'provisional' => ! $hasFrozenValues,
            'clean' => $totals['variance_products'] === 0,
            'totals' => [
                'products_counted' => $countedProducts,
                'products_total' => $totalProducts,
                'variance_products' => $totals['variance_products'],
                'short_count' => $totals['short_count'],
                'over_count' => $totals['over_count'],
                'short_qty' => Decimal::qtyString($totals['short_qty']),
                'over_qty' => Decimal::qtyString($totals['over_qty']),
                'net_qty' => Decimal::qtyString($totals['over_qty'] - $totals['short_qty']),
            ],
            'categories' => $categoryNodes,
            'approval' => [
                'required' => $approvalRequired,
                'reasons' => $approvalReasons,
            ],
        ];

        if ($canViewValue) {
            $report['totals'] += [
                'short_value' => Decimal::moneyString($totals['short_value']),
                'over_value' => Decimal::moneyString($totals['over_value']),
                'abs_value' => Decimal::moneyString($totals['abs_value']),
            ];
        }

        if ($canViewValue) {
            $report['approval']['thresholds'] = [
                'per_product' => $thresholds['per_product_threshold'],
                'per_session' => $thresholds['per_session_threshold'],
            ];
        }

        return $report;
    }

    /**
     * @param  array<int, array{counted_products: int, variance_count: int, short_qty: int, over_qty: int, lines: list<array<string, mixed>>}>  $counts
     * @return list<array<string, mixed>>
     */
    private function categoryTree(int $storeId, array $counts): array
    {
        $categories = DB::table('categories')->where('store_id', $storeId)->get(['id', 'parent_id', 'name']);
        $byId = $categories->keyBy('id');
        foreach (array_keys($counts) as $categoryId) {
            if ($categoryId !== 0 && ! isset($byId[$categoryId])) {
                $counts[0] ??= ['counted_products' => 0, 'variance_count' => 0, 'short_qty' => 0, 'over_qty' => 0, 'lines' => []];
                $counts[0]['counted_products'] += $counts[$categoryId]['counted_products'];
                $counts[0]['variance_count'] += $counts[$categoryId]['variance_count'];
                $counts[0]['short_qty'] += $counts[$categoryId]['short_qty'];
                $counts[0]['over_qty'] += $counts[$categoryId]['over_qty'];
                array_push($counts[0]['lines'], ...$counts[$categoryId]['lines']);
                unset($counts[$categoryId]);
            }
        }
        $included = [];
        foreach (array_keys($counts) as $categoryId) {
            if ($categoryId === 0 || ! isset($byId[$categoryId])) {
                continue;
            }
            $current = $byId[$categoryId];
            while ($current !== null && ! isset($included[(int) $current->id])) {
                $included[(int) $current->id] = $current;
                $current = $current->parent_id === null ? null : ($byId[(int) $current->parent_id] ?? null);
            }
        }

        $children = [];
        foreach ($included as $categoryId => $category) {
            $parentId = $category->parent_id !== null && isset($included[(int) $category->parent_id])
                ? (int) $category->parent_id
                : 0;
            $children[$parentId][] = $categoryId;
        }
        foreach ($children as &$ids) {
            usort($ids, fn (int $a, int $b) => strcasecmp($included[$a]->name, $included[$b]->name));
        }
        unset($ids);

        $build = function (int $parentId) use (&$build, $children, $included, $counts): array {
            $nodes = [];
            foreach ($children[$parentId] ?? [] as $categoryId) {
                $node = $this->makeNode(
                    (int) $categoryId,
                    (string) $included[$categoryId]->name,
                    $counts[$categoryId] ?? ['counted_products' => 0, 'variance_count' => 0, 'short_qty' => 0, 'over_qty' => 0, 'lines' => []],
                    $build($categoryId),
                );
                $nodes[] = $node;
            }

            return $nodes;
        };
        $nodes = $build(0);
        if (isset($counts[0])) {
            $nodes[] = $this->makeNode(0, 'Lainnya', $counts[0], []);
        }

        return $nodes;
    }

    /** @param array{counted_products: int, variance_count: int, short_qty: int, over_qty: int, lines: list<array<string, mixed>>} $counts
     * @param  list<array<string, mixed>>  $children
     * @return array<string, mixed>
     */
    private function makeNode(int $id, string $name, array $counts, array $children): array
    {
        $node = [
            'id' => $id,
            'name' => $name,
            'products_counted' => $counts['counted_products'] + array_sum(array_column($children, 'products_counted')),
            'variance_count' => $counts['variance_count'] + array_sum(array_column($children, 'variance_count')),
            'short_qty' => Decimal::qtyString($counts['short_qty'] + array_sum(array_map(fn ($node) => Decimal::qty($node['short_qty']), $children))),
            'over_qty' => Decimal::qtyString($counts['over_qty'] + array_sum(array_map(fn ($node) => Decimal::qty($node['over_qty']), $children))),
            'lines' => $counts['lines'],
            'children' => $children,
        ];

        return $node;
    }
}
