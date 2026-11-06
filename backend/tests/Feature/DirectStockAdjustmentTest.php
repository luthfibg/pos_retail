<?php

namespace Tests\Feature;

use App\Services\InventoryService;
use App\Services\StockAdjustmentService;
use Illuminate\Support\Facades\DB;
use Mockery;
use RuntimeException;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class DirectStockAdjustmentTest extends SeededTestCase
{
    use BuildsPurchasing;

    /** @return array{product_id: int, location_id: int, barcode: string} */
    private function fixture(string $qty = '8', bool $trackExpiry = false): array
    {
        $this->actAsAdmin();
        $productId = $this->product(['track_expiry' => $trackExpiry ? 1 : 0]);
        $barcode = (string) DB::table('products')->where('id', $productId)->value('barcode');
        $locationId = (int) DB::table('locations')
            ->where('store_id', $this->storeId())
            ->where('type', 'store_floor')
            ->where('is_active', 1)
            ->orderBy('id')
            ->value('id');

        $this->postJson('/api/inventory/opening-balances', [
            'items' => [[
                'product_id' => $productId,
                'qty' => $qty,
                'unit_cost' => '2500',
                'expiry_date' => $trackExpiry ? '2027-01-01' : null,
            ]],
        ])->assertCreated();

        return ['product_id' => $productId, 'location_id' => $locationId, 'barcode' => $barcode];
    }

    /** @return array<string, mixed> */
    private function payload(array $fixture, string $type, int $quantity, string $reason = 'input_correction'): array
    {
        return [
            'product_id' => $fixture['product_id'],
            'type' => $type,
            'quantity' => $quantity,
            'reason_code' => $reason,
            'client_request_id' => fake()->uuid(),
        ];
    }

    public function test_increase_posts_stock_and_returns_document_snapshot(): void
    {
        $fixture = $this->fixture();
        $this->signIn('Kasir', 'cashier-direct-increase');

        $response = $this->postJson('/api/stock-adjustments', $this->payload($fixture, 'increase', 3))
            ->assertCreated()
            ->assertJsonPath('data.type', 'increase')
            ->assertJsonPath('data.quantity', 3)
            ->assertJsonPath('data.stock_before', '8.000')
            ->assertJsonPath('data.stock_after', '11.000')
            ->assertJsonPath('data.source', 'manual');

        $id = (int) $response->json('data.id');
        $this->assertSame(11.0, (float) DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'adjustment',
            'to_bucket' => 'sellable',
            'qty' => '3.000',
            'ref_type' => 'stock_adjustment',
            'ref_id' => $id,
        ]);
        $this->assertDatabaseHas('stock_adjustments', [
            'id' => $id,
            'status' => 'posted',
            'reason_code' => 'input_correction',
            'source' => 'manual',
        ]);
    }

    public function test_decrease_posts_stock_using_fefo_and_writes_off_expired_reason(): void
    {
        $fixture = $this->fixture();
        $this->actAsAdmin();

        $response = $this->postJson('/api/stock-adjustments', $this->payload($fixture, 'decrease', 3, 'lost'))
            ->assertCreated()
            ->assertJsonPath('data.stock_before', '8.000')
            ->assertJsonPath('data.stock_after', '5.000');

        $this->assertSame(5.0, (float) DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'write_off',
            'from_bucket' => 'sellable',
            'qty' => '3.000',
            'ref_id' => $response->json('data.id'),
        ]);
    }

    public function test_decrease_over_stock_returns_insufficient_stock_and_rolls_back_document(): void
    {
        $fixture = $this->fixture('2');
        $this->signIn('Kasir', 'cashier-direct-short');
        $input = $this->payload($fixture, 'decrease', 3);

        $this->postJson('/api/stock-adjustments', $input)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'insufficient_stock');

        $this->assertSame(2.0, (float) DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->assertSame(0, DB::table('stock_adjustments')->where('client_request_id', $input['client_request_id'])->count());
        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
    }

    public function test_other_requires_notes_and_manual_opname_reason_is_rejected(): void
    {
        $fixture = $this->fixture();
        $this->actAsAdmin();

        $this->postJson('/api/stock-adjustments', $this->payload($fixture, 'increase', 1, 'other'))
            ->assertUnprocessable()->assertJsonValidationErrors(['notes']);
        $this->postJson('/api/stock-adjustments', array_merge($this->payload($fixture, 'increase', 1), ['reason_code' => 'opname_result']))
            ->assertUnprocessable()->assertJsonValidationErrors(['reason_code']);

        $this->assertSame(0, DB::table('stock_adjustments')->whereNotNull('reason_code')->count());
    }

    public function test_same_client_request_id_returns_existing_document_without_duplicate_movement(): void
    {
        $fixture = $this->fixture();
        $this->signIn('Kasir', 'cashier-direct-idempotent');
        $input = $this->payload($fixture, 'increase', 2);

        $first = $this->postJson('/api/stock-adjustments', $input)->assertCreated();
        $this->postJson('/api/stock-adjustments', $input)->assertOk()
            ->assertJsonPath('data.id', $first->json('data.id'));

        $this->assertSame(1, DB::table('stock_adjustments')->where('client_request_id', $input['client_request_id'])->count());
        $this->assertSame(1, DB::table('inventory_movements')->where('ref_type', 'stock_adjustment')
            ->where('ref_id', $first->json('data.id'))->count());
        $this->assertSame(10.0, (float) DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
    }

    public function test_expiry_tracked_increase_requires_and_records_expiry_date(): void
    {
        $fixture = $this->fixture('2', true);
        $this->actAsAdmin();
        $input = $this->payload($fixture, 'increase', 1);

        $this->postJson('/api/stock-adjustments', $input)->assertUnprocessable()->assertJsonValidationErrors(['expiry_date']);
        $this->postJson('/api/stock-adjustments', $input + ['expiry_date' => '2027-03-01'])
            ->assertCreated();
        $this->assertDatabaseHas('product_batches', [
            'product_id' => $fixture['product_id'],
            'expiry_date' => '2027-03-01',
            'batch_code' => null,
        ]);
    }

    public function test_direct_adjustment_routes_require_admin_or_cashier_role_not_adjustment_permission(): void
    {
        $this->getJson('/api/stock-adjustments/meta')->assertUnauthorized();
        $this->signIn('Finance', 'finance-no-direct-adjustment');
        $this->getJson('/api/stock-adjustments/meta')->assertForbidden();

        $this->signIn('Kasir', 'cashier-direct-meta');
        $this->getJson('/api/stock-adjustments/meta')->assertOk()
            ->assertJsonPath('data.reasons.7.requires_notes', true);
    }

    public function test_manual_list_supports_search_filter_and_pagination(): void
    {
        $fixture = $this->fixture();
        $this->actAsAdmin();
        $this->postJson('/api/stock-adjustments', $this->payload($fixture, 'increase', 1, 'found'))->assertCreated();
        $this->postJson('/api/stock-adjustments', $this->payload($fixture, 'decrease', 1, 'lost'))->assertCreated();

        $this->getJson('/api/stock-adjustments?q='.$fixture['barcode'].'&type=decrease&per_page=1')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.reason_code', 'lost');
    }

    public function test_internal_opname_source_is_supported_without_manual_selectability(): void
    {
        $fixture = $this->fixture();
        $admin = $this->actAsAdmin();

        $result = app(StockAdjustmentService::class)->record($admin, $this->storeId(), [
            'product_id' => $fixture['product_id'],
            'type' => 'increase',
            'quantity' => 1,
            'reason_code' => 'opname_result',
        ], 'opname', 42);

        $this->assertSame('opname', $result['adjustment']['source']);
        $this->assertSame(42, $result['adjustment']['opname_session_id']);
        $this->assertDatabaseHas('stock_adjustments', [
            'id' => $result['adjustment']['id'],
            'reason_code' => 'opname_result',
            'opname_session_id' => 42,
        ]);
    }

    public function test_inventory_failure_rolls_back_adjustment_document(): void
    {
        $fixture = $this->fixture();
        $admin = $this->actAsAdmin();
        $inventory = Mockery::mock(InventoryService::class);
        $inventory->shouldReceive('recordDirectAdjustment')->once()->andThrow(new RuntimeException('Movement failed.'));
        $this->app->instance(InventoryService::class, $inventory);

        try {
            app(StockAdjustmentService::class)->record($admin, $this->storeId(), $this->payload($fixture, 'increase', 1));
            $this->fail('Expected inventory failure.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Movement failed.', $exception->getMessage());
        }

        $this->assertSame(0, DB::table('stock_adjustments')->whereNotNull('reason_code')->count());
    }
}
