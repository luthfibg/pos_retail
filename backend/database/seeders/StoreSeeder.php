<?php

namespace Database\Seeders;

use App\Services\TenantProvisioner;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Data dasar toko. Idempotent: aman dijalankan berulang, tidak menimpa data yang sudah diubah.
 */
class StoreSeeder extends Seeder
{
    public function run(): void
    {
        $code = (string) config('pos.default_store_code');

        $storeId = DB::table('stores')->where('code', $code)->value('id');

        if ($storeId === null) {
            $storeId = DB::table('stores')->insertGetId([
                'code' => $code,
                'name' => (string) config('pos.default_store_name'),
                'timezone' => 'Asia/Jakarta',
                'currency' => 'IDR',
            ]);
        }

        app(TenantProvisioner::class)->initialize((int) $storeId);
    }
}
