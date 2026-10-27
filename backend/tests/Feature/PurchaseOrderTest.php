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

    public function test_submit_auto_approves_within_pr_total(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);   // estimasi 25.000
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p))->assertCreated()->json('data.id');

        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.approve', 'entity_id' => $po]);
    }

    public function test_submit_over_pr_total_needs_owner_confirmation(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);   // estimasi 25.000
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '10', '3000'))->assertCreated()->json('data.id');

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
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'approved');

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

        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');
    }

    public function test_send_requires_approved_and_permission(): void
    {
        $p = $this->product();
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2500']]);
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p))->assertCreated()->json('data.id');

        $this->postJson("/api/purchase-orders/{$po}/send")->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk();

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
        $po = $this->postJson('/api/purchase-orders', $this->payload($pr, $this->supplier(), $p, '5', '2000'))->assertCreated()->json('data.id');

        $this->patchJson("/api/purchase-orders/{$po}", ['items' => [['product_id' => $p, 'qty_ordered' => '8', 'unit_price' => '2100']]])
            ->assertOk()->assertJsonPath('data.total', '16800.00')->assertJsonPath('data.items.0.qty_ordered', '8.000');
        $this->patchJson("/api/purchase-orders/{$po}", ['pr_id' => $pr])->assertUnprocessable()->assertJsonValidationErrors(['pr_id']);
        $this->patchJson("/api/purchase-orders/{$po}", ['items' => [['product_id' => $p, 'qty_ordered' => '11', 'unit_price' => '1']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty_ordered']);

        $this->postJson("/api/purchase-orders/{$po}/submit")->assertOk();
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
