<?php

namespace Tests\Concerns;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;

trait CreatesUsers
{
    /**
     * Membuat pengguna dengan role sistem ('Admin' atau 'Kasir') di toko seed.
     * Role dan toko berasal dari DatabaseSeeder.
     */
    protected function makeUser(
        string $role,
        string $username,
        string $password = 'rahasia-12345',
        bool $active = true,
    ): User {
        $user = User::create([
            'name' => ucfirst($username),
            'username' => $username,
            'password_hash' => Hash::make($password),
            'is_active' => $active,
        ]);

        DB::table('user_roles')->insert([
            'user_id' => $user->id,
            'role_id' => DB::table('roles')->where('name', $role)->value('id'),
            'store_id' => DB::table('stores')->value('id'),
        ]);

        return $user;
    }

    /** Membuat pengguna lalu mengautentikasinya untuk request berikutnya (Sanctum). */
    protected function signIn(string $role, ?string $username = null): User
    {
        $user = $this->makeUser($role, $username ?? strtolower($role).'-uji');

        Sanctum::actingAs($user, ['*']);

        return $user;
    }
}
