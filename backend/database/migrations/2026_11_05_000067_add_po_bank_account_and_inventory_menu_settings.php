<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('settings')->where('setting_key', 'purchase_fund_percent')->delete();
        $legacyPermissionIds = DB::table('permissions')
            ->whereIn('code', ['purchase_fund.view', 'purchase_fund.allocate', 'bank_account.manage'])
            ->pluck('id');
        if ($legacyPermissionIds->isNotEmpty()) {
            DB::table('role_permissions')->whereIn('permission_id', $legacyPermissionIds)->delete();
            DB::table('user_permissions')->whereIn('permission_id', $legacyPermissionIds)->delete();
            DB::table('permissions')->whereIn('id', $legacyPermissionIds)->delete();
        }

        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->unsignedBigInteger('bank_account_id')->nullable()->after('supplier_id');
            $table->foreign('bank_account_id', 'fk_po_bank_account')->references('id')->on('bank_accounts');
        });

        $latestAllocations = DB::table('purchase_fund_allocations')
            ->selectRaw('purchase_order_id, MAX(id) as allocation_id')
            ->groupBy('purchase_order_id');
        DB::table('purchase_fund_allocations as allocation')
            ->joinSub($latestAllocations, 'latest', 'latest.allocation_id', '=', 'allocation.id')
            ->select(['allocation.purchase_order_id', 'allocation.bank_account_id'])
            ->orderBy('allocation.purchase_order_id')
            ->get()
            ->each(fn ($allocation) => DB::table('purchase_orders')
                ->where('id', $allocation->purchase_order_id)
                ->whereNull('bank_account_id')
                ->update(['bank_account_id' => $allocation->bank_account_id]));

        DB::table('stores')->orderBy('id')->pluck('id')->each(function (int $storeId) {
            foreach ([
                'show_opening_balance' => false,
                'show_stock_transfer' => false,
            ] as $key => $value) {
                DB::table('settings')->insertOrIgnore([
                    'store_id' => $storeId,
                    'setting_key' => $key,
                    'setting_value' => json_encode($value),
                ]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropForeign('fk_po_bank_account');
            $table->dropColumn('bank_account_id');
        });
        DB::table('settings')->whereIn('setting_key', ['show_opening_balance', 'show_stock_transfer'])->delete();
    }
};
