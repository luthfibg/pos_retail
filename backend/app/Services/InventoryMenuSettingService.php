<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class InventoryMenuSettingService
{
    private const DEFAULTS = [
        'show_opening_balance' => false,
        'show_stock_transfer' => false,
    ];

    public function __construct(private AuditLogger $audit) {}

    /** @return array{show_opening_balance: bool, show_stock_transfer: bool} */
    public function get(int $storeId): array
    {
        $values = DB::table('settings')
            ->where('store_id', $storeId)
            ->whereIn('setting_key', array_keys(self::DEFAULTS))
            ->pluck('setting_value', 'setting_key');

        return [
            'show_opening_balance' => $this->decode($values['show_opening_balance'] ?? null, self::DEFAULTS['show_opening_balance']),
            'show_stock_transfer' => $this->decode($values['show_stock_transfer'] ?? null, self::DEFAULTS['show_stock_transfer']),
        ];
    }

    /**
     * @param  array{show_opening_balance: bool, show_stock_transfer: bool}  $data
     * @return array{show_opening_balance: bool, show_stock_transfer: bool}
     */
    public function update(User $actor, int $storeId, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $data) {
            $before = $this->get($storeId);
            $rows = [];
            foreach ($data as $key => $value) {
                $rows[] = [
                    'store_id' => $storeId,
                    'setting_key' => $key,
                    'setting_value' => json_encode((bool) $value),
                    'updated_by' => $actor->id,
                ];
            }
            DB::table('settings')->upsert(
                $rows,
                ['store_id', 'setting_key'],
                ['setting_value', 'updated_by'],
            );
            $after = $this->get($storeId);
            if ($before !== $after) {
                $this->audit->log(
                    'settings.inventory_menus',
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

    private function decode(?string $value, bool $default): bool
    {
        return $value === null ? $default : (bool) json_decode($value, true);
    }
}
