<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class ReportTest extends SeededTestCase
{
    private User $cashier;

    private int $shiftId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = $this->makeUser('Kasir', 'kasir-laporan');
        $this->shiftId = DB::table('cash_shifts')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => 'SHIFT-RPT',
            'register_id' => DB::table('registers')->value('id'),
            'cashier_id' => $this->cashier->id,
            'opening_balance' => '0.00',
            'status' => 'open',
            'opened_at' => '2026-10-28 02:00:00',
        ]);
    }

    private function sale(string $mode, string $total, string $postedAt, string $status = 'posted'): int
    {
        $customerId = null;
        if ($mode === 'payroll_credit') {
            $customerId = DB::table('customers')->insertGetId([
                'store_id' => $this->storeId(), 'customer_no' => 'EMP-RPT', 'name' => 'Karyawan Laporan',
                'status' => 'active', 'created_by' => $this->cashier->id,
            ]);
        }

        return DB::table('sales')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => 'RPT-'.Str::random(8),
            'shift_id' => $this->shiftId,
            'cashier_id' => $this->cashier->id,
            'customer_id' => $customerId,
            'payment_mode' => $mode,
            'subtotal' => $total,
            'discount_total' => '0.00',
            'tax_amount' => '0.00',
            'total' => $total,
            'status' => $status,
            'billing_status' => $mode === 'payroll_credit' ? 'unbilled' : 'not_applicable',
            'idempotency_key' => (string) Str::uuid(),
            'posted_at' => $postedAt,
        ]);
    }

    private function product(string $sku, array $overrides = []): int
    {
        return DB::table('products')->insertGetId($overrides + [
            'store_id' => $this->storeId(),
            'sku' => $sku,
            'barcode' => '899'.str_pad((string) random_int(1, 999999999), 12, '0', STR_PAD_LEFT),
            'name' => "Produk $sku",
            'sell_price' => '10000.00',
            'min_stock' => '10.000',
            'critical_stock' => '5.000',
            'status' => 'active',
        ]);
    }

    public function test_admin_can_read_sales_inventory_and_cash_dashboard(): void
    {
        $this->signIn('Admin', 'admin-laporan');

        $this->sale('cash', '100.00', '2026-10-28 02:00:00');
        $this->sale('payroll_credit', '40.00', '2026-10-28 03:00:00');
        $this->sale('cash', '999.00', '2026-10-28 04:00:00', 'voided');

        $low = $this->product('LOW');
        $expiring = $this->product('EXP', ['track_expiry' => true]);
        $batch = DB::table('product_batches')->insertGetId([
            'product_id' => $expiring,
            'batch_code' => 'EXP-01',
            'expiry_date' => '2026-10-30',
        ]);
        DB::table('inventory_balances')->insert([
            'product_id' => $expiring,
            'location_id' => DB::table('locations')->value('id'),
            'batch_id' => $batch,
            'qty_sellable' => '5.000',
        ]);

        DB::table('cash_movements')->insert([
            'shift_id' => $this->shiftId,
            'type' => 'in',
            'amount' => '50.00',
            'reason' => 'Modal tambahan',
            'created_by' => $this->cashier->id,
            'created_at' => '2026-10-28 02:30:00',
        ]);
        DB::table('cash_movements')->insert([
            'shift_id' => $this->shiftId,
            'type' => 'out',
            'amount' => '10.00',
            'reason' => 'Operasional',
            'created_by' => $this->cashier->id,
            'created_at' => '2026-10-28 03:30:00',
        ]);

        $fund = DB::table('fund_accounts')->value('id');
        DB::table('cash_deposits')->insert([
            'store_id' => $this->storeId(),
            'doc_number' => 'DEP-RPT',
            'kind' => 'partial',
            'shift_id' => $this->shiftId,
            'source_fund_id' => $fund,
            'destination_fund_id' => $fund,
            'counted_amount' => '20.00',
            'float_kept' => '0.00',
            'deposit_amount' => '20.00',
            'status' => 'received',
            'received_amount' => '20.00',
            'received_by' => $this->cashier->id,
            'received_at' => '2026-10-28 04:00:00',
            'created_by' => $this->cashier->id,
            'created_at' => '2026-10-28 03:45:00',
        ]);

        $this->getJson('/api/reports/dashboard?date_from=2026-10-28&date_to=2026-10-28')
            ->assertOk()
            ->assertJsonPath('data.period.date_from', '2026-10-28')
            ->assertJsonPath('data.sales.summary.transaction_count', 2)
            ->assertJsonPath('data.sales.summary.gross_sales', '140.00')
            ->assertJsonPath('data.sales.summary.net_sales', '140.00')
            ->assertJsonPath('data.sales.by_payment_mode.cash.net_sales', '100.00')
            ->assertJsonPath('data.sales.by_payment_mode.payroll_credit.net_sales', '40.00')
            ->assertJsonPath('data.inventory.counts.low_stock', 2)
            ->assertJsonPath('data.inventory.counts.expiring_batches', 1)
            ->assertJsonPath('data.inventory.low_stock.0.product_id', $low)
            ->assertJsonPath('data.inventory.expiring_batches.0.product_id', $expiring)
            ->assertJsonPath('data.inventory.expiring_batches.0.status', 'akan_kedaluwarsa')
            ->assertJsonPath('data.cash.sales.cash', '100.00')
            ->assertJsonPath('data.cash.movements.cash_in', '50.00')
            ->assertJsonPath('data.cash.movements.cash_out', '10.00')
            ->assertJsonPath('data.cash.deposits.received_amount', '20.00')
            ->assertJsonPath('data.cash.net_cash_movement', '120.00');

        $this->getJson('/api/reports/sales-daily?date_from=2026-10-28&date_to=2026-10-29')
            ->assertOk()
            ->assertJsonCount(2, 'data.daily')
            ->assertJsonPath('data.daily.1.transaction_count', 0);

        $this->getJson('/api/reports/inventory?include_expired=0&expiry_days=1')
            ->assertOk()
            ->assertJsonCount(0, 'data.expiring_batches');
    }

    public function test_cashier_is_restricted_to_own_shift_sales_and_cash(): void
    {
        $this->sale('cash', '100.00', '2026-10-28 02:00:00');

        $other = $this->makeUser('Kasir', 'kasir-lain-laporan');
        $otherShift = DB::table('cash_shifts')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => 'SHIFT-RPT-LAIN',
            'register_id' => DB::table('registers')->value('id'),
            'cashier_id' => $other->id,
            'opening_balance' => '0.00',
            'status' => 'closed',
            'opened_at' => '2026-10-28 02:00:00',
            'closed_at' => '2026-10-28 04:00:00',
        ]);
        DB::table('sales')->insert([
            'store_id' => $this->storeId(), 'doc_number' => 'RPT-OTHER', 'shift_id' => $otherShift,
            'cashier_id' => $other->id, 'payment_mode' => 'cash', 'subtotal' => '999.00',
            'discount_total' => '0.00', 'tax_amount' => '0.00', 'total' => '999.00', 'status' => 'posted',
            'billing_status' => 'not_applicable', 'idempotency_key' => (string) Str::uuid(), 'posted_at' => '2026-10-28 03:00:00',
        ]);

        Sanctum::actingAs($this->cashier, ['*']);
        $this->getJson('/api/reports/sales-daily?date_from=2026-10-28&date_to=2026-10-28')
            ->assertOk()
            ->assertJsonPath('data.summary.transaction_count', 1)
            ->assertJsonPath('data.summary.net_sales', '100.00');

        $this->getJson('/api/reports/sales-daily?date_from=2026-10-28&date_to=2026-10-28&cashier_id='.$other->id)
            ->assertForbidden();

        $this->getJson('/api/reports/cash-summary?date_from=2026-10-28&date_to=2026-10-28')
            ->assertOk()
            ->assertJsonPath('data.sales.cash', '100.00')
            ->assertJsonCount(0, 'data.fund_balances');
    }

    public function test_report_filters_are_validated_and_store_scoped(): void
    {
        $this->signIn('Admin', 'admin-filter-laporan');

        $this->getJson('/api/reports/sales-daily?date_from=2026-10-29&date_to=2026-10-28')
            ->assertUnprocessable();
        $this->getJson('/api/reports/sales-daily?date_from=2026-10-01&date_to=2027-10-28')
            ->assertUnprocessable();
        $this->getJson('/api/reports/sales-daily?date_from=28-10-2026')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['date_from']);
        $this->getJson('/api/reports/inventory?expiry_days=366')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['expiry_days']);

        $foreignStore = DB::table('stores')->insertGetId(['code' => 'LAIN-RPT', 'name' => 'Toko Lain']);
        $foreignCashier = User::create([
            'name' => 'Kasir Lain', 'username' => 'kasir-lain-toko',
            'password_hash' => '$2y$12$not-used', 'is_active' => true,
        ]);
        DB::table('user_roles')->insert([
            'user_id' => $foreignCashier->id,
            'role_id' => DB::table('roles')->where('name', 'Kasir')->value('id'),
            'store_id' => $foreignStore,
        ]);
        $foreignShift = DB::table('cash_shifts')->insertGetId([
            'store_id' => $foreignStore, 'doc_number' => 'SHIFT-FOREIGN',
            'register_id' => DB::table('registers')->insertGetId(['store_id' => $foreignStore, 'name' => 'Kasir 1']),
            'cashier_id' => $foreignCashier->id, 'opening_balance' => 0, 'status' => 'open', 'opened_at' => '2026-10-28 02:00:00',
        ]);
        DB::table('sales')->insert([
            'store_id' => $foreignStore, 'doc_number' => 'RPT-FOREIGN', 'shift_id' => $foreignShift,
            'cashier_id' => $foreignCashier->id, 'payment_mode' => 'cash', 'subtotal' => '555.00',
            'discount_total' => '0.00', 'tax_amount' => '0.00', 'total' => '555.00', 'status' => 'posted',
            'billing_status' => 'not_applicable', 'idempotency_key' => (string) Str::uuid(), 'posted_at' => '2026-10-28 02:00:00',
        ]);

        $this->getJson('/api/reports/sales-daily?date_from=2026-10-28&date_to=2026-10-28')
            ->assertOk()
            ->assertJsonPath('data.summary.net_sales', '0.00');
    }
}
