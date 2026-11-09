<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class OpnameCountTest extends SeededTestCase
{
    use BuildsPurchasing;

    private function category(string $name): int
    {
        return DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(),
            'name' => $name,
            'is_active' => 1,
        ]);
    }

    private function startAll(): int
    {
        return (int) $this->postJson('/api/stock-opname-sessions', [
            'scope_type' => 'all',
            'client_request_id' => fake()->uuid(),
        ])->assertCreated()->json('data.id');
    }

    public function test_set_add_idempotency_clear_and_recent_history_do_not_change_stock(): void
    {
        $this->actAsAdmin();
        $productId = $this->product();
        $locationId = (int) DB::table('locations')->where('store_id', $this->storeId())->where('type', 'store_floor')->value('id');
        DB::table('inventory_balances')->insert([
            'product_id' => $productId,
            'location_id' => $locationId,
            'qty_sellable' => '4.125',
            'qty_quarantine' => '0.000',
            'qty_damaged' => '0.000',
        ]);
        $sessionId = $this->startAll();
        $itemId = (int) DB::table('stock_opname_items')->where('session_id', $sessionId)->where('product_id', $productId)->value('id');

        $requestId = fake()->uuid();
        $first = $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'set',
            'quantity' => 17,
            'client_request_id' => $requestId,
        ])->assertOk()
            ->assertJsonPath('item.counted_qty', '17.000')
            ->assertJsonPath('item.status', 'counted')
            ->assertJsonPath('summary.counted_products', 1)
            ->assertJsonMissingPath('item.system_qty')
            ->assertJsonMissingPath('nodes.0.variance_count');
        $first->assertJsonMissingPath('item.system_qty_at_start');

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'set',
            'quantity' => 17,
            'client_request_id' => $requestId,
        ])->assertOk()->assertJsonPath('item.counted_qty', '17.000');
        $this->assertSame(1, DB::table('stock_opname_count_logs')->where('session_id', $sessionId)->count());

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'set',
            'quantity' => 20,
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('item.counted_qty', '20.000');
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'add',
            'quantity' => 3,
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('item.counted_qty', '23.000');

        foreach ([-1, 1000001, 1.5, 'abc'] as $quantity) {
            $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
                'item_id' => $itemId,
                'mode' => 'set',
                'quantity' => $quantity,
                'client_request_id' => fake()->uuid(),
            ])->assertUnprocessable()->assertJsonValidationErrors(['quantity']);
        }

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'set',
            'quantity' => 0,
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('item.counted_qty', '0.000');

        $this->getJson("/api/stock-opname-sessions/{$sessionId}/counts")
            ->assertOk()->assertJsonCount(4, 'data')
            ->assertJsonMissingPath('data.0.system_qty')
            ->assertJsonMissingPath('data.0.variance_count');

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts/{$itemId}/clear", [
            'client_request_id' => fake()->uuid(),
        ])->assertOk()
            ->assertJsonPath('item.counted_qty', null)
            ->assertJsonPath('item.status', 'uncounted')
            ->assertJsonPath('summary.counted_products', 0);

        $this->assertSame('4.125', DB::table('inventory_balances')->where('product_id', $productId)->value('qty_sellable'));
        $this->assertSame(5, DB::table('stock_opname_count_logs')->where('session_id', $sessionId)->count());
        $this->assertSame(0, DB::table('stock_adjustments')->count());
    }

    public function test_lookup_distinguishes_products_outside_session_and_respects_blind_display_setting(): void
    {
        $this->actAsAdmin();
        $insideCategory = $this->category('Di dalam sesi');
        $outsideCategory = $this->category('Di luar sesi');
        $inside = $this->product(['category_id' => $insideCategory, 'barcode' => '8996000012345']);
        $outside = $this->product(['category_id' => $outsideCategory, 'barcode' => '8996000054321']);
        DB::table('inventory_balances')->insert([
            'product_id' => $inside,
            'location_id' => DB::table('locations')->where('store_id', $this->storeId())->where('type', 'store_floor')->value('id'),
            'qty_sellable' => '6.000',
            'qty_quarantine' => '0.000',
            'qty_damaged' => '0.000',
        ]);
        $sessionId = (int) $this->postJson('/api/stock-opname-sessions', [
            'scope_type' => 'categories',
            'category_ids' => [$insideCategory],
            'client_request_id' => fake()->uuid(),
        ])->assertCreated()->json('data.id');
        $itemId = (int) DB::table('stock_opname_items')->where('session_id', $sessionId)->where('product_id', $inside)->value('id');

        $this->getJson("/api/stock-opname-sessions/{$sessionId}/lookup?q=8996000012345&mode=barcode")
            ->assertOk()->assertJsonPath('data.0.id', $itemId)
            ->assertJsonMissingPath('data.0.system_qty');
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/lookup?q=Barang&mode=search")
            ->assertOk()->assertJsonCount(1, 'data');
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/lookup?q=8996000054321&mode=auto")
            ->assertNotFound()->assertJsonPath('code', 'not_in_session')
            ->assertJsonPath('product_name', DB::table('products')->where('id', $outside)->value('name'));
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/lookup?q=0000000000000&mode=auto")
            ->assertNotFound()->assertJsonPath('code', 'unknown_barcode');

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'set',
            'quantity' => 2,
            'client_request_id' => fake()->uuid(),
        ])->assertOk();
        $this->setSetting('opname.show_system_qty', true);
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/lookup?q=8996000012345&mode=barcode")
            ->assertOk()->assertJsonPath('data.0.system_qty', '6.000')
            ->assertJsonPath('data.0.status', 'variance');
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/tree")
            ->assertOk()->assertJsonPath('nodes.0.variance_count', 1);
    }

    public function test_count_requires_opname_count_permission_but_lock_status_is_available_to_cashier(): void
    {
        $this->actAsAdmin();
        $productId = $this->product();
        $sessionId = $this->startAll();
        $itemId = (int) DB::table('stock_opname_items')->where('session_id', $sessionId)->where('product_id', $productId)->value('id');
        $this->signIn('Kasir', 'cashier-count-denied');

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'set',
            'quantity' => 1,
            'client_request_id' => fake()->uuid(),
        ])->assertForbidden();
        $this->getJson('/api/stock-opname/lock-status')
            ->assertOk()
            ->assertJsonPath('locked', true)
            ->assertJsonPath('store_wide', true)
            ->assertJsonMissingPath('stock')
            ->assertJsonMissingPath('system_qty');
    }
}
