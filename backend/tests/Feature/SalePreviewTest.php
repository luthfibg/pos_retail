<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class SalePreviewTest extends SeededTestCase
{
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cashier = $this->makeUser('Kasir', 'kasir-pratinjau');
        Sanctum::actingAs($this->cashier, ['*']);
    }

    private function openShift(): int
    {
        return (int) $this->postJson('/api/shifts/open')->assertCreated()->json('data.id');
    }

    private function product(string $price = '10000', array $overrides = []): int
    {
        static $n = 0;
        $n++;

        return DB::table('products')->insertGetId($overrides + [
            'store_id' => $this->storeId(), 'sku' => "PRV-{$n}", 'barcode' => sprintf('89970000%05d', $n),
            'name' => "Produk pratinjau {$n}", 'sell_price' => $price, 'status' => 'active',
        ]);
    }

    private function stock(int $productId, string $qty, ?string $expiry = null): void
    {
        DB::transaction(fn () => app(InventoryService::class)->receive(
            $this->storeId(), $productId, $qty, '5000', $expiry, null, null, 'goods_receipt', 1, null,
        ));
    }

    private function employee(string $limit = '100000'): int
    {
        $id = DB::table('customers')->insertGetId([
            'store_id' => $this->storeId(), 'customer_no' => 'EMP-PREV', 'name' => 'Karyawan Pratinjau',
            'status' => 'active', 'created_by' => $this->cashier->id,
        ]);
        DB::table('customer_credit_limits')->insert([
            'customer_id' => $id, 'limit_amount' => $limit, 'effective_from' => now(), 'set_by' => $this->cashier->id,
        ]);

        return $id;
    }

    public function test_preview_matches_posted_decimal_sale_with_merged_lines(): void
    {
        $this->openShift();
        $auditBeforePreview = DB::table('audit_logs')->count();
        $product = $this->product('3333');
        $this->stock($product, '10');
        $items = [
            ['product_id' => $product, 'qty' => '1'],
            ['product_id' => $product, 'qty' => '0.5'],
        ];

        $preview = $this->postJson('/api/sales/preview', [
            'payment_mode' => 'cash', 'items' => $items,
        ])->assertOk()->assertJsonPath('data.subtotal', '4999.50')
            ->assertJsonPath('data.total', '4999.50')->assertJsonCount(1, 'data.lines')
            ->assertJsonPath('data.lines.0.qty', '1.500')
            ->assertJsonPath('data.lines.0.stock_available', '10.000')
            ->assertJsonPath('data.lines.0.stock_sufficient', true);

        $this->assertSame(0, DB::table('sales')->count());
        $this->assertSame(0, DB::table('sale_items')->count());
        $this->assertSame($auditBeforePreview, DB::table('audit_logs')->count());

        $posted = $this->postJson('/api/sales', [
            'idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'cash',
            'amount_tendered' => '5000', 'items' => $items,
        ])->assertCreated();

        $this->assertSame($preview->json('data.subtotal'), $posted->json('data.subtotal'));
        $this->assertSame($preview->json('data.discount_total'), $posted->json('data.discount_total'));
        $this->assertSame($preview->json('data.tax_amount'), $posted->json('data.tax_amount'));
        $this->assertSame($preview->json('data.total'), $posted->json('data.total'));
        $this->assertSame($preview->json('data.lines.0.line_total'), $posted->json('data.items.0.line_total'));
    }

    public function test_preview_matches_best_discount_and_exclusive_cash_vat(): void
    {
        $this->openShift();
        $category = DB::table('categories')->insertGetId(['store_id' => $this->storeId(), 'name' => 'Pratinjau', 'is_active' => 1]);
        $product = $this->product('10000', ['category_id' => $category]);
        $this->stock($product, '10');
        DB::table('settings')->insert(['store_id' => $this->storeId(), 'setting_key' => 'vat_enabled', 'setting_value' => json_encode(true)]);
        DB::table('tax_rates')->insert([
            'store_id' => $this->storeId(), 'name' => 'PPN', 'rate' => '11.00', 'price_includes_tax' => 0,
            'effective_from' => now('Asia/Jakarta')->subDay()->toDateString(), 'created_by' => $this->cashier->id,
        ]);
        DB::table('discounts')->insert([
            'store_id' => $this->storeId(), 'name' => 'Diskon kategori terbaik', 'target_type' => 'category',
            'target_id' => $category, 'discount_type' => 'amount', 'value' => '1500', 'is_active' => 1,
            'starts_at' => now()->subDay(), 'ends_at' => null, 'created_by' => $this->cashier->id,
        ]);
        $items = [['product_id' => $product, 'qty' => '2']];

        $preview = $this->postJson('/api/sales/preview', ['payment_mode' => 'cash', 'items' => $items])
            ->assertOk()->assertJsonPath('data.subtotal', '20000.00')
            ->assertJsonPath('data.discount_total', '3000.00')
            ->assertJsonPath('data.lines.0.discount_name', 'Diskon kategori terbaik')
            ->assertJsonPath('data.tax_amount', '1870.00')->assertJsonPath('data.total', '18870.00');

        $posted = $this->postJson('/api/sales', [
            'idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'cash',
            'amount_tendered' => '20000', 'items' => $items,
        ])->assertCreated();

        $this->assertSame($preview->json('data.total'), $posted->json('data.total'));
        $this->assertSame($preview->json('data.discount_total'), $posted->json('data.discount_total'));
    }

    public function test_preview_matches_inclusive_cash_vat(): void
    {
        $this->openShift();
        $product = $this->product('10000');
        $this->stock($product, '10');
        DB::table('settings')->insert(['store_id' => $this->storeId(), 'setting_key' => 'vat_enabled', 'setting_value' => json_encode(true)]);
        DB::table('tax_rates')->insert([
            'store_id' => $this->storeId(), 'name' => 'PPN inklusif', 'rate' => '11.00', 'price_includes_tax' => 1,
            'effective_from' => now('Asia/Jakarta')->subDay()->toDateString(), 'created_by' => $this->cashier->id,
        ]);
        $items = [['product_id' => $product, 'qty' => 1]];

        $preview = $this->postJson('/api/sales/preview', ['payment_mode' => 'cash', 'items' => $items])
            ->assertOk()->assertJsonPath('data.tax_amount', '990.99')->assertJsonPath('data.total', '10000.00');

        $posted = $this->postJson('/api/sales', [
            'idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'cash',
            'amount_tendered' => '10000', 'items' => $items,
        ])->assertCreated();

        $this->assertSame($preview->json('data.tax_amount'), $posted->json('data.tax_amount'));
        $this->assertSame($preview->json('data.total'), $posted->json('data.total'));
    }

    public function test_credit_preview_reports_remaining_without_posting_or_reauth(): void
    {
        $this->openShift();
        $product = $this->product('40000');
        $this->stock($product, '10');
        $employee = $this->employee('100000');

        $this->postJson('/api/sales/preview', [
            'payment_mode' => 'payroll_credit', 'customer_id' => $employee,
            'items' => [['product_id' => $product, 'qty' => 3]],
        ])->assertOk()->assertJsonPath('data.credit.remaining_before', '100000.00')
            ->assertJsonPath('data.credit.remaining_after', '0.00')
            ->assertJsonPath('data.credit.exceeds_limit', true)
            ->assertJsonPath('data.tax_amount', '0.00')->assertJsonPath('data.total', '120000.00');

        $this->assertSame(0, DB::table('sales')->count());
        $this->assertSame(0, DB::table('sale_items')->count());
        $this->assertSame(0, DB::table('payments')->count());
        $this->assertSame(10, (int) DB::table('inventory_balances')->where('product_id', $product)->sum('qty_sellable'));
    }

    public function test_preview_excludes_expired_stock_but_does_not_reject_it(): void
    {
        $product = $this->product('1000', ['track_expiry' => 1]);
        $this->stock($product, '2', now('Asia/Jakarta')->subDay()->toDateString());
        $movementsBefore = DB::table('inventory_movements')->count();

        $this->postJson('/api/sales/preview', [
            'payment_mode' => 'cash', 'items' => [['product_id' => $product, 'qty' => 1]],
        ])->assertOk()->assertJsonPath('data.lines.0.stock_available', '0.000')
            ->assertJsonPath('data.lines.0.stock_sufficient', false);

        $this->assertSame(0, DB::table('sales')->count());
        $this->assertSame($movementsBefore, DB::table('inventory_movements')->count());
    }
}
