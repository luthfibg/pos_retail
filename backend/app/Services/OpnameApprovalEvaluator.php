<?php

namespace App\Services;

use App\Support\Decimal;
use Illuminate\Support\Facades\DB;

class OpnameApprovalEvaluator
{
    /**
     * @param  array<int, object>  $items
     * @param  array{item_values: array<int, array{diff_qty: string, cost: ?string, value: ?int, revisions: int}>, totals: array<string, mixed>}  $snapshot
     * @param  array{per_product_threshold: int, per_session_threshold: int, require_first_opname: bool}  $thresholds
     * @return list<array<string, mixed>>
     */
    public function evaluate(int $storeId, array $items, array $snapshot, array $thresholds): array
    {
        $reasons = [];
        foreach ($items as $item) {
            $value = $snapshot['item_values'][(int) $item->id];
            if (Decimal::qty($value['diff_qty']) === 0) {
                continue;
            }
            if ($value['cost'] === null) {
                $reasons[] = [
                    'type' => 'cost_missing',
                    'product_id' => (int) $item->product_id,
                    'product_name' => $item->product_name_snapshot,
                ];
            } elseif ($value['value'] !== null && $value['value'] >= $thresholds['per_product_threshold'] * 100) {
                $reasons[] = [
                    'type' => 'per_product_threshold',
                    'product_id' => (int) $item->product_id,
                    'product_name' => $item->product_name_snapshot,
                ];
            }
        }
        if (Decimal::money((string) $snapshot['totals']['abs_value']) >= $thresholds['per_session_threshold'] * 100
            && Decimal::money((string) $snapshot['totals']['abs_value']) > 0) {
            $reasons[] = ['type' => 'per_session_threshold'];
        }
        if ($thresholds['require_first_opname'] && ! DB::table('stock_opname_sessions')
            ->where('store_id', $storeId)->where('status', 'posted')->exists()) {
            $reasons[] = ['type' => 'first_opname'];
        }

        return $reasons;
    }
}
