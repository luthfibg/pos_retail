<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class InventoryMenuSettingTest extends SeededTestCase
{
    public function test_inventory_menus_are_hidden_by_default_and_can_be_configured(): void
    {
        $storeId = $this->storeId();
        $this->signIn('Kasir');

        $this->getJson('/api/settings/inventory/menus')->assertOk()
            ->assertJsonPath('data.show_opening_balance', false)
            ->assertJsonPath('data.show_stock_transfer', false);

        $this->signIn('Admin');
        $this->putJson('/api/settings/inventory/menus', [
            'show_opening_balance' => true,
            'show_stock_transfer' => true,
        ])->assertOk()
            ->assertJsonPath('data.show_opening_balance', true)
            ->assertJsonPath('data.show_stock_transfer', true);

        $this->assertDatabaseHas('settings', [
            'store_id' => $storeId,
            'setting_key' => 'show_opening_balance',
        ]);
        $this->assertDatabaseHas('settings', [
            'store_id' => $storeId,
            'setting_key' => 'show_stock_transfer',
        ]);
        $this->assertSame(true, json_decode((string) DB::table('settings')
            ->where('store_id', $storeId)->where('setting_key', 'show_opening_balance')->value('setting_value'), true));
        $this->assertSame(true, json_decode((string) DB::table('settings')
            ->where('store_id', $storeId)->where('setting_key', 'show_stock_transfer')->value('setting_value'), true));
    }

    public function test_only_settings_managers_can_change_inventory_menu_visibility(): void
    {
        $this->signIn('Kasir');
        $this->putJson('/api/settings/inventory/menus', [
            'show_opening_balance' => true,
            'show_stock_transfer' => false,
        ])->assertForbidden();

        $this->signIn('Admin');
        $this->putJson('/api/settings/inventory/menus', ['show_opening_balance' => true])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['show_stock_transfer']);
    }
}
