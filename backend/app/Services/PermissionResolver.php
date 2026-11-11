<?php

namespace App\Services;

use App\Models\User;
use App\Support\StockAuthorityPolicy;
use Illuminate\Support\Facades\DB;

/**
 * Permission efektif = permission dari role (per toko) + override `allow` - override `deny`.
 * Permission stok (StockAuthorityPolicy::controlledPermissions) TIDAK diambil dari role_permissions, melainkan dari
 * matriks kewenangan stok toko (settings.stock_authority atau default menurut model administrasi).
 * Hasil di-cache per instance (per request).
 */
class PermissionResolver
{
    /** @var array<string, list<string>> */
    private array $cache = [];

    public function __construct(private StoreContext $stores) {}

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

        foreach (StockAuthorityPolicy::controlledPermissions() as $code) {
            unset($set[$code]);
        }
        $roleNames = StockAuthorityPolicy::roleNames($userId, $storeId);
        foreach (StockAuthorityPolicy::permissionsFor($storeId, $roleNames) as $code) {
            $set[$code] = true;
        }

        $overrides = DB::table('user_permissions as up')
            ->join('permissions as p', 'p.id', '=', 'up.permission_id')
            ->where('up.user_id', $userId)
            ->where('up.store_id', $storeId)
            ->get(['p.code', 'up.effect']);

        $simpleAdmin = in_array('Admin', $roleNames, true)
            && DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'admin_model')->value('setting_value') !== json_encode('standard');
        $ownerOrAccounting = array_intersect($roleNames, ['Owner', 'Accounting']) !== [];
        if (in_array('Admin', $roleNames, true) && ! $ownerOrAccounting && ! $simpleAdmin) {
            unset($set['opname.approve'], $set['opname.view_value']);
        }
        foreach ($overrides as $override) {
            if ($override->effect === 'deny') {
                unset($set[$override->code]);
            } else {
                if (! (in_array('Admin', $roleNames, true)
                    && ! $ownerOrAccounting
                    && ! $simpleAdmin
                    && in_array($override->code, ['opname.approve', 'opname.view_value'], true))) {
                    $set[$override->code] = true;
                }
            }
        }

        $codes = array_keys($set);
        sort($codes);

        return $codes;
    }
}
