<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class OpeningBalanceTest extends SeededTestCase
{
    private function makeProduct(array $overrides = []): int
    {
        static $n = 0;
        $n++;

        return DB::table('products')->insertGetId($overrides + [
            'store_id' => $this->storeId(),
            'sku' => "OB-{$n}",
            'barcode' => sprintf('89980000%05d', $n),
            'name' => "Produk OB {$n}",
            'sell_price' => 5000,
            'status' => 'active',
        ]);
    }

    public function test_admin_posts_opening_balance_with_batches_movements_and_audit(): void
    {
        $admin = $this->signIn('Admin');
        $a = $this->makeProduct(['track_expiry' => 1]);
        $b = $this->makeProduct();

        $response = $this->postJson('/api/inventory/opening-balances', [
            'note' => 'Stok awal cut-over',
            'items' => [
                ['product_id' => $a, 'qty' => '24', 'unit_cost' => '2000', 'expiry_date' => '2027-03-01', 'batch_code' => 'L1'],
                ['product_id' => $b, 'qty' => '10.5', 'unit_cost' => '1000'],
            ],
        ])->assertCreated();

        $response->assertJsonPath('data.document_no', 'OPEN-000001')
            ->assertJsonCount(2, 'data.items')
            ->assertJsonPath('data.items.1.qty', '10.500');

        $location = DB::table('locations')->where('type', 'store_floor')->value('id');
        $this->assertDatabaseHas('inventory_balances', ['product_id' => $a, 'location_id' => $location, 'qty_sellable' => '24.000']);
        $this->assertDatabaseHas('inventory_balances', ['product_id' => $b, 'location_id' => $location, 'qty_sellable' => '10.500']);
        $this->assertDatabaseHas('product_batches', ['product_id' => $a, 'batch_code' => 'L1', 'expiry_date' => '2027-03-01', 'is_opening' => 1]);
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $a, 'movement_type' => 'opening_balance', 'qty' => '24.000',
            'to_location_id' => $location, 'to_bucket' => 'sellable', 'ref_type' => 'opening_balance', 'ref_id' => 1, 'created_by' => $admin->id,
        ]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'inventory.opening_balance', 'actor_id' => $admin->id]);
        $this->assertSame('2000.0000', DB::table('products')->where('id', $a)->value('avg_cost'));

        // produk di daftar menampilkan stok baru
        $this->getJson("/api/products/{$a}")->assertJsonPath('data.stock_sellable', '24.000');
    }

    public function test_second_document_gets_next_number_and_extra_batch_for_same_product(): void
    {
        $this->signIn('Admin');
        $p = $this->makeProduct();

        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => $p, 'qty' => 5]]])
            ->assertCreated()->assertJsonPath('data.document_no', 'OPEN-000001');
        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => $p, 'qty' => 3, 'expiry_date' => '2027-01-01']]])
            ->assertCreated()->assertJsonPath('data.document_no', 'OPEN-000002');

        $this->assertSame(2, DB::table('product_batches')->where('product_id', $p)->count());
        $this->getJson("/api/inventory/products/{$p}/stock")->assertOk()->assertJsonPath('data.totals.qty_sellable', '8.000');
    }

    public function test_cashier_is_forbidden(): void
    {
        $this->signIn('Kasir');
        $p = $this->makeProduct();

        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => $p, 'qty' => 5]]])->assertForbidden();
        $this->assertSame(0, DB::table('inventory_movements')->count());
    }

    public function test_guest_is_unauthenticated(): void
    {
        $this->postJson('/api/inventory/opening-balances', ['items' => []])->assertUnauthorized();
    }

    public function test_validation_errors(): void
    {
        $this->signIn('Admin');
        $p = $this->makeProduct();

        $this->postJson('/api/inventory/opening-balances', [])->assertUnprocessable()->assertJsonValidationErrors(['items']);
        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => $p, 'qty' => 0]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);
        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => $p, 'qty' => '1.2345']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);
        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => $p, 'qty' => 1, 'expiry_date' => '01-03-2027']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.expiry_date']);
        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => 999999, 'qty' => 1]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);
    }

    public function test_inactive_product_and_operational_history_are_rejected(): void
    {
        $this->signIn('Admin');
        $inactive = $this->makeProduct(['status' => 'inactive']);
        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => $inactive, 'qty' => 1]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);

        $withSale = $this->makeProduct();
        DB::table('inventory_movements')->insert([
            'store_id' => $this->storeId(), 'product_id' => $withSale, 'from_bucket' => 'sellable', 'qty' => 1,
            'movement_type' => 'sale', 'ref_type' => 'sale', 'ref_id' => 1, 'occurred_at' => now(),
        ]);
        $this->postJson('/api/inventory/opening-balances', ['items' => [['product_id' => $withSale, 'qty' => 1]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);
    }

    public function test_one_invalid_line_rolls_back_the_whole_document(): void
    {
        $this->signIn('Admin');
        $good = $this->makeProduct();

        $this->postJson('/api/inventory/opening-balances', ['items' => [
            ['product_id' => $good, 'qty' => 5],
            ['product_id' => 999999, 'qty' => 1],
        ]])->assertUnprocessable();

        $this->assertSame(0, DB::table('inventory_movements')->count());
        $this->assertSame(0, DB::table('inventory_balances')->count());
        $this->assertSame(0, DB::table('product_batches')->count());
    }

    public function test_stock_breakdown_flags_expiry_and_movements_are_listed(): void
    {
        $this->signIn('Admin');
        $p = $this->makeProduct(['track_expiry' => 1]);

        $near = now('Asia/Jakarta')->addDays(10)->toDateString();
        $far = now('Asia/Jakarta')->addDays(200)->toDateString();
        $past = now('Asia/Jakarta')->subDays(2)->toDateString();

        $this->postJson('/api/inventory/opening-balances', ['items' => [
            ['product_id' => $p, 'qty' => 1, 'expiry_date' => $far],
            ['product_id' => $p, 'qty' => 2, 'expiry_date' => $near],
            ['product_id' => $p, 'qty' => 3, 'expiry_date' => $past],
            ['product_id' => $p, 'qty' => 4],
        ]])->assertCreated();

        $batches = $this->getJson("/api/inventory/products/{$p}/stock")->assertOk()
            ->assertJsonPath('data.totals.qty_sellable', '10.000')
            ->json('data.batches');

        // urut FEFO: kadaluarsa terdekat dulu, tanpa tanggal terakhir
        $this->assertSame(['expired', 'near_expiry', 'ok', 'none'], array_column($batches, 'expiry_status'));

        $this->getJson("/api/inventory/movements?product_id={$p}&movement_type=opening_balance")
            ->assertOk()->assertJsonPath('total', 4)->assertJsonPath('data.0.product_name', DB::table('products')->where('id', $p)->value('name'));

        $this->getJson('/api/inventory/movements?movement_type=bogus')->assertUnprocessable();
    }

    public function test_cashier_can_read_stock_but_unknown_product_is_404(): void
    {
        $this->signIn('Kasir');
        $p = $this->makeProduct();

        $this->getJson("/api/inventory/products/{$p}/stock")->assertOk()->assertJsonPath('data.product_id', $p);
        $this->getJson('/api/inventory/products/999999/stock')->assertNotFound();
    }
}
