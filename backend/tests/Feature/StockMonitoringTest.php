<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class StockMonitoringTest extends SeededTestCase
{
    private function product(string $sku, string $restockQuantity): int
    {
        return DB::table('products')->insertGetId([
            'store_id' => $this->storeId(),
            'sku' => $sku,
            'barcode' => 'SM-'.$sku,
            'name' => 'Produk '.$sku,
            'sell_price' => '5000.00',
            'restock_quantity' => $restockQuantity,
            'status' => 'active',
        ]);
    }

    /** @param list<array<string, mixed>> $items */
    private function openingBalance(User $actor, array $items): void
    {
        Sanctum::actingAs($actor, ['*']);
        $this->postJson('/api/inventory/opening-balances', ['items' => $items])->assertCreated();
    }

    public function test_low_stock_creates_and_updates_one_automatic_draft_until_cashier_submits(): void
    {
        $admin = $this->signIn('Admin');
        $first = $this->product('SM-1', '5.000');

        $this->openingBalance($admin, [[
            'product_id' => $first,
            'qty' => '3.000',
            'unit_cost' => '1000.1234',
        ]]);

        $pr = DB::table('purchase_requisitions')
            ->where('store_id', $this->storeId())
            ->where('is_auto_generated', 1)
            ->where('status', 'draft')
            ->first();

        $this->assertNotNull($pr);
        $this->assertSame('5000.60', $pr->est_total);
        $this->assertDatabaseHas('purchase_requisition_items', [
            'pr_id' => $pr->id,
            'product_id' => $first,
            'qty' => '5.000',
            'est_price' => '1000.12',
        ]);

        $second = $this->product('SM-2', '4.000');
        $this->openingBalance($admin, [[
            'product_id' => $second,
            'qty' => '2.000',
            'unit_cost' => '200.0000',
        ]]);

        $pr = DB::table('purchase_requisitions')->where('id', $pr->id)->first();
        $this->assertSame('5800.60', $pr->est_total);
        $this->assertSame(2, DB::table('purchase_requisition_items')->where('pr_id', $pr->id)->count());

        $cashier = $this->makeUser('Kasir', 'kasir-stock-monitor');
        Sanctum::actingAs($cashier, ['*']);
        $this->getJson('/api/purchase-requisitions')
            ->assertOk()
            ->assertJsonPath('data.0.is_auto_generated', true)
            ->assertJsonPath('data.0.id', (int) $pr->id);
        $this->getJson("/api/purchase-requisitions/{$pr->id}")
            ->assertOk()
            ->assertJsonPath('data.is_auto_generated', true)
            ->assertJsonPath('data.items.0.est_price', '1000.12');
        $this->patchJson("/api/purchase-requisitions/{$pr->id}", ['reason' => 'ubah'])->assertForbidden();
        $this->postJson('/api/purchase-requisitions', [
            'items' => [['product_id' => $first, 'qty' => '1']],
        ])->assertForbidden();

        $this->postJson("/api/purchase-requisitions/{$pr->id}/submit")
            ->assertOk()
            ->assertJsonPath('data.status', 'submitted');

        $third = $this->product('SM-3', '2.000');
        $this->openingBalance($admin, [[
            'product_id' => $third,
            'qty' => '1.000',
            'unit_cost' => '250.0000',
        ]]);

        $newDraft = DB::table('purchase_requisitions')
            ->where('store_id', $this->storeId())
            ->where('is_auto_generated', 1)
            ->where('status', 'draft')
            ->first();
        $this->assertNotNull($newDraft);
        $this->assertNotSame((int) $pr->id, (int) $newDraft->id);
        $this->assertSame(1, DB::table('purchase_requisition_items')->where('pr_id', $newDraft->id)->count());
        $this->assertDatabaseHas('purchase_requisition_items', [
            'pr_id' => $newDraft->id,
            'product_id' => $third,
            'qty' => '2.000',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'purchase_requisition.auto_create',
            'store_id' => $this->storeId(),
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'purchase_requisition.auto_update',
            'entity_id' => $pr->id,
        ]);
    }

    public function test_stock_monitoring_setting_defaults_to_three_and_reconciles_auto_draft(): void
    {
        $admin = $this->signIn('Admin');
        $product = $this->product('SM-SETTING', '3.000');
        $this->openingBalance($admin, [[
            'product_id' => $product,
            'qty' => '3.000',
            'unit_cost' => '500.0000',
        ]]);

        Sanctum::actingAs($admin, ['*']);
        $this->getJson('/api/settings/inventory/stock-monitoring')
            ->assertOk()
            ->assertJsonPath('data.low_stock_threshold', '3.000');
        $this->putJson('/api/settings/inventory/stock-monitoring', ['low_stock_threshold' => '2.000'])
            ->assertOk()
            ->assertJsonPath('data.low_stock_threshold', '2.000');

        $this->assertDatabaseHas('purchase_requisitions', [
            'store_id' => $this->storeId(),
            'is_auto_generated' => 1,
            'status' => 'cancelled',
            'est_total' => '0.00',
        ]);
        $this->assertSame(0, DB::table('purchase_requisition_items')->count());
        $this->assertDatabaseHas('settings', [
            'store_id' => $this->storeId(),
            'setting_key' => 'inventory_low_stock_threshold',
            'updated_by' => $admin->id,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'settings.stock_monitoring',
            'actor_id' => $admin->id,
        ]);

        $this->putJson('/api/settings/inventory/stock-monitoring', ['low_stock_threshold' => '1.2345'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['low_stock_threshold']);

        $cashier = $this->makeUser('Kasir', 'kasir-stock-setting');
        Sanctum::actingAs($cashier, ['*']);
        $this->getJson('/api/settings/inventory/stock-monitoring')->assertForbidden();
        $this->putJson('/api/settings/inventory/stock-monitoring', ['low_stock_threshold' => '4'])->assertForbidden();
    }
}
