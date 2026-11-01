<?php

namespace App\Services;

use App\Models\User;
use App\Support\StockAuthorityPolicy as Policy;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Konfigurasi matriks kewenangan stok per toko (settings.manage). Lihat StockAuthorityPolicy untuk mekanisme.
 *  - 8 aturan: stok awal, penerimaan (toko/gudang), transfer (toko/gudang), ajuan adjustment (toko/gudang), persetujuan adjustment
 *  - tiap aturan minimal satu role, dan role harus tersedia pada model administrasi toko (mis. Owner tidak pada model simple)
 *  - tidak bergantung pada warehouse_enabled: aturan gudang tetap dapat disetel saat Gudang nonaktif (baru berlaku saat aktif)
 *  - `roles: null` mengembalikan aturan ke default menurut model; perubahan dicatat di audit
 *  - tidak ada penghalang keras bila belum ada pengguna aktif pada role terpilih; hanya `warnings` (jangan sampai terkunci tanpa sadar)
 */
class StockAuthorityService
{
    public function __construct(
        private AuditLogger $audit,
        private AdminModelService $adminModel,
        private PermissionResolver $permissions,
    ) {
    }

    /** @return array<string, mixed> */
    public function get(int $storeId): array
    {
        $model = Policy::model($storeId);
        $defaults = Policy::defaults($model);
        $stored = Policy::stored($storeId);
        $effective = array_replace($defaults, $stored);
        $warehouseEnabled = $this->warehouseEnabled($storeId);

        $rules = [];
        foreach (Policy::RULES as $key => $rule) {
            $roles = $effective[$key];
            $active = $this->activeUsers($storeId, $roles);
            $warnings = [];

            if ($active === 0) {
                $warnings[] = ['code' => 'no_active_user', 'message' => 'Belum ada pengguna aktif pada role terpilih; operasi ini tidak dapat dilakukan siapa pun.'];
            }

            $rules[] = [
                'key' => $key,
                'action' => $rule['action'],
                'scope' => $rule['scope'],
                'permission' => $rule['permission'],
                'label' => $rule['label'],
                'description' => $rule['description'],
                'roles' => $roles,
                'default_roles' => $defaults[$key],
                'customized' => array_key_exists($key, $stored) && $stored[$key] !== $defaults[$key],
                'active_users' => $active,
                'applies' => $rule['scope'] !== 'warehouse' || $warehouseEnabled,
                'warnings' => $warnings,
            ];
        }

        return [
            'admin_model' => $model,
            'warehouse_enabled' => $warehouseEnabled,
            'assignable_roles' => $this->adminModel->assignableRoles($model),
            'rules' => $rules,
        ];
    }

    /**
     * @param  list<array{key: string, roles: list<string>|null}>  $changes
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, array $changes): array
    {
        DB::transaction(function () use ($actor, $storeId, $changes) {
            DB::table('stores')->where('id', $storeId)->lockForUpdate()->first();

            $model = Policy::model($storeId);
            $assignable = $this->adminModel->assignableRoles($model);
            $defaults = Policy::defaults($model);
            $before = Policy::stored($storeId);
            $stored = $before;
            $errors = [];
            $seen = [];

            foreach ($changes as $i => $change) {
                $key = (string) $change['key'];

                if (isset($seen[$key])) {
                    $errors["rules.{$i}.key"] = ['Aturan ini muncul lebih dari sekali.'];

                    continue;
                }
                $seen[$key] = true;

                if (! isset(Policy::RULES[$key])) {
                    $errors["rules.{$i}.key"] = ['Aturan tidak dikenal.'];

                    continue;
                }

                $roles = $change['roles'] ?? null;

                if ($roles === null) {
                    unset($stored[$key]);

                    continue;
                }

                $roles = array_values(array_unique(array_map('strval', $roles)));

                if ($roles === []) {
                    $errors["rules.{$i}.roles"] = ['Pilih minimal satu role.'];

                    continue;
                }

                $invalid = array_values(array_diff($roles, $assignable));
                if ($invalid !== []) {
                    $errors["rules.{$i}.roles"] = ['Role tidak tersedia pada model administrasi toko ini: '.implode(', ', $invalid).'.'];

                    continue;
                }

                if ($roles === $defaults[$key]) {
                    unset($stored[$key]);   // sama dengan default: tidak perlu disimpan
                } else {
                    $stored[$key] = $roles;
                }
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            if ($stored === $before) {
                return;
            }

            Policy::save($storeId, $stored, $actor->id);
            $this->permissions->flush();

            $this->audit->log('settings.stock_authority', 'setting', null,
                before: array_replace(array_fill_keys(array_keys($stored + $before), null), $before),
                after: array_replace(array_fill_keys(array_keys($stored + $before), null), $stored),
                storeId: $storeId, actorId: $actor->id);
        });

        return $this->get($storeId);
    }

    /** @param list<string> $roles */
    private function activeUsers(int $storeId, array $roles): int
    {
        return (int) DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->join('users as u', 'u.id', '=', 'ur.user_id')
            ->where('ur.store_id', $storeId)->whereIn('r.name', $roles)->where('u.is_active', 1)->distinct()->count('u.id');
    }

    private function warehouseEnabled(int $storeId): bool
    {
        $raw = DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'warehouse_enabled')->value('setting_value');

        return $raw !== null && json_decode((string) $raw, true) === true;
    }
}
