<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class PlatformStoreManagementTest extends SeededTestCase
{
    private User $operator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->operator = $this->createOperator();
    }

    private function asOperator(): void
    {
        Sanctum::actingAs($this->operator, ['*']);
    }

    private function createOperator(): User
    {
        $id = DB::table('users')->insertGetId([
            'name' => 'Platform Operator',
            'username' => 'platform-operator',
            'password_hash' => Hash::make('operator-password-123'),
            'is_active' => 1,
        ]);
        DB::table('platform_operators')->insert(['user_id' => $id, 'is_active' => 1]);

        return User::findOrFail($id);
    }

    /** @return array<string, mixed> */
    private function tenantPayload(array $overrides = []): array
    {
        return array_replace_recursive([
            'code' => 'CLIENT-01',
            'name' => 'Toko Klien Satu',
            'timezone' => 'Asia/Jakarta',
            'currency' => 'IDR',
            'owner' => [
                'name' => 'Pemilik Klien',
                'username' => 'owner-client-01',
                'email' => 'owner01@example.test',
                'password' => 'owner-password-123',
            ],
        ], $overrides);
    }

    public function test_store_management_requires_a_platform_operator_not_a_store_admin(): void
    {
        $admin = $this->makeUser('Admin', 'store-admin');
        Sanctum::actingAs($admin, ['*']);
        $this->getJson('/api/platform/stores')->assertForbidden();
        $this->postJson('/api/platform/stores', $this->tenantPayload())->assertForbidden();

        $this->app['auth']->forgetGuards();
        $this->getJson('/api/platform/stores')->assertUnauthorized();
    }

    public function test_platform_operator_can_sign_in_without_a_store_assignment(): void
    {
        $login = $this->postJson('/api/auth/login', [
            'username' => 'platform-operator',
            'password' => 'operator-password-123',
        ])->assertOk()->assertJsonPath('platform_operator', true);

        $this->withToken($login->json('token'))->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('platform_operator', true)
            ->assertJsonPath('store', null)
            ->assertJsonPath('roles', [])
            ->assertJsonPath('permissions', []);
    }

    public function test_operator_can_be_bootstrapped_with_a_hidden_password_prompt(): void
    {
        $this->artisan('platform:operator-create', [
            'username' => 'bootstrapped-operator',
            'name' => 'Bootstrapped Operator',
        ])
            ->expectsQuestion('Password operator (minimal 12 karakter)', 'bootstrap-password-123')
            ->expectsQuestion('Ulangi password operator', 'bootstrap-password-123')
            ->expectsOutputToContain("Operator platform 'bootstrapped-operator' berhasil dibuat")
            ->assertExitCode(0);

        $user = User::where('username', 'bootstrapped-operator')->firstOrFail();
        $this->assertTrue(Hash::check('bootstrap-password-123', $user->password_hash));
        $this->assertDatabaseHas('platform_operators', ['user_id' => $user->id, 'is_active' => 1]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'platform.operator_create',
            'entity_type' => 'platform_operator',
            'entity_id' => $user->id,
            'actor_id' => null,
        ]);
    }

    public function test_operator_creates_store_and_initial_admin_atomically_with_defaults(): void
    {
        $this->asOperator();
        $response = $this->postJson('/api/platform/stores', $this->tenantPayload())
            ->assertCreated()
            ->assertJsonPath('data.code', 'CLIENT-01')
            ->assertJsonPath('data.name', 'Toko Klien Satu')
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.initial_owner.username', 'owner-client-01')
            ->assertJsonPath('data.initial_owner.role', 'Admin');

        $storeId = (int) $response->json('data.id');
        $ownerId = (int) $response->json('data.initial_owner.id');

        $this->assertDatabaseHas('user_roles', [
            'user_id' => $ownerId,
            'role_id' => DB::table('roles')->where('name', 'Admin')->value('id'),
            'store_id' => $storeId,
        ]);
        $this->assertDatabaseHas('settings', [
            'store_id' => $storeId,
            'setting_key' => 'warehouse_enabled',
        ]);
        $this->assertSame('false', DB::table('settings')->where('store_id', $storeId)
            ->where('setting_key', 'warehouse_enabled')->value('setting_value'));
        $this->assertSame(1, DB::table('locations')->where('store_id', $storeId)->where('type', 'store_floor')->where('is_active', 1)->count());
        $this->assertSame(1, DB::table('locations')->where('store_id', $storeId)->where('type', 'warehouse')->where('is_active', 0)->count());
        $this->assertSame(1, DB::table('registers')->where('store_id', $storeId)->count());
        $this->assertSame(3, DB::table('fund_accounts')->where('store_id', $storeId)->count());
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'platform.store_create',
            'entity_type' => 'store',
            'entity_id' => $storeId,
            'actor_id' => $this->operator->id,
            'store_id' => null,
        ]);

        $this->app['auth']->forgetGuards();
        $login = $this->postJson('/api/auth/login', [
            'username' => 'owner-client-01',
            'password' => 'owner-password-123',
        ])->assertOk()->assertJsonPath('platform_operator', false);
        $this->withToken($login->json('token'))->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('store.id', $storeId)
            ->assertJsonPath('store.code', 'CLIENT-01')
            ->assertJsonPath('roles.0', 'Admin');
    }

    public function test_tenant_deactivation_blocks_store_access_without_deleting_data_and_can_be_reversed(): void
    {
        $this->asOperator();
        $storeId = (int) $this->postJson('/api/platform/stores', $this->tenantPayload())->assertCreated()->json('data.id');
        $this->app['auth']->forgetGuards();
        $ownerToken = $this->postJson('/api/auth/login', [
            'username' => 'owner-client-01',
            'password' => 'owner-password-123',
        ])->assertOk()->json('token');
        $this->assertNotEmpty($ownerToken);
        $this->asOperator();

        $this->patchJson("/api/platform/stores/{$storeId}/status", [
            'is_active' => false,
            'reason' => 'Akun tenant dinonaktifkan sementara',
        ])->assertOk()->assertJsonPath('data.is_active', false);

        Sanctum::actingAs(User::where('username', 'owner-client-01')->firstOrFail(), ['*']);
        $this->getJson('/api/auth/me')->assertForbidden();
        $this->getJson('/api/products')->assertForbidden();
        $this->assertDatabaseHas('stores', ['id' => $storeId, 'is_active' => 0]);
        $this->assertDatabaseHas('users', ['username' => 'owner-client-01', 'is_active' => 1]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'platform.store_status',
            'entity_id' => $storeId,
            'actor_id' => $this->operator->id,
            'store_id' => null,
        ]);

        $this->asOperator();
        $this->getJson('/api/platform/stores?status=inactive')->assertOk()->assertJsonPath('total', 1);
        $this->patchJson("/api/platform/stores/{$storeId}/status", ['is_active' => true])->assertOk();
        Sanctum::actingAs(User::where('username', 'owner-client-01')->firstOrFail(), ['*']);
        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('store.id', $storeId);
    }

    public function test_duplicate_tenant_or_owner_identity_is_rejected_without_partial_provisioning(): void
    {
        $this->asOperator();
        $this->postJson('/api/platform/stores', $this->tenantPayload())->assertCreated();

        $this->postJson('/api/platform/stores', $this->tenantPayload([
            'code' => 'CLIENT-02',
            'owner' => ['username' => 'owner-client-01'],
        ]))->assertUnprocessable()->assertJsonValidationErrors(['owner.username']);

        $this->postJson('/api/platform/stores', $this->tenantPayload([
            'code' => 'CLIENT-01',
            'owner' => ['username' => 'owner-client-02'],
        ]))->assertUnprocessable()->assertJsonValidationErrors(['code']);

        $this->assertSame(2, DB::table('stores')->count());
        $this->assertSame(1, DB::table('users')->where('username', 'owner-client-01')->count());
        $this->assertSame(10, DB::table('settings')->where('store_id', DB::table('stores')->where('code', 'CLIENT-01')->value('id'))->count());
    }
}
