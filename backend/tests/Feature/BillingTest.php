<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\SeededTestCase;

class BillingTest extends SeededTestCase
{
    private User $admin;

    private User $cashier;

    private int $shiftId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = $this->makeUser('Admin', 'admin-tagihan');
        $this->cashier = $this->makeUser('Kasir', 'kasir-tagihan');
        $this->shiftId = DB::table('cash_shifts')->insertGetId([
            'store_id' => $this->storeId(), 'doc_number' => 'SHIFT-TGH', 'register_id' => DB::table('registers')->value('id'),
            'cashier_id' => $this->cashier->id, 'opening_balance' => 0, 'status' => 'open', 'opened_at' => now(),
        ]);
        \Laravel\Sanctum\Sanctum::actingAs($this->admin, ['*']);
    }

    private function employee(string $no, string $name): int
    {
        return DB::table('customers')->insertGetId([
            'store_id' => $this->storeId(), 'customer_no' => $no, 'name' => $name, 'department' => 'Produksi',
            'status' => 'active', 'created_by' => $this->admin->id,
        ]);
    }

    private function sale(?int $customerId, string $total, string $mode = 'payroll_credit', string $status = 'posted', ?int $period = null): int
    {
        return DB::table('sales')->insertGetId([
            'store_id' => $this->storeId(), 'doc_number' => 'S-'.Str::random(8), 'shift_id' => $this->shiftId, 'cashier_id' => $this->cashier->id,
            'customer_id' => $customerId, 'payment_mode' => $mode, 'subtotal' => $total, 'total' => $total, 'status' => $status,
            'billing_status' => $mode === 'payroll_credit' ? 'unbilled' : 'not_applicable', 'billing_period_id' => $period,
            'idempotency_key' => (string) Str::uuid(), 'posted_at' => now()->subSecond(),
        ]);
    }

    private function openPeriod(): int
    {
        return $this->postJson('/api/billing-periods', ['label' => 'Oktober 2026', 'scheduled_close_date' => '2026-10-28'])
            ->assertCreated()->assertJsonPath('data.status', 'open')->json('data.id');
    }

    /** Dua karyawan, tiga struk kredit (+ tunai dan batal yang tidak ikut), periode ditutup. @return array{int, int, int} [periode, budi, sari] */
    private function closedPeriodWithSales(): array
    {
        $budi = $this->employee('NIK-1', 'Budi');
        $sari = $this->employee('NIK-2', 'Sari');
        $period = $this->openPeriod();

        $this->sale($budi, '100000.00');
        $this->sale($budi, '50000.50');
        $this->sale($sari, '25000.00');
        $this->sale(null, '999000.00', 'cash');
        $this->sale($sari, '888000.00', 'payroll_credit', 'voided');

        $this->postJson("/api/billing-periods/{$period}/close")->assertOk();

        return [$period, $budi, $sari];
    }

    public function test_open_period_once_and_update_schedule(): void
    {
        $this->getJson('/api/billing-periods/current')->assertOk()->assertJsonPath('data', null);

        $id = $this->openPeriod();
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing_period.open', 'entity_id' => $id, 'actor_id' => $this->admin->id]);

        $this->postJson('/api/billing-periods', [])->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->getJson('/api/billing-periods/current')->assertOk()->assertJsonPath('data.id', $id);

        $this->patchJson("/api/billing-periods/{$id}", ['scheduled_close_date' => '2026-10-30'])->assertOk()
            ->assertJsonPath('data.scheduled_close_date', '2026-10-30');
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing_period.update', 'entity_id' => $id]);

        $this->patchJson("/api/billing-periods/{$id}", ['scheduled_close_date' => '30-10-2026'])->assertUnprocessable();
        $this->getJson('/api/billing-periods/99999')->assertNotFound();
        $this->getJson('/api/billing-periods')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_close_binds_only_posted_credit_sales_and_opens_next_period(): void
    {
        $budi = $this->employee('NIK-1', 'Budi');
        $id = $this->openPeriod();
        $credit = $this->sale($budi, '100000.00');
        $cash = $this->sale(null, '50000.00', 'cash');
        $voided = $this->sale($budi, '70000.00', 'payroll_credit', 'voided');

        $this->postJson("/api/billing-periods/{$id}/close")->assertOk()
            ->assertJsonPath('data.status', 'closed')->assertJsonPath('data.sales_count', 1)->assertJsonPath('data.sales_total', '100000.00')
            ->assertJsonPath('data.customers.0.name', 'Budi');

        $this->assertSame($id, (int) DB::table('sales')->where('id', $credit)->value('billing_period_id'));
        $this->assertNull(DB::table('sales')->where('id', $cash)->value('billing_period_id'));
        $this->assertNull(DB::table('sales')->where('id', $voided)->value('billing_period_id'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing_period.close', 'entity_id' => $id, 'actor_id' => $this->admin->id]);

        $next = $this->getJson('/api/billing-periods/current')->assertOk()->json('data');
        $this->assertNotNull($next);
        $this->assertNotSame($id, $next['id']);
        $this->assertSame('open', $next['status']);

        // struk kredit setelah tutup tidak terikat ke periode lama
        $later = $this->sale($budi, '10000.00');
        $this->postJson("/api/billing-periods/{$next['id']}/close")->assertOk()->assertJsonPath('data.sales_count', 1);
        $this->assertNotSame($id, (int) DB::table('sales')->where('id', $later)->value('billing_period_id'));

        $this->postJson("/api/billing-periods/{$id}/close")->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->patchJson("/api/billing-periods/{$id}", ['label' => 'x'])->assertUnprocessable();
    }

    public function test_closing_frees_the_credit_limit_of_the_new_period(): void
    {
        $budi = $this->employee('NIK-1', 'Budi');
        DB::table('customer_credit_limits')->insert(['customer_id' => $budi, 'limit_amount' => '500000.00', 'set_by' => $this->admin->id]);
        $id = $this->openPeriod();
        $this->sale($budi, '300000.00');

        $this->getJson("/api/customers/{$budi}")->assertJsonPath('data.credit_remaining', '200000.00');
        $this->postJson("/api/billing-periods/{$id}/close")->assertOk();
        $this->getJson("/api/customers/{$budi}")->assertJsonPath('data.credit_remaining', '500000.00');
    }

    public function test_generate_invoice_with_lines_grouped_per_employee(): void
    {
        [$period, $budi] = $this->closedPeriodWithSales();

        $r = $this->postJson("/api/billing-periods/{$period}/invoice", ['bill_to' => 'HRD PT Maju'])->assertCreated()
            ->assertJsonPath('data.status', 'draft')->assertJsonPath('data.bill_to', 'HRD PT Maju')
            ->assertJsonPath('data.subtotal', '175000.50')->assertJsonPath('data.tax_amount', '0.00')->assertJsonPath('data.tax_rate', null)
            ->assertJsonPath('data.total', '175000.50')->assertJsonPath('data.amount_remaining', '175000.50')
            ->assertJsonCount(2, 'data.customers')
            ->assertJsonPath('data.customers.0.name', 'Budi')->assertJsonPath('data.customers.0.subtotal', '150000.50')
            ->assertJsonCount(2, 'data.customers.0.sales')->assertJsonPath('data.customers.1.subtotal', '25000.00');

        $this->assertMatchesRegularExpression('/^INV-\d{6}-000001$/', $r->json('data.document_no'));
        $id = $r->json('data.id');

        $this->assertSame(3, DB::table('receivable_invoice_lines')->where('invoice_id', $id)->count());
        $this->assertSame(3, DB::table('sales')->where('invoice_id', $id)->where('billing_status', 'invoiced')->count());
        $this->assertSame('invoiced', DB::table('billing_periods')->where('id', $period)->value('status'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'invoice.generate', 'entity_id' => $id]);

        $this->getJson("/api/billing-periods/{$period}")->assertJsonPath('data.invoice_id', $id);
        $this->getJson('/api/invoices')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/invoices?status=paid')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/invoices?status=bogus')->assertUnprocessable();

        // karyawan Budi memegang dua struk di invoice
        $this->assertSame(2, DB::table('receivable_invoice_lines')->where('invoice_id', $id)->where('customer_id', $budi)->count());
    }

    public function test_invoice_rules_open_period_duplicate_and_empty(): void
    {
        $open = $this->openPeriod();
        $this->postJson("/api/billing-periods/{$open}/invoice")->assertUnprocessable()->assertJsonValidationErrors(['status']);

        $this->postJson("/api/billing-periods/{$open}/close")->assertOk();   // kosong
        $this->postJson("/api/billing-periods/{$open}/invoice")->assertUnprocessable()->assertJsonValidationErrors(['status']);

        [$period] = $this->closedPeriodWithSalesInNextPeriod();
        $this->postJson("/api/billing-periods/{$period}/invoice")->assertCreated();
        $this->postJson("/api/billing-periods/{$period}/invoice")->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->postJson('/api/billing-periods/99999/invoice')->assertNotFound();
    }

    /** Periode berikutnya (otomatis terbuka) diberi struk lalu ditutup. @return array{int} */
    private function closedPeriodWithSalesInNextPeriod(): array
    {
        $budi = $this->employee('NIK-9', 'Andi');
        $next = $this->getJson('/api/billing-periods/current')->json('data.id');
        $this->sale($budi, '40000.00');
        $this->postJson("/api/billing-periods/{$next}/close")->assertOk();

        return [$next];
    }

    public function test_vat_is_added_on_invoice_only_when_configured(): void
    {
        [$period] = $this->closedPeriodWithSales();
        DB::table('settings')->insert(['store_id' => $this->storeId(), 'setting_key' => 'vat_enabled', 'setting_value' => json_encode(true)]);

        // konfigurasi belum lengkap: invoice ditolak dan tidak ada yang berubah
        $this->postJson("/api/billing-periods/{$period}/invoice")->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertSame(0, DB::table('receivable_invoices')->count());
        $this->assertSame('closed', DB::table('billing_periods')->where('id', $period)->value('status'));

        DB::table('tax_rates')->insert([
            'store_id' => $this->storeId(), 'name' => 'PPN', 'rate' => '11.00', 'price_includes_tax' => 0,
            'effective_from' => now('Asia/Jakarta')->subDay()->toDateString(), 'created_by' => $this->admin->id,
        ]);

        // eksklusif: 11% x 175.000,50 = 19.250,055 -> 19.250,06
        $this->postJson("/api/billing-periods/{$period}/invoice")->assertCreated()
            ->assertJsonPath('data.tax_rate', '11.00')->assertJsonPath('data.tax_amount', '19250.06')
            ->assertJsonPath('data.subtotal', '175000.50')->assertJsonPath('data.total', '194250.56');
    }

    public function test_inclusive_vat_keeps_total_equal_to_subtotal(): void
    {
        $budi = $this->employee('NIK-1', 'Budi');
        $id = $this->openPeriod();
        $this->sale($budi, '111000.00');
        $this->postJson("/api/billing-periods/{$id}/close")->assertOk();
        DB::table('settings')->insert(['store_id' => $this->storeId(), 'setting_key' => 'vat_enabled', 'setting_value' => json_encode(true)]);
        DB::table('tax_rates')->insert([
            'store_id' => $this->storeId(), 'name' => 'PPN', 'rate' => '11.00', 'price_includes_tax' => 1,
            'effective_from' => now('Asia/Jakarta')->subDay()->toDateString(), 'created_by' => $this->admin->id,
        ]);

        $this->postJson("/api/billing-periods/{$id}/invoice")->assertCreated()
            ->assertJsonPath('data.tax_amount', '11000.00')->assertJsonPath('data.total', '111000.00');
    }

    public function test_invoice_lifecycle_with_partial_payments(): void
    {
        [$period] = $this->closedPeriodWithSales();
        $invoice = $this->postJson("/api/billing-periods/{$period}/invoice")->assertCreated()->json('data.id');   // total 175000.50

        // belum diterbitkan: belum boleh dibayar
        $this->postJson("/api/invoices/{$invoice}/payments", ['amount' => '1000'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->postJson("/api/invoices/{$invoice}/hand-over")->assertUnprocessable()->assertJsonValidationErrors(['status']);

        $this->postJson("/api/invoices/{$invoice}/issue")->assertOk()->assertJsonPath('data.status', 'issued');
        $this->assertNotNull(DB::table('receivable_invoices')->where('id', $invoice)->value('issued_at'));
        $this->postJson("/api/invoices/{$invoice}/issue")->assertUnprocessable();
        $this->postJson("/api/invoices/{$invoice}/hand-over")->assertOk()->assertJsonPath('data.status', 'handed_to_hr');

        $this->postJson("/api/invoices/{$invoice}/payments", ['amount' => '100000', 'reference' => 'TRF-1', 'received_on' => '2026-10-28'])
            ->assertCreated()->assertJsonPath('data.status', 'partially_paid')->assertJsonPath('data.amount_paid', '100000.00')
            ->assertJsonPath('data.amount_remaining', '75000.50')->assertJsonCount(1, 'data.payments');
        $this->assertSame(3, DB::table('sales')->where('invoice_id', $invoice)->where('billing_status', 'invoiced')->count());

        $this->postJson("/api/invoices/{$invoice}/payments", ['amount' => '75000.51'])->assertUnprocessable()->assertJsonValidationErrors(['amount']);
        $this->postJson("/api/invoices/{$invoice}/payments", ['amount' => '0'])->assertUnprocessable();
        $this->postJson("/api/invoices/{$invoice}/payments", ['amount' => '10.123'])->assertUnprocessable();

        $this->postJson("/api/invoices/{$invoice}/payments", ['amount' => '75000.50'])->assertCreated()
            ->assertJsonPath('data.status', 'paid')->assertJsonPath('data.amount_remaining', '0.00')->assertJsonCount(2, 'data.payments');
        $this->assertSame(3, DB::table('sales')->where('invoice_id', $invoice)->where('billing_status', 'paid')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'invoice.record_payment', 'entity_id' => $invoice, 'actor_id' => $this->admin->id]);

        $this->postJson("/api/invoices/{$invoice}/payments", ['amount' => '1'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_billed_credit_sale_cannot_be_voided_after_invoice(): void
    {
        $budi = $this->employee('NIK-1', 'Budi');
        $id = $this->openPeriod();
        $sale = $this->sale($budi, '100000.00');
        $this->postJson("/api/billing-periods/{$id}/close")->assertOk();
        $this->postJson("/api/billing-periods/{$id}/invoice")->assertCreated();

        $this->postJson("/api/sales/{$sale}/void", ['reason' => 'salah'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertSame('posted', DB::table('sales')->where('id', $sale)->value('status'));
    }

    public function test_cashier_and_guest_have_no_access(): void
    {
        $id = $this->openPeriod();
        \Laravel\Sanctum\Sanctum::actingAs($this->cashier, ['*']);
        app(\App\Services\PermissionResolver::class)->flush();

        $this->getJson('/api/billing-periods')->assertForbidden();
        $this->postJson('/api/billing-periods', [])->assertForbidden();
        $this->postJson("/api/billing-periods/{$id}/close")->assertForbidden();
        $this->postJson("/api/billing-periods/{$id}/invoice")->assertForbidden();
        $this->getJson('/api/invoices')->assertForbidden();
        $this->postJson('/api/invoices/1/payments', ['amount' => 1])->assertForbidden();
    }
}
