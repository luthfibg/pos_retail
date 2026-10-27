<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class StockTransferTest extends SeededTestCase
{
    private function stockFixture(string $qty = '8'): array
    {
        $this->signIn('Admin');
        static $sequence = 0;
        $sequence++;

        $productId = DB::table('products')->insertGetId([
            'store_id' => $this->storeId(),
            'sku' => "TRF-{$sequence}",
            'barcode' => sprintf('89970000%05d', $sequence),
            'name' => "Produk Transfer {$sequence}",
            'sell_price' => 5000,
            'status' => 'active',
        ]);
        $locationId = (int) DB::table('locations')
            ->where('store_id', $this->storeId())->where('type', 'store_floor')->value('id');
        $fromPositionId = $this->makePosition($locationId, "A{$sequence}");
        $toPositionId = $this->makePosition($locationId, "B{$sequence}");

        $this->postJson('/api/inventory/opening-balances', [
            'items' => [[
                'product_id' => $productId,
                'qty' => $qty,
                'unit_cost' => '2500',
                'shelf_position_id' => $fromPositionId,
            ]],
        ])->assertCreated();

        return [
            'product_id' => $productId,
            'location_id' => $locationId,
            'from_position_id' => $fromPositionId,
            'to_position_id' => $toPositionId,
            'batch_id' => (int) DB::table('product_batches')->where('product_id', $productId)->value('id'),
        ];
    }

    private function makePosition(int $locationId, string $code): int
    {
        $shelfId = DB::table('shelves')->insertGetId([
            'location_id' => $locationId,
            'code' => $code,
            'name' => "Rak {$code}",
        ]);

        return DB::table('shelf_positions')->insertGetId([
            'shelf_id' => $shelfId,
            'level' => 1,
            'slot' => 1,
        ]);
    }

    private function transferPayload(array $fixture, string $qty = '5'): array
    {
        return [
            'from_location_id' => $fixture['location_id'],
            'to_location_id' => $fixture['location_id'],
            'items' => [[
                'product_id' => $fixture['product_id'],
                'batch_id' => $fixture['batch_id'],
                'from_position_id' => $fixture['from_position_id'],
                'to_position_id' => $fixture['to_position_id'],
                'qty' => $qty,
            ]],
        ];
    }

    public function test_posted_transfer_moves_the_same_batch_and_records_both_movements_atomically(): void
    {
        $fixture = $this->stockFixture();
        $draft = $this->postJson('/api/inventory/transfers', $this->transferPayload($fixture))
            ->assertCreated()
            ->assertJsonPath('data.doc_number', 'TRF-000001')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.items.0.qty', '5.000');
        $transferId = $draft->json('data.id');

        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());

        $this->postJson("/api/inventory/transfers/{$transferId}/post")
            ->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.items.0.batch_id', $fixture['batch_id']);

        $this->assertDatabaseHas('inventory_balances', [
            'product_id' => $fixture['product_id'],
            'location_id' => $fixture['location_id'],
            'shelf_position_id' => $fixture['from_position_id'],
            'batch_id' => $fixture['batch_id'],
            'qty_sellable' => '3.000',
        ]);
        $this->assertDatabaseHas('inventory_balances', [
            'product_id' => $fixture['product_id'],
            'location_id' => $fixture['location_id'],
            'shelf_position_id' => $fixture['to_position_id'],
            'batch_id' => $fixture['batch_id'],
            'qty_sellable' => '5.000',
        ]);
        $this->assertSame('8.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->assertSame('2500.0000', DB::table('products')->where('id', $fixture['product_id'])->value('avg_cost'));

        $movements = DB::table('inventory_movements')->where('ref_type', 'stock_transfer')
            ->where('ref_id', $transferId)->orderBy('id')->get();
        $this->assertCount(2, $movements);
        $this->assertSame('sellable', $movements[0]->from_bucket);
        $this->assertNull($movements[0]->to_bucket);
        $this->assertSame('sellable', $movements[1]->to_bucket);
        $this->assertNull($movements[1]->from_bucket);
        $this->assertSame($fixture['batch_id'], (int) $movements[1]->batch_id);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_transfer.create', 'entity_id' => $transferId]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_transfer.post', 'entity_id' => $transferId]);

        $this->getJson('/api/inventory/transfers?status=posted')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.status', 'posted');
        $this->getJson('/api/inventory/movements?movement_type=transfer')
            ->assertOk()->assertJsonPath('total', 2);
    }

    public function test_insufficient_aggregate_source_stock_keeps_draft_and_balances_unchanged(): void
    {
        $fixture = $this->stockFixture('5');
        $payload = $this->transferPayload($fixture, '3');
        $secondPosition = $this->makePosition($fixture['location_id'], 'C');
        $payload['items'][] = [
            'product_id' => $fixture['product_id'],
            'batch_id' => $fixture['batch_id'],
            'from_position_id' => $fixture['from_position_id'],
            'to_position_id' => $secondPosition,
            'qty' => '3',
        ];
        $transferId = $this->postJson('/api/inventory/transfers', $payload)
            ->assertCreated()->json('data.id');

        $this->postJson("/api/inventory/transfers/{$transferId}/post")
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);

        $this->assertDatabaseHas('stock_transfers', ['id' => $transferId, 'status' => 'draft']);
        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
        $this->assertSame('5.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->where('shelf_position_id', $fixture['from_position_id'])->value('qty_sellable'));
        $this->assertSame(0, DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->where('shelf_position_id', $secondPosition)->count());
    }

    public function test_invalid_positions_same_position_and_invalid_qty_are_rejected(): void
    {
        $fixture = $this->stockFixture();
        $payload = $this->transferPayload($fixture);
        $payload['items'][0]['to_position_id'] = $fixture['from_position_id'];
        $this->postJson('/api/inventory/transfers', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.to_position_id']);

        $payload = $this->transferPayload($fixture, '1.0001');
        $this->postJson('/api/inventory/transfers', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);

        $payload = $this->transferPayload($fixture);
        $payload['items'][0]['to_position_id'] = 999999;
        $this->postJson('/api/inventory/transfers', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.to_position_id']);
    }

    public function test_warehouse_transfer_is_blocked_when_warehouse_setting_is_disabled(): void
    {
        $fixture = $this->stockFixture();
        $warehouseId = DB::table('locations')->insertGetId([
            'store_id' => $this->storeId(),
            'type' => 'warehouse',
            'name' => 'Gudang uji',
            'is_active' => 1,
        ]);
        $payload = $this->transferPayload($fixture);
        $payload['from_location_id'] = $warehouseId;

        $this->postJson('/api/inventory/transfers', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors(['from_location_id']);
        $this->assertSame(0, DB::table('stock_transfers')->count());

        DB::table('settings')->where('store_id', $this->storeId())
            ->where('setting_key', 'warehouse_enabled')
            ->update(['setting_value' => json_encode(true)]);

        $payload = $this->transferPayload($fixture, '2');
        $payload['to_location_id'] = $warehouseId;
        $payload['items'][0]['to_position_id'] = null;
        $putawayId = $this->postJson('/api/inventory/transfers', $payload)
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/transfers/{$putawayId}/post")
            ->assertOk()->assertJsonPath('data.status', 'posted');

        $payload['from_location_id'] = $warehouseId;
        $payload['to_location_id'] = $fixture['location_id'];
        $payload['items'][0]['from_position_id'] = null;
        $payload['items'][0]['to_position_id'] = $fixture['to_position_id'];
        $putawayId = $this->postJson('/api/inventory/transfers', $payload)
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/transfers/{$putawayId}/post")
            ->assertOk()->assertJsonPath('data.status', 'posted');

        $this->assertSame('6.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])
            ->where('location_id', $fixture['location_id'])->where('shelf_position_id', $fixture['from_position_id'])->value('qty_sellable'));
        $this->assertSame('2.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])
            ->where('location_id', $fixture['location_id'])->where('shelf_position_id', $fixture['to_position_id'])->value('qty_sellable'));
        $this->assertSame('0.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])
            ->where('location_id', $warehouseId)->whereNull('shelf_position_id')->value('qty_sellable'));
    }

    public function test_cashier_can_transfer_stock_and_guest_is_rejected(): void
    {
        $this->postJson('/api/inventory/transfers', [])->assertUnauthorized();
        $fixture = $this->stockFixture();
        $payload = $this->transferPayload($fixture);

        $this->signIn('Kasir');
        $transferId = $this->postJson('/api/inventory/transfers', $payload)
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/transfers/{$transferId}/post")
            ->assertOk()->assertJsonPath('data.status', 'posted');
    }

    public function test_only_draft_transfer_can_be_cancelled_or_posted(): void
    {
        $fixture = $this->stockFixture();
        $transferId = $this->postJson('/api/inventory/transfers', $this->transferPayload($fixture))
            ->assertCreated()->json('data.id');

        $this->postJson("/api/inventory/transfers/{$transferId}/cancel", ['reason' => 'Salah pilih lokasi'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->postJson("/api/inventory/transfers/{$transferId}/post")
            ->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_transfer.cancel', 'entity_id' => $transferId]);
    }
}
