<?php

namespace Tests\Feature;

use App\Services\PermissionResolver;
use App\Support\PermissionCatalog;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Tests\Concerns\CreatesUsers;
use Tests\TestCase;

class RbacTest extends TestCase
{
    use CreatesUsers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(DatabaseSeeder::class);
    }

    private function overridePermission(int $userId, string $code, string $effect): void
    {
        DB::table('user_permissions')->insert([
            'user_id' => $userId,
            'permission_id' => DB::table('permissions')->where('code', $code)->value('id'),
            'store_id' => DB::table('stores')->value('id'),
            'effect' => $effect,
        ]);

        app(PermissionResolver::class)->flush();
    }

    public function test_catalog_cashier_permissions_are_all_defined(): void
    {
        $all = array_keys(PermissionCatalog::all());

        $this->assertSame([], array_diff(PermissionCatalog::cashier(), $all));
        $this->assertSame(count(PermissionCatalog::cashier()), count(array_unique(PermissionCatalog::cashier())));
    }

    public function test_admin_has_every_permission(): void
    {
        $admin = $this->makeUser('Admin', 'budi');

        $codes = app(PermissionResolver::class)->codes($admin);

        $expected = array_keys(PermissionCatalog::all());
        sort($expected);
        $this->assertSame($expected, $codes);
    }

    public function test_cashier_has_only_operational_permissions(): void
    {
        $cashier = $this->makeUser('Kasir', 'sari');

        $codes = app(PermissionResolver::class)->codes($cashier);

        $expected = PermissionCatalog::cashier();
        sort($expected);
        $this->assertSame($expected, $codes);
    }

    public function test_gate_follows_permission_codes(): void
    {
        $cashier = $this->makeUser('Kasir', 'sari');
        $admin = $this->makeUser('Admin', 'budi');

        $this->assertTrue(Gate::forUser($cashier)->allows('sales.create'));
        $this->assertFalse(Gate::forUser($cashier)->allows('purchase_requisition.approve'));
        $this->assertFalse(Gate::forUser($cashier)->allows('sales.credit_exception'));
        $this->assertTrue(Gate::forUser($admin)->allows('purchase_requisition.approve'));
        $this->assertTrue(Gate::forUser($admin)->allows('sales.credit_exception'));
    }

    public function test_user_override_can_add_and_remove_permissions(): void
    {
        $cashier = $this->makeUser('Kasir', 'sari');

        $this->overridePermission($cashier->id, 'shift.review', 'allow');
        $this->overridePermission($cashier->id, 'sales.create', 'deny');

        $resolver = app(PermissionResolver::class);
        $this->assertTrue($resolver->allows($cashier, 'shift.review'));
        $this->assertFalse($resolver->allows($cashier, 'sales.create'));
        $this->assertTrue($resolver->allows($cashier, 'shift.open'));
    }

    public function test_inactive_user_has_no_permissions(): void
    {
        $user = $this->makeUser('Admin', 'nonaktif', active: false);

        $this->assertSame([], app(PermissionResolver::class)->codes($user));
        $this->assertFalse(Gate::forUser($user)->allows('sales.create'));
    }

    public function test_user_without_store_assignment_has_no_permissions(): void
    {
        $user = $this->makeUser('Admin', 'budi');
        DB::table('user_roles')->where('user_id', $user->id)->delete();
        app(PermissionResolver::class)->flush();

        $this->assertSame([], app(PermissionResolver::class)->codes($user));
    }
}
