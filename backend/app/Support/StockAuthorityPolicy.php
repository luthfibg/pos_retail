<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Matriks kewenangan stok per toko: role mana yang boleh melakukan operasi stok tertentu.
 *
 * Disimpan di settings.stock_authority sebagai {kunci_aturan: [nama role]} HANYA untuk aturan yang diubah; aturan yang tidak
 * disetel memakai default menurut model administrasi toko (simple/standard). Tidak bergantung pada ada/tidaknya Gudang.
 *
 * Mekanisme: PermissionResolver menurunkan permission stok (goods_receipt.create, supplier_return.create, stock_transfer.create,
 * inventory.adjust.approve, inventory.opening_balance) DARI MATRIKS ini, bukan dari role_permissions,
 * sehingga middleware `can:` yang ada dan menu frontend (dari permissions di /api/auth/me) otomatis mengikuti. Penerimaan,
 * retur, dan transfer punya lingkup lokasi (toko/gudang); lingkup diperiksa lagi di service lewat assertScope().
 * Kelas ini sengaja tanpa dependensi container (hanya DB) agar aman dipakai PermissionResolver.
 */
final class StockAuthorityPolicy
{
    public const SETTING_KEY = 'stock_authority';

    /** @var array<string, array{action: string, scope: ?string, permission: string, label: string, description: string}> */
    public const RULES = [
        'opening_balance' => ['action' => 'opening_balance', 'scope' => null, 'permission' => 'inventory.opening_balance',
            'label' => 'Input stok awal', 'description' => 'Memasukkan saldo stok awal (cut-over) per produk dan batch.'],
        'receipt.store_floor' => ['action' => 'receipt', 'scope' => 'store_floor', 'permission' => 'goods_receipt.create',
            'label' => 'Penerimaan barang ke toko', 'description' => 'Mencatat, memposting, dan membatalkan penerimaan barang dari PO ke lokasi toko.'],
        'receipt.warehouse' => ['action' => 'receipt', 'scope' => 'warehouse', 'permission' => 'goods_receipt.create',
            'label' => 'Penerimaan barang ke gudang', 'description' => 'Penerimaan barang dari PO ke lokasi gudang (berlaku bila Gudang diaktifkan).'],
        'supplier_return.store_floor' => ['action' => 'supplier_return', 'scope' => 'store_floor', 'permission' => 'supplier_return.create',
            'label' => 'Retur supplier dari toko', 'description' => 'Mengajukan retur barang dan mencatat keputusan supplier dari lokasi toko.'],
        'supplier_return.warehouse' => ['action' => 'supplier_return', 'scope' => 'warehouse', 'permission' => 'supplier_return.create',
            'label' => 'Retur supplier dari gudang', 'description' => 'Mengajukan retur barang dan mencatat keputusan supplier dari gudang.'],
        'transfer.store_floor' => ['action' => 'transfer', 'scope' => 'store_floor', 'permission' => 'stock_transfer.create',
            'label' => 'Transfer/putaway di toko', 'description' => 'Memindahkan stok antar posisi rak di toko.'],
        'transfer.warehouse' => ['action' => 'transfer', 'scope' => 'warehouse', 'permission' => 'stock_transfer.create',
            'label' => 'Transfer/putaway dari/ke gudang', 'description' => 'Memindahkan stok yang melibatkan gudang (asal atau tujuan).'],
        'adjustment_approve' => ['action' => 'adjustment_approve', 'scope' => null, 'permission' => 'inventory.adjust.approve',
            'label' => 'Setujui write-off retur supplier', 'description' => 'Menyetujui pencatatan barang retur supplier yang ditolak dan dihapus dari stok.'],
    ];

    private const ACTION_LABELS = [
        'receipt' => 'menerima barang',
        'supplier_return' => 'mengajukan retur supplier',
        'transfer' => 'memindahkan stok',
    ];

    /** @return list<string> permission yang dikendalikan matriks (bukan role_permissions) */
    public static function controlledPermissions(): array
    {
        return array_values(array_unique(array_column(self::RULES, 'permission')));
    }

    public static function model(int $storeId): string
    {
        $raw = DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'admin_model')->value('setting_value');

        return $raw !== null && json_decode((string) $raw, true) === 'standard' ? 'standard' : 'simple';
    }

    /** @return array<string, list<string>> kunci aturan => role (default menurut model) */
    public static function defaults(string $model): array
    {
        $byAction = $model === 'standard'
            ? ['opening_balance' => ['Owner'], 'receipt' => ['Kasir'], 'supplier_return' => ['Kasir'], 'transfer' => ['Kasir'], 'adjustment_approve' => ['Owner']]
            : ['opening_balance' => ['Admin'], 'receipt' => ['Admin', 'Kasir'], 'supplier_return' => ['Admin', 'Kasir'], 'transfer' => ['Admin', 'Kasir'], 'adjustment_approve' => ['Admin']];

        $out = [];
        foreach (self::RULES as $key => $rule) {
            $out[$key] = $byAction[$rule['action']];
        }

        return $out;
    }

    /** @return array<string, list<string>> hanya aturan yang disetel (valid) */
    public static function stored(int $storeId): array
    {
        $raw = DB::table('settings')->where('store_id', $storeId)->where('setting_key', self::SETTING_KEY)->value('setting_value');
        $data = $raw === null ? null : json_decode((string) $raw, true);
        $out = [];

        if (is_array($data)) {
            foreach ($data as $key => $roles) {
                if (isset(self::RULES[$key]) && is_array($roles) && $roles !== []) {
                    $out[$key] = array_values(array_unique(array_filter($roles, 'is_string')));
                }
            }
        }

        return $out;
    }

    /** @return array<string, list<string>> aturan berlaku: default ditimpa yang disetel */
    public static function rules(int $storeId): array
    {
        return array_replace(self::defaults(self::model($storeId)), self::stored($storeId));
    }

    /** @return list<string> */
    public static function roleNames(int $userId, int $storeId): array
    {
        return DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('ur.user_id', $userId)->where('ur.store_id', $storeId)->pluck('r.name')->all();
    }

    /**
     * Permission stok yang diberikan matriks kepada pemegang role tersebut (lingkup mana pun).
     *
     * @param  list<string>  $roleNames
     * @return list<string>
     */
    public static function permissionsFor(int $storeId, array $roleNames): array
    {
        $granted = [];

        foreach (self::rules($storeId) as $key => $roles) {
            if (array_intersect($roles, $roleNames) !== []) {
                $granted[self::RULES[$key]['permission']] = true;
            }
        }

        return array_keys($granted);
    }

    /** Boleh pada satu aturan: role ada dalam daftar, atau pengguna punya override `allow` eksplisit untuk permission-nya. */
    public static function allowsRule(int $userId, int $storeId, string $key): bool
    {
        if (! isset(self::RULES[$key])) {
            return false;
        }

        if (array_intersect(self::rules($storeId)[$key], self::roleNames($userId, $storeId)) !== []) {
            return true;
        }

        return DB::table('user_permissions as up')->join('permissions as p', 'p.id', '=', 'up.permission_id')
            ->where('up.user_id', $userId)->where('up.store_id', $storeId)->where('up.effect', 'allow')
            ->where('p.code', self::RULES[$key]['permission'])->exists();
    }

    /**
     * Peta kunci aturan => boleh/tidak untuk satu pengguna (untuk /api/auth/me).
     *
     * @return array<string, bool>
     */
    public static function userMap(User $user, int $storeId): array
    {
        $out = [];
        foreach (array_keys(self::RULES) as $key) {
            $out[$key] = $user->is_active && self::allowsRule($user->id, $storeId, $key);
        }

        return $out;
    }

    /** Pemeriksaan lingkup lokasi di service: 403 bila pengguna tidak berwenang untuk jenis lokasi (toko/gudang) itu. */
    public static function assertScope(User $user, int $storeId, string $action, int $locationId): void
    {
        $type = DB::table('locations')->where('store_id', $storeId)->where('id', $locationId)->value('type');

        if ($type === null) {
            return; // lokasi tidak valid ditolak oleh validasi masing-masing service
        }

        $scope = $type === 'warehouse' ? 'warehouse' : 'store_floor';

        abort_unless(
            self::allowsRule($user->id, $storeId, "{$action}.{$scope}"),
            403,
            'Anda tidak berwenang '.self::ACTION_LABELS[$action].' pada lokasi '.($scope === 'warehouse' ? 'Gudang' : 'Toko').'.',
        );
    }

    /**
     * Ganti nama role pada aturan yang disetel (dipakai saat peralihan model Admin <-> Owner).
     *
     * @return bool apakah ada yang berubah
     */
    public static function remapRole(int $storeId, string $from, string $to, ?int $actorId = null): bool
    {
        $stored = self::stored($storeId);
        $changed = false;

        foreach ($stored as $key => $roles) {
            if (in_array($from, $roles, true)) {
                $roles = array_map(fn ($r) => $r === $from ? $to : $r, $roles);
                $stored[$key] = array_values(array_unique($roles));
                $changed = true;
            }
        }

        if ($changed) {
            self::save($storeId, $stored, $actorId);
        }

        return $changed;
    }

    /** @param array<string, list<string>> $stored */
    public static function save(int $storeId, array $stored, ?int $actorId): void
    {
        DB::table('settings')->updateOrInsert(
            ['store_id' => $storeId, 'setting_key' => self::SETTING_KEY],
            ['setting_value' => json_encode((object) $stored), 'updated_by' => $actorId],
        );
    }
}
