<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class WarehouseSettingsTest extends SeededTestCase
{
    public function test_admin_can_enable_and_disable_warehouse_without_deleting_stock_history(): void
    {
        $admin = $this->signIn('Admin');
        $storeId = $this->storeId();
        $warehouseId = (int) DB::table('locations')
            ->where('store_id', $storeId)
            ->where('type', 'warehouse')
            ->value('id');
        $productId = DB::table('products')->insertGetId([
            'store_id' => $storeId,
            'sku' => 'WH-SETTING-TEST',
            'barcode' => '8997000000001',
            'name' => 'Stok Gudang Uji',
            'sell_price' => 5000,
            'status' => 'active',
        ]);
        DB::table('inventory_balances')->insert([
            'product_id' => $productId,
            'location_id' => $warehouseId,
            'qty_sellable' => '3.000',
        ]);

        $this->getJson('/api/settings/warehouse')->assertOk()
            ->assertJsonPath('data.enabled', false)
            ->assertJsonPath('data.locations.0.id', $warehouseId)
            ->assertJsonPath('data.locations.0.is_active', false);

        $this->putJson('/api/settings/warehouse', ['enabled' => true])->assertOk()
            ->assertJsonPath('data.enabled', true)
            ->assertJsonPath('data.locations.0.is_active', true);
        $this->assertDatabaseHas('settings', [
            'store_id' => $storeId,
            'setting_key' => 'warehouse_enabled',
        ]);
        $setting = DB::table('settings')
            ->where('store_id', $storeId)
            ->where('setting_key', 'warehouse_enabled')
            ->first();
        $this->assertSame(true, json_decode((string) $setting->setting_value, true));
        $this->assertSame($admin->id, (int) $setting->updated_by);
        $this->assertDatabaseHas('locations', ['id' => $warehouseId, 'is_active' => 1]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'settings.warehouse',
            'actor_id' => $admin->id,
            'store_id' => $storeId,
        ]);

        $this->putJson('/api/settings/warehouse', ['enabled' => false])->assertOk()
            ->assertJsonPath('data.enabled', false)
            ->assertJsonPath('data.locations.0.is_active', false);
        $this->assertSame(false, json_decode((string) DB::table('settings')
            ->where('store_id', $storeId)
            ->where('setting_key', 'warehouse_enabled')
            ->value('setting_value'), true));
        $this->assertDatabaseHas('locations', ['id' => $warehouseId, 'is_active' => 0]);
        $this->assertDatabaseHas('inventory_balances', [
            'product_id' => $productId,
            'location_id' => $warehouseId,
            'qty_sellable' => '3.000',
        ]);
        $this->assertSame(2, DB::table('audit_logs')->where('action', 'settings.warehouse')->count());
    }

    public function test_warehouse_setting_requires_admin_permission_and_boolean_value(): void
    {
        $this->getJson('/api/settings/warehouse')->assertUnauthorized();

        $this->signIn('Kasir');
        $this->getJson('/api/settings/warehouse')->assertForbidden();
        $this->putJson('/api/settings/warehouse', ['enabled' => true])->assertForbidden();

        $this->signIn('Admin');
        $this->putJson('/api/settings/warehouse', [])->assertUnprocessable()
            ->assertJsonValidationErrors(['enabled']);
        $this->putJson('/api/settings/warehouse', ['enabled' => 'maybe'])->assertUnprocessable()
            ->assertJsonValidationErrors(['enabled']);
    }
}
