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
            'good_quantity' => 17,
            'damaged_quantity' => 0,
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
            'good_quantity' => 17,
            'damaged_quantity' => 0,
            'client_request_id' => $requestId,
        ])->assertOk()->assertJsonPath('item.counted_qty', '17.000');
        $this->assertSame(1, DB::table('stock_opname_count_logs')->where('session_id', $sessionId)->count());

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'set',
            'good_quantity' => 20,
            'damaged_quantity' => 0,
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('item.counted_qty', '20.000');
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'add',
            'good_quantity' => 3,
            'damaged_quantity' => 0,
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('item.counted_qty', '23.000');
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'add',
            'good_quantity' => 0,
            'damaged_quantity' => 0,
            'client_request_id' => fake()->uuid(),
        ])->assertUnprocessable()->assertJsonValidationErrors(['good_quantity']);

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
            'good_quantity' => 0,
            'damaged_quantity' => 0,
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
            'good_quantity' => 2,
            'damaged_quantity' => 0,
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
        $this->getJson('/api/auth/me')->assertOk()->assertJsonFragment(['opname.count']);
        $productId = $this->product();
        $sessionId = $this->startAll();
        $itemId = (int) DB::table('stock_opname_items')->where('session_id', $sessionId)->where('product_id', $productId)->value('id');
        $this->signIn('Kasir', 'cashier-count-denied');

        $this->getJson('/api/auth/me')->assertOk()->assertJsonMissing(['opname.count']);
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

    public function test_items_can_list_recent_counts_and_exclude_ids_without_changing_default_order(): void
    {
        $this->actAsAdmin();
        $category = $this->category('Rak A');
        $first = $this->product(['category_id' => $category, 'name' => 'Barang A']);
        $second = $this->product(['category_id' => $category, 'name' => 'Barang B']);
        $third = $this->product(['category_id' => $category, 'name' => 'Barang C']);
        $sessionId = $this->startAll();
        $items = DB::table('stock_opname_items')->where('session_id', $sessionId)->get()->keyBy('product_id');

        foreach ([$first, $second] as $productId) {
            $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
                'item_id' => $items[$productId]->id,
                'mode' => 'set',
                'good_quantity' => $productId === $first ? 12 : 17,
                'damaged_quantity' => 0,
                'client_request_id' => fake()->uuid(),
            ])->assertOk();
        }
        DB::table('stock_opname_items')->where('id', $items[$first]->id)->update(['counted_at' => '2026-11-09 08:00:00.000']);
        DB::table('stock_opname_items')->where('id', $items[$second]->id)->update(['counted_at' => '2026-11-09 09:00:00.000']);

        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items?only_counted=true&sort=-counted_at&per_page=2")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.product_id', $second)
            ->assertJsonPath('data.0.counted_at', '2026-11-09 09:00:00.000')
            ->assertJsonPath('data.1.product_id', $first)
            ->assertJsonPath('data.1.counted_at', '2026-11-09 08:00:00.000');

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts/{$items[$first]->id}/clear", [
            'client_request_id' => fake()->uuid(),
        ])->assertOk();
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items?only_counted=true&sort=-counted_at")
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.product_id', $second);

        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items?category_id={$category}&scope=direct&only_uncounted=true&exclude_item_ids[]={$items[$first]->id}&exclude_item_ids[]={$items[$third]->id}")
            ->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items?category_id={$category}&scope=direct&only_uncounted=true")
            ->assertOk()->assertJsonCount(2, 'data')
            ->assertJsonPath('data.1.product_id', $third)
            ->assertJsonPath('data.1.counted_at', null);

        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items")
            ->assertOk()->assertJsonPath('data.0.name', 'Barang A');
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items?exclude_item_ids[]=1&exclude_item_ids[]=2&exclude_item_ids[]=3&exclude_item_ids[]=4&exclude_item_ids[]=5&exclude_item_ids[]=6&exclude_item_ids[]=7&exclude_item_ids[]=8&exclude_item_ids[]=9&exclude_item_ids[]=10&exclude_item_ids[]=11")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['exclude_item_ids']);
    }

    public function test_batch_counts_process_in_order_are_idempotent_and_keep_rejections_isolated(): void
    {
        $this->actAsAdmin();
        $firstProduct = $this->product(['barcode' => 'ABC-123']);
        $secondProduct = $this->product(['barcode' => 'XYZ-456']);
        $sessionId = $this->startAll();
        $items = DB::table('stock_opname_items')->where('session_id', $sessionId)->get()->keyBy('product_id');
        $createdAt = '2026-11-10T01:00:00+00:00';
        $setId = fake()->uuid();
        $addId = fake()->uuid();
        $invalidId = fake()->uuid();
        $clearId = fake()->uuid();
        $body = ['operations' => [
            [
                'client_request_id' => $setId,
                'action' => 'count',
                'item_id' => $items[$firstProduct]->id,
                'mode' => 'set',
                'good_quantity' => 10,
                'damaged_quantity' => 0,
                'client_created_at' => $createdAt,
            ],
            [
                'client_request_id' => $addId,
                'action' => 'count',
                'item_id' => $items[$firstProduct]->id,
                'mode' => 'add',
                'good_quantity' => 3,
                'damaged_quantity' => 0,
                'client_created_at' => $createdAt,
            ],
            [
                'client_request_id' => $invalidId,
                'action' => 'count',
                'item_id' => $items[$firstProduct]->id,
                'mode' => 'add',
                'quantity' => -2,
                'client_created_at' => $createdAt,
            ],
            [
                'client_request_id' => $clearId,
                'action' => 'clear',
                'item_id' => $items[$secondProduct]->id,
                'client_created_at' => $createdAt,
            ],
        ]];

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts/batch", $body)
            ->assertOk()
            ->assertJsonPath('results.0.status', 'ok')
            ->assertJsonPath('results.0.item.counted_qty', '10.000')
            ->assertJsonPath('results.1.status', 'ok')
            ->assertJsonPath('results.1.item.counted_qty', '13.000')
            ->assertJsonPath('results.2.status', 'rejected')
            ->assertJsonPath('results.2.error.code', 'validation_failed')
            ->assertJsonPath('results.3.status', 'ok')
            ->assertJsonPath('summary.counted_products', 1);
        $this->assertSame(3, DB::table('stock_opname_count_logs')->where('session_id', $sessionId)->count());
        $this->assertSame(3, DB::table('stock_opname_count_logs')->where('session_id', $sessionId)->where('via_batch', true)->count());
        $this->assertNotNull(DB::table('stock_opname_count_logs')->where('client_request_id', $setId)->value('client_created_at'));

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts/batch", $body)
            ->assertOk()
            ->assertJsonPath('results.0.status', 'duplicate')
            ->assertJsonPath('results.1.status', 'duplicate')
            ->assertJsonPath('results.3.status', 'duplicate');
        $this->assertSame(3, DB::table('stock_opname_count_logs')->where('session_id', $sessionId)->count());
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/lookup?q=abc-123&mode=barcode")
            ->assertOk()->assertJsonPath('data.0.product_id', $firstProduct);
    }

    public function test_offline_index_is_paginated_versioned_blind_and_requires_running_session(): void
    {
        $this->actAsAdmin();
        $category = $this->category('Offline');
        $product = $this->product(['category_id' => $category, 'barcode' => 'Offline-001']);
        $sessionId = $this->startAll();
        $itemId = (int) DB::table('stock_opname_items')->where('session_id', $sessionId)->where('product_id', $product)->value('id');
        $this->setSetting('opname.show_system_qty', true);
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts/batch", ['operations' => [[
            'client_request_id' => fake()->uuid(),
            'action' => 'count',
            'item_id' => $itemId,
            'mode' => 'set',
            'good_quantity' => 8,
            'damaged_quantity' => 0,
            'client_created_at' => now()->toIso8601String(),
        ]]])->assertOk();

        $response = $this->getJson("/api/stock-opname-sessions/{$sessionId}/offline-index?per_page=1");
        $response->assertOk()
            ->assertJsonPath('items.0.item_id', $itemId)
            ->assertJsonPath('items.0.counted_qty', 8)
            ->assertJsonPath('categories.0.name', 'Offline')
            ->assertJsonMissingPath('items.0.system_qty')
            ->assertJsonMissingPath('items.0.status')
            ->assertJsonMissingPath('items.0.variance_count');
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/offline-index?per_page=1")
            ->assertHeader('ETag', $response->headers->get('ETag'));

        $this->withHeaders(['If-None-Match' => $response->headers->get('ETag')])
            ->get("/api/stock-opname-sessions/{$sessionId}/offline-index?per_page=1")
            ->assertStatus(304);

        DB::table('stock_opname_sessions')->where('id', $sessionId)->update(['status' => 'cancelled']);
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/offline-index")
            ->assertStatus(409);
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts/batch", ['operations' => [[
            'client_request_id' => fake()->uuid(),
            'action' => 'count',
            'item_id' => $itemId,
            'mode' => 'set',
            'quantity' => 9,
        ], [
            'client_request_id' => fake()->uuid(),
            'action' => 'clear',
            'item_id' => $itemId,
        ]]])->assertOk()
            ->assertJsonPath('results.0.error.code', 'session_not_in_progress')
            ->assertJsonPath('results.1.error.code', 'session_not_in_progress');
    }

    public function test_item_sources_include_po_and_receipt_dates_with_remaining_good_and_damaged_qty(): void
    {
        $admin = $this->actAsAdmin();
        $productId = $this->product(['track_expiry' => true]);
        $supplierId = $this->supplier();
        $orderedQty = '10.000';
        $prId = $this->pr($admin->id, [$productId => [$orderedQty, '2000.00']], 'converted');
        $poId = $this->po($prId, $supplierId, [$productId => [$orderedQty, '2000.00']]);
        DB::table('purchase_orders')->where('id', $poId)->update(['order_date' => '2026-10-25']);
        $poItemId = $this->poItemId($poId, $productId);
        $locationId = (int) DB::table('locations')
            ->where('store_id', $this->storeId())->where('type', 'store_floor')->value('id');
        $receiptId = DB::table('goods_receipts')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => 'GR-OPN-SOURCE-0001',
            'po_id' => $poId,
            'supplier_id' => $supplierId,
            'receiving_location_id' => $locationId,
            'status' => 'posted',
            'document_status' => 'pending',
            'received_by' => $admin->id,
            'posted_at' => '2026-11-02 10:30:00.000',
        ]);
        $receiptItemId = DB::table('goods_receipt_items')->insertGetId([
            'gr_id' => $receiptId,
            'po_item_id' => $poItemId,
            'product_id' => $productId,
            'qty_ordered' => $orderedQty,
            'qty_received' => '8.000',
            'qty_damaged' => '2.000',
            'qty_short' => '0.000',
            'unit_cost' => '2000.00',
            'damage_disposition' => 'quarantine',
        ]);
        $batchId = DB::table('product_batches')->insertGetId([
            'product_id' => $productId,
            'goods_receipt_item_id' => $receiptItemId,
            'batch_code' => 'LOT-OPN-SOURCE',
        ]);
        DB::table('inventory_balances')->insert([
            'product_id' => $productId,
            'location_id' => $locationId,
            'batch_id' => $batchId,
            'qty_sellable' => '3.000',
            'qty_quarantine' => '1.000',
            'qty_damaged' => '2.000',
        ]);
        $sessionId = $this->startAll();

        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items?include_sources=1")
            ->assertOk()
            ->assertJsonPath('data.0.sku', DB::table('products')->where('id', $productId)->value('sku'))
            ->assertJsonPath('data.0.source_receipts.0.po_number', DB::table('purchase_orders')->where('id', $poId)->value('doc_number'))
            ->assertJsonPath('data.0.source_receipts.0.po_date', '2026-10-25')
            ->assertJsonPath('data.0.source_receipts.0.receipt_number', 'GR-OPN-SOURCE-0001')
            ->assertJsonPath('data.0.source_receipts.0.receipt_date', '2026-11-02 10:30:00.000')
            ->assertJsonPath('data.0.source_receipts.0.good_qty', '3.000')
            ->assertJsonPath('data.0.source_receipts.0.damaged_qty', '3.000');
    }

    public function test_count_batch_rejects_more_than_one_hundred_operations(): void
    {
        $this->actAsAdmin();
        $this->product();
        $sessionId = $this->startAll();
        $operations = array_fill(0, 101, [
            'client_request_id' => fake()->uuid(),
            'action' => 'clear',
            'item_id' => 1,
        ]);

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts/batch", ['operations' => $operations])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['operations']);
    }
}
