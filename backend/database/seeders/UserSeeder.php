<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Akun awal. Tidak pernah menimpa akun yang sudah ada.
 * Jika password tidak diisi di .env, dibuat acak dan ditampilkan SEKALI di console.
 */
class UserSeeder extends Seeder
{
    public function run(): void
    {
        $storeId = (int) DB::table('stores')->where('code', config('pos.default_store_code'))->value('id');

        $this->ensureUser(
            $storeId,
            'Admin',
            (string) config('pos.seed.admin_username'),
            'Administrator',
            config('pos.seed.admin_password'),
        );

        $cashier = config('pos.seed.cashier_username');
        if (is_string($cashier) && $cashier !== '') {
            $this->ensureUser($storeId, 'Kasir', $cashier, 'Kasir 1', config('pos.seed.cashier_password'));
        }
    }

    private function ensureUser(int $storeId, string $role, string $username, string $name, ?string $password): void
    {
        $userId = DB::table('users')->where('username', $username)->value('id');

        if ($userId === null) {
            $generated = $password === null || $password === '';
            $plain = $generated ? Str::password(16, symbols: false) : $password;

            $userId = DB::table('users')->insertGetId([
                'name' => $name,
                'username' => $username,
                'password_hash' => Hash::make($plain),
                'is_active' => 1,
            ]);

            if ($generated) {
                $this->command?->warn("Password awal untuk '{$username}': {$plain}  (catat sekarang, tidak ditampilkan lagi)");
            }
        }

        $roleId = (int) DB::table('roles')->where('name', $role)->value('id');

        DB::table('user_roles')->insertOrIgnore([
            'user_id' => $userId,
            'role_id' => $roleId,
            'store_id' => $storeId,
        ]);
    }
}
