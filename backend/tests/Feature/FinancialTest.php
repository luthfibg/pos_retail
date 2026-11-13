<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class FinancialTest extends SeededTestCase
{
    use BuildsPurchasing;

    private User $cashier;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = $this->makeUser('Kasir', 'kasir-financial');
        $this->admin = $this->actAsAdmin();
    }

    public function test_finance_can_record_partial_po_payments_and_balance_decreases_once(): void
    {
        $this->fundMainCash('1000.00');
        $po = $this->purchaseOrder('500.00');
        $this->signIn('Finance', 'finance-po-payment');

        $this->postJson("/api/financial/purchase-orders/{$po}/payments", [
            'amount' => '200.00',
            'paid_on' => now('Asia/Jakarta')->toDateString(),
        ])->assertCreated()
            ->assertJsonPath('data.payment_status', 'partial')
            ->assertJsonPath('data.amount_paid', '200.00');

        $this->assertSame('200.00', DB::table('purchase_orders')->where('id', $po)->value('amount_paid'));
        $this->assertSame(-20000, (int) (DB::table('fund_ledger_entries')
            ->where('ref_type', 'purchase_order_payment')
            ->sum(DB::raw('amount * 100'))));

        $this->postJson("/api/financial/purchase-orders/{$po}/payments", [
            'amount' => '301.00',
        ])->assertUnprocessable()->assertJsonValidationErrors(['amount']);
        $this->assertSame(1, DB::table('purchase_order_payments')->where('po_id', $po)->count());

        $this->postJson("/api/financial/purchase-orders/{$po}/payments", [
            'amount' => '300.00',
        ])->assertCreated()->assertJsonPath('data.payment_status', 'paid');

        $this->assertSame('500.00', DB::table('purchase_orders')->where('id', $po)->value('amount_paid'));
        $this->assertSame(-50000, (int) (DB::table('fund_ledger_entries')
            ->where('ref_type', 'purchase_order_payment')
            ->sum(DB::raw('amount * 100'))));
    }

    public function test_operating_cost_and_payroll_debit_main_cash_immediately(): void
    {
        $fundId = $this->fundMainCash('500.00');
        $this->signIn('Accounting', 'accounting-expenses');

        $this->postJson('/api/financial/expenses', [
            'category' => 'operational',
            'description' => 'Listrik toko',
            'amount' => '125.00',
        ])->assertCreated();

        $this->postJson('/api/financial/expenses', [
            'category' => 'payroll',
            'description' => 'Karyawan A · November',
            'amount' => '200.00',
        ])->assertCreated();

        $this->assertSame('175.00', DB::table('fund_ledger_entries')
            ->where('fund_account_id', $fundId)
            ->selectRaw('coalesce(sum(amount), 0) as balance')
            ->value('balance'));

        $this->postJson('/api/financial/expenses', [
            'category' => 'operational',
            'description' => 'Terlalu besar',
            'amount' => '176.00',
        ])->assertUnprocessable()->assertJsonValidationErrors(['amount']);
        $this->assertSame(2, DB::table('financial_expenses')->count());
    }

    public function test_report_calculates_cash_and_net_profit_without_counting_po_payments_as_expense(): void
    {
        $this->fundMainCash('1000.00');
        $po = $this->purchaseOrder('500.00');
        $this->signIn('Finance', 'finance-report');

        $this->postJson("/api/financial/purchase-orders/{$po}/payments", ['amount' => '500.00'])->assertCreated();
        $this->postJson('/api/financial/expenses', [
            'category' => 'operational',
            'description' => 'Operasional',
            'amount' => '100.00',
        ])->assertCreated();
        $this->postJson('/api/financial/expenses', [
            'category' => 'payroll',
            'description' => 'Gaji',
            'amount' => '150.00',
        ])->assertCreated();

        $today = now('Asia/Jakarta')->toDateString();
        $this->getJson("/api/financial/report?date_from={$today}&date_to={$today}")
            ->assertOk()
            ->assertJsonPath('data.cash.opening_balance', '1000.00')
            ->assertJsonPath('data.cash.cash_in', '0.00')
            ->assertJsonPath('data.cash.cash_out', '750.00')
            ->assertJsonPath('data.cash.closing_balance', '250.00')
            ->assertJsonPath('data.profit.gross_profit', '0.00')
            ->assertJsonPath('data.profit.operating_expenses', '100.00')
            ->assertJsonPath('data.profit.payroll_expenses', '150.00')
            ->assertJsonPath('data.profit.net_profit', '-250.00')
            ->assertJsonPath('data.supplier_payments', '500.00');
    }

    public function test_financial_report_is_restricted_and_owner_cannot_record_expenses(): void
    {
        Sanctum::actingAs($this->makeUser('Kasir', 'kasir-financial-access'), ['*']);
        $this->getJson('/api/financial/report')->assertForbidden();

        Sanctum::actingAs($this->makeUser('Owner', 'owner-financial-access'), ['*']);
        $this->getJson('/api/financial/report')->assertOk();
        $this->postJson('/api/financial/expenses', [
            'category' => 'operational',
            'description' => 'Tidak diizinkan',
            'amount' => '1.00',
        ])->assertForbidden();
    }

    private function fundMainCash(string $amount): int
    {
        $fundId = (int) DB::table('fund_accounts')
            ->where('store_id', $this->storeId())
            ->where('type', 'main_cash')
            ->value('id');
        DB::table('fund_ledger_entries')->insert([
            'fund_account_id' => $fundId,
            'entry_type' => 'opening',
            'amount' => $amount,
            'ref_type' => 'test',
            'ref_id' => random_int(1, 1000000),
            'occurred_at' => now('UTC')->subDays(2)->format('Y-m-d H:i:s.v'),
            'created_by' => $this->admin->id,
            'note' => 'Saldo awal pengujian',
        ]);

        return $fundId;
    }

    private function purchaseOrder(string $total): int
    {
        $product = $this->product();
        $supplier = $this->supplier();
        $requisition = $this->pr($this->cashier->id, [$product => ['1', $total]]);

        return $this->po($requisition, $supplier, [$product => ['1', $total]], 'approved');
    }
}
