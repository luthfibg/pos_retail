<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class StoreNameSettingService
{
    public function __construct(private AuditLogger $audit) {}

    /** @return array{name: string} */
    public function update(User $actor, int $storeId, string $name): array
    {
        return DB::transaction(function () use ($actor, $storeId, $name) {
            $store = DB::table('stores')->where('id', $storeId)->lockForUpdate()->first(['name']);
            abort_if($store === null, 404, 'Toko tidak ditemukan.');

            if ($store->name !== $name) {
                DB::table('stores')->where('id', $storeId)->update(['name' => $name]);
                $this->audit->log(
                    'settings.store_name',
                    'store',
                    $storeId,
                    before: ['name' => $store->name],
                    after: ['name' => $name],
                    storeId: $storeId,
                    actorId: $actor->id,
                );
            }

            return ['name' => $name];
        });
    }
}
