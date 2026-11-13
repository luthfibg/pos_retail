<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class OpnameHistoryTest extends SeededTestCase
{
    use BuildsPurchasing;

    /**
     * Admin pada model administrasi `standard` (tanpa Owner/Accounting) TIDAK memegang opname.view_value,
     * sehingga field nilai rupiah harus disembunyikan. Model default toko adalah `simple`, di mana Admin
     * memegang semua permission (lihat RbacTest), jadi model `standard` harus disetel eksplisit.
     */
    private function actAsStandardModelAdmin(): \App\Models\User
    {
        $this->setSetting('admin_model', 'standard');

        return $this->actAsAdmin();
    }

    private function createOpnameSession(int $actorId, string $number, string $status, string $startedAt, ?string $postedAt = null, array $overrides = []): int
    {
        return DB::table('stock_opname_sessions')->insertGetId($overrides + [
            'store_id' => $this->storeId(),
            'number' => $number,
            'scope_type' => 'all',
            'status' => $status,
            'started_at' => $startedAt,
            'created_by' => $actorId,
            'posted_at' => $postedAt,
            'variance_products' => $status === 'posted' ? 0 : null,
            'short_qty' => $status === 'posted' ? '0.000' : null,
            'over_qty' => $status === 'posted' ? '0.000' : null,
            'abs_value' => $status === 'posted' ? '0.00' : null,
            'created_at' => $startedAt,
            'updated_at' => $startedAt,
        ]);
    }

    private function varianceItem(int $sessionId, int $productId, string $diff, string $name = 'Produk uji'): void
    {
        DB::table('stock_opname_items')->insert([
            'session_id' => $sessionId,
            'product_id' => $productId,
            'product_name_snapshot' => $name,
            'barcode_snapshot' => '8996000000011',
            'system_qty_at_start' => '5.000',
            'counted_qty' => (string) (5 + (float) $diff),
            'system_qty_at_count' => '5.000',
            'diff_qty' => $diff,
            'unit_cost_snapshot' => '100.0000',
            'diff_value' => number_format(abs((float) $diff) * 100, 2, '.', ''),
            'revision_count' => 1,
        ]);
    }

    public function test_periods_use_store_timezone_and_only_posted_sessions_contribute_to_variance_totals(): void
    {
        $admin = $this->actAsStandardModelAdmin();
        $october = $this->createOpnameSession((int) $admin->id, 'OPN-HIST-001', 'posted', '2026-10-20 04:00:00', '2026-10-31 16:30:00', [
            'variance_products' => 2, 'short_qty' => '2.000', 'over_qty' => '1.000', 'abs_value' => '300.00',
        ]);
        $this->createOpnameSession((int) $admin->id, 'OPN-HIST-002', 'cancelled', '2026-10-31 16:45:00');
        $this->createOpnameSession((int) $admin->id, 'OPN-HIST-003', 'in_progress', '2026-11-01 02:00:00');
        $november = $this->createOpnameSession((int) $admin->id, 'OPN-HIST-004', 'posted', '2026-11-01 02:00:00', '2026-10-31 17:10:00', [
            'variance_products' => 0, 'short_qty' => '0.000', 'over_qty' => '0.000', 'abs_value' => '0.00',
        ]);

        $response = $this->getJson('/api/stock-opname-sessions/periods?group=month')->assertOk();
        $response->assertJsonPath('periods.0.period_key', '2026-11')
            ->assertJsonPath('periods.0.sessions_total', 2)
            ->assertJsonPath('periods.0.sessions_posted', 1)
            ->assertJsonPath('periods.0.sessions_clean', 1)
            ->assertJsonPath('periods.1.period_key', '2026-10')
            ->assertJsonPath('periods.1.sessions_total', 2)
            ->assertJsonPath('periods.1.sessions_posted', 1)
            ->assertJsonPath('periods.1.variance_products', 2)
            ->assertJsonPath('periods.1.short_qty', '2.000')
            ->assertJsonMissingPath('periods.0.abs_value');

        $this->assertNotSame($october, $november);
    }

    public function test_frequent_variance_aggregates_posted_snapshots_and_last_status_defaults_to_no_reminder(): void
    {
        $admin = $this->actAsStandardModelAdmin();
        $productId = $this->product();
        $first = $this->createOpnameSession((int) $admin->id, 'OPN-HIST-011', 'posted', '2026-11-01 01:00:00', '2026-11-01 02:00:00', [
            'variance_products' => 1, 'short_qty' => '1.000', 'abs_value' => '100.00',
        ]);
        $second = $this->createOpnameSession((int) $admin->id, 'OPN-HIST-012', 'posted', '2026-11-02 01:00:00', '2026-11-02 02:00:00', [
            'variance_products' => 1, 'over_qty' => '2.000', 'abs_value' => '200.00',
        ]);
        $this->varianceItem($first, $productId, '-1.000', 'Nama lama');
        $this->varianceItem($second, $productId, '2.000', 'Nama terbaru');

        $this->getJson('/api/stock-opname-sessions/frequent-variance?date_from=2026-11-01&date_to=2026-11-30')
            ->assertOk()
            ->assertJsonPath('items.0.sessions_with_variance', 2)
            ->assertJsonPath('items.0.name', 'Nama terbaru')
            ->assertJsonPath('items.0.short_qty', '1.000')
            ->assertJsonPath('items.0.over_qty', '2.000')
            ->assertJsonMissingPath('items.0.value');

        $this->getJson('/api/stock-opname/last-status')
            ->assertOk()
            ->assertJsonPath('last_posted.id', $second)
            ->assertJsonPath('reminder.enabled', false)
            ->assertJsonPath('reminder.interval_days', 30)
            ->assertJsonPath('reminder.basis', 'all')
            ->assertJsonPath('reminder.due', false);
    }

    public function test_csv_export_uses_bom_formula_neutralization_and_omits_value_for_admin(): void
    {
        $admin = $this->actAsStandardModelAdmin();
        $productId = $this->product();
        $sessionId = $this->createOpnameSession((int) $admin->id, 'OPN-HIST-021', 'posted', '2026-11-05 01:00:00', '2026-11-05 02:00:00', [
            'variance_products' => 1, 'short_qty' => '1.000', 'abs_value' => '100.00',
        ]);
        $this->varianceItem($sessionId, $productId, '-1.000', '=SUM(1,1)');
        $categoryId = DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(),
            'name' => 'Kategori Bersih',
            'is_active' => 1,
        ]);
        $matchedProductId = $this->product(['category_id' => $categoryId]);
        DB::table('stock_opname_items')->insert([
            'session_id' => $sessionId,
            'product_id' => $matchedProductId,
            'category_id' => $categoryId,
            'product_name_snapshot' => 'Produk cocok',
            'barcode_snapshot' => '8996000000022',
            'category_name_snapshot' => 'Kategori Bersih',
            'system_qty_at_start' => '5.000',
            'counted_qty' => '5.000',
            'system_qty_at_count' => '5.000',
            'diff_qty' => '0.000',
            'unit_cost_snapshot' => '100.0000',
            'diff_value' => '0.00',
            'revision_count' => 0,
        ]);

        $response = $this->get("/api/stock-opname-sessions/{$sessionId}/export?part=detail&delimiter=semicolon");
        $response->assertOk();
        $csv = $response->streamedContent();

        $this->assertStringStartsWith("\xEF\xBB\xBF", $csv);
        $this->assertStringContainsString('Produk;Barcode;', $csv);
        $this->assertStringContainsString("'=SUM(1,1)", $csv);
        $this->assertStringNotContainsString('Nilai', $csv);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'stock_opname.export',
            'entity_id' => $sessionId,
            'actor_id' => $admin->id,
        ]);
        $summary = $this->get("/api/stock-opname-sessions/{$sessionId}/export?part=summary")->assertOk()->streamedContent();
        $this->assertStringContainsString('Kategori Bersih', $summary);

        $inProgress = $this->createOpnameSession((int) $admin->id, 'OPN-HIST-022', 'in_progress', '2026-11-06 01:00:00');
        $this->getJson("/api/stock-opname-sessions/{$inProgress}/export?part=detail")
            ->assertStatus(409)
            ->assertJsonPath('code', 'opname_export_unavailable');
    }

    public function test_reminder_settings_are_validated_and_audited_for_admin(): void
    {
        $admin = $this->actAsAdmin();
        $this->putJson('/api/settings/opname', [
            'reminder_enabled' => true,
            'reminder_interval_days' => 7,
            'reminder_basis' => 'any',
        ])->assertOk()
            ->assertJsonPath('data.reminder_enabled', true)
            ->assertJsonPath('data.reminder_interval_days', 7)
            ->assertJsonPath('data.reminder_basis', 'any');

        $this->putJson('/api/settings/opname', ['reminder_interval_days' => 366])->assertUnprocessable();
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'settings.opname_reminder',
            'actor_id' => $admin->id,
        ]);
    }

    public function test_value_fields_are_permission_gated_and_history_requires_opname_view(): void
    {
        $this->getJson('/api/stock-opname-sessions/periods')->assertUnauthorized();
        $admin = $this->actAsStandardModelAdmin();
        $productId = $this->product();
        $sessionId = $this->createOpnameSession((int) $admin->id, 'OPN-HIST-031', 'posted', '2026-11-05 01:00:00', '2026-11-05 02:00:00', [
            'variance_products' => 1, 'short_qty' => '1.000', 'abs_value' => '100.00',
        ]);
        $this->varianceItem($sessionId, $productId, '-1.000');

        $this->getJson('/api/stock-opname-sessions/periods')->assertOk()->assertJsonMissingPath('periods.0.abs_value');
        $this->signIn('Accounting', 'opname-accounting');
        $this->getJson('/api/stock-opname-sessions/periods')->assertOk()->assertJsonPath('periods.0.abs_value', '100.00');
        $this->getJson('/api/stock-opname-sessions/frequent-variance?date_from=2026-11-01&date_to=2026-11-30')
            ->assertOk()->assertJsonPath('items.0.value', '100.00');
        $csvResponse = $this->get("/api/stock-opname-sessions/{$sessionId}/export?part=detail")->assertOk();
        $this->assertStringContainsString('Nilai', $csvResponse->streamedContent());

        $this->signIn('Kasir', 'opname-cashier');
        $this->getJson('/api/stock-opname-sessions/periods')->assertForbidden();
        $this->getJson('/api/stock-opname/lock-status')->assertOk();
    }

    public function test_blind_in_progress_session_metadata_omits_variance_keys_and_offline_index_stays_blind(): void
    {
        $admin = $this->actAsAdmin();
        $sessionId = $this->createOpnameSession((int) $admin->id, 'OPN-HIST-041', 'in_progress', now('UTC')->format('Y-m-d H:i:s'));
        $productId = $this->product();
        DB::table('stock_opname_items')->insert([
            'session_id' => $sessionId,
            'product_id' => $productId,
            'product_name_snapshot' => 'Produk belum dihitung',
            'barcode_snapshot' => '8996000000044',
            'system_qty_at_start' => '9.000',
        ]);

        $this->getJson("/api/stock-opname-sessions/{$sessionId}")
            ->assertOk()
            ->assertJsonMissingPath('data.variance_products')
            ->assertJsonMissingPath('data.short_qty')
            ->assertJsonMissingPath('data.over_qty');
        $this->getJson('/api/stock-opname-sessions')
            ->assertOk()
            ->assertJsonMissingPath('data.0.variance_products')
            ->assertJsonMissingPath('data.0.short_qty');
        $this->getJson("/api/stock-opname-sessions/{$sessionId}/offline-index")
            ->assertOk()
            ->assertJsonMissingPath('items.0.system_qty')
            ->assertJsonMissingPath('items.0.diff_qty')
            ->assertJsonMissingPath('items.0.variance_count')
            ->assertJsonMissingPath('items.0.short_qty')
            ->assertJsonMissingPath('items.0.over_qty');
    }

    public function test_count_simulator_refuses_production_environment_before_accessing_data(): void
    {
        $this->app['env'] = 'production';

        $this->artisan('opname:simulate-counts', ['sessionId' => 1])
            ->expectsOutput('Perintah simulasi opname hanya boleh dijalankan pada environment local atau testing.')
            ->assertExitCode(1);
    }

    public function test_new_history_endpoints_require_login_and_opname_view(): void
    {
        $paths = [
            '/api/stock-opname-sessions/periods',
            '/api/stock-opname-sessions/frequent-variance',
            '/api/stock-opname/last-status',
            '/api/stock-opname-sessions/periods/export',
            '/api/stock-opname-sessions/999/export?part=summary',
        ];
        foreach ($paths as $path) {
            $this->getJson($path)->assertUnauthorized();
        }

        $this->signIn('Kasir', 'opname-history-cashier');
        foreach ($paths as $path) {
            $this->getJson($path)->assertForbidden();
        }

        $this->actAsAdmin();
        $this->getJson('/api/stock-opname-sessions/periods')->assertOk();
        $this->getJson('/api/stock-opname-sessions/frequent-variance')->assertOk();
        $this->getJson('/api/stock-opname/last-status')->assertOk();
        $this->get('/api/stock-opname-sessions/periods/export')->assertOk();
        $this->get('/api/stock-opname-sessions/999/export?part=summary')->assertNotFound();
    }
}
