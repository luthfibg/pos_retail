<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Permission efektif = permission dari role (per toko) + override `allow` - override `deny`.
 * Hasil di-cache per instance (per request).
 */
class PermissionResolver
{
    /** @var array<string, list<string>> */
    private array $cache = [];

    public function __construct(private StoreContext $stores)
    {
    }

    /** @return list<string> */
    public function codes(User $user, ?int $storeId = null): array
    {
        if (! $user->is_active) {
            return [];
        }

        $storeId ??= $this->stores->idFor($user);

        if ($storeId === null) {
            return [];
        }

        return $this->cache[$user->id.':'.$storeId] ??= $this->load($user->id, $storeId);
    }

    public function allows(User $user, string $code, ?int $storeId = null): bool
    {
        return in_array($code, $this->codes($user, $storeId), true);
    }

    public function flush(): void
    {
        $this->cache = [];
        $this->stores->flush();
    }

    /** @return list<string> */
    private function load(int $userId, int $storeId): array
    {
        $granted = DB::table('user_roles as ur')
            ->join('role_permissions as rp', 'rp.role_id', '=', 'ur.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('ur.user_id', $userId)
            ->where('ur.store_id', $storeId)
            ->pluck('p.code')
            ->unique()
            ->all();

        $set = array_fill_keys($granted, true);

        $overrides = DB::table('user_permissions as up')
            ->join('permissions as p', 'p.id', '=', 'up.permission_id')
            ->where('up.user_id', $userId)
            ->where('up.store_id', $storeId)
            ->get(['p.code', 'up.effect']);

        foreach ($overrides as $override) {
            if ($override->effect === 'deny') {
                unset($set[$override->code]);
            } else {
                $set[$override->code] = true;
            }
        }

        $codes = array_keys($set);
        sort($codes);

        return $codes;
    }
}
