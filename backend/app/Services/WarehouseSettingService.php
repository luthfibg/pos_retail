<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class WarehouseSettingService
{
    public function __construct(private AuditLogger $audit) {}

    /**
     * @return array{enabled: bool, locations: list<array{id: int, name: string, is_active: bool}>}
     */
    public function get(int $storeId): array
    {
        $value = DB::table('settings')
            ->where('store_id', $storeId)
            ->where('setting_key', 'warehouse_enabled')
            ->value('setting_value');
        $locations = DB::table('locations')
            ->where('store_id', $storeId)
            ->where('type', 'warehouse')
            ->orderBy('id')
            ->get(['id', 'name', 'is_active']);

        return [
            'enabled' => $value !== null && json_decode((string) $value, true) === true,
            'locations' => $locations->map(fn ($location) => [
                'id' => (int) $location->id,
                'name' => $location->name,
                'is_active' => (bool) $location->is_active,
            ])->all(),
        ];
    }

    /**
     * @param  array{enabled: bool}  $data
     * @return array{enabled: bool, locations: list<array{id: int, name: string, is_active: bool}>}
     */
    public function update(User $actor, int $storeId, array $data): array
    {
        $enabled = (bool) $data['enabled'];

        return DB::transaction(function () use ($actor, $storeId, $enabled) {
            $before = $this->get($storeId);
            $locations = DB::table('locations')
                ->where('store_id', $storeId)
                ->where('type', 'warehouse')
                ->orderBy('id')
                ->lockForUpdate()
                ->get(['id']);

            if ($enabled && $locations->isEmpty()) {
                throw ValidationException::withMessages([
                    'enabled' => ['Lokasi Gudang belum tersedia untuk toko ini. Hubungi administrator sistem.'],
                ]);
            }

            DB::table('settings')->upsert(
                [[
                    'store_id' => $storeId,
                    'setting_key' => 'warehouse_enabled',
                    'setting_value' => json_encode($enabled),
                    'updated_by' => $actor->id,
                ]],
                ['store_id', 'setting_key'],
                ['setting_value', 'updated_by'],
            );

            if ($locations->isNotEmpty()) {
                DB::table('locations')
                    ->whereIn('id', $locations->pluck('id'))
                    ->update(['is_active' => $enabled]);
            }

            $after = $this->get($storeId);
            if ($before !== $after) {
                $this->audit->log(
                    'settings.warehouse',
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
