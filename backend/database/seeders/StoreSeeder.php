<?php

namespace Database\Seeders;

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

        // Lokasi: toko aktif; gudang tersedia tetapi nonaktif (warehouse_enabled = false)
        if (! DB::table('locations')->where('store_id', $storeId)->where('type', 'store_floor')->exists()) {
            DB::table('locations')->insert(['store_id' => $storeId, 'type' => 'store_floor', 'name' => 'Toko', 'is_active' => 1]);
        }
        if (! DB::table('locations')->where('store_id', $storeId)->where('type', 'warehouse')->exists()) {
            DB::table('locations')->insert(['store_id' => $storeId, 'type' => 'warehouse', 'name' => 'Gudang', 'is_active' => 0]);
        }

        // Satu toko, satu kasir, satu laci
        $registerId = DB::table('registers')->where('store_id', $storeId)->value('id');
        if ($registerId === null) {
            $registerId = DB::table('registers')->insertGetId(['store_id' => $storeId, 'name' => 'Kasir 1', 'is_active' => 1]);
        }

        // Akun dana: kas kecil (laci), kas besar, saldo pembelian
        $accounts = [
            ['type' => 'petty_cash', 'name' => 'Kas Kecil - Kasir 1', 'register_id' => $registerId],
            ['type' => 'main_cash', 'name' => 'Kas Besar', 'register_id' => null],
            ['type' => 'purchase_fund', 'name' => 'Saldo Pembelian', 'register_id' => null],
        ];
        foreach ($accounts as $account) {
            $exists = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', $account['type'])->exists();
            if (! $exists) {
                DB::table('fund_accounts')->insert($account + ['store_id' => $storeId, 'is_active' => 1]);
            }
        }

        // Pengaturan bawaan (insertOrIgnore: tidak menimpa nilai yang sudah diubah Admin)
        $settings = [
            'warehouse_enabled' => false,
            'receiving_requires_po' => true,
            'sod_pr_creator_approver' => 'block',
            'sod_owner_self_approve' => 'allow_with_flag',
            'approval_reauth_required' => true,
            'expiry_warning_days' => 30,
            'credit_requires_verified_customer' => true,
            'credit_blocked_without_limit' => true,
            'float_rounding_unit' => 1000,
            'purchase_fund_percent' => 15,
        ];
        foreach ($settings as $key => $value) {
            DB::table('settings')->insertOrIgnore([
                'store_id' => $storeId,
                'setting_key' => $key,
                'setting_value' => json_encode($value),
            ]);
        }
    }
}
