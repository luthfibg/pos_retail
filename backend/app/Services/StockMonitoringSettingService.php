<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use Illuminate\Support\Facades\DB;

class StockMonitoringSettingService
{
    private const SETTING_KEY = 'inventory_low_stock_threshold';

    public function __construct(
        private AuditLogger $audit,
        private PurchaseRequisitionService $requisitions,
    ) {}

    /** @return array{low_stock_threshold: string} */
    public function get(int $storeId): array
    {
        $value = DB::table('settings')
            ->where('store_id', $storeId)
            ->where('setting_key', self::SETTING_KEY)
            ->value('setting_value');

        return [
            'low_stock_threshold' => $value === null
                ? '3.000'
                : Decimal::qtyString(Decimal::qty((string) json_decode((string) $value, true))),
        ];
    }

    /**
     * @param  array{low_stock_threshold: string|int|float}  $data
     * @return array{low_stock_threshold: string}
     */
    public function update(User $actor, int $storeId, array $data): array
    {
        $threshold = Decimal::qtyString(Decimal::qty((string) $data['low_stock_threshold']));

        return DB::transaction(function () use ($actor, $storeId, $threshold) {
            $before = $this->get($storeId);

            DB::table('settings')->upsert(
                [[
                    'store_id' => $storeId,
                    'setting_key' => self::SETTING_KEY,
                    'setting_value' => json_encode($threshold),
                    'updated_by' => $actor->id,
                ]],
                ['store_id', 'setting_key'],
                ['setting_value', 'updated_by'],
            );

            $after = $this->get($storeId);
            if ($before !== $after) {
                $this->requisitions->synchronizeAutomatic($actor, $storeId);
                $this->audit->log(
                    'settings.stock_monitoring',
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
}
