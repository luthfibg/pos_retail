<?php

namespace Tests;

use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\CreatesUsers;

/** Dasar untuk test fitur: database test di-refresh lalu diisi seeder dasar. */
abstract class SeededTestCase extends TestCase
{
    use CreatesUsers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'pos.seed.admin_username' => 'admin',
            'pos.seed.admin_password' => 'sandi-admin-123',
            'pos.seed.cashier_username' => null,
            'pos.seed.cashier_password' => null,
        ]);

        $this->seed(DatabaseSeeder::class);
    }

    protected function storeId(): int
    {
        return (int) \Illuminate\Support\Facades\DB::table('stores')->value('id');
    }
}
