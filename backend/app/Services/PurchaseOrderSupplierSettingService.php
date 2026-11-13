<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class PurchaseOrderSupplierSettingService
{
    private const SETTING_KEY = 'purchase_order_supplier_selection';

    public function __construct(private AuditLogger $audit) {}

    /** @return array{mode: 'manual'|'product'} */
    public function get(int $storeId): array
    {
        $value = DB::table('settings')
            ->where('store_id', $storeId)
            ->where('setting_key', self::SETTING_KEY)
            ->value('setting_value');
        $mode = $value === null ? 'manual' : json_decode((string) $value, true);

        return ['mode' => $mode === 'product' ? 'product' : 'manual'];
    }

    /** @return array{mode: 'manual'|'product'} */
    public function update(User $actor, int $storeId, string $mode): array
    {
        return DB::transaction(function () use ($actor, $storeId, $mode) {
            $before = $this->get($storeId);
            DB::table('settings')->upsert(
                [[
                    'store_id' => $storeId,
                    'setting_key' => self::SETTING_KEY,
                    'setting_value' => json_encode($mode, JSON_THROW_ON_ERROR),
                    'updated_by' => $actor->id,
                ]],
                ['store_id', 'setting_key'],
                ['setting_value', 'updated_by'],
            );

            $after = $this->get($storeId);
            if ($before !== $after) {
                $this->audit->log(
                    'settings.purchase_order_supplier_selection',
                    'setting',
                    null,
                    before: $before,
                    after: $after,
                    actorId: $actor->id,
                    storeId: $storeId,
                );
            }

            return $after;
        });
    }
}
