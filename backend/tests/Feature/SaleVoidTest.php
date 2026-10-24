<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class SaleVoidTest extends SeededTestCase
{
    private User $admin;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->makeUser('Admin', 'admin-void');
        $this->cashier = $this->makeUser('Kasir', 'kasir-void');
        Sanctum::actingAs($this->cashier, ['*']);
    }

    private function as(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
    }

    private function product(string $price = '10000'): int
    {
        static $n = 0;
        $n++;

        return DB::table('products')->insertGetId([
            'store_id' => $this->storeId(), 'sku' => "VD-{$n}", 'barcode' => sprintf('89930000%05d', $n),
            'name' => "Produk VD {$n}", 'sell_price' => $price, 'status' => 'active',
        ]);
    }

    private function stock(int $productId, string $qty, ?string $expiry = null): int
    {
        return DB::transaction(fn () => app(InventoryService::class)->receive(
            $this->storeId(), $productId, $qty, '6000', $expiry, null, null, 'goods_receipt', 1, null,
        ))['batch_id'];
    }

    private function onHand(int $productId): string
    {
        return number_format((float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_sellable'), 3, '.', '');
    }

    private function cashSale(int $productId, string $qty, string $tendered): int
    {
        $this->as($this->cashier);

        return (int) $this->postJson('/api/sales', [
            'idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'cash', 'amount_tendered' => $tendered,
            'items' => [['product_id' => $productId, 'qty' => $qty]],
        ])->assertCreated()->json('data.id');
    }

    private function creditSale(int $productId, string $qty, int $employee): int
    {
        $this->as($this->cashier);

        return (int) $this->postJson('/api/sales', [
            'idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'payroll_credit', 'customer_id' => $employee,
            'items' => [['product_id' => $productId, 'qty' => $qty]],
        ])->assertCreated()->json('data.id');
    }

    private function employee(string $limit = '1000000'): int
    {
        $id = DB::table('customers')->insertGetId([
            'store_id' => $this->storeId(), 'customer_no' => 'EMP-'.Str::random(5), 'name' => 'Karyawan Uji', 'status' => 'active', 'created_by' => $this->cashier->id,
        ]);
        DB::table('customer_credit_limits')->insert(['customer_id' => $id, 'limit_amount' => $limit, 'effective_from' => now(), 'set_by' => $this->admin->id]);

        return $id;
    }

    private function openShift(): int
    {
        $this->as($this->cashier);

        return (int) $this->postJson('/api/shifts/open')->assertCreated()->json('data.id');
    }

    public function test_admin_voids_cash_sale_in_open_shift_and_everything_is_reversed(): void
    {
        $shift = $this->openShift();
        $p = $this->product('10000');
        $soon = $this->stock($p, '3', now('Asia/Jakarta')->addDays(10)->toDateString());
        $late = $this->stock($p, '7', now('Asia/Jakarta')->addDays(90)->toDateString());
        $sale = $this->cashSale($p, '5', '50000');   // 3 dari batch dekat + 2 dari batch jauh
        $this->assertSame('5.000', $this->onHand($p));

        $this->as($this->admin);
        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'salah input barang'])->assertOk()
            ->assertJsonPath('data.status', 'voided')->assertJsonPath('data.receipt.is_void', true)->assertJsonPath('data.receipt.void_label', 'DIBATALKAN');

        $this->assertSame('10.000', $this->onHand($p));
        $this->assertDatabaseHas('inventory_balances', ['batch_id' => $soon, 'qty_sellable' => '3.000']);
        $this->assertDatabaseHas('inventory_balances', ['batch_id' => $late, 'qty_sellable' => '7.000']);
        $this->assertSame(2, DB::table('inventory_movements')->where('movement_type', 'sale_void')->where('ref_id', $sale)->count());
        $this->assertDatabaseHas('sale_voids', ['sale_id' => $sale, 'reason' => 'salah input barang', 'requested_by' => $this->admin->id, 'approved_by' => $this->admin->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'sale.void', 'entity_id' => $sale, 'reason' => 'salah input barang']);
        $this->assertDatabaseHas('fund_ledger_entries', ['entry_type' => 'sale_void', 'ref_id' => $sale, 'amount' => '-50000.00']);
        $this->assertSame('0.00', number_format((float) DB::table('fund_ledger_entries')->sum('amount'), 2, '.', ''));   // kas kecil kembali nol

        // struk tunai batal tidak dihitung di ringkasan shift dan kas diharapkan
        $this->getJson("/api/shifts/{$shift}")->assertJsonPath('data.summary.cash_sales_total', '0.00')->assertJsonPath('data.expected_cash', '0.00');
        $this->getJson('/api/sales?status=voided')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_void_is_admin_only_needs_reason_and_cannot_repeat(): void
    {
        $this->openShift();
        $p = $this->product();
        $this->stock($p, '5');
        $sale = $this->cashSale($p, '1', '10000');

        $this->as($this->cashier);
        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'x'])->assertForbidden();

        $this->as($this->admin);
        $this->postJson("/api/sales/{$sale}/void")->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'batal'])->assertOk();
        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'batal lagi'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->postJson('/api/sales/999999/void', ['reason' => 'x'])->assertNotFound();
        $this->assertSame('5.000', $this->onHand($p));
        $this->assertSame(1, DB::table('sale_voids')->count());
    }

    public function test_cash_sale_from_a_closed_shift_cannot_be_voided(): void
    {
        $shift = $this->openShift();
        $p = $this->product('10000');
        $this->stock($p, '5');
        $sale = $this->cashSale($p, '2', '20000');
        $this->postJson("/api/shifts/{$shift}/close", ['counted_cash' => '20000'])->assertOk();

        $this->as($this->admin);
        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'terlambat'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertSame('3.000', $this->onHand($p));
        $this->assertDatabaseHas('sales', ['id' => $sale, 'status' => 'posted']);
        $this->assertSame(0, DB::table('sale_voids')->count());
    }

    public function test_unbilled_credit_sale_can_be_voided_even_after_shift_closed_and_frees_the_limit(): void
    {
        $shift = $this->openShift();
        $p = $this->product('40000');
        $this->stock($p, '5');
        $employee = $this->employee('100000');
        $sale = $this->creditSale($p, '2', $employee);   // 80.000 dari batas 100.000
        $this->postJson("/api/shifts/{$shift}/close", ['counted_cash' => '0'])->assertOk();

        $this->as($this->admin);
        $this->getJson("/api/customers/{$employee}")->assertJsonPath('data.credit_used', '80000.00')->assertJsonPath('data.credit_remaining', '20000.00');
        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'karyawan batal ambil'])->assertOk()->assertJsonPath('data.status', 'voided');

        $this->getJson("/api/customers/{$employee}")->assertJsonPath('data.credit_used', '0.00')->assertJsonPath('data.credit_remaining', '100000.00');
        $this->assertSame('5.000', $this->onHand($p));
        $this->assertSame(0, DB::table('fund_ledger_entries')->count());   // kredit tidak menyentuh kas
    }

    public function test_billed_credit_sale_cannot_be_voided(): void
    {
        $this->openShift();
        $p = $this->product('10000');
        $this->stock($p, '5');
        $sale = $this->creditSale($p, '1', $this->employee());
        DB::table('sales')->where('id', $sale)->update(['billing_status' => 'invoiced']);

        $this->as($this->admin);
        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'sudah ditagih'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertSame('4.000', $this->onHand($p));
    }

    public function test_void_then_sell_again_uses_restored_stock(): void
    {
        $this->openShift();
        $p = $this->product('10000');
        $this->stock($p, '2');
        $sale = $this->cashSale($p, '2', '20000');

        $this->as($this->cashier);
        $this->postJson('/api/sales', [
            'idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'cash', 'amount_tendered' => '10000',
            'items' => [['product_id' => $p, 'qty' => 1]],
        ])->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);   // stok habis

        $this->as($this->admin);
        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'batal'])->assertOk();
        $this->cashSale($p, '2', '20000');
        $this->assertSame('0.000', $this->onHand($p));
    }
}
