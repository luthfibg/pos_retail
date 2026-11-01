<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\PermissionCatalog;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class AdminModelTest extends SeededTestCase
{
    private function staff(): void
    {
        foreach ([['Kasir', 'kasir-a'], ['Finance', 'fin-a'], ['Purchasing', 'buy-a'], ['Accounting', 'acc-a']] as [$role, $username]) {
            $this->postJson('/api/users', ['name' => ucfirst($username), 'username' => $username, 'password' => 'sandi-12345', 'role' => $role])->assertCreated();
        }
    }

    private function enterStandard(): User
    {
        $admin = $this->signIn('Admin');
        $this->staff();
        $this->putJson('/api/settings/admin-model', ['model' => 'standard', 'confirm' => true])->assertOk()->assertJsonPath('data.model', 'standard');

        return $admin;
    }

    private function actAs(string $username): void
    {
        Sanctum::actingAs(User::where('username', $username)->firstOrFail(), ['*']);
    }

    public function test_default_model_is_simple_and_standard_is_blocked_until_roles_have_accounts(): void
    {
        $this->signIn('Admin');

        $data = $this->getJson('/api/settings/admin-model')->assertOk()
            ->assertJsonPath('data.model', 'simple')->assertJsonPath('data.controlling_role', 'Admin')
            ->assertJsonPath('data.options.0.model', 'simple')->assertJsonPath('data.options.0.current', true)
            ->assertJsonPath('data.options.1.model', 'standard')->assertJsonPath('data.options.1.can_switch', false)
            ->json('data');

        $missing = array_column($data['options'][1]['blockers'], 'role');
        $this->assertEqualsCanonicalizing(['Kasir', 'Finance', 'Purchasing', 'Accounting'], $missing);
        $this->assertSame('Admin', $data['options'][1]['conversions'][0]['from']);
        $this->assertSame('Owner', $data['options'][1]['conversions'][0]['to']);
        $this->assertCount(2, $data['options'][1]['conversions'][0]['users']); // admin seeder + admin uji

        $this->putJson('/api/settings/admin-model', ['model' => 'standard', 'confirm' => true])
            ->assertUnprocessable()->assertJsonValidationErrors(['model']);
        $this->assertSame(0, DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')->where('roles.name', 'Owner')->count());

        // tanpa baris setting pun dianggap simple
        DB::table('settings')->where('setting_key', 'admin_model')->delete();
        $this->getJson('/api/settings/admin-model')->assertOk()->assertJsonPath('data.model', 'simple');
        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('admin_model', 'simple');
    }

    public function test_only_settings_managers_can_read_or_change_the_model(): void
    {
        $this->signIn('Kasir');
        $this->getJson('/api/settings/admin-model')->assertForbidden();
        $this->putJson('/api/settings/admin-model', ['model' => 'standard', 'confirm' => true])->assertForbidden();
    }

    public function test_guest_is_unauthenticated(): void
    {
        $this->getJson('/api/settings/admin-model')->assertUnauthorized();
        $this->putJson('/api/settings/admin-model', ['model' => 'standard', 'confirm' => true])->assertUnauthorized();
    }

    public function test_switch_needs_active_account_per_role_and_explicit_confirmation(): void
    {
        $this->signIn('Admin');
        $this->staff();

        $this->getJson('/api/settings/admin-model')->assertJsonPath('data.options.1.can_switch', true)->assertJsonPath('data.options.1.blockers', []);

        // akun Kasir dinonaktifkan -> role Kasir kembali tanpa akun aktif
        $kasirId = User::where('username', 'kasir-a')->value('id');
        $this->patchJson("/api/users/{$kasirId}", ['is_active' => false])->assertOk();
        $blockers = $this->getJson('/api/settings/admin-model')->assertJsonPath('data.options.1.can_switch', false)->json('data.options.1.blockers');
        $this->assertSame(['Kasir'], array_column($blockers, 'role'));
        $this->putJson('/api/settings/admin-model', ['model' => 'standard', 'confirm' => true])->assertUnprocessable()->assertJsonValidationErrors(['model']);
        $this->patchJson("/api/users/{$kasirId}", ['is_active' => true])->assertOk();

        $this->putJson('/api/settings/admin-model', ['model' => 'standard'])->assertUnprocessable()->assertJsonValidationErrors(['confirm']);
        $this->putJson('/api/settings/admin-model', ['model' => 'bogus', 'confirm' => true])->assertUnprocessable()->assertJsonValidationErrors(['model']);
        $this->putJson('/api/settings/admin-model', ['model' => 'simple', 'confirm' => true])->assertUnprocessable()->assertJsonValidationErrors(['model']); // sudah simple
        $this->assertDatabaseMissing('audit_logs', ['action' => 'settings.admin_model']);
    }

    public function test_switching_to_standard_converts_admins_to_owner_and_back_with_audit(): void
    {
        $admin = $this->enterStandard();

        $this->assertSame(0, DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')->where('roles.name', 'Admin')->count());
        $this->assertSame(2, DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')->where('roles.name', 'Owner')->count());
        $this->assertSame('"standard"', (string) DB::table('settings')->where('setting_key', 'admin_model')->value('setting_value'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.admin_model', 'actor_id' => $admin->id]);

        $me = $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('admin_model', 'standard')->assertJsonPath('roles', ['Owner'])->json('permissions');
        $this->assertContains('settings.manage', $me);
        $this->assertContains('purchase_requisition.approve', $me);
        $this->assertNotContains('sales.create', $me);
        $this->assertNotContains('purchase_order.create', $me);

        $names = array_column($this->getJson('/api/roles')->assertOk()->json('data'), 'name');
        $this->assertSame(['Accounting', 'Finance', 'Kasir', 'Owner', 'Purchasing'], $names);

        $this->postJson('/api/users', ['name' => 'X', 'username' => 'adm-baru', 'password' => 'sandi-12345', 'role' => 'Admin'])
            ->assertUnprocessable()->assertJsonValidationErrors(['role']);
        $kasirId = User::where('username', 'kasir-a')->value('id');
        $this->patchJson("/api/users/{$kasirId}", ['role' => 'Admin'])->assertUnprocessable()->assertJsonValidationErrors(['role']);
        $this->postJson('/api/users', ['name' => 'Y', 'username' => 'owner-2', 'password' => 'sandi-12345', 'role' => 'Owner'])->assertCreated();

        // kembali ke simple: Owner -> Admin, Owner tidak lagi dapat ditugaskan
        $this->putJson('/api/settings/admin-model', ['model' => 'simple', 'confirm' => true])->assertOk()->assertJsonPath('data.model', 'simple');
        $this->assertSame(0, DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')->where('roles.name', 'Owner')->count());
        $this->getJson('/api/auth/me')->assertJsonPath('roles', ['Admin'])->assertJsonPath('admin_model', 'simple');
        $this->postJson('/api/users', ['name' => 'Z', 'username' => 'owner-3', 'password' => 'sandi-12345', 'role' => 'Owner'])
            ->assertUnprocessable()->assertJsonValidationErrors(['role']);
        $this->assertSame(2, DB::table('audit_logs')->where('action', 'settings.admin_model')->count());
    }

    public function test_each_standard_role_reaches_only_its_own_functions(): void
    {
        $this->enterStandard();

        $this->actAs('kasir-a');
        $shiftId = $this->postJson('/api/shifts/open')->assertCreated()->json('data.id');

        $this->actAs('fin-a');
        $this->getJson("/api/shifts/{$shiftId}")->assertOk();
        $this->getJson('/api/shifts')->assertOk();
        $this->getJson('/api/cash-deposits')->assertOk();
        $this->getJson('/api/sales')->assertOk();
        $this->postJson('/api/sales', [])->assertForbidden();
        $this->postJson('/api/purchase-orders', [])->assertForbidden();
        $this->getJson('/api/billing-periods')->assertForbidden();

        $this->actAs('buy-a');
        $this->getJson('/api/suppliers')->assertOk();
        $this->getJson('/api/purchase-orders')->assertOk();
        $this->getJson('/api/sales')->assertForbidden();
        $this->getJson('/api/shifts')->assertForbidden();
        $this->getJson("/api/shifts/{$shiftId}")->assertForbidden();
        $this->getJson('/api/settings/admin-model')->assertForbidden();

        $this->actAs('acc-a');
        $this->getJson('/api/billing-periods')->assertOk();
        $this->getJson('/api/goods-receipts')->assertOk();
        $this->postJson('/api/goods-receipts', [])->assertForbidden();
        $this->getJson('/api/sales')->assertOk();
        $this->getJson('/api/purchase-orders')->assertForbidden();

        $this->actAs('kasir-a');
        $this->getJson('/api/billing-periods')->assertForbidden();
        $this->getJson('/api/shifts')->assertForbidden();
        $this->getJson("/api/shifts/{$shiftId}")->assertOk();
        $this->getJson('/api/goods-receipts')->assertOk();

        $this->actAs('admin-uji'); // sekarang Owner
        $this->postJson('/api/sales', [])->assertForbidden();
        $this->getJson('/api/users')->assertOk();
        $this->getJson('/api/reports/dashboard')->assertOk();
        $this->getJson('/api/sales')->assertOk();
        $this->getJson('/api/billing-periods')->assertForbidden();
    }

    public function test_deactivated_user_with_unavailable_role_cannot_be_reactivated_unless_role_is_changed(): void
    {
        $this->enterStandard();
        $ghost = $this->makeUser('Admin', 'ghost-admin', active: false);

        $this->patchJson("/api/users/{$ghost->id}", ['is_active' => true])->assertUnprocessable()->assertJsonValidationErrors(['is_active']);
        $this->assertSame(0, (int) DB::table('users')->where('id', $ghost->id)->value('is_active'));

        $this->patchJson("/api/users/{$ghost->id}", ['is_active' => true, 'role' => 'Finance'])->assertOk()->assertJsonPath('data.roles', ['Finance']);
    }

    public function test_last_owner_cannot_be_removed_in_standard_model(): void
    {
        $owner = $this->enterStandard();
        // satu-satunya Owner = akun uji (hapus penugasan admin seed yang ikut menjadi Owner)
        DB::table('user_roles')->whereIn('user_id', DB::table('users')->where('username', 'admin')->pluck('id'))->delete();

        $this->patchJson("/api/users/{$owner->id}", ['is_active' => false])->assertUnprocessable()->assertJsonValidationErrors(['is_active']);
        $this->patchJson("/api/users/{$owner->id}", ['role' => 'Finance'])->assertUnprocessable()->assertJsonValidationErrors(['role']);

        // Owner lain boleh dinonaktifkan selama masih ada Owner aktif
        $second = $this->postJson('/api/users', ['name' => 'O2', 'username' => 'owner-2', 'password' => 'sandi-12345', 'role' => 'Owner'])->json('data.id');
        $this->patchJson("/api/users/{$second}", ['is_active' => false])->assertOk();
    }

    public function test_role_catalog_is_consistent(): void
    {
        $all = array_keys(PermissionCatalog::all());
        $roles = PermissionCatalog::roles();

        $this->assertSame(['Admin', 'Kasir', 'Owner', 'Finance', 'Purchasing', 'Accounting'], array_keys($roles));
        $this->assertEqualsCanonicalizing($all, $roles['Admin']['codes']);
        $this->assertSame(PermissionCatalog::cashier(), $roles['Kasir']['codes']);

        foreach ($roles as $name => $role) {
            $this->assertSame($role['codes'], array_values(array_unique($role['codes'])), "duplikat permission pada role {$name}");
            $this->assertSame([], array_values(array_diff($role['codes'], $all)), "permission tidak dikenal pada role {$name}");
            $this->assertSame(count($role['codes']), (int) DB::table('role_permissions')->where('role_id', DB::table('roles')->where('name', $name)->value('id'))->count());
        }

        // Owner pengawas: tidak memegang fungsi operasional kasir/pembelian/tagihan
        foreach (['sales.create', 'shift.open', 'cash_deposit.create', 'cash_deposit.receive', 'purchase_order.create', 'invoice.issue', 'goods_receipt.create'] as $code) {
            $this->assertNotContains($code, $roles['Owner']['codes']);
        }
    }
}
