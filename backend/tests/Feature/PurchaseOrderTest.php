<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class PurchaseOrderTest extends SeededTestCase
{
    use BuildsPurchasing;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = $this->makeUser('Kasir', 'kasir-po');
        $this->actAsAdmin();
    }

    /** @return array<string, mixed> */
    private function payload(int $prId, int $supplierId, int $productId, string $qty = '10', string $price = '2400'): array
    {
        return [
            'pr_id' => $prId,
            'supplier_id' => $supplierId,
            'items' => [['product_id' => $productId, 'qty_ordered' => $qty, 'unit_price' => $price]],
        ];
    }

    private function bankAccount(string $openingBalance = '1000000.00'): int
    {
        return $this->postJson('/api/bank-accounts', [
            'bank_name' => 'Bank Uji',
            'account_name' => 'POS Retail',
            'account_number' => '1234567890',
            'opening_balance' => $openingBalance,
            'reason' => 'Saldo awal sesuai pencatatan manual',
        ])->assertCreated()->json('data.id');
    }

    private function allocatePo(int $poId, int $bankId): void
    {
        $this->postJson("/api/purchase-orders/{$poId}/fund-allocation", ['bank_account_id' => $bankId])
            ->assertCreated()->assertJsonPath('data.fund_allocation.status', 'reserved');
    }

    public function test_creates_po_from_approved_pr_and_converts_the_pr(): void
    {
        $p = $this->product();
        $supplier = $this->supplier(['default_payment_terms' => 'credit']);
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);

        $response = $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p))
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.receipt_status', 'none')
            ->assertJsonPath('data.payment_status', 'unpaid')
            ->assertJsonPath('data.payment_terms', 'credit')        // dari supplier
            ->assertJsonPath('data.total', '24000.00')
            ->assertJsonPath('data.items.0.line_total', '24000.00')
            ->assertJsonPath('data.items.0.qty_remaining', '10.000');

        $this->assertMatchesRegularExpression('/^PO-\d{6}-000001$/', $response->json('data.doc_number'));
        $this->assertSame('converted', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_requisition.convert', 'entity_id' => $pr]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.create']);
    }

    public function test_rejects_unapproved_pr_inactive_supplier_and_foreign_product(): void
    {
        $p = $this->product();
        $other = $this->product();
        $supplier = $this->supplier();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $submitted = $this->pr($this->cashier->id, [$p => ['10', '2500']], 'submitted');

        $this->postJson('/api/purchase-orders', $this->payload($submitted, $supplier, $p))
            ->assertUnprocessable()->assertJsonValidationErrors(['pr_id']);
        $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(['is_active' => 0]), $p))
            ->assertUnprocessable()->assertJsonValidationErrors(['supplier_id']);
        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $other))
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);

        $this->assertSame(0, DB::table('purchase_orders')->count());
    }

    public function test_quantity_cap_is_cumulative_and_cancel_reopens_the_pr(): void
    {
        $p = $this->product();
        $supplier = $this->supplier();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);

        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, '6'))->assertCreated();
        $this->assertSame('approved', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));

        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, '5'))
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty_ordered']);

        $second = $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, '4'))->assertCreated()->json('data.id');
        $this->assertSame('converted', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));

        $this->postJson("/api/purchase-orders/{$second}/cancel")->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $this->postJson("/api/purchase-orders/{$second}/cancel", ['reason' => 'salah supplier'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame('approved', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));
    }

    public function test_submit_requires_full_funding_and_owner_approval_even_within_pr_total(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);   // estimasi 25.000
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p))->assertCreated()->json('data.id');

        $this->postJson("/api/purchase-orders/{$po}/submit")->assertUnprocessable()->assertJsonValidationErrors(['allocation']);
        $bank = $this->bankAccount();
        $this->allocatePo($po, $bank);

        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');
        $this->postJson("/api/purchase-orders/{$po}/confirm", $this->adminCreds())
            ->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.confirm', 'entity_id' => $po]);
    }

    public function test_allocation_reserves_account_and_purchase_fund_balances_and_cancel_releases_them(): void
    {
        $product = $this->product();
        $pr = $this->pr($this->cashier->id, [$product => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $product))
            ->assertCreated()->json('data.id');
        $bank = $this->bankAccount('50000');
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'bank_account.create',
            'reason' => 'Saldo awal sesuai pencatatan manual',
        ]);

        $this->allocatePo($po, $bank);
        $this->getJson('/api/bank-accounts')
            ->assertOk()->assertJsonPath('data.0.balance', '50000.00')
            ->assertJsonPath('data.0.reserved_for_purchase_fund', '24000.00')
            ->assertJsonPath('data.0.available_balance', '26000.00')
            ->assertJsonPath('data.0.account_number_masked', '••••7890');
        $this->getJson('/api/purchase-fund')
            ->assertOk()->assertJsonPath('data.balance', '24000.00')
            ->assertJsonPath('data.reserved_total', '24000.00');

        $this->postJson("/api/purchase-orders/{$po}/cancel", ['reason' => 'PO tidak jadi'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->getJson('/api/bank-accounts')
            ->assertOk()->assertJsonPath('data.0.balance', '50000.00')
            ->assertJsonPath('data.0.reserved_for_purchase_fund', '0.00')
            ->assertJsonPath('data.0.available_balance', '50000.00');
        $this->getJson('/api/purchase-fund')
            ->assertOk()->assertJsonPath('data.balance', '0.00')
            ->assertJsonPath('data.reserved_total', '0.00');
    }

    public function test_allocation_rejects_insufficient_unreserved_bank_balance(): void
    {
        $product = $this->product();
        $pr = $this->pr($this->cashier->id, [$product => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $product))
            ->assertCreated()->json('data.id');

        $this->postJson("/api/purchase-orders/{$po}/fund-allocation", [
            'bank_account_id' => $this->bankAccount('10000'),
        ])->assertUnprocessable()->assertJsonValidationErrors(['bank_account_id']);
        $this->assertDatabaseCount('purchase_fund_allocations', 0);
    }

    public function test_manual_bank_decrease_cannot_consume_reserved_purchase_funds(): void
    {
        $product = $this->product();
        $pr = $this->pr($this->cashier->id, [$product => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $product))
            ->assertCreated()->json('data.id');
        $bank = $this->bankAccount('50000');
        $this->allocatePo($po, $bank);

        $this->postJson("/api/bank-accounts/{$bank}/adjustments", [
            'direction' => 'decrease',
            'amount' => '30000',
            'reason' => 'Koreksi saldo',
        ])->assertUnprocessable()->assertJsonValidationErrors(['amount']);
        $this->getJson('/api/bank-accounts')->assertOk()->assertJsonPath('data.0.balance', '50000.00');
    }

    public function test_finance_can_allocate_and_owner_can_review_without_bank_management_access(): void
    {
        $product = $this->product();
        $pr = $this->pr($this->cashier->id, [$product => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $product))
            ->assertCreated()->json('data.id');

        $finance = $this->makeUser('Finance', 'finance-po');
        Sanctum::actingAs($finance, ['*']);
        $bank = $this->postJson('/api/bank-accounts', [
            'bank_name' => 'Bank Finance',
            'account_name' => 'Toko',
            'account_number' => '9876543210',
            'opening_balance' => '50000',
            'reason' => 'Saldo awal sesuai rekening',
        ])->assertCreated()->json('data.id');
        $this->getJson('/api/purchase-fund')->assertOk();
        $this->postJson("/api/purchase-orders/{$po}/fund-allocation", ['bank_account_id' => $bank])->assertCreated();
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');

        $owner = $this->makeUser('Owner', 'owner-po');
        Sanctum::actingAs($owner, ['*']);
        $this->getJson('/api/purchase-fund')->assertOk();
        $this->postJson('/api/bank-accounts', [
            'bank_name' => 'Tidak boleh',
            'account_name' => 'Toko',
            'account_number' => '1111111111',
            'opening_balance' => '0',
            'reason' => 'Rekening tanpa saldo awal',
        ])->assertForbidden();
        $this->postJson("/api/purchase-orders/{$po}/confirm", [
            'approver_username' => 'owner-po',
            'approver_password' => 'rahasia-12345',
        ])->assertOk()->assertJsonPath('data.status', 'approved');
    }

    public function test_submit_over_pr_total_needs_owner_confirmation(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);   // estimasi 25.000
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '10', '3000'))->assertCreated()->json('data.id');

        $this->allocatePo($po, $this->bankAccount());
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');
        $this->postJson("/api/purchase-orders/{$po}/send")->assertUnprocessable()->assertJsonValidationErrors(['status']);

        $this->postJson("/api/purchase-orders/{$po}/confirm")->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $this->postJson("/api/purchase-orders/{$po}/confirm", ['approver_username' => 'admin', 'approver_password' => 'salah-sekali'])
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $this->postJson("/api/purchase-orders/{$po}/confirm", $this->adminCreds() + ['note' => 'Harga naik'])
            ->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.confirm', 'entity_id' => $po, 'reason' => 'Harga naik']);

        $this->postJson("/api/purchase-orders/{$po}/confirm", $this->adminCreds())->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_owner_can_view_and_confirm_po_without_purchase_order_create_permission(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '10', '3000'))->assertCreated()->json('data.id');
        $this->allocatePo($po, $this->bankAccount());
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');

        $admin = $this->actAsAdmin();
        $storeId = (int) DB::table('user_roles')->where('user_id', $admin->id)->value('store_id');
        foreach (['purchase_order.create', 'purchase_order.send', 'goods_receipt.create'] as $code) {
            DB::table('user_permissions')->insert([
                'user_id' => $admin->id,
                'permission_id' => DB::table('permissions')->where('code', $code)->value('id'),
                'store_id' => $storeId,
                'effect' => 'deny',
            ]);
        }
        app(\App\Services\PermissionResolver::class)->flush();

        $this->getJson("/api/purchase-orders/{$po}")
            ->assertOk()
            ->assertJsonPath('data.id', $po);
        $this->postJson("/api/purchase-orders/{$po}/confirm", $this->adminCreds())
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_purchase_order_creator_can_list_suppliers_without_supplier_manage_permission(): void
    {
        $admin = $this->actAsAdmin();
        $storeId = (int) DB::table('user_roles')->where('user_id', $admin->id)->value('store_id');
        DB::table('user_permissions')->insert([
            'user_id' => $admin->id,
            'permission_id' => DB::table('permissions')->where('code', 'supplier.manage')->value('id'),
            'store_id' => $storeId,
            'effect' => 'deny',
        ]);
        app(\App\Services\PermissionResolver::class)->flush();

        $this->getJson('/api/suppliers?active_only=1')
            ->assertOk()
            ->assertJsonStructure(['data']);
    }

    public function test_purchase_order_sender_can_open_pr_and_send_without_create_permission(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p))->assertCreated()->json('data.id');
        $this->allocatePo($po, $this->bankAccount());
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');
        $this->postJson("/api/purchase-orders/{$po}/confirm", $this->adminCreds())->assertOk()->assertJsonPath('data.status', 'approved');

        $admin = $this->actAsAdmin();
        $storeId = (int) DB::table('user_roles')->where('user_id', $admin->id)->value('store_id');
        foreach (['purchase_requisition.create', 'purchase_order.create', 'goods_receipt.create'] as $code) {
            DB::table('user_permissions')->insert([
                'user_id' => $admin->id,
                'permission_id' => DB::table('permissions')->where('code', $code)->value('id'),
                'store_id' => $storeId,
                'effect' => 'deny',
            ]);
        }
        app(\App\Services\PermissionResolver::class)->flush();

        $this->getJson('/api/purchase-requisitions')
            ->assertOk()
            ->assertJsonPath('data.0.id', $pr);
        $this->getJson("/api/purchase-orders/{$po}")
            ->assertOk()
            ->assertJsonPath('data.id', $po);
        $this->postJson("/api/purchase-orders/{$po}/send")
            ->assertOk()
            ->assertJsonPath('data.status', 'sent');
    }

    public function test_pr_without_estimate_always_needs_confirmation(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', null]]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '10', '10'))->assertCreated()->json('data.id');

        $this->allocatePo($po, $this->bankAccount());
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');
    }

    public function test_send_requires_approved_and_permission(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p))->assertCreated()->json('data.id');

        $this->postJson("/api/purchase-orders/{$po}/send")->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->allocatePo($po, $this->bankAccount());
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');

        Sanctum::actingAs($this->cashier, ['*']);
        $this->postJson("/api/purchase-orders/{$po}/send")->assertForbidden();

        $this->actAsAdmin();
        $this->postJson("/api/purchase-orders/{$po}/confirm", $this->adminCreds())->assertOk();
        $this->postJson("/api/purchase-orders/{$po}/send")->assertOk()->assertJsonPath('data.status', 'sent');
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.send', 'entity_id' => $po]);
    }

    public function test_update_replaces_items_only_while_draft(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '5', '2000'))->assertCreated()->json('data.id');

        $this->patchJson("/api/purchase-orders/{$po}", ['items' => [['product_id' => $p, 'qty_ordered' => '8', 'unit_price' => '2100']]])
            ->assertOk()->assertJsonPath('data.total', '16800.00')->assertJsonPath('data.items.0.qty_ordered', '8.000');
        $this->patchJson("/api/purchase-orders/{$po}", ['pr_id' => $pr])->assertUnprocessable()->assertJsonValidationErrors(['pr_id']);
        $this->patchJson("/api/purchase-orders/{$po}", ['items' => [['product_id' => $p, 'qty_ordered' => '11', 'unit_price' => '1']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty_ordered']);

        $this->allocatePo($po, $this->bankAccount());
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');
        $this->postJson("/api/purchase-orders/{$po}/confirm", $this->adminCreds())->assertOk();
        $this->postJson("/api/purchase-orders/{$po}/send")->assertOk();
        $this->patchJson("/api/purchase-orders/{$po}", ['payment_terms' => 'cod'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_close_needs_a_receipt_first(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']], 'converted');
        $po = $this->po($pr, $this->supplier(), [$p => ['10', '2400']], 'sent');

        $this->postJson("/api/purchase-orders/{$po}/close", ['reason' => 'supplier batal'])
            ->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_cashier_sees_only_receivable_orders_without_prices(): void
    {
        $p = $this->product();
        $supplier = $this->supplier();
        $pr = $this->pr($this->cashier->id, [$p => ['20', '2500']], 'converted');
        $draft = $this->po($pr, $supplier, [$p => ['10', '2400']], 'draft');
        $sent = $this->po($pr, $supplier, [$p => ['10', '2400']], 'sent');

        $this->getJson('/api/purchase-orders')->assertOk()->assertJsonPath('total', 2);

        Sanctum::actingAs($this->cashier, ['*']);
        $this->getJson('/api/purchase-orders')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $sent)->assertJsonPath('data.0.total', null);
        $this->getJson("/api/purchase-orders/{$sent}")->assertOk()
            ->assertJsonPath('data.items.0.unit_price', null)->assertJsonPath('data.items.0.qty_ordered', '10.000');
        $this->getJson("/api/purchase-orders/{$draft}")->assertNotFound();
        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p))->assertForbidden();
    }
}
