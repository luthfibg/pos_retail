<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $legacyAdjustmentIds = DB::table('stock_adjustments')
            ->whereNull('reason_code')
            ->select('id');

        DB::table('stock_adjustment_items')
            ->whereIn('adjustment_id', $legacyAdjustmentIds)
            ->delete();

        DB::table('stock_adjustments')
            ->whereNull('reason_code')
            ->delete();

        $legacyPermissionIds = DB::table('permissions')
            ->where('code', 'inventory.adjust.request')
            ->pluck('id');
        if ($legacyPermissionIds->isNotEmpty()) {
            DB::table('role_permissions')->whereIn('permission_id', $legacyPermissionIds)->delete();
            DB::table('user_permissions')->whereIn('permission_id', $legacyPermissionIds)->delete();
            DB::table('permissions')->whereIn('id', $legacyPermissionIds)->delete();
        }

        DB::table('settings')->where('setting_key', 'stock_authority')->get(['store_id', 'setting_value'])
            ->each(function (object $setting): void {
                $rules = json_decode((string) $setting->setting_value, true);
                if (! is_array($rules)) {
                    return;
                }

                $updated = false;
                foreach (['adjustment_request.store_floor', 'adjustment_request.warehouse'] as $key) {
                    if (array_key_exists($key, $rules)) {
                        unset($rules[$key]);
                        $updated = true;
                    }
                }
                if ($updated) {
                    DB::table('settings')->where('store_id', $setting->store_id)->where('setting_key', 'stock_authority')
                        ->update(['setting_value' => json_encode((object) $rules)]);
                }
            });
    }

    public function down(): void
    {
        // Deleted legacy adjustment records cannot be reconstructed.
    }
};
