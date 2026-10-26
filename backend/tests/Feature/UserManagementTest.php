<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\PermissionResolver;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class UserManagementTest extends SeededTestCase
{
    private function create(array $o = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/users', $o + ['name' => 'Sari Kasir', 'username' => 'sari', 'password' => 'sandi-kasir-1', 'role' => 'Kasir']);
    }

    private function login(string $u, string $p): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/auth/login', ['username' => $u, 'password' => $p]);
    }

    public function test_admin_creates_cashier_who_can_login_with_cashier_role(): void
    {
        $admin = $this->signIn('Admin');

        $r = $this->create(['email' => 'sari@toko.test'])->assertCreated()
            ->assertJsonPath('data.username', 'sari')->assertJsonPath('data.roles.0', 'Kasir')->assertJsonPath('data.is_active', true);
        $this->assertArrayNotHasKey('password_hash', $r->json('data'));
        $id = $r->json('data.id');

        $audit = DB::table('audit_logs')->where('action', 'user.create')->where('entity_id', $id)->first();
        $this->assertSame($admin->id, (int) $audit->actor_id);
        $this->assertStringNotContainsString('sandi-kasir-1', (string) $audit->after_json);
        $this->assertStringNotContainsString('hash', (string) $audit->after_json);

        $token = $this->login('sari', 'sandi-kasir-1')->assertOk()->json('token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/auth/me')->assertOk()->assertJsonPath('roles.0', 'Kasir');
        $this->withToken($token)->getJson('/api/users')->assertForbidden();
    }

    public function test_create_validation(): void
    {
        $this->signIn('Admin');
        $this->create()->assertCreated();

        $this->postJson('/api/users', [])->assertUnprocessable()->assertJsonValidationErrors(['name', 'username', 'password', 'role']);
        $this->create(['username' => 'SARI'])->assertUnprocessable()->assertJsonValidationErrors(['username']);   // tanpa membedakan huruf besar/kecil
        $this->create(['username' => 'ada spasi'])->assertUnprocessable()->assertJsonValidationErrors(['username']);
        $this->create(['username' => 'baru', 'password' => 'pendek'])->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $this->create(['username' => 'baru', 'role' => 'Dewa'])->assertUnprocessable()->assertJsonValidationErrors(['role']);
        $this->create(['username' => 'a1', 'email' => 'dobel@toko.test'])->assertCreated();
        $this->create(['username' => 'a2', 'email' => 'dobel@toko.test'])->assertUnprocessable()->assertJsonValidationErrors(['email']);
    }

    public function test_list_filter_roles_and_show(): void
    {
        $this->signIn('Admin', 'budi-admin');
        $this->create(['name' => 'Sari Kasir', 'username' => 'sari'])->assertCreated();
        $this->create(['name' => 'Dedi Kasir', 'username' => 'dedi'])->assertCreated();
        $lain = DB::table('users')->insertGetId(['name' => 'Tanpa Toko', 'username' => 'tanpa-toko', 'password_hash' => 'x', 'is_active' => 1]);

        $this->getJson('/api/users')->assertOk()->assertJsonPath('total', 4);   // pengguna tanpa penugasan toko tidak tampil
        $this->getJson('/api/users?role=Kasir')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/users?role=Admin')->assertOk()->assertJsonPath('total', 2);   // admin seed + budi-admin
        $this->getJson('/api/users?q=dedi')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.roles.0', 'Kasir');
        $this->getJson('/api/users?status=inactive')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/users?status=bogus')->assertUnprocessable();
        $this->getJson("/api/users/{$lain}")->assertNotFound();
        $this->getJson('/api/users/99999')->assertNotFound();

        $names = array_column($this->getJson('/api/roles')->assertOk()->json('data'), 'name');
        $this->assertSame(['Admin', 'Kasir'], $names);
    }

    public function test_update_changes_name_email_and_role_with_audit(): void
    {
        $this->signIn('Admin');
        $id = $this->create()->json('data.id');

        $this->patchJson("/api/users/{$id}", ['name' => 'Sari Wulandari', 'email' => 'sw@toko.test'])->assertOk()
            ->assertJsonPath('data.name', 'Sari Wulandari')->assertJsonPath('data.email', 'sw@toko.test');
        $this->patchJson("/api/users/{$id}", ['role' => 'Admin'])->assertOk()->assertJsonPath('data.roles', ['Admin']);
        $this->assertSame(1, DB::table('user_roles')->where('user_id', $id)->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.update', 'entity_id' => $id]);

        $this->patchJson("/api/users/{$id}", ['username' => 'baru'])->assertUnprocessable()->assertJsonValidationErrors(['username']);
        $this->patchJson("/api/users/{$id}", ['password' => 'sandi-baru-1'])->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $this->patchJson("/api/users/{$id}", ['role' => 'Dewa'])->assertUnprocessable()->assertJsonValidationErrors(['role']);
        $this->patchJson('/api/users/99999', ['name' => 'X'])->assertNotFound();
        $this->patchJson("/api/users/{$id}", ['email' => 'sw@toko.test'])->assertOk();   // email sendiri boleh dikirim ulang
    }

    public function test_deactivation_blocks_login_and_revokes_tokens_then_can_reactivate(): void
    {
        $this->signIn('Admin');
        $id = $this->create()->json('data.id');
        $this->login('sari', 'sandi-kasir-1')->assertOk();
        $this->assertSame(1, DB::table('personal_access_tokens')->where('tokenable_id', $id)->count());

        $this->patchJson("/api/users/{$id}", ['is_active' => false])->assertOk()->assertJsonPath('data.is_active', false);
        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $id)->count());
        $this->login('sari', 'sandi-kasir-1')->assertUnprocessable();
        $this->getJson('/api/users?status=inactive')->assertOk()->assertJsonPath('total', 1);

        $this->patchJson("/api/users/{$id}", ['is_active' => true])->assertOk();
        $this->login('sari', 'sandi-kasir-1')->assertOk();
    }

    public function test_self_protection_and_last_admin_guard(): void
    {
        // buang penugasan admin seed agar akun uji menjadi satu-satunya Admin
        DB::table('user_roles')->whereIn('user_id', DB::table('users')->where('username', 'admin')->pluck('id'))->delete();
        $admin = $this->signIn('Admin', 'satu-satunya-admin');

        $this->patchJson("/api/users/{$admin->id}", ['is_active' => false])->assertUnprocessable()->assertJsonValidationErrors(['is_active']);
        $this->patchJson("/api/users/{$admin->id}", ['role' => 'Kasir'])->assertUnprocessable()->assertJsonValidationErrors(['role']);
        $this->assertSame(1, (int) DB::table('users')->where('id', $admin->id)->value('is_active'));

        // pengguna ber-delegasi user.manage (bukan Admin) mencoba menyingkirkan Admin terakhir
        $delegate = $this->makeUser('Kasir', 'kasir-delegasi');
        DB::table('user_permissions')->insert([
            'user_id' => $delegate->id, 'permission_id' => DB::table('permissions')->where('code', 'user.manage')->value('id'),
            'store_id' => $this->storeId(), 'effect' => 'allow',
        ]);
        Sanctum::actingAs($delegate, ['*']);
        app(PermissionResolver::class)->flush();

        $this->patchJson("/api/users/{$admin->id}", ['is_active' => false])->assertUnprocessable()->assertJsonValidationErrors(['is_active']);
        $this->patchJson("/api/users/{$admin->id}", ['role' => 'Kasir'])->assertUnprocessable()->assertJsonValidationErrors(['role']);
    }

    public function test_reset_password_replaces_credentials_and_revokes_sessions(): void
    {
        $admin = $this->signIn('Admin');
        $id = $this->create()->json('data.id');
        $this->login('sari', 'sandi-kasir-1')->assertOk();

        $this->postJson("/api/users/{$id}/reset-password", ['password' => 'pendek'])->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $this->postJson("/api/users/{$id}/reset-password", ['password' => 'sandi-baru-123'])->assertOk();

        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $id)->count());
        $this->login('sari', 'sandi-kasir-1')->assertUnprocessable();
        $this->login('sari', 'sandi-baru-123')->assertOk();

        $audit = DB::table('audit_logs')->where('action', 'user.reset_password')->where('entity_id', $id)->first();
        $this->assertSame($admin->id, (int) $audit->actor_id);
        $this->assertNull($audit->after_json);
        $this->postJson('/api/users/99999/reset-password', ['password' => 'sandi-baru-123'])->assertNotFound();
    }

    public function test_user_changes_own_password(): void
    {
        $this->signIn('Admin');
        $this->create()->assertCreated();
        $token = $this->login('sari', 'sandi-kasir-1')->assertOk()->json('token');
        $this->app['auth']->forgetGuards();

        $h = fn () => $this->withToken($token);
        $h()->postJson('/api/auth/change-password', ['current_password' => 'salah', 'password' => 'sandi-baru-123'])
            ->assertUnprocessable()->assertJsonValidationErrors(['current_password']);
        $h()->postJson('/api/auth/change-password', ['current_password' => 'sandi-kasir-1', 'password' => 'sandi-kasir-1'])
            ->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $h()->postJson('/api/auth/change-password', ['current_password' => 'sandi-kasir-1', 'password' => 'pendek'])
            ->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $h()->postJson('/api/auth/change-password', ['current_password' => 'sandi-kasir-1', 'password' => 'sandi-baru-123'])->assertOk();
        $this->login('sari', 'sandi-kasir-1')->assertUnprocessable();
        $this->login('sari', 'sandi-baru-123')->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.change_password']);
    }

    public function test_cashier_has_no_user_management_access(): void
    {
        $this->signIn('Kasir');

        $this->getJson('/api/users')->assertForbidden();
        $this->postJson('/api/users', [])->assertForbidden();
        $this->patchJson('/api/users/1', [])->assertForbidden();
        $this->postJson('/api/users/1/reset-password', [])->assertForbidden();
        $this->getJson('/api/roles')->assertForbidden();
    }

    public function test_guest_is_unauthenticated(): void
    {
        $this->getJson('/api/users')->assertUnauthorized();
        $this->postJson('/api/auth/change-password', [])->assertUnauthorized();
    }
}
