<?php

namespace Tests\Feature;

use App\Support\PermissionCatalog;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class SeederTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Test tidak boleh bergantung pada SEED_* di .env / .env.testing.
        config([
            'pos.seed.admin_username' => 'admin',
            'pos.seed.admin_password' => 'sandi-admin-123',
            'pos.seed.cashier_username' => null,
            'pos.seed.cashier_password' => null,
        ]);
    }

    public function test_seeder_creates_base_data(): void
    {
        $this->seed(DatabaseSeeder::class);

        $storeId = DB::table('stores')->where('code', 'SMK')->value('id');
        $this->assertNotNull($storeId);

        $this->assertSame(3, DB::table('fund_accounts')->where('store_id', $storeId)->count());
        $this->assertSame(1, DB::table('registers')->where('store_id', $storeId)->count());
        $this->assertSame(0, (int) DB::table('locations')->where('type', 'warehouse')->value('is_active'));
        $this->assertSame('false', DB::table('settings')->where('setting_key', 'warehouse_enabled')->value('setting_value'));
        $this->assertSame(count(PermissionCatalog::all()), DB::table('permissions')->count());

        $adminRoleId = DB::table('roles')->where('name', 'Admin')->value('id');
        $this->assertSame(
            count(PermissionCatalog::all()),
            DB::table('role_permissions')->where('role_id', $adminRoleId)->count()
        );

        $admin = DB::table('users')->where('username', 'admin')->first();
        $this->assertNotNull($admin);
        $this->assertTrue(Hash::check('sandi-admin-123', $admin->password_hash));
        $this->assertSame(1, DB::table('user_roles')->where('user_id', $admin->id)->where('role_id', $adminRoleId)->count());
    }

    public function test_seeder_is_idempotent_and_keeps_changed_settings(): void
    {
        $this->seed(DatabaseSeeder::class);

        DB::table('settings')->where('setting_key', 'expiry_warning_days')->update(['setting_value' => json_encode(14)]);

        $this->seed(DatabaseSeeder::class);

        $this->assertSame(1, DB::table('stores')->count());
        $this->assertSame(3, DB::table('fund_accounts')->count());
        $this->assertSame(2, DB::table('roles')->count());
        $this->assertSame(1, DB::table('users')->count());
        $this->assertSame('14', DB::table('settings')->where('setting_key', 'expiry_warning_days')->value('setting_value'));
    }

    public function test_seeder_creates_cashier_only_when_configured_and_never_duplicates(): void
    {
        config([
            'pos.seed.cashier_username' => 'kasir-uji',
            'pos.seed.cashier_password' => 'sandi-kasir-123',
        ]);

        $this->seed(DatabaseSeeder::class);
        $this->seed(DatabaseSeeder::class);

        $this->assertSame(2, DB::table('users')->count());

        $cashier = DB::table('users')->where('username', 'kasir-uji')->first();
        $this->assertNotNull($cashier);
        $this->assertTrue(Hash::check('sandi-kasir-123', $cashier->password_hash));

        $kasirRoleId = DB::table('roles')->where('name', 'Kasir')->value('id');
        $this->assertSame(
            1,
            DB::table('user_roles')->where('user_id', $cashier->id)->where('role_id', $kasirRoleId)->count()
        );
    }
}
