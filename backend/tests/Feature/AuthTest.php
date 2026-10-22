<?php

namespace Tests\Feature;

use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesUsers;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use CreatesUsers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(DatabaseSeeder::class);
    }

    private function loginToken(string $username, string $password): string
    {
        return (string) $this->postJson('/api/auth/login', [
            'username' => $username,
            'password' => $password,
        ])->json('token');
    }

    public function test_login_returns_token_and_user(): void
    {
        $this->makeUser('Admin', 'budi', 'rahasia-123');

        $this->postJson('/api/auth/login', ['username' => 'budi', 'password' => 'rahasia-123'])
            ->assertOk()
            ->assertJsonStructure(['token', 'token_type', 'expires_at', 'user' => ['id', 'name', 'username']])
            ->assertJsonPath('token_type', 'Bearer')
            ->assertJsonPath('user.username', 'budi');

        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.login']);
        $this->assertDatabaseCount('personal_access_tokens', 1);
        $this->assertNotNull(DB::table('users')->where('username', 'budi')->value('last_login_at'));
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $this->makeUser('Admin', 'budi', 'rahasia-123');

        $this->postJson('/api/auth/login', ['username' => 'budi', 'password' => 'salah'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('username');

        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.login_failed']);
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_login_fails_for_unknown_user(): void
    {
        $this->postJson('/api/auth/login', ['username' => 'tidak-ada', 'password' => 'apa-saja'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('username');
    }

    public function test_inactive_user_cannot_login(): void
    {
        $this->makeUser('Kasir', 'nonaktif', 'rahasia-123', active: false);

        $this->postJson('/api/auth/login', ['username' => 'nonaktif', 'password' => 'rahasia-123'])
            ->assertStatus(422);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_me_requires_authentication(): void
    {
        $this->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_me_returns_roles_store_and_permissions_for_cashier(): void
    {
        $this->makeUser('Kasir', 'sari', 'rahasia-123');
        $token = $this->loginToken('sari', 'rahasia-123');

        $response = $this->withToken($token)->getJson('/api/auth/me');

        $response->assertOk()
            ->assertJsonPath('user.username', 'sari')
            ->assertJsonPath('roles.0', 'Kasir')
            ->assertJsonPath('store.code', 'SMK');

        $permissions = $response->json('permissions');
        $this->assertContains('sales.create', $permissions);
        $this->assertContains('shift.close', $permissions);
        $this->assertNotContains('purchase_requisition.approve', $permissions);
        $this->assertNotContains('price.change', $permissions);
        $this->assertNotContains('sales.credit_exception', $permissions);
    }

    public function test_user_without_store_assignment_is_forbidden_on_me(): void
    {
        $this->makeUser('Kasir', 'sari', 'rahasia-123');
        DB::table('user_roles')->delete();

        $token = $this->loginToken('sari', 'rahasia-123');

        $this->withToken($token)->getJson('/api/auth/me')->assertForbidden();
    }

    public function test_logout_revokes_the_token(): void
    {
        $this->makeUser('Admin', 'budi', 'rahasia-123');
        $token = $this->loginToken('budi', 'rahasia-123');
        $this->assertDatabaseCount('personal_access_tokens', 1);

        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();

        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.logout']);
    }
}
