<?php

namespace Tests\Feature;

use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class OpnameSessionTest extends SeededTestCase
{
    use BuildsPurchasing;

    private function category(string $name, ?int $parentId = null, bool $active = true): int
    {
        return DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(),
            'parent_id' => $parentId,
            'name' => $name,
            'is_active' => $active ? 1 : 0,
        ]);
    }

    /** @return array{product_id: int, location_id: int} */
    private function productWithStock(?int $categoryId = null, string $quantity = '0.000', string $status = 'active'): array
    {
        $productId = $this->product(['category_id' => $categoryId, 'status' => $status]);
        $locationId = (int) DB::table('locations')->where('store_id', $this->storeId())
            ->where('type', 'store_floor')->where('is_active', 1)->orderBy('id')->value('id');
        if ($quantity !== '0.000') {
            DB::table('inventory_balances')->insert([
                'product_id' => $productId,
                'location_id' => $locationId,
                'qty_sellable' => $quantity,
                'qty_quarantine' => '0.000',
                'qty_damaged' => '0.000',
            ]);
        }

        return ['product_id' => $productId, 'location_id' => $locationId];
    }

    /** @param list<int> $categoryIds */
    private function startPayload(string $scope = 'all', array $categoryIds = [], ?string $requestId = null): array
    {
        return [
            'scope_type' => $scope,
            ...($scope === 'categories' ? ['category_ids' => $categoryIds] : []),
            'client_request_id' => $requestId ?? fake()->uuid(),
        ];
    }

    public function test_start_all_snapshots_every_active_product_without_changing_stock_or_exposing_quantities(): void
    {
        $this->actAsAdmin();
        $withStock = $this->productWithStock(null, '4.125');
        $zeroStock = $this->productWithStock();
        $this->productWithStock(null, '0.000', 'inactive');

        $response = $this->postJson('/api/stock-opname-sessions', $this->startPayload())
            ->assertCreated()
            ->assertJsonPath('data.scope_type', 'all')
            ->assertJsonPath('data.total_products', 2)
            ->assertJsonPath('data.counted_products', 0)
            ->assertJsonMissingPath('data.system_qty_at_start')
            ->assertJsonMissingPath('data.items');

        $sessionId = (int) $response->json('data.id');
        $this->assertDatabaseHas('stock_opname_items', [
            'session_id' => $sessionId, 'product_id' => $withStock['product_id'], 'system_qty_at_start' => '4.125',
        ]);
        $this->assertDatabaseHas('stock_opname_items', [
            'session_id' => $sessionId, 'product_id' => $zeroStock['product_id'], 'system_qty_at_start' => '0.000',
        ]);
        $this->assertSame(4.125, (float) DB::table('inventory_balances')->where('product_id', $withStock['product_id'])->sum('qty_sellable'));

        $this->getJson('/api/stock-opname-sessions')->assertOk()
            ->assertJsonMissingPath('data.0.system_qty_at_start')
            ->assertJsonMissingPath('data.0.items');
        $this->getJson("/api/stock-opname-sessions/{$sessionId}")->assertOk()
            ->assertJsonMissingPath('data.system_qty_at_start')
            ->assertJsonMissingPath('data.items');
    }

    public function test_category_scope_includes_descendants_and_deduplicates_selected_parent_and_child(): void
    {
        $this->actAsAdmin();
        $parent = $this->category('Makanan');
        $child = $this->category('Makanan Ringan', $parent);
        $other = $this->category('Minuman');
        $parentProduct = $this->productWithStock($parent);
        $childProduct = $this->productWithStock($child);
        $this->productWithStock($other);

        $response = $this->postJson('/api/stock-opname-sessions', $this->startPayload('categories', [$parent, $child]))
            ->assertCreated()
            ->assertJsonPath('data.total_products', 2);

        $this->assertSame(2, DB::table('stock_opname_items')->where('session_id', $response->json('data.id'))->count());
        $this->assertDatabaseHas('stock_opname_items', ['session_id' => $response->json('data.id'), 'product_id' => $parentProduct['product_id']]);
        $this->assertDatabaseHas('stock_opname_items', ['session_id' => $response->json('data.id'), 'product_id' => $childProduct['product_id']]);
        $this->assertSame(2, count($response->json('data.scope_categories', [])));
    }

    public function test_empty_scope_and_overlapping_active_scope_are_rejected_with_conflict_numbers(): void
    {
        $this->actAsAdmin();
        $empty = $this->category('Kosong');
        $this->postJson('/api/stock-opname-sessions', $this->startPayload('categories', [$empty]))
            ->assertUnprocessable();

        $category = $this->category('Kebutuhan');
        $this->productWithStock($category);
        $first = $this->postJson('/api/stock-opname-sessions', $this->startPayload('categories', [$category]))->assertCreated();
        $this->postJson('/api/stock-opname-sessions', $this->startPayload())
            ->assertUnprocessable()
            ->assertJsonPath('conflicting_sessions.0.id', $first->json('data.id'))
            ->assertJsonPath('conflicting_sessions.0.number', $first->json('data.number'));
    }

    public function test_non_overlapping_category_scopes_can_run_in_parallel_and_options_mark_locked_categories(): void
    {
        $this->actAsAdmin();
        $left = $this->category('Kiri');
        $right = $this->category('Kanan');
        $this->productWithStock($left);
        $this->productWithStock($right);
        $first = $this->postJson('/api/stock-opname-sessions', $this->startPayload('categories', [$left]))->assertCreated();
        $second = $this->postJson('/api/stock-opname-sessions', $this->startPayload('categories', [$right]))->assertCreated();
        $this->assertNotSame($first->json('data.id'), $second->json('data.id'));

        $options = $this->getJson('/api/stock-opname/scope-options')->assertOk()->json('data');
        $byId = collect($options)->keyBy('id');
        $this->assertSame($first->json('data.number'), $byId[$left]['locked_by']['number']);
        $this->assertSame($second->json('data.number'), $byId[$right]['locked_by']['number']);
        $this->assertSame(2, $this->getJson('/api/stock-opname-sessions')->json('total'));
    }

    public function test_start_is_idempotent_and_cancel_frees_products_without_changing_stock(): void
    {
        $this->actAsAdmin();
        $fixture = $this->productWithStock(null, '8.000');
        $input = $this->startPayload('all', [], fake()->uuid());

        $first = $this->postJson('/api/stock-opname-sessions', $input)->assertCreated();
        $this->postJson('/api/stock-opname-sessions', $input)->assertOk()
            ->assertJsonPath('data.id', $first->json('data.id'));
        $this->postJson("/api/stock-opname-sessions/{$first->json('data.id')}/cancel", ['reason' => 'Pemeriksaan ditunda'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.cancel_reason', 'Pemeriksaan ditunda');

        $this->assertSame(8.0, (float) DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated();
        $this->postJson("/api/stock-opname-sessions/{$first->json('data.id')}/cancel", ['reason' => 'ulang'])
            ->assertUnprocessable();
        $this->postJson('/api/stock-opname-sessions/'.DB::table('stock_opname_sessions')->where('status', 'in_progress')->value('id').'/cancel', ['reason' => '   '])
            ->assertUnprocessable();
    }

    public function test_item_insert_failure_rolls_back_the_whole_start_transaction(): void
    {
        $this->actAsAdmin();
        $this->productWithStock();
        DB::listen(function ($query): void {
            if (str_starts_with(strtolower(ltrim($query->sql)), 'insert into `stock_opname_items`')) {
                throw new RuntimeException('Simulated item insert failure.');
            }
        });

        try {
            $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertServerError();
        } finally {
            DB::disableQueryLog();
        }

        $this->assertSame(0, DB::table('stock_opname_sessions')->count());
        $this->assertSame(0, DB::table('stock_opname_items')->count());
    }

    public function test_permissions_cover_accounting_view_but_not_cashier_access(): void
    {
        $this->productWithStock();
        $this->getJson('/api/stock-opname-sessions')->assertUnauthorized();
        $this->signIn('Kasir', 'cashier-opname-denied');
        $this->getJson('/api/stock-opname-sessions')->assertForbidden();

        $this->signIn('Accounting', 'accounting-opname-view');
        $this->getJson('/api/stock-opname-sessions')->assertOk();
        $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertForbidden();

        $this->signIn('Owner', 'owner-opname-create');
        $session = $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated();
        $this->postJson("/api/stock-opname-sessions/{$session->json('data.id')}/cancel", ['reason' => 'Pembatalan uji'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
    }

    public function test_adjustments_opname_foreign_key_is_installed(): void
    {
        $foreignKeys = Schema::getForeignKeys('stock_adjustments');

        $this->assertTrue(collect($foreignKeys)->contains(
            fn (array $foreignKey) => $foreignKey['name'] === 'fk_sa_opname_session'
                && $foreignKey['foreign_table'] === 'stock_opname_sessions'
                && $foreignKey['columns'] === ['opname_session_id'],
        ));
    }

    public function test_list_filters_and_scope_option_counts_use_active_products_only(): void
    {
        $this->actAsAdmin();
        $parent = $this->category('Pangan');
        $child = $this->category('Roti', $parent);
        $other = $this->category('Minuman');
        $this->productWithStock($child);
        $this->productWithStock($child, '0.000', 'inactive');
        $this->productWithStock($other);
        $response = $this->postJson('/api/stock-opname-sessions', $this->startPayload('categories', [$parent], fake()->uuid()))
            ->assertCreated();
        $second = $this->postJson('/api/stock-opname-sessions', $this->startPayload('categories', [$other], fake()->uuid()))
            ->assertCreated();

        $today = now('UTC')->toDateString();
        $this->getJson("/api/stock-opname-sessions?status=in_progress&q=OPN&per_page=1&date_from={$today}&date_to={$today}")
            ->assertOk()->assertJsonPath('total', 2)->assertJsonPath('last_page', 2)
            ->assertJsonPath('data.0.id', $second->json('data.id'));
        $this->getJson('/api/stock-opname-sessions?sort=oldest&per_page=1')
            ->assertOk()->assertJsonPath('data.0.id', $response->json('data.id'));
        $this->getJson('/api/stock-opname-sessions?status=cancelled')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/stock-opname-sessions?date_from='.now('UTC')->addDay()->toDateString())
            ->assertOk()->assertJsonPath('total', 0);
        $options = $this->getJson('/api/stock-opname/scope-options')->assertOk();
        $categories = collect($options->json('data'))->keyBy('id');
        $this->assertSame(1, $categories[$parent]['product_count']);
        $this->assertSame(2, $options->json('total_products'));
    }

    public function test_tree_aggregates_direct_products_and_children_while_blind_mode_omits_variance(): void
    {
        $this->actAsAdmin();
        $parent = $this->category('Makanan');
        $child = $this->category('Mi Instan', $parent);
        $direct = $this->productWithStock($parent, '5.000');
        $counted = $this->productWithStock($child, '7.000');
        $uncounted = $this->productWithStock($child, '2.000');
        $session = $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated()->json('data');
        $now = now('UTC')->format('Y-m-d H:i:s.v');
        DB::table('stock_opname_items')->where('session_id', $session['id'])->where('product_id', $counted['product_id'])->update([
            'counted_qty' => '8.000',
            'system_qty_at_count' => '7.000',
            'counted_at' => $now,
            'counted_by' => $this->seededAdmin()->id,
        ]);

        $tree = $this->getJson("/api/stock-opname-sessions/{$session['id']}/tree")
            ->assertOk()
            ->assertJsonPath('summary.total_products', 3)
            ->assertJsonPath('summary.counted_products', 1)
            ->assertJsonPath('display.reveals_system_qty', false);
        $this->assertArrayNotHasKey('variance_count', $tree->json('nodes.0'));
        $this->assertSame(3, $tree->json('nodes.0.product_count'));
        $this->assertSame(1, $tree->json('nodes.0.direct_product_count'));
        $this->assertSame(1, $tree->json('nodes.0.counted_count'));
        $this->assertSame('partial', $tree->json('nodes.0.status'));
        $this->assertSame('partial', $tree->json('nodes.0.children.0.status'));

        DB::table('stock_opname_items')->where('session_id', $session['id'])->update(['counted_qty' => '0.000']);
        $completeTree = $this->getJson("/api/stock-opname-sessions/{$session['id']}/tree")
            ->assertOk()->assertJsonPath('nodes.0.status', 'done');
        $this->assertSame('done', $completeTree->json('nodes.0.children.0.status'));
        $this->assertDatabaseHas('stock_opname_items', ['session_id' => $session['id'], 'product_id' => $direct['product_id']]);
        $this->assertDatabaseHas('stock_opname_items', ['session_id' => $session['id'], 'product_id' => $uncounted['product_id']]);
    }

    public function test_show_system_qty_setting_controls_all_item_fields_and_audit(): void
    {
        $admin = $this->actAsAdmin();
        $fixture = $this->productWithStock(null, '6.000');
        $session = $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated()->json('data');
        $item = DB::table('stock_opname_items')->where('session_id', $session['id'])->first();
        DB::table('stock_opname_items')->where('id', $item->id)->update([
            'counted_qty' => '5.000',
            'system_qty_at_count' => '6.000',
            'counted_at' => now('UTC')->format('Y-m-d H:i:s.v'),
            'counted_by' => $admin->id,
        ]);

        $this->getJson("/api/stock-opname-sessions/{$session['id']}/tree")
            ->assertOk()->assertJsonMissingPath('nodes.0.variance_count');
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items")
            ->assertOk()->assertJsonMissingPath('data.0.system_qty')
            ->assertJsonPath('data.0.status', 'counted');
        $this->getJson('/api/settings/opname')->assertOk()->assertJsonPath('data.show_system_qty', false);

        $this->putJson('/api/settings/opname', ['show_system_qty' => true])
            ->assertOk()->assertJsonPath('data.show_system_qty', true);
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/tree")
            ->assertOk()->assertJsonPath('nodes.0.variance_count', 1);
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items")
            ->assertOk()->assertJsonPath('data.0.system_qty', '6.000')
            ->assertJsonPath('data.0.status', 'variance');
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'settings.opname_display',
            'actor_id' => $admin->id,
        ]);

        $this->putJson('/api/settings/opname', ['show_system_qty' => false])->assertOk();
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items")
            ->assertOk()->assertJsonMissingPath('data.0.system_qty')
            ->assertJsonPath('data.0.status', 'counted');
        $this->assertDatabaseHas('stock_opname_items', ['id' => $item->id, 'product_id' => $fixture['product_id']]);
    }

    public function test_items_support_direct_descendant_search_barcode_priority_and_blind_redaction(): void
    {
        $this->actAsAdmin();
        $parent = $this->category('Minuman');
        $child = $this->category('Air Mineral', $parent);
        $direct = $this->productWithStock($parent);
        $nested = $this->productWithStock($child);
        $session = $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated()->json('data');

        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items?category_id={$parent}&scope=direct")
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.product_id', $direct['product_id']);
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items?category_id={$parent}&scope=all")
            ->assertOk()->assertJsonPath('total', 2);
        $barcode = (string) DB::table('products')->where('id', $nested['product_id'])->value('barcode');
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items?q={$barcode}")
            ->assertOk()->assertJsonPath('data.0.product_id', $nested['product_id'])
            ->assertJsonPath('data.0.category_path.0', 'Minuman')
            ->assertJsonPath('data.0.category_path.1', 'Air Mineral')
            ->assertJsonMissingPath('data.0.system_qty');
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items?q=A&only_uncounted=1")
            ->assertUnprocessable();
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items?only_uncounted=1")
            ->assertOk()->assertJsonPath('total', 2);
    }

    public function test_moved_category_items_are_grouped_under_other_using_snapshot_path(): void
    {
        $this->actAsAdmin();
        $oldParent = $this->category('Makanan');
        $moved = $this->category('Mi Instan', $oldParent);
        $newParent = $this->category('Barang Rumah Tangga');
        $product = $this->productWithStock($moved);
        $session = $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated()->json('data');
        DB::table('categories')->where('id', $moved)->update(['parent_id' => $newParent]);

        $tree = $this->getJson("/api/stock-opname-sessions/{$session['id']}/tree")
            ->assertOk()->assertJsonPath('nodes.0.name', 'Lainnya')
            ->assertJsonPath('nodes.0.product_count', 1);
        $this->assertSame('other', $tree->json('nodes.0.id'));
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/items?category_id=0")
            ->assertOk()->assertJsonPath('data.0.product_id', $product['product_id'])
            ->assertJsonPath('data.0.category_path.0', 'Makanan')
            ->assertJsonPath('data.0.category_path.1', 'Mi Instan');
    }

    public function test_counted_progress_is_reflected_in_session_list_and_cancelled_tree_remains_readable(): void
    {
        $this->actAsAdmin();
        $this->productWithStock();
        $session = $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated()->json('data');
        $itemId = DB::table('stock_opname_items')->where('session_id', $session['id'])->value('id');
        DB::table('stock_opname_items')->where('id', $itemId)->update(['counted_qty' => '0.000']);
        $this->getJson('/api/stock-opname-sessions')->assertOk()->assertJsonPath('data.0.counted_products', 1);
        $this->getJson("/api/stock-opname-sessions/{$session['id']}")
            ->assertOk()->assertJsonPath('data.counted_products', 1);
        $this->postJson("/api/stock-opname-sessions/{$session['id']}/cancel", ['reason' => 'Selesai uji'])->assertOk();
        $this->getJson("/api/stock-opname-sessions/{$session['id']}/tree")
            ->assertOk()->assertJsonPath('session.status', 'cancelled');
    }

    public function test_opname_setting_is_restricted_to_admin_and_owner(): void
    {
        $this->getJson('/api/settings/opname')->assertUnauthorized();
        $this->signIn('Kasir', 'cashier-opname-setting-denied');
        $this->getJson('/api/settings/opname')->assertForbidden();
        $this->signIn('Accounting', 'accounting-opname-setting-denied');
        $this->putJson('/api/settings/opname', ['show_system_qty' => true])->assertForbidden();
        $this->signIn('Owner', 'owner-opname-setting-allowed');
        $this->getJson('/api/settings/opname')->assertOk();
        $this->putJson('/api/settings/opname', ['show_system_qty' => true])->assertOk();
    }

    public function test_simulation_command_sets_requested_progress_and_reset_clears_it(): void
    {
        $this->actAsAdmin();
        $this->productWithStock(null, '4.000');
        $this->productWithStock(null, '8.000');
        $session = $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated()->json('data');

        $this->artisan('opname:simulate-counts', ['sessionId' => $session['id'], '--percent' => 50, '--variance' => 100])
            ->assertExitCode(0);
        $this->assertSame(1, DB::table('stock_opname_items')->where('session_id', $session['id'])->whereNotNull('counted_qty')->count());
        $this->assertSame(1, DB::table('stock_opname_items')->where('session_id', $session['id'])->whereColumn('counted_qty', '<>', 'system_qty_at_count')->count());

        $this->artisan('opname:simulate-counts', ['sessionId' => $session['id'], '--reset' => true])->assertExitCode(0);
        $this->assertSame(0, DB::table('stock_opname_items')->where('session_id', $session['id'])->whereNotNull('counted_qty')->count());
    }

    public function test_start_five_thousand_products_in_batched_inserts(): void
    {
        $this->actAsAdmin();
        $rows = [];
        for ($i = 1; $i <= 5000; $i++) {
            $rows[] = [
                'store_id' => $this->storeId(),
                'sku' => sprintf('OPN-%05d', $i),
                'barcode' => sprintf('89970000%05d', $i),
                'name' => sprintf('Produk Uji %05d', $i),
                'unit_name' => 'pcs',
                'track_expiry' => 0,
                'sell_price' => '5000.00',
                'status' => 'active',
            ];
            if (count($rows) === 500) {
                DB::table('products')->insert($rows);
                $rows = [];
            }
        }
        if ($rows !== []) {
            DB::table('products')->insert($rows);
        }

        $startedAt = hrtime(true);
        $response = $this->postJson('/api/stock-opname-sessions', $this->startPayload())->assertCreated();
        $elapsed = (hrtime(true) - $startedAt) / 1_000_000_000;

        $this->assertSame(5000, $response->json('data.total_products'));
        $this->assertSame(5000, DB::table('stock_opname_items')->where('session_id', $response->json('data.id'))->count());
        $treeStartedAt = hrtime(true);
        $this->getJson("/api/stock-opname-sessions/{$response->json('data.id')}/tree")->assertOk();
        $treeElapsed = (hrtime(true) - $treeStartedAt) / 1_000_000_000;
        $queryCounts = ['tree' => 0, 'items' => 0, 'guard' => 0];
        $phase = null;
        DB::listen(function ($query) use (&$queryCounts, &$phase) {
            if ($phase !== null && str_contains(strtolower($query->sql), 'stock_opname_items')) {
                $queryCounts[$phase]++;
            }
        });
        $phase = 'tree';
        $this->getJson("/api/stock-opname-sessions/{$response->json('data.id')}/tree")->assertOk();
        $phase = 'items';
        $itemsStartedAt = hrtime(true);
        $this->getJson("/api/stock-opname-sessions/{$response->json('data.id')}/items?per_page=100")->assertOk();
        $phase = null;
        $itemsElapsed = (hrtime(true) - $itemsStartedAt) / 1_000_000_000;

        $sessionId = (int) $response->json('data.id');
        $item = DB::table('stock_opname_items')->where('session_id', $sessionId)->first(['id', 'barcode_snapshot']);
        $lookupStartedAt = hrtime(true);
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/lookup?q={$item->barcode_snapshot}&mode=auto")->assertOk();
        $lookupElapsed = (hrtime(true) - $lookupStartedAt) / 1_000_000_000;
        $countStartedAt = hrtime(true);
        $this->postJson("/api/stock-opname-sessions/{$sessionId}/counts", [
            'item_id' => $item->id,
            'mode' => 'set',
            'quantity' => 17,
            'client_request_id' => fake()->uuid(),
        ])->assertOk();
        $countElapsed = (hrtime(true) - $countStartedAt) / 1_000_000_000;
        $countedItemsStartedAt = hrtime(true);
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items?only_counted=true&sort=-counted_at&per_page=2")
            ->assertOk()->assertJsonCount(1, 'data');
        $countedItemsElapsed = (hrtime(true) - $countedItemsStartedAt) / 1_000_000_000;
        $excludedItem = DB::table('stock_opname_items')
            ->where('session_id', $sessionId)->whereNull('counted_qty')->first(['id']);
        $recommendationsStartedAt = hrtime(true);
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/items?category_id=0&scope=direct&only_uncounted=true&per_page=2&exclude_item_ids[]={$excludedItem->id}")
            ->assertOk()->assertJsonCount(2, 'data');
        $recommendationsElapsed = (hrtime(true) - $recommendationsStartedAt) / 1_000_000_000;
        DB::table('stock_opname_sessions')->where('id', $sessionId)->update(['status' => 'posted']);
        $guardIds = DB::table('products')->where('store_id', $this->storeId())->orderBy('id')->limit(20)->pluck('id')->map(fn ($id) => (int) $id)->all();
        $guardQueries = 0;
        $phase = 'guard';
        DB::listen(function ($query) use (&$guardQueries, &$phase) {
            if ($phase === 'guard' && str_contains(strtolower($query->sql), 'stock_opname_sessions')) {
                $guardQueries++;
            }
        });
        $guardStartedAt = hrtime(true);
        DB::transaction(fn () => app(InventoryService::class)->withUnlockedProducts(
            $this->storeId(),
            $guardIds,
            fn () => null,
        ));
        $phase = null;
        $guardElapsed = (hrtime(true) - $guardStartedAt) / 1_000_000_000;
        fwrite(STDOUT, sprintf(
            "Opname 5,000 products: start %.3fs, tree %.3fs, items/100 %.3fs, lookup %.3fs, count %.3fs, counted/2 %.3fs, recommendations/2 %.3fs, 20-product guard %.3fs (%d lock queries)\n",
            $elapsed,
            $treeElapsed,
            $itemsElapsed,
            $lookupElapsed,
            $countElapsed,
            $countedItemsElapsed,
            $recommendationsElapsed,
            $guardElapsed,
            $guardQueries,
        ));
        $this->assertLessThan(1.0, $treeElapsed);
        $this->assertLessThan(0.3, $itemsElapsed);
        $this->assertLessThanOrEqual(1, $queryCounts['tree']);
        $this->assertLessThanOrEqual(3, $queryCounts['items']);
    }
}
