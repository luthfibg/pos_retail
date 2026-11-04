<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class TenantProvisioner
{
    public function initialize(int $storeId): void
    {
        if (! DB::table('locations')->where('store_id', $storeId)->where('type', 'store_floor')->exists()) {
            DB::table('locations')->insert([
                'store_id' => $storeId,
                'type' => 'store_floor',
                'name' => 'Toko',
                'is_active' => 1,
            ]);
        }

        if (! DB::table('locations')->where('store_id', $storeId)->where('type', 'warehouse')->exists()) {
            DB::table('locations')->insert([
                'store_id' => $storeId,
                'type' => 'warehouse',
                'name' => 'Gudang',
                'is_active' => 0,
            ]);
        }

        if (! DB::table('registers')->where('store_id', $storeId)->exists()) {
            DB::table('registers')->insert([
                'store_id' => $storeId,
                'name' => 'Kasir 1',
                'is_active' => 1,
            ]);
        }
        $registers = DB::table('registers')->where('store_id', $storeId)->get(['id', 'name']);

        foreach ([
            ['type' => 'main_cash', 'name' => 'Kas Besar', 'register_id' => null],
            ['type' => 'purchase_fund', 'name' => 'Saldo Pembelian', 'register_id' => null],
        ] as $account) {
            if (! DB::table('fund_accounts')->where('store_id', $storeId)->where('type', $account['type'])->exists()) {
                DB::table('fund_accounts')->insert($account + ['store_id' => $storeId, 'is_active' => 1]);
            }
        }
        foreach ($registers as $register) {
            if (! DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'petty_cash')->where('register_id', $register->id)->exists()) {
                DB::table('fund_accounts')->insert([
                    'store_id' => $storeId,
                    'type' => 'petty_cash',
                    'name' => 'Kas Kecil - '.$register->name,
                    'register_id' => $register->id,
                    'is_active' => 1,
                ]);
            }
        }

        foreach ([
            'warehouse_enabled' => false,
            'admin_model' => 'simple',
            'receiving_requires_po' => true,
            'sod_pr_creator_approver' => 'block',
            'sod_owner_self_approve' => 'allow_with_flag',
            'approval_reauth_required' => true,
            'expiry_warning_days' => 30,
            'credit_requires_verified_customer' => true,
            'credit_blocked_without_limit' => true,
            'float_rounding_unit' => 1000,
            'purchase_fund_percent' => 15,
            'inventory_low_stock_threshold' => 3,
        ] as $key => $value) {
            DB::table('settings')->insertOrIgnore([
                'store_id' => $storeId,
                'setting_key' => $key,
                'setting_value' => json_encode($value),
            ]);
        }
    }
}
