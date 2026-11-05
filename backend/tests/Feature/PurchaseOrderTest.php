<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\PermissionResolver;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class PurchaseOrderTest extends SeededTestCase
{
    use BuildsPurchasing;

    private User $cashier;

    private int $bankSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->bankSequence = 0;
        $this->cashier = $this->makeUser('Kasir', 'kasir-po');
        $this->actAsAdmin();
    }

    /** @return array<string, mixed> */
    private function payload(int $prId, int $supplierId, int $productId, string $qty = '10', string $price = '2400', ?int $bankId = null, ?array $credentials = null): array
    {
        return [
            'pr_id' => $prId,
            'supplier_id' => $supplierId,
            'bank_account_id' => $bankId ?? $this->bankAccount(),
            ...($credentials ?? $this->adminCreds()),
            'items' => [['product_id' => $productId, 'qty_ordered' => $qty, 'unit_price' => $price]],
        ];
    }

    private function bankAccount(): int
    {
        $this->bankSequence++;

        return $this->postJson('/api/settings/bank-accounts', [
            'bank_name' => 'Bank Uji',
            'account_name' => 'POS Retail',
            'account_number' => sprintf('123456%04d', $this->bankSequence),
        ])->assertCreated()->json('data.id');
    }

    public function test_creates_po_from_approved_pr_and_converts_the_pr(): void
    {
        $p = $this->product();
        $supplier = $this->supplier(['default_payment_terms' => 'credit']);
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);

        $response = $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p))
            ->assertCreated()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.receipt_status', 'none')
            ->assertJsonPath('data.payment_status', 'unpaid')
            ->assertJsonPath('data.payment_terms', 'credit')        // dari supplier
            ->assertJsonPath('data.total', '24000.00')
            ->assertJsonPath('data.items.0.line_total', '24000.00')
            ->assertJsonPath('data.items.0.qty_remaining', '10.000')
            ->assertJsonPath('data.bank_account.account_number_masked', '••••0001')
            ->assertJsonMissingPath('data.fund_allocation');

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
        $this->getJson("/api/purchase-requisitions/{$pr}/purchase-order-items")
            ->assertOk()
            ->assertJsonPath('data.pr_id', $pr)
            ->assertJsonPath('data.items.0.qty_available', '4.000')
            ->assertJsonMissingPath('data.items.0.qty_ordered')
            ->assertJsonMissingPath('data.items.0.qty_remaining');

        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, '5'))
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty_ordered']);

        $second = $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, '4'))->assertCreated()->json('data.id');
        $this->assertSame('converted', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));
        $this->getJson("/api/purchase-requisitions/{$pr}/purchase-order-items")->assertUnprocessable();

        $this->postJson("/api/purchase-orders/{$second}/cancel")->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $this->postJson("/api/purchase-orders/{$second}/cancel", ['reason' => 'salah supplier'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame('approved', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));
        $this->getJson("/api/purchase-requisitions/{$pr}/purchase-order-items")
            ->assertOk()->assertJsonPath('data.items.0.qty_available', '4.000');

        $first = (int) DB::table('purchase_orders')->where('pr_id', $pr)->where('status', '<>', 'cancelled')->value('id');
        $this->postJson("/api/purchase-orders/{$first}/cancel", ['reason' => 'batal'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->getJson("/api/purchase-requisitions/{$pr}/purchase-order-items")
            ->assertOk()->assertJsonPath('data.items.0.qty_available', '10.000');
    }

    public function test_po_creation_requires_one_owner_authorization_and_keeps_bank_account_only_as_po_data(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $supplier = $this->supplier();
        $bank = $this->bankAccount();

        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, bankId: $bank, credentials: []))
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $this->assertDatabaseCount('purchase_orders', 0);

        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, bankId: $bank, credentials: [
            'approver_username' => 'admin',
            'approver_password' => 'salah-sekali',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, bankId: $bank))
            ->assertCreated()->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.bank_account.id', $bank)
            ->assertJsonMissingPath('data.fund_allocation')
            ->json('data.id');
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.create', 'entity_id' => $po]);
        $this->assertDatabaseMissing('purchase_orders', ['id' => $po, 'status' => 'draft']);
        $this->assertDatabaseCount('bank_account_ledger_entries', 0);
        $this->assertDatabaseCount('purchase_fund_allocations', 0);
    }

    public function test_bank_account_settings_are_limited_to_five_and_mask_numbers_for_po_use(): void
    {
        $ids = [];
        for ($i = 0; $i < 5; $i++) {
            $ids[] = $this->bankAccount();
        }
        $this->postJson('/api/settings/bank-accounts', [
            'bank_name' => 'Bank Keenam',
            'account_name' => 'POS Retail',
            'account_number' => '9999999999',
        ])->assertUnprocessable()->assertJsonValidationErrors(['bank_accounts']);

        $this->getJson('/api/settings/bank-accounts')
            ->assertOk()
            ->assertJsonFragment(['id' => $ids[0], 'account_number' => '1234560001']);
        $this->getJson('/api/bank-accounts')
            ->assertOk()
            ->assertJsonPath('data.0.account_number_masked', '••••0001')
            ->assertJsonMissingPath('data.0.account_number')
            ->assertJsonMissingPath('data.0.balance');
        $this->patchJson("/api/settings/bank-accounts/{$ids[0]}", ['is_active' => false])
            ->assertOk()->assertJsonPath('data.is_active', false);
        $this->getJson('/api/bank-accounts')->assertOk()->assertJsonCount(4, 'data');
        $this->getJson('/api/purchase-fund')->assertNotFound();
        $this->assertCount(5, $ids);
    }

    public function test_po_requires_an_active_bank_account(): void
    {
        $product = $this->product();
        $pr = $this->pr($this->cashier->id, [$product => ['10', '2500']]);
        $bank = $this->bankAccount();
        $this->patchJson("/api/settings/bank-accounts/{$bank}", ['is_active' => false])->assertOk();

        $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $product, bankId: $bank))
            ->assertUnprocessable()->assertJsonValidationErrors(['bank_account_id']);
        $this->assertDatabaseCount('purchase_orders', 0);
    }

    public function test_po_creator_can_select_finance_account_and_owner_authorizes_once(): void
    {
        $product = $this->product();
        $pr = $this->pr($this->cashier->id, [$product => ['10', '2500']]);
        $bank = $this->bankAccount();
        Sanctum::actingAs($this->makeUser('Purchasing', 'purchasing-po'), ['*']);
        $this->getJson('/api/bank-accounts')->assertOk()->assertJsonPath('data.0.id', $bank);
        $this->makeUser('Owner', 'owner-po');
        $this->actAsAdmin();
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $product, bankId: $bank, credentials: [
            'approver_username' => 'owner-po',
            'approver_password' => 'rahasia-12345',
        ]))->assertCreated()->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.bank_account.id', $bank)->json('data.id');

        Sanctum::actingAs(User::where('username', 'owner-po')->firstOrFail(), ['*']);
        $this->postJson('/api/settings/bank-accounts', [
            'bank_name' => 'Bank Owner',
            'account_name' => 'Toko',
            'account_number' => '1111111111',
        ])->assertCreated();
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'purchase_order.create',
            'entity_id' => $po,
            'reason' => null,
        ]);
    }

    public function test_owner_authorization_is_required_even_when_po_exceeds_pr_estimate(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);   // estimasi 25.000
        $response = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '10', '3000'))
            ->assertCreated()->assertJsonPath('data.status', 'approved');
        $po = $response->json('data.id');
        $this->postJson("/api/purchase-orders/{$po}/send")->assertOk()->assertJsonPath('data.status', 'sent');
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.create', 'entity_id' => $po]);
    }

    public function test_purchase_order_owner_authorization_obeys_self_approval_policy(): void
    {
        $p = $this->product();
        $admin = $this->actAsAdmin();
        $pr = $this->pr($admin->id, [$p => ['10', '2500']]);
        $supplier = $this->supplier();
        $bank = $this->bankAccount();
        $this->setSetting('sod_owner_self_approve', 'block');

        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, bankId: $bank))
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_username']);
        $this->assertDatabaseCount('purchase_orders', 0);

        $this->setSetting('sod_owner_self_approve', 'allow_with_flag');
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, bankId: $bank))
            ->assertCreated()->json('data.id');
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'purchase_order.create',
            'entity_id' => $po,
            'is_self_approval' => 1,
        ]);
    }

    public function test_owner_can_view_po_without_purchase_order_create_permission(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '10', '3000'))->assertCreated()->json('data.id');

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
        app(PermissionResolver::class)->flush();

        $this->getJson("/api/purchase-orders/{$po}")
            ->assertOk()
            ->assertJsonPath('data.id', $po);
        $this->getJson("/api/purchase-orders/{$po}")->assertOk()->assertJsonPath('data.status', 'approved');
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
        app(PermissionResolver::class)->flush();

        $this->getJson('/api/suppliers?active_only=1')
            ->assertOk()
            ->assertJsonStructure(['data']);
    }

    public function test_purchase_order_sender_can_open_pr_and_send_without_create_permission(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p))->assertCreated()->json('data.id');

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
        app(PermissionResolver::class)->flush();

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

    public function test_pr_without_estimate_can_be_converted_to_approved_po(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', null]]);
        $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '10', '10'))
            ->assertCreated()->assertJsonPath('data.status', 'approved');
    }

    public function test_send_requires_approved_and_permission(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p))->assertCreated()->json('data.id');

        Sanctum::actingAs($this->cashier, ['*']);
        $this->postJson("/api/purchase-orders/{$po}/send")->assertForbidden();

        $this->actAsAdmin();
        $this->postJson("/api/purchase-orders/{$po}/send")->assertOk()->assertJsonPath('data.status', 'sent');
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.send', 'entity_id' => $po]);
    }

    public function test_update_replaces_items_only_while_draft(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->po($pr, $this->supplier(), [$p => ['5', '2000']], 'draft');

        $this->patchJson("/api/purchase-orders/{$po}", ['items' => [['product_id' => $p, 'qty_ordered' => '8', 'unit_price' => '2100']]])
            ->assertOk()->assertJsonPath('data.total', '16800.00')->assertJsonPath('data.items.0.qty_ordered', '8.000');
        $this->patchJson("/api/purchase-orders/{$po}", ['pr_id' => $pr])->assertUnprocessable()->assertJsonValidationErrors(['pr_id']);
        $this->patchJson("/api/purchase-orders/{$po}", ['items' => [['product_id' => $p, 'qty_ordered' => '11', 'unit_price' => '1']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty_ordered']);

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
        $bank = $this->bankAccount();
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
        $this->postJson('/api/purchase-orders', $this->payload($pr, $supplier, $p, bankId: $bank))->assertForbidden();
    }
}
