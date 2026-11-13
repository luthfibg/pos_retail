<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class PurchaseOrderSupplierSettingTest extends SeededTestCase
{
    public function test_default_is_manual_and_admin_can_save_product_based_selection(): void
    {
        $admin = $this->signIn('Admin');

        $this->getJson('/api/settings/purchase-order-supplier-selection')
            ->assertOk()
            ->assertJsonPath('data.mode', 'manual');

        $this->putJson('/api/settings/purchase-order-supplier-selection', ['mode' => 'product'])
            ->assertOk()
            ->assertJsonPath('data.mode', 'product');

        $this->assertSame(
            '"product"',
            DB::table('settings')
                ->where('store_id', $this->storeId())
                ->where('setting_key', 'purchase_order_supplier_selection')
                ->value('setting_value'),
        );
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'settings.purchase_order_supplier_selection',
            'actor_id' => $admin->id,
        ]);
        $this->putJson('/api/settings/purchase-order-supplier-selection', ['mode' => 'invalid'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['mode']);
    }

    public function test_po_creators_can_read_setting_but_cashiers_cannot_access_it(): void
    {
        $this->signIn('Owner');
        $this->getJson('/api/settings/purchase-order-supplier-selection')->assertOk();
        $this->putJson('/api/settings/purchase-order-supplier-selection', ['mode' => 'manual'])
            ->assertOk()
            ->assertJsonPath('data.mode', 'manual');

        $this->signIn('Purchasing');
        $this->getJson('/api/settings/purchase-order-supplier-selection')->assertOk()->assertJsonPath('data.mode', 'manual');

        $this->signIn('Kasir');

        $this->getJson('/api/settings/purchase-order-supplier-selection')->assertForbidden();
        $this->putJson('/api/settings/purchase-order-supplier-selection', ['mode' => 'product'])->assertForbidden();
        $this->putJson('/api/settings/purchase-order-supplier-selection', ['mode' => 'product'])->assertForbidden();
    }
}
