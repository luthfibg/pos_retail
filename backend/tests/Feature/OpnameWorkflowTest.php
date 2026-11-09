<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use RuntimeException;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class OpnameWorkflowTest extends SeededTestCase
{
    use BuildsPurchasing;

    /** @return array{product_id: int, item_id: int, session_id: int} */
    private function countedProduct(string $systemQty, string $countedQty, ?string $cost = '1000.0000', ?int $categoryId = null): array
    {
        $categoryId ??= DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(),
            'name' => 'Kategori Opname '.fake()->unique()->numerify('###'),
            'is_active' => 1,
        ]);
        $productId = $this->product(['category_id' => $categoryId, 'unit_cost' => $cost]);
        $locationId = (int) DB::table('locations')->where('store_id', $this->storeId())
            ->where('type', 'store_floor')->where('is_active', 1)->value('id');
        DB::table('inventory_balances')->insert([
            'product_id' => $productId,
            'location_id' => $locationId,
            'qty_sellable' => $systemQty,
            'qty_quarantine' => '0.000',
            'qty_damaged' => '0.000',
        ]);
        $sessionId = (int) $this->postJson('/api/stock-opname-sessions', [
            'scope_type' => 'categories',
            'category_ids' => [$categoryId],
            'client_request_id' => fake()->uuid(),
        ])->assertCreated()->json('data.id');
        $itemId = (int) DB::table('stock_opname_items')
            ->where('session_id', $sessionId)->where('product_id', $productId)->value('id');
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $itemId,
            'mode' => 'set',
            'quantity' => (int) $countedQty,
            'client_request_id' => fake()->uuid(),
        ])->assertOk();

        return ['product_id' => $productId, 'item_id' => $itemId, 'session_id' => $sessionId];
    }

    private function owner(string $username = 'owner-uji'): User
    {
        return $this->makeUser('Owner', $username, 'password-owner-123');
    }

    public function test_report_hides_differences_until_complete_and_lists_only_variance_products(): void
    {
        $this->actAsAdmin();
        $categoryId = DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(), 'name' => 'Kategori Uji', 'is_active' => 1,
        ]);
        $fixtures = [];
        foreach ([['5.000', '5'], ['6.000', '4']] as [$stock, $count]) {
            $productId = $this->product(['category_id' => $categoryId, 'unit_cost' => '1000.0000']);
            DB::table('inventory_balances')->insert([
                'product_id' => $productId,
                'location_id' => DB::table('locations')->where('store_id', $this->storeId())->where('type', 'store_floor')->value('id'),
                'qty_sellable' => $stock,
                'qty_quarantine' => '0.000',
                'qty_damaged' => '0.000',
            ]);
            $fixtures[] = [$productId, $count];
        }
        $sessionId = (int) $this->postJson('/api/stock-opname-sessions', [
            'scope_type' => 'all', 'client_request_id' => fake()->uuid(),
        ])->assertCreated()->json('data.id');
        $items = DB::table('stock_opname_items')->where('session_id', $sessionId)->orderBy('product_id')->get();
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/report")
            ->assertStatus(409)->assertJsonPath('code', 'counting_incomplete')
            ->assertJsonMissingPath('categories');
        foreach ($items as $index => $item) {
            $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
                'item_id' => $item->id, 'mode' => 'set', 'quantity' => (int) $fixtures[$index][1],
                'client_request_id' => fake()->uuid(),
            ])->assertOk();
        }
        $revisedItem = $items->firstWhere('product_id', $fixtures[1][0]);
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $revisedItem->id,
            'mode' => 'set',
            'quantity' => 4,
            'client_request_id' => fake()->uuid(),
        ])->assertOk();

        $report = $this->getJson("/api/stock-opname-sessions/{$sessionId}/report")
            ->assertOk()->assertJsonPath('data.complete', true)
            ->assertJsonPath('data.clean', false)
            ->assertJsonPath('data.totals.variance_products', 1)
            ->assertJsonPath('data.totals.short_qty', '2.000')
            ->assertJsonMissingPath('data.totals.abs_value')
            ->assertJsonPath('data.approval.required', true)
            ->assertJsonPath('data.approval.reasons.0.type', 'first_opname')
            ->assertJsonPath('data.categories.0.lines.0.revised', true)
            ->assertJsonCount(1, 'data.categories.0.lines');
        $this->assertSame((int) $items[1]->product_id, $report->json('data.categories.0.lines.0.product_id'));
    }

    public function test_admin_submits_for_owner_and_owner_approval_posts_once_with_frozen_cost(): void
    {
        $admin = $this->actAsAdmin();
        $fixture = $this->countedProduct('10.000', '11', '5000.0000');
        $sessionId = $fixture['session_id'];
        $requestId = fake()->uuid();

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/submit", ['client_request_id' => $requestId])
            ->assertOk()->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonMissingPath('data.abs_value');
        $this->assertSame('5000.0000', DB::table('stock_opname_items')->where('id', $fixture['item_id'])->value('unit_cost_snapshot'));
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $fixture['item_id'], 'mode' => 'set', 'quantity' => 2, 'client_request_id' => fake()->uuid(),
        ])->assertStatus(409);

        $owner = $this->owner();
        DB::table('products')->where('id', $fixture['product_id'])->update(['unit_cost' => '9999.0000']);
        Sanctum::actingAs($owner, ['*']);
        $approvalRequest = fake()->uuid();
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/approve", [
            'client_request_id' => fake()->uuid(),
            'owner_password' => 'password-salah',
        ])->assertUnprocessable()->assertJsonValidationErrors(['owner_password']);
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/approve", [
            'client_request_id' => $approvalRequest, 'owner_password' => 'password-owner-123',
        ])->assertOk()->assertJsonPath('data.status', 'posted');
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/approve", [
            'client_request_id' => $approvalRequest, 'owner_password' => 'password-owner-123',
        ])->assertOk()->assertJsonPath('data.status', 'posted');

        $this->assertSame(11.0, (float) DB::table('inventory_balances')->where('product_id', $fixture['product_id'])
            ->selectRaw('SUM(qty_sellable + qty_quarantine + qty_damaged) as total')->value('total'));
        $this->assertSame('9999.0000', DB::table('products')->where('id', $fixture['product_id'])->value('unit_cost'));
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/report")
            ->assertOk()->assertJsonPath('data.totals.abs_value', '5000.00');
        $this->assertSame(1, DB::table('inventory_movements')->where('ref_type', 'stock_opname')->where('ref_id', $sessionId)->count());
        $this->assertSame(1, DB::table('stock_opname_approvals')->where('session_id', $sessionId)->where('action', 'approved')->count());
        $this->assertSame($admin->id, (int) DB::table('stock_opname_sessions')->where('id', $sessionId)->value('submitted_by'));
    }

    public function test_rejection_clears_frozen_values_and_returns_session_to_counting(): void
    {
        $this->actAsAdmin();
        $fixture = $this->countedProduct('10.000', '8', '1000.0000');
        $sessionId = $fixture['session_id'];
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/submit", ['client_request_id' => fake()->uuid()])
            ->assertOk()->assertJsonPath('data.status', 'pending_approval');

        $this->makeUser('Admin', 'admin-no-owner-approval');
        $this->actingAs(User::where('username', 'admin-no-owner-approval')->firstOrFail());
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/approve", [
            'client_request_id' => fake()->uuid(), 'owner_password' => 'wrong',
        ])->assertForbidden();

        Sanctum::actingAs($this->owner(), ['*']);
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/reject", [
            'client_request_id' => fake()->uuid(),
            'owner_password' => 'password-owner-123',
            'reason' => 'Periksa kembali jumlah fisik',
        ])->assertOk()->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.reject_reason', 'Periksa kembali jumlah fisik');
        $this->assertNull(DB::table('stock_opname_items')->where('id', $fixture['item_id'])->value('unit_cost_snapshot'));
        $this->assertNull(DB::table('stock_opname_sessions')->where('id', $sessionId)->value('abs_value'));
    }

    public function test_owner_threshold_settings_are_owner_only_and_admin_report_omits_money(): void
    {
        $this->actAsAdmin();
        $this->getJson('/api/settings/opname')->assertOk()
            ->assertJsonMissingPath('data.per_product_threshold');
        $this->putJson('/api/settings/opname', ['per_product_threshold' => 100])
            ->assertForbidden();

        $owner = $this->owner();
        Sanctum::actingAs($owner, ['*']);
        $this->putJson('/api/settings/opname', [
            'per_product_threshold' => 30000,
            'per_session_threshold' => 250000,
            'require_first_opname' => false,
        ])->assertOk()->assertJsonPath('data.per_product_threshold', 30000);
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.opname_approval', 'actor_id' => $owner->id]);
    }

    public function test_direct_admin_post_is_idempotent_when_thresholds_do_not_require_approval(): void
    {
        $admin = $this->actAsAdmin();
        $this->setSetting('opname.approval.require_first_opname', false);
        $fixture = $this->countedProduct('5.000', '6', '100.0000');
        $requestId = fake()->uuid();
        $path = "/api/stock-opname-sessions/{$fixture['session_id']}/submit";
        $this->postJson($path, ['client_request_id' => $requestId])
            ->assertOk()->assertJsonPath('data.status', 'posted')
            ->assertJsonMissingPath('data.abs_value');
        $this->postJson($path, ['client_request_id' => $requestId])
            ->assertOk()->assertJsonPath('data.status', 'posted');
        $this->assertSame(6.0, (float) DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->assertSame(1, DB::table('inventory_movements')->where('ref_type', 'stock_opname')->where('ref_id', $fixture['session_id'])->count());
        $this->assertSame(1, DB::table('stock_opname_approvals')->where('session_id', $fixture['session_id'])->where('action', 'posted')->count());
        $this->assertNotNull($admin);
    }

    public function test_per_product_threshold_is_inclusive_and_one_rupiah_below_posts_directly(): void
    {
        $this->actAsAdmin();
        $this->setSetting('opname.approval.require_first_opname', false);
        $this->setSetting('opname.approval.per_session_threshold', 1000000);

        $below = $this->countedProduct('1.000', '2', '24999.9900');
        $this->postJson("/api/stock-opname-sessions/{$below['session_id']}/submit", [
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('data.status', 'posted');

        $atThreshold = $this->countedProduct('1.000', '2', '25000.0000');
        $this->postJson("/api/stock-opname-sessions/{$atThreshold['session_id']}/submit", [
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.approval_reasons.0.type', 'per_product_threshold');
    }

    public function test_session_threshold_uses_absolute_short_and_over_values_even_when_net_is_zero(): void
    {
        $this->actAsAdmin();
        $this->setSetting('opname.approval.require_first_opname', false);
        $this->setSetting('opname.approval.per_product_threshold', 1000000);
        $categoryId = DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(), 'name' => 'Kategori Selisih', 'is_active' => 1,
        ]);
        $productIds = [
            $this->product(['category_id' => $categoryId, 'unit_cost' => '100000.0000']),
            $this->product(['category_id' => $categoryId, 'unit_cost' => '100000.0000']),
        ];
        $locationId = (int) DB::table('locations')->where('store_id', $this->storeId())
            ->where('type', 'store_floor')->where('is_active', 1)->value('id');
        foreach ($productIds as $productId) {
            DB::table('inventory_balances')->insert([
                'product_id' => $productId,
                'location_id' => $locationId,
                'qty_sellable' => '10.000',
                'qty_quarantine' => '0.000',
                'qty_damaged' => '0.000',
            ]);
        }
        $sessionId = (int) $this->postJson('/api/stock-opname-sessions', [
            'scope_type' => 'categories',
            'category_ids' => [$categoryId],
            'client_request_id' => fake()->uuid(),
        ])->assertCreated()->json('data.id');
        $items = DB::table('stock_opname_items')->where('session_id', $sessionId)->orderBy('product_id')->get();
        foreach ($items as $index => $item) {
            $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
                'item_id' => $item->id,
                'mode' => 'set',
                'quantity' => $index === 0 ? 11 : 9,
                'client_request_id' => fake()->uuid(),
            ])->assertOk();
        }

        $this->getJson("/api/stock-opname-sessions/{$sessionId}/report")
            ->assertOk()->assertJsonPath('data.totals.net_qty', '0.000')
            ->assertJsonPath('data.approval.required', true)
            ->assertJsonPath('data.approval.reasons.0.type', 'per_session_threshold')
            ->assertJsonMissingPath('data.totals.abs_value');
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/submit", [
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('data.status', 'pending_approval');

        Sanctum::actingAs($this->owner(), ['*']);
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/report")
            ->assertOk()->assertJsonPath('data.totals.abs_value', '200000.00')
            ->assertJsonPath('data.totals.short_value', '100000.00')
            ->assertJsonPath('data.totals.over_value', '100000.00');
    }

    public function test_cost_missing_requires_owner_and_owner_can_post_directly_with_password(): void
    {
        $this->actAsAdmin();
        $this->setSetting('opname.approval.require_first_opname', false);
        $missingCost = $this->countedProduct('2.000', '1', '0.0000');
        $this->postJson("/api/stock-opname-sessions/{$missingCost['session_id']}/submit", [
            'client_request_id' => fake()->uuid(),
        ])->assertOk()->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.approval_reasons.0.type', 'cost_missing');

        Sanctum::actingAs($this->owner(), ['*']);
        $this->postJson("/api/stock-opname-sessions/{$missingCost['session_id']}/reject", [
            'client_request_id' => fake()->uuid(),
            'owner_password' => 'password-owner-123',
            'reason' => 'Uji melanjutkan sesi berikutnya',
        ])->assertOk()->assertJsonPath('data.status', 'in_progress');
        $this->postJson("/api/stock-opname-sessions/{$missingCost['session_id']}/cancel", [
            'reason' => 'Selesaikan fixture pengujian',
        ])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $ownerFixture = $this->countedProduct('4.000', '5', '5000.0000');
        $this->postJson("/api/stock-opname-sessions/{$ownerFixture['session_id']}/submit", [
            'client_request_id' => fake()->uuid(),
            'owner_password' => 'password-owner-123',
        ])->assertOk()->assertJsonPath('data.status', 'posted');
        $this->assertSame(5.0, (float) DB::table('inventory_balances')
            ->where('product_id', $ownerFixture['product_id'])->sum('qty_sellable'));
    }

    public function test_stock_integrity_failure_rolls_back_posting(): void
    {
        $this->actAsAdmin();
        $this->setSetting('opname.approval.require_first_opname', false);
        $fixture = $this->countedProduct('5.000', '6', '100.0000');
        DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->update(['qty_sellable' => '4.000']);

        $this->postJson("/api/stock-opname-sessions/{$fixture['session_id']}/submit", [
            'client_request_id' => fake()->uuid(),
        ])->assertStatus(409)->assertJsonPath('code', 'stock_changed_during_opname');
        $this->assertSame('in_progress', DB::table('stock_opname_sessions')
            ->where('id', $fixture['session_id'])->value('status'));
        $this->assertSame(0, DB::table('inventory_movements')
            ->where('ref_type', 'stock_opname')->where('ref_id', $fixture['session_id'])->count());
    }

    public function test_posting_failure_after_first_movement_rolls_back_the_whole_transaction(): void
    {
        $this->actAsAdmin();
        $this->setSetting('opname.approval.require_first_opname', false);
        $this->setSetting('opname.approval.per_product_threshold', 1000000);
        $this->setSetting('opname.approval.per_session_threshold', 1000000);
        $categoryId = DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(), 'name' => 'Kategori Atomik', 'is_active' => 1,
        ]);
        $productIds = [
            $this->product(['category_id' => $categoryId, 'unit_cost' => '100.0000']),
            $this->product(['category_id' => $categoryId, 'unit_cost' => '100.0000']),
        ];
        $locationId = (int) DB::table('locations')->where('store_id', $this->storeId())
            ->where('type', 'store_floor')->where('is_active', 1)->value('id');
        foreach ($productIds as $productId) {
            DB::table('inventory_balances')->insert([
                'product_id' => $productId,
                'location_id' => $locationId,
                'qty_sellable' => '10.000',
                'qty_quarantine' => '0.000',
                'qty_damaged' => '0.000',
            ]);
        }
        $sessionId = (int) $this->postJson('/api/stock-opname-sessions', [
            'scope_type' => 'categories',
            'category_ids' => [$categoryId],
            'client_request_id' => fake()->uuid(),
        ])->assertCreated()->json('data.id');
        $items = DB::table('stock_opname_items')->where('session_id', $sessionId)->orderBy('product_id')->get();
        foreach ($items as $index => $item) {
            $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
                'item_id' => $item->id,
                'mode' => 'set',
                'quantity' => $index === 0 ? 11 : 9,
                'client_request_id' => fake()->uuid(),
            ])->assertOk();
        }

        $inventory = app(InventoryService::class);
        $partial = Mockery::mock($inventory)->makePartial();
        $partial->shouldReceive('postOpnameAdjustments')->once()->andReturnUsing(
            function (User $actor, int $storeId, int $sourceSessionId, array $lines) use ($inventory) {
                $inventory->postOpnameAdjustments($actor, $storeId, $sourceSessionId, [$lines[0]]);
                throw new RuntimeException('Simulated posting failure.');
            },
        );
        $this->app->instance(InventoryService::class, $partial);
        $this->withoutExceptionHandling();
        try {
            $this->postJson("/api/stock-opname-sessions/{$sessionId}/submit", [
                'client_request_id' => fake()->uuid(),
            ]);
            $this->fail('Posting failure should escape and roll back the transaction.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Simulated posting failure.', $exception->getMessage());
        }

        $this->assertSame('in_progress', DB::table('stock_opname_sessions')->where('id', $sessionId)->value('status'));
        $this->assertSame(0, DB::table('inventory_movements')->where('ref_type', 'stock_opname')->where('ref_id', $sessionId)->count());
        foreach ($productIds as $productId) {
            $this->assertSame(10.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_sellable'));
        }
    }

    public function test_clean_report_has_category_summary_without_product_lines(): void
    {
        $this->actAsAdmin();
        $fixture = $this->countedProduct('3.000', '3');

        $this->getJson("/api/stock-opname-sessions/{$fixture['session_id']}/report")
            ->assertOk()->assertJsonPath('data.clean', true)
            ->assertJsonPath('data.totals.variance_products', 0)
            ->assertJsonPath('data.categories.0.variance_count', 0)
            ->assertJsonPath('data.categories.0.lines', []);
    }
}
