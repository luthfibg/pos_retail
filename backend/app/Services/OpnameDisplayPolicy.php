<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class OpnameDisplayPolicy
{
    private const SETTING_KEY = 'opname.show_system_qty';

    public function __construct(private AuditLogger $audit) {}

    public function revealsSystemQty(int $storeId): bool
    {
        $value = DB::table('settings')
            ->where('store_id', $storeId)
            ->where('setting_key', self::SETTING_KEY)
            ->value('setting_value');

        return $value === null ? false : json_decode((string) $value, true) === true;
    }

    /** @return array{show_system_qty: bool} */
    public function get(int $storeId): array
    {
        return ['show_system_qty' => $this->revealsSystemQty($storeId)];
    }

    /** @return array{show_system_qty: bool} */
    public function update(User $actor, int $storeId, bool $showSystemQty): array
    {
        return DB::transaction(function () use ($actor, $storeId, $showSystemQty) {
            $before = $this->get($storeId);
            DB::table('settings')->upsert(
                [[
                    'store_id' => $storeId,
                    'setting_key' => self::SETTING_KEY,
                    'setting_value' => json_encode($showSystemQty),
                    'updated_by' => $actor->id,
                ]],
                ['store_id', 'setting_key'],
                ['setting_value', 'updated_by'],
            );
            $after = $this->get($storeId);
            if ($before !== $after) {
                $this->audit->log(
                    'settings.opname_display',
                    'setting',
                    null,
                    before: $before,
                    after: $after,
                    storeId: $storeId,
                    actorId: $actor->id,
                );
            }

            return $after;
        });
    }

    /** @param object|array<string, mixed> $item */
    public function itemStatus(object|array $item, bool $revealsSystemQty): string
    {
        $countedQty = is_array($item) ? $item['counted_qty'] : $item->counted_qty;
        if ($countedQty === null) {
            return 'uncounted';
        }
        if (! $revealsSystemQty) {
            return 'counted';
        }

        $systemQty = is_array($item)
            ? ($item['system_qty_at_count'] ?? $item['system_qty_at_start'] ?? '0.000')
            : ($item->system_qty_at_count ?? $item->system_qty_at_start);

        return (string) $countedQty === (string) $systemQty ? 'matched' : 'variance';
    }
}
