<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class StockAdjustmentTest extends SeededTestCase
{
    private function stockFixture(string $qty = '8', bool $trackExpiry = false): array
    {
        $this->signIn('Admin');
        static $sequence = 0;
        $sequence++;

        $productId = DB::table('products')->insertGetId([
            'store_id' => $this->storeId(),
            'sku' => "ADJ-{$sequence}",
            'barcode' => sprintf('89971000%05d', $sequence),
            'name' => "Produk Adjustment {$sequence}",
            'sell_price' => 5000,
            'status' => 'active',
            'track_expiry' => $trackExpiry,
        ]);
        $locationId = (int) DB::table('locations')
            ->where('store_id', $this->storeId())->where('type', 'store_floor')->value('id');

        $this->postJson('/api/inventory/opening-balances', [
            'items' => [[
                'product_id' => $productId,
                'qty' => $qty,
                'unit_cost' => '2500',
                'expiry_date' => $trackExpiry ? '2027-01-01' : null,
            ]],
        ])->assertCreated();

        return [
            'product_id' => $productId,
            'location_id' => $locationId,
            'batch_id' => (int) DB::table('product_batches')->where('product_id', $productId)->value('id'),
        ];
    }

    private function payload(array $fixture, string $counted, string $reason = 'opname'): array
    {
        return [
            'reason' => $reason,
            'note' => 'Pemeriksaan stok fisik',
            'items' => [[
                'product_id' => $fixture['product_id'],
                'batch_id' => $fixture['batch_id'],
                'location_id' => $fixture['location_id'],
                'qty_counted' => $counted,
            ]],
        ];
    }

    private function approver(string $username = 'stock-owner', string $password = 'rahasia-12345'): User
    {
        $user = $this->makeUser('Admin', $username, $password);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_cashier_creates_draft_then_approved_opname_posts_stock_atomically(): void
    {
        $fixture = $this->stockFixture();
        $cashier = $this->signIn('Kasir', 'kasir-adjust');
        $draft = $this->postJson('/api/inventory/adjustments', $this->payload($fixture, '5'))
            ->assertCreated()
            ->assertJsonPath('data.doc_number', 'ADJ-000001')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.items.0.qty_before', '8.000')
            ->assertJsonPath('data.items.0.qty_diff', '-3.000');
        $id = (int) $draft->json('data.id');

        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
        $this->postJson("/api/inventory/adjustments/{$id}/request")
            ->assertOk()->assertJsonPath('data.status', 'requested');

        $approver = $this->approver();
        $this->postJson("/api/inventory/adjustments/{$id}/approve")
            ->assertOk()->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.approved_by', $approver->id);

        $this->assertSame('5.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_sellable'));
        $this->assertSame(2, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'adjustment',
            'from_bucket' => 'sellable',
            'qty' => '3.000',
            'ref_type' => 'stock_adjustment',
            'ref_id' => $id,
        ]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_adjustment.create', 'entity_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_adjustment.request', 'entity_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_adjustment.approve', 'entity_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_adjustment.post', 'entity_id' => $id]);
        $this->assertSame('2500.0000', DB::table('products')->where('id', $fixture['product_id'])->value('avg_cost'));
        $this->assertSame($cashier->id, (int) DB::table('stock_adjustments')->where('id', $id)->value('requested_by'));
    }

    public function test_positive_opname_adjustment_adds_sellable_stock_without_reauth(): void
    {
        $fixture = $this->stockFixture();
        $this->signIn('Kasir', 'kasir-adjust-up');
        $id = (int) $this->postJson('/api/inventory/adjustments', $this->payload($fixture, '10'))
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/adjustments/{$id}/request")->assertOk();
        $this->approver('stock-owner-up');

        $this->postJson("/api/inventory/adjustments/{$id}/approve")
            ->assertOk()->assertJsonPath('data.status', 'posted');

        $this->assertSame('10.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_sellable'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'adjustment',
            'to_bucket' => 'sellable',
            'qty' => '2.000',
        ]);
    }

    public function test_damage_adjustment_moves_stock_to_damaged_bucket(): void
    {
        $fixture = $this->stockFixture();
        $this->signIn('Kasir', 'kasir-damage');
        $id = (int) $this->postJson('/api/inventory/adjustments', $this->payload($fixture, '6', 'damage'))
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/adjustments/{$id}/request")->assertOk();
        $this->approver('stock-owner-damage');

        $this->postJson("/api/inventory/adjustments/{$id}/approve")
            ->assertOk()->assertJsonPath('data.status', 'posted');

        $balance = DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->first();
        $this->assertSame('6.000', $balance->qty_sellable);
        $this->assertSame('2.000', $balance->qty_damaged);
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'adjustment',
            'from_bucket' => 'sellable',
            'to_bucket' => 'damaged',
            'qty' => '2.000',
        ]);
    }

    public function test_loss_and_expired_approval_require_reauthentication_and_write_off_movement(): void
    {
        $fixture = $this->stockFixture();
        $this->signIn('Kasir', 'kasir-loss');
        $id = (int) $this->postJson('/api/inventory/adjustments', $this->payload($fixture, '6', 'loss'))
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/adjustments/{$id}/request")->assertOk();
        $this->approver('stock-owner-loss');

        $this->postJson("/api/inventory/adjustments/{$id}/approve")
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $this->postJson("/api/inventory/adjustments/{$id}/approve", [
            'approver_username' => 'stock-owner-loss',
            'approver_password' => 'wrong-password',
        ])->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $this->assertSame('8.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_sellable'));

        $approver = DB::table('users')->where('username', 'stock-owner-loss')->first();
        $this->postJson("/api/inventory/adjustments/{$id}/approve", [
            'approver_username' => $approver->username,
            'approver_password' => 'rahasia-12345',
        ])->assertOk()->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.reauth_at', fn ($value) => $value !== null);

        $this->assertSame('6.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_sellable'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'write_off',
            'qty' => '2.000',
            'ref_type' => 'stock_adjustment',
            'ref_id' => $id,
        ]);
    }

    public function test_approval_rejects_stale_opname_without_changing_stock(): void
    {
        $fixture = $this->stockFixture();
        $this->signIn('Kasir', 'kasir-stale');
        $id = (int) $this->postJson('/api/inventory/adjustments', $this->payload($fixture, '5'))
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/adjustments/{$id}/request")->assertOk();
        DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->update(['qty_sellable' => '7.000']);
        $this->approver('stock-owner-stale');

        $this->postJson("/api/inventory/adjustments/{$id}/approve")
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty_counted']);

        $this->assertSame('requested', DB::table('stock_adjustments')->where('id', $id)->value('status'));
        $this->assertSame('7.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_sellable'));
        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
    }

    public function test_rejected_and_cancelled_adjustments_do_not_change_stock(): void
    {
        $fixture = $this->stockFixture();
        $this->signIn('Kasir', 'kasir-cancel-adjust');
        $cancelled = (int) $this->postJson('/api/inventory/adjustments', $this->payload($fixture, '7'))
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/adjustments/{$cancelled}/cancel", ['reason' => 'Input salah'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');

        $rejected = (int) $this->postJson('/api/inventory/adjustments', $this->payload($fixture, '6'))
            ->assertCreated()->json('data.id');
        $this->postJson("/api/inventory/adjustments/{$rejected}/request")->assertOk();
        $this->approver('stock-owner-reject');
        $this->postJson("/api/inventory/adjustments/{$rejected}/approve", [
            'decision' => 'reject',
            'note' => 'Perlu hitung ulang',
        ])->assertOk()->assertJsonPath('data.status', 'rejected');

        $this->assertSame('8.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_sellable'));
        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
    }

    public function test_quantities_positions_and_access_are_validated(): void
    {
        $fixture = $this->stockFixture();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/inventory/adjustments')->assertUnauthorized();
        $this->signIn('Kasir', 'kasir-invalid-adjust');

        $payload = $this->payload($fixture, '1.2345');
        $this->postJson('/api/inventory/adjustments', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty_counted']);

        $payload = $this->payload($fixture, '1');
        $payload['items'][0]['shelf_position_id'] = 999999;
        $this->postJson('/api/inventory/adjustments', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.shelf_position_id']);

        $this->postJson('/api/inventory/adjustments/999999/approve')
            ->assertForbidden();
        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
    }

    public function test_expiry_tracked_products_require_a_batch_for_adjustment(): void
    {
        $fixture = $this->stockFixture('8', true);
        $this->signIn('Kasir', 'kasir-expiry-adjust');
        $payload = $this->payload($fixture, '5');
        $payload['items'][0]['batch_id'] = null;

        $this->postJson('/api/inventory/adjustments', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.batch_id']);
        $this->assertSame(0, DB::table('stock_adjustments')->count());
    }
}
