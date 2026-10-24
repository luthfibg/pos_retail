<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class PurchaseRequisitionTest extends SeededTestCase
{
    use BuildsPurchasing;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = $this->makeUser('Kasir', 'kasir-beli');
        Sanctum::actingAs($this->cashier, ['*']);
    }

    /** @return array<string, mixed> */
    private function payload(int $productId, array $item = []): array
    {
        return ['reason' => 'Stok menipis', 'items' => [$item + ['product_id' => $productId, 'qty' => '10', 'est_price' => '2500']]];
    }

    private function createSubmitted(int $productId): int
    {
        $id = $this->postJson('/api/purchase-requisitions', $this->payload($productId))->assertCreated()->json('data.id');
        $this->postJson("/api/purchase-requisitions/{$id}/submit")->assertOk();

        return $id;
    }

    public function test_cashier_creates_draft_with_computed_total_number_and_audit(): void
    {
        $p1 = $this->product();
        $p2 = $this->product();

        $response = $this->postJson('/api/purchase-requisitions', ['reason' => 'Stok menipis', 'items' => [
            ['product_id' => $p1, 'qty' => '10', 'est_price' => '2500'],
            ['product_id' => $p2, 'qty' => '2.5', 'est_price' => '1000.50', 'note' => 'merk bebas'],
        ]])->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.est_total', '27501.25')   // 10 x 2500 + 2,5 x 1000,50
            ->assertJsonPath('data.items.0.qty', '10.000')
            ->assertJsonPath('data.items.0.qty_remaining', '10.000')
            ->assertJsonPath('data.requester_name', $this->cashier->name);

        $this->assertMatchesRegularExpression('/^PR-\d{6}-000001$/', $response->json('data.doc_number'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_requisition.create', 'actor_id' => $this->cashier->id]);
    }

    public function test_item_validation(): void
    {
        $good = $this->product();
        $inactive = $this->product(['status' => 'inactive']);

        $this->postJson('/api/purchase-requisitions', ['items' => [['product_id' => $inactive, 'qty' => '1']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);
        $this->postJson('/api/purchase-requisitions', ['items' => [
            ['product_id' => $good, 'qty' => '1'], ['product_id' => $good, 'qty' => '2'],
        ]])->assertUnprocessable()->assertJsonValidationErrors(['items.1.product_id']);
        $this->postJson('/api/purchase-requisitions', ['items' => [['product_id' => 999999, 'qty' => '1']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.product_id']);
        $this->postJson('/api/purchase-requisitions', $this->payload($good, ['qty' => '0']))
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);
        $this->postJson('/api/purchase-requisitions', ['items' => []])
            ->assertUnprocessable()->assertJsonValidationErrors(['items']);

        $this->assertSame(0, DB::table('purchase_requisitions')->count());
    }

    public function test_submit_notifies_finance_and_locks_editing(): void
    {
        $id = $this->createSubmitted($this->product());

        $this->assertSame(1, $this->notificationCount('pr.submitted', $this->seededAdmin()->id));
        $this->patchJson("/api/purchase-requisitions/{$id}", ['reason' => 'ubah'])
            ->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_full_approval_flow_records_both_decisions(): void
    {
        $id = $this->createSubmitted($this->product());

        $admin = $this->actAsAdmin();
        $this->postJson("/api/purchase-requisitions/{$id}/finance-check", ['decision' => 'pass'])
            ->assertOk()->assertJsonPath('data.status', 'finance_checked');
        $this->postJson("/api/purchase-requisitions/{$id}/approve", $this->adminCreds())
            ->assertOk()->assertJsonPath('data.status', 'approved')
            ->assertJsonCount(2, 'data.approvals')
            ->assertJsonPath('data.approvals.0.step', 'finance_check')
            ->assertJsonPath('data.approvals.1.step', 'owner_auth')
            ->assertJsonPath('data.approvals.1.is_self_approval', false);

        $this->assertNotNull(DB::table('pr_approvals')->where('pr_id', $id)->where('step', 'owner_auth')->value('reauth_at'));
        $this->assertSame(1, $this->notificationCount('pr.approved', $this->cashier->id));
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_requisition.approve', 'actor_id' => $admin->id, 'is_self_approval' => 0]);
    }

    public function test_finance_return_needs_note_and_allows_edit_and_resubmit(): void
    {
        $id = $this->createSubmitted($this->product());

        $this->actAsAdmin();
        $this->postJson("/api/purchase-requisitions/{$id}/finance-check", ['decision' => 'return'])
            ->assertUnprocessable()->assertJsonValidationErrors(['note']);
        $this->postJson("/api/purchase-requisitions/{$id}/finance-check", ['decision' => 'return', 'note' => 'Jumlah terlalu besar'])
            ->assertOk()->assertJsonPath('data.status', 'returned');
        $this->assertSame(1, $this->notificationCount('pr.returned', $this->cashier->id));

        Sanctum::actingAs($this->cashier, ['*']);
        $this->patchJson("/api/purchase-requisitions/{$id}", ['reason' => 'Sudah dikurangi'])->assertOk();
        $this->postJson("/api/purchase-requisitions/{$id}/submit")->assertOk()->assertJsonPath('data.status', 'submitted');
    }

    public function test_approval_requires_valid_reauth_and_permission(): void
    {
        $id = $this->createSubmitted($this->product());

        // Kasir tidak punya purchase_requisition.approve / finance_check
        $this->postJson("/api/purchase-requisitions/{$id}/finance-check", ['decision' => 'pass'])->assertForbidden();
        $this->postJson("/api/purchase-requisitions/{$id}/approve", $this->adminCreds())->assertForbidden();

        $this->actAsAdmin();
        $this->postJson("/api/purchase-requisitions/{$id}/finance-check", ['decision' => 'pass'])->assertOk();

        $this->postJson("/api/purchase-requisitions/{$id}/approve")
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $this->postJson("/api/purchase-requisitions/{$id}/approve", ['approver_username' => 'admin', 'approver_password' => 'salah-sekali'])
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);

        $this->assertSame('finance_checked', DB::table('purchase_requisitions')->where('id', $id)->value('status'));
    }

    public function test_reject_requires_note(): void
    {
        $id = $this->createSubmitted($this->product());

        $this->actAsAdmin();
        $this->postJson("/api/purchase-requisitions/{$id}/finance-check", ['decision' => 'pass'])->assertOk();
        $this->postJson("/api/purchase-requisitions/{$id}/approve", $this->adminCreds() + ['decision' => 'reject'])
            ->assertUnprocessable()->assertJsonValidationErrors(['note']);
        $this->postJson("/api/purchase-requisitions/{$id}/approve", $this->adminCreds() + ['decision' => 'reject', 'note' => 'Tidak perlu'])
            ->assertOk()->assertJsonPath('data.status', 'rejected');

        $this->assertSame(1, $this->notificationCount('pr.rejected', $this->cashier->id));
    }

    public function test_self_approval_is_flagged_and_can_be_blocked_by_setting(): void
    {
        $p = $this->product();
        $admin = $this->actAsAdmin();

        $first = $this->postJson('/api/purchase-requisitions', $this->payload($p))->assertCreated()->json('data.id');
        $this->postJson("/api/purchase-requisitions/{$first}/submit")->assertOk();
        $this->postJson("/api/purchase-requisitions/{$first}/finance-check", ['decision' => 'pass'])->assertOk();
        $this->postJson("/api/purchase-requisitions/{$first}/approve", $this->adminCreds())
            ->assertOk()->assertJsonPath('data.approvals.1.is_self_approval', true);
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_requisition.approve', 'entity_id' => $first, 'is_self_approval' => 1, 'actor_id' => $admin->id]);

        $this->setSetting('sod_owner_self_approve', 'block');

        $second = $this->postJson('/api/purchase-requisitions', $this->payload($p))->assertCreated()->json('data.id');
        $this->postJson("/api/purchase-requisitions/{$second}/submit")->assertOk();
        $this->postJson("/api/purchase-requisitions/{$second}/finance-check", ['decision' => 'pass'])->assertOk();
        $this->postJson("/api/purchase-requisitions/{$second}/approve", $this->adminCreds())
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_username']);
        $this->assertSame('finance_checked', DB::table('purchase_requisitions')->where('id', $second)->value('status'));
    }

    public function test_reauth_can_be_switched_off_by_setting(): void
    {
        $id = $this->createSubmitted($this->product());
        $this->setSetting('approval_reauth_required', false);

        $this->actAsAdmin();
        $this->postJson("/api/purchase-requisitions/{$id}/finance-check", ['decision' => 'pass'])->assertOk();
        $this->postJson("/api/purchase-requisitions/{$id}/approve")->assertOk()->assertJsonPath('data.status', 'approved');

        $this->assertNull(DB::table('pr_approvals')->where('pr_id', $id)->where('step', 'owner_auth')->value('reauth_at'));
    }

    public function test_cancel_rules(): void
    {
        $p = $this->product();
        $draft = $this->postJson('/api/purchase-requisitions', $this->payload($p))->assertCreated()->json('data.id');

        $other = $this->makeUser('Kasir', 'kasir-lain');
        Sanctum::actingAs($other, ['*']);
        $this->postJson("/api/purchase-requisitions/{$draft}/cancel")->assertForbidden();

        Sanctum::actingAs($this->cashier, ['*']);
        $this->postJson("/api/purchase-requisitions/{$draft}/cancel", ['reason' => 'salah input'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');

        $approved = $this->pr($this->cashier->id, [$p => ['5', '1000']], 'approved');
        $this->postJson("/api/purchase-requisitions/{$approved}/cancel")
            ->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_visibility_cashier_sees_only_own_admin_sees_all(): void
    {
        $p = $this->product();
        $mine = $this->pr($this->cashier->id, [$p => ['1', null]], 'draft');
        $other = $this->makeUser('Kasir', 'kasir-lain');
        $theirs = $this->pr($other->id, [$p => ['1', null]], 'draft');

        $this->getJson('/api/purchase-requisitions')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $mine);
        $this->getJson("/api/purchase-requisitions/{$theirs}")->assertNotFound();

        $this->actAsAdmin();
        $this->getJson('/api/purchase-requisitions')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/purchase-requisitions?mine=1')->assertOk()->assertJsonPath('total', 0);
        $this->getJson("/api/purchase-requisitions/{$theirs}")->assertOk()->assertJsonPath('data.id', $theirs);
    }
}
