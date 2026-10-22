<?php

namespace Database\Seeders;

use App\Support\PermissionCatalog;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Permission + role sistem (Admin, Kasir). Idempotent: hanya menambah yang belum ada,
 * tidak mencabut permission yang sudah diubah manual pada role.
 */
class PermissionSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [];
        foreach (PermissionCatalog::all() as $code => $description) {
            $rows[] = ['code' => $code, 'module' => PermissionCatalog::module($code), 'description' => $description];
        }
        DB::table('permissions')->upsert($rows, ['code'], ['module', 'description']);

        $roles = [
            'Admin' => ['description' => 'Admin/Owner: seluruh fungsi bisnis', 'codes' => array_keys(PermissionCatalog::all())],
            'Kasir' => ['description' => 'Operasional toko', 'codes' => PermissionCatalog::cashier()],
        ];

        foreach ($roles as $name => $role) {
            DB::table('roles')->upsert(
                [['name' => $name, 'description' => $role['description'], 'is_system' => 1]],
                ['name'],
                ['description', 'is_system'],
            );

            $roleId = (int) DB::table('roles')->where('name', $name)->value('id');
            $permissionIds = DB::table('permissions')->whereIn('code', $role['codes'])->pluck('id');

            foreach ($permissionIds as $permissionId) {
                DB::table('role_permissions')->insertOrIgnore(['role_id' => $roleId, 'permission_id' => $permissionId]);
            }
        }
    }
}
