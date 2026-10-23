<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class SaleTest extends SeededTestCase
{
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cashier = $this->makeUser('Kasir', 'kasir-jual');
        Sanctum::actingAs($this->cashier, ['*']);
    }

    private function openShift(): int
    {
        return (int) $this->postJson('/api/shifts/open')->assertCreated()->json('data.id');
    }

    private function makeProduct(string $price = '10000', array $overrides = []): int
    {
        static $n = 0;
        $n++;

        return DB::table('products')->insertGetId($overrides + [
            'store_id' => $this->storeId(), 'sku' => "SL-{$n}", 'barcode' => sprintf('89960000%05d', $n),
            'name' => "Produk SL {$n}", 'sell_price' => $price, 'status' => 'active',
        ]);
    }

    private function stock(int $productId, string $qty, string $cost = '6000', ?string $expiry = null): void
    {
        DB::transaction(fn () => app(InventoryService::class)->receive(
            $this->storeId(), $productId, $qty, $cost, $expiry, null, null, 'goods_receipt', 1, null,
        ));
    }

    private function onHand(int $productId): string
    {
        return number_format((float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_sellable'), 3, '.', '');
    }

    private function cashSale(array $items, string $tendered, ?string $key = null, array $extra = [])
    {
        return $this->postJson('/api/sales', $extra + [
            'idempotency_key' => $key ?? (string) Str::uuid(),
            'payment_mode' => 'cash',
            'amount_tendered' => $tendered,
            'items' => $items,
        ]);
    }

    private function employee(string $status = 'active', ?string $limit = '1000000'): int
    {
        static $n = 0;
        $n++;
        $id = DB::table('customers')->insertGetId([
            'store_id' => $this->storeId(), 'customer_no' => "EMP-{$n}", 'name' => "Karyawan {$n}", 'status' => $status,
            'created_by' => $this->cashier->id,
        ]);
        if ($limit !== null) {
            DB::table('customer_credit_limits')->insert([
                'customer_id' => $id, 'limit_amount' => $limit, 'effective_from' => now(), 'set_by' => $this->cashier->id,
            ]);
        }

        return $id;
    }

    private function creditSale(int $customerId, array $items, array $extra = [])
    {
        return $this->postJson('/api/sales', $extra + [
            'idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'payroll_credit', 'customer_id' => $customerId, 'items' => $items,
        ]);
    }

    // ------------------------------------------------------------------ tunai

    public function test_cash_sale_posts_everything_atomically(): void
    {
        $shiftId = $this->openShift();
        $a = $this->makeProduct('10000');
        $b = $this->makeProduct('2500');
        $this->stock($a, '10', '6000');
        $this->stock($b, '20', '1000');

        $response = $this->cashSale([['product_id' => $a, 'qty' => '2'], ['product_id' => $b, 'qty' => '3']], '50000')->assertCreated();
        $period = now('Asia/Jakarta')->format('Ym');

        $response->assertJsonPath('replayed', false)
            ->assertJsonPath('data.doc_number', "SALE-{$period}-000001")
            ->assertJsonPath('data.subtotal', '27500.00')
            ->assertJsonPath('data.total', '27500.00')
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.billing_status', 'not_applicable')
            ->assertJsonPath('data.payment.amount_tendered', '50000.00')
            ->assertJsonPath('data.payment.change_given', '22500.00')
            ->assertJsonCount(2, 'data.items')
            ->assertJsonPath('data.receipt.is_copy', false);

        $saleId = $response->json('data.id');
        $this->assertSame('8.000', $this->onHand($a));
        $this->assertSame('17.000', $this->onHand($b));
        $this->assertDatabaseHas('sale_items', ['sale_id' => $saleId, 'product_id' => $a, 'unit_price' => '10000.00', 'line_total' => '20000.00', 'cost_snapshot' => '6000.0000']);
        $this->assertDatabaseHas('inventory_movements', ['product_id' => $a, 'movement_type' => 'sale', 'qty' => '2.000', 'ref_type' => 'sale', 'ref_id' => $saleId]);
        $this->assertDatabaseHas('payments', ['sale_id' => $saleId, 'shift_id' => $shiftId, 'amount_applied' => '27500.00']);
        $this->assertDatabaseHas('fund_ledger_entries', ['entry_type' => 'sale_cash', 'amount' => '27500.00', 'ref_type' => 'sale', 'ref_id' => $saleId]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'sale.post', 'entity_id' => $saleId, 'actor_id' => $this->cashier->id]);
        $this->assertSame(1, DB::table('sale_item_batches')->where('qty', '2.000')->count());

        $this->getJson('/api/shifts/current')
            ->assertJsonPath('data.summary.cash_sales_count', 1)
            ->assertJsonPath('data.summary.cash_sales_total', '27500.00');
    }

    public function test_idempotent_resend_returns_same_receipt_and_does_not_double_post(): void
    {
        $this->openShift();
        $p = $this->makeProduct();
        $this->stock($p, '10');
        $key = (string) Str::uuid();

        $first = $this->cashSale([['product_id' => $p, 'qty' => 1]], '10000', $key)->assertCreated();
        $second = $this->cashSale([['product_id' => $p, 'qty' => 1]], '10000', $key)->assertOk();

        $second->assertJsonPath('replayed', true)->assertJsonPath('data.id', $first->json('data.id'));
        $this->assertSame(1, DB::table('sales')->count());
        $this->assertSame('9.000', $this->onHand($p));
    }

    public function test_requires_open_shift_and_blocks_while_counting(): void
    {
        $p = $this->makeProduct();
        $this->stock($p, '10');

        $this->cashSale([['product_id' => $p, 'qty' => 1]], '10000')->assertUnprocessable()->assertJsonValidationErrors(['shift']);

        $shiftId = $this->openShift();
        $this->postJson("/api/shifts/{$shiftId}/start-count")->assertOk();
        $this->cashSale([['product_id' => $p, 'qty' => 1]], '10000')->assertUnprocessable()->assertJsonValidationErrors(['shift']);

        $this->assertSame(0, DB::table('sales')->count());
        $this->assertSame('10.000', $this->onHand($p));
    }

    public function test_insufficient_stock_fails_whole_transaction_with_line_error(): void
    {
        $this->openShift();
        $a = $this->makeProduct();
        $b = $this->makeProduct();
        $this->stock($a, '5');
        $this->stock($b, '1');

        $this->cashSale([['product_id' => $a, 'qty' => 2], ['product_id' => $b, 'qty' => 3]], '999999')
            ->assertUnprocessable()->assertJsonValidationErrors(['items.1.qty']);

        $this->assertSame(0, DB::table('sales')->count());
        $this->assertSame(0, DB::table('sale_items')->count());
        $this->assertSame(0, DB::table('payments')->count());
        $this->assertSame(0, DB::table('fund_ledger_entries')->count());
        $this->assertSame('5.000', $this->onHand($a));
        $this->assertSame('1.000', $this->onHand($b));
    }

    public function test_fefo_is_applied_per_sale(): void
    {
        $this->openShift();
        $p = $this->makeProduct('1000', ['track_expiry' => 1]);
        $this->stock($p, '3', '500', now('Asia/Jakarta')->addDays(90)->toDateString());
        $this->stock($p, '3', '500', now('Asia/Jakarta')->addDays(10)->toDateString());

        $this->cashSale([['product_id' => $p, 'qty' => 4]], '4000')->assertCreated();

        $soonBatch = DB::table('product_batches')->where('product_id', $p)->orderBy('expiry_date')->value('id');
        $this->assertDatabaseHas('inventory_balances', ['batch_id' => $soonBatch, 'qty_sellable' => '0.000']);
        $this->assertSame(2, DB::table('sale_item_batches')->count());
    }

    public function test_underpayment_and_unsellable_products_are_rejected(): void
    {
        $this->openShift();
        $p = $this->makeProduct('10000');
        $this->stock($p, '5');
        $pending = $this->makeProduct('1000', ['status' => 'pending_price', 'sell_price' => null]);
        $inactive = $this->makeProduct('1000', ['status' => 'inactive']);

        $this->cashSale([['product_id' => $p, 'qty' => 2]], '19999')->assertUnprocessable()->assertJsonValidationErrors(['amount_tendered']);
        $this->cashSale([['product_id' => $pending, 'qty' => 1]], '5000')->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);
        $this->cashSale([['product_id' => $inactive, 'qty' => 1]], '5000')->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);
        $this->cashSale([['product_id' => 999999, 'qty' => 1]], '5000')->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);
        $this->assertSame(0, DB::table('sales')->count());
    }

    public function test_duplicate_lines_are_merged_and_decimal_qty_priced_exactly(): void
    {
        $this->openShift();
        $p = $this->makeProduct('3333');   // 3.333 x 1.5 -> round
        $this->stock($p, '10');

        $r = $this->cashSale([['product_id' => $p, 'qty' => '1'], ['product_id' => $p, 'qty' => '0.5']], '10000')->assertCreated();

        $r->assertJsonCount(1, 'data.items')->assertJsonPath('data.items.0.qty', '1.500')->assertJsonPath('data.total', '4999.50');
        $this->assertSame('8.500', $this->onHand($p));
    }

    // ------------------------------------------------------------------ diskon & PPN

    public function test_admin_discounts_apply_best_of_product_and_category(): void
    {
        $this->openShift();
        $category = DB::table('categories')->insertGetId(['store_id' => $this->storeId(), 'name' => 'Minuman '.uniqid(), 'is_active' => 1]);
        $p = $this->makeProduct('10000', ['category_id' => $category]);
        $this->stock($p, '10');

        $row = fn (array $o) => DB::table('discounts')->insert($o + [
            'store_id' => $this->storeId(), 'name' => 'Promo', 'starts_at' => now()->subDay(), 'ends_at' => null,
            'is_active' => 1, 'created_by' => $this->cashier->id,
        ]);
        $row(['target_type' => 'product', 'target_id' => $p, 'discount_type' => 'percent', 'value' => '10']);      // 2.000 untuk 2 pcs
        $row(['target_type' => 'category', 'target_id' => $category, 'discount_type' => 'amount', 'value' => '1500']);   // 3.000 untuk 2 pcs (menang)
        $row(['target_type' => 'product', 'target_id' => $p, 'discount_type' => 'percent', 'value' => '50', 'is_active' => 0]);   // nonaktif
        $row(['target_type' => 'product', 'target_id' => $p, 'discount_type' => 'percent', 'value' => '90', 'ends_at' => now()->subHour()]);   // kedaluwarsa

        $this->cashSale([['product_id' => $p, 'qty' => 2]], '20000')->assertCreated()
            ->assertJsonPath('data.subtotal', '20000.00')
            ->assertJsonPath('data.discount_total', '3000.00')
            ->assertJsonPath('data.total', '17000.00')
            ->assertJsonPath('data.items.0.discount_amount', '3000.00')
            ->assertJsonPath('data.items.0.line_total', '17000.00');
    }

    public function test_vat_exclusive_is_added_for_cash_when_enabled_and_never_for_credit(): void
    {
        $this->openShift();
        $p = $this->makeProduct('100000');
        $this->stock($p, '10');
        DB::table('settings')->insert(['store_id' => $this->storeId(), 'setting_key' => 'vat_enabled', 'setting_value' => json_encode(true)]);

        // tarif belum dikonfigurasi lengkap
        $this->cashSale([['product_id' => $p, 'qty' => 1]], '200000')->assertUnprocessable()->assertJsonValidationErrors(['payment_mode']);

        DB::table('tax_rates')->insert([
            'store_id' => $this->storeId(), 'name' => 'PPN', 'rate' => '11.00', 'price_includes_tax' => 0,
            'effective_from' => now('Asia/Jakarta')->subDay()->toDateString(), 'created_by' => $this->cashier->id,
        ]);

        $this->cashSale([['product_id' => $p, 'qty' => 1]], '200000')->assertCreated()
            ->assertJsonPath('data.tax_rate', '11.00')->assertJsonPath('data.tax_amount', '11000.00')->assertJsonPath('data.total', '111000.00');

        $employee = $this->employee();
        $this->creditSale($employee, [['product_id' => $p, 'qty' => 1]])->assertCreated()
            ->assertJsonPath('data.tax_amount', '0.00')->assertJsonPath('data.total', '100000.00');
    }

    // ------------------------------------------------------------------ kredit

    public function test_credit_sale_within_limit_has_no_payment_or_cash_ledger_and_is_unbilled(): void
    {
        $this->openShift();
        $p = $this->makeProduct('20000');
        $this->stock($p, '10');
        $employee = $this->employee('active', '100000');

        $r = $this->creditSale($employee, [['product_id' => $p, 'qty' => 2]])->assertCreated();

        $r->assertJsonPath('data.payment_mode', 'payroll_credit')->assertJsonPath('data.billing_status', 'unbilled')
            ->assertJsonPath('data.over_limit', false)->assertJsonPath('data.payment', null)
            ->assertJsonPath('data.customer_id', $employee);
        $this->assertSame(0, DB::table('payments')->count());
        $this->assertSame(0, DB::table('fund_ledger_entries')->count());
        $this->assertSame('8.000', $this->onHand($p));

        $this->getJson('/api/shifts/current')
            ->assertJsonPath('data.summary.credit_sales_total', '40000.00')->assertJsonPath('data.summary.cash_sales_total', '0.00');

        // sisa batas terlihat Kasir lewat data karyawan
        $this->getJson("/api/customers/{$employee}")->assertJsonPath('data.credit_remaining', '60000.00');
    }

    public function test_credit_requires_active_customer_with_limit(): void
    {
        $this->openShift();
        $p = $this->makeProduct('1000');
        $this->stock($p, '10');
        $item = [['product_id' => $p, 'qty' => 1]];

        $this->creditSale($this->employee('pending_verification', null), $item)->assertUnprocessable()->assertJsonValidationErrors(['customer_id']);
        $this->creditSale($this->employee('active', null), $item)->assertUnprocessable()->assertJsonValidationErrors(['customer_id']);
        $this->creditSale($this->employee('inactive', '1000000'), $item)->assertUnprocessable()->assertJsonValidationErrors(['customer_id']);
        $this->postJson('/api/sales', ['idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'payroll_credit', 'items' => $item])
            ->assertUnprocessable()->assertJsonValidationErrors(['customer_id']);

        $this->assertSame(0, DB::table('sales')->count());
    }

    public function test_exceeding_limit_is_rejected_and_counts_previous_unbilled_credit(): void
    {
        $this->openShift();
        $p = $this->makeProduct('40000');
        $this->stock($p, '10');
        $employee = $this->employee('active', '100000');
        $item = [['product_id' => $p, 'qty' => 1]];

        $this->creditSale($employee, $item)->assertCreated();   // 40.000
        $this->creditSale($employee, $item)->assertCreated();   // 80.000
        $this->creditSale($employee, $item)->assertUnprocessable()->assertJsonValidationErrors(['credit_limit']);   // 120.000 > 100.000

        $this->assertSame(2, DB::table('sales')->count());
        $this->assertSame('8.000', $this->onHand($p));
    }

    public function test_admin_exception_allows_over_limit_with_label_note_and_audit(): void
    {
        $this->openShift();
        $p = $this->makeProduct('150000');
        $this->stock($p, '5');
        $employee = $this->employee('active', '100000');
        $this->makeUser('Admin', 'admin-penyetuju', 'sandi-admin-123');
        $item = [['product_id' => $p, 'qty' => 1]];
        $exception = fn (array $o = []) => ['credit_exception' => $o + [
            'approver_username' => 'admin-penyetuju', 'approver_password' => 'sandi-admin-123', 'note' => 'Kebutuhan mendesak, disetujui HRD',
        ]];

        // password salah
        $this->creditSale($employee, $item, $exception(['approver_password' => 'salah']))
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        // Kasir tidak berwenang sebagai penyetuju
        $this->makeUser('Kasir', 'kasir-penyetuju', 'sandi-kasir-123');
        $this->creditSale($employee, $item, $exception(['approver_username' => 'kasir-penyetuju', 'approver_password' => 'sandi-kasir-123']))
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $this->assertSame(0, DB::table('sales')->count());

        $r = $this->creditSale($employee, $item, $exception())->assertCreated();
        $r->assertJsonPath('data.over_limit', true)->assertJsonPath('data.total', '150000.00');

        $adminId = DB::table('users')->where('username', 'admin-penyetuju')->value('id');
        $this->assertDatabaseHas('sales', ['id' => $r->json('data.id'), 'over_limit_flag' => 1, 'credit_exception_by' => $adminId, 'credit_exception_note' => 'Kebutuhan mendesak, disetujui HRD']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'sale.credit_exception', 'entity_id' => $r->json('data.id'), 'reason' => 'Kebutuhan mendesak, disetujui HRD']);
    }

    public function test_exception_is_ignored_when_not_over_limit(): void
    {
        $this->openShift();
        $p = $this->makeProduct('1000');
        $this->stock($p, '5');
        $employee = $this->employee('active', '100000');
        $this->makeUser('Admin', 'admin-penyetuju2', 'sandi-admin-123');

        $this->creditSale($employee, [['product_id' => $p, 'qty' => 1]], ['credit_exception' => [
            'approver_username' => 'admin-penyetuju2', 'approver_password' => 'sandi-admin-123', 'note' => 'tidak perlu',
        ]])->assertCreated()->assertJsonPath('data.over_limit', false);
    }

    // ------------------------------------------------------------------ validasi & akses

    public function test_validation_errors(): void
    {
        $this->openShift();
        $p = $this->makeProduct();

        $this->postJson('/api/sales', [])->assertUnprocessable()->assertJsonValidationErrors(['idempotency_key', 'payment_mode', 'items']);
        $base = ['idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'cash', 'amount_tendered' => 1000];
        $this->postJson('/api/sales', $base + ['items' => [['product_id' => $p, 'qty' => 0]]])->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);
        $this->postJson('/api/sales', $base + ['items' => [['product_id' => $p, 'qty' => '1.2345']]])->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);
        $this->postJson('/api/sales', ['idempotency_key' => 'bukan-uuid', 'payment_mode' => 'cash', 'amount_tendered' => 1, 'items' => [['product_id' => $p, 'qty' => 1]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['idempotency_key']);
        $this->postJson('/api/sales', ['idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'cash', 'items' => [['product_id' => $p, 'qty' => 1]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['amount_tendered']);
    }

    public function test_idempotency_key_of_another_cashier_is_refused(): void
    {
        $this->openShift();
        $p = $this->makeProduct();
        $this->stock($p, '5');
        $key = (string) Str::uuid();
        $this->cashSale([['product_id' => $p, 'qty' => 1]], '10000', $key)->assertCreated();

        Sanctum::actingAs($this->makeUser('Kasir', 'kasir-asing'), ['*']);
        $this->cashSale([['product_id' => $p, 'qty' => 1]], '10000', $key)->assertUnprocessable()->assertJsonValidationErrors(['idempotency_key']);
    }

    public function test_cashier_sees_only_own_sales_admin_sees_all_and_reprint_is_labelled_and_logged(): void
    {
        $this->openShift();
        $p = $this->makeProduct();
        $this->stock($p, '10');
        $mine = $this->cashSale([['product_id' => $p, 'qty' => 1]], '10000')->assertCreated()->json('data.id');
        $this->postJson('/api/shifts/'.DB::table('cash_shifts')->value('id').'/close', ['counted_cash' => '10000', 'variance_note' => 'uji'])->assertOk();

        $other = $this->makeUser('Kasir', 'kasir-kedua');
        Sanctum::actingAs($other, ['*']);
        $this->postJson('/api/shifts/open')->assertCreated();
        $theirs = $this->cashSale([['product_id' => $p, 'qty' => 1]], '10000')->assertCreated()->json('data.id');

        $this->getJson('/api/sales')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $theirs);
        $this->getJson("/api/sales/{$mine}")->assertNotFound();
        $this->postJson("/api/sales/{$mine}/reprint")->assertNotFound();

        $this->postJson("/api/sales/{$theirs}/reprint")->assertOk()
            ->assertJsonPath('data.receipt.is_copy', true)->assertJsonPath('data.receipt.copy_label', 'SALINAN');
        $this->assertDatabaseHas('receipt_print_logs', ['sale_id' => $theirs, 'print_type' => 'copy', 'printed_by' => $other->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'receipt.reprint', 'entity_id' => $theirs]);

        $this->signIn('Admin');
        $this->getJson('/api/sales')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/sales?payment_mode=payroll_credit')->assertOk()->assertJsonPath('total', 0);
        $this->getJson("/api/sales/{$mine}")->assertOk()->assertJsonPath('data.id', $mine);
        $this->getJson('/api/sales?status=bogus')->assertUnprocessable();
    }
}
