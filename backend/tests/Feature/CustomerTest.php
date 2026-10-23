<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class CustomerTest extends SeededTestCase
{
    private function createAs(string $role, array $overrides = [], ?string $username = null): array
    {
        static $n = 0;
        $n++;

        $user = $this->signIn($role, $username ?? strtolower($role)."-{$n}");
        $response = $this->postJson('/api/customers', $overrides + [
            'customer_no' => "NIK-{$n}",
            'name' => "Karyawan {$n}",
            'department' => 'Produksi',
        ])->assertCreated();

        return [$user, $response->json('data')];
    }

    public function test_cashier_creates_pending_customer_audit_and_admin_notification(): void
    {
        $admin = $this->makeUser('Admin', 'admin-penerima');
        [$cashier, $customer] = $this->createAs('Kasir', ['customer_no' => 'NIK-100', 'name' => 'Budi'], 'kasir-input');

        $this->assertSame('pending_verification', $customer['status']);
        $this->assertSame('not_verified', $customer['credit_state']);
        $this->assertNull($customer['credit_remaining']);
        $this->assertArrayNotHasKey('credit_limit', $customer);   // Kasir tidak melihat nilai batas
        $this->assertDatabaseHas('customers', ['customer_no' => 'NIK-100', 'created_by' => $cashier->id, 'status' => 'pending_verification']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer.create', 'entity_id' => $customer['id'], 'actor_id' => $cashier->id]);

        $this->assertDatabaseHas('notifications', [
            'user_id' => $admin->id, 'type' => 'customer.limit_needed', 'entity_type' => 'customer', 'entity_id' => $customer['id'], 'read_at' => null,
        ]);
        // Kasir sendiri tidak diberi notifikasi
        $this->assertDatabaseMissing('notifications', ['user_id' => $cashier->id]);
    }

    public function test_duplicate_employee_number_is_rejected(): void
    {
        $this->createAs('Kasir', ['customer_no' => 'NIK-DUP']);

        $this->postJson('/api/customers', ['customer_no' => 'NIK-DUP', 'name' => 'Lain'])
            ->assertUnprocessable()->assertJsonValidationErrors(['customer_no']);
    }

    public function test_validation_on_create(): void
    {
        $this->signIn('Kasir');

        $this->postJson('/api/customers', [])->assertUnprocessable()->assertJsonValidationErrors(['customer_no', 'name']);
        $this->postJson('/api/customers', ['customer_no' => 'bad no!', 'name' => 'X'])
            ->assertUnprocessable()->assertJsonValidationErrors(['customer_no']);
    }

    public function test_cashier_cannot_verify_set_limit_or_update(): void
    {
        [, $customer] = $this->createAs('Kasir');

        $this->postJson("/api/customers/{$customer['id']}/verify")->assertForbidden();
        $this->putJson("/api/customers/{$customer['id']}/credit-limit", ['limit_amount' => 1000000])->assertForbidden();
        $this->patchJson("/api/customers/{$customer['id']}", ['name' => 'Ganti'])->assertForbidden();
        $this->getJson("/api/customers/{$customer['id']}/credit-limits")->assertForbidden();
    }

    public function test_admin_verifies_without_limit_then_sets_limit_and_notification_is_resolved(): void
    {
        $admin = $this->makeUser('Admin', 'admin-a');
        [, $customer] = $this->createAs('Kasir', username: 'kasir-a');
        $id = $customer['id'];

        $this->signInExisting($admin);

        $this->postJson("/api/customers/{$id}/verify")
            ->assertOk()
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.credit_state', 'limit_not_set')   // R-09: kredit ditahan
            ->assertJsonPath('data.credit_limit', null);

        $this->assertDatabaseHas('customers', ['id' => $id, 'verified_by' => $admin->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer.verify', 'entity_id' => $id, 'actor_id' => $admin->id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $admin->id, 'entity_id' => $id, 'read_at' => null]);

        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => '1500000', 'note' => '60% gaji, data HRD'])
            ->assertOk()
            ->assertJsonPath('data.credit_state', 'available')
            ->assertJsonPath('data.credit_limit', '1500000.00')
            ->assertJsonPath('data.credit_used', '0.00')
            ->assertJsonPath('data.credit_remaining', '1500000.00');

        $this->assertDatabaseHas('customer_credit_limits', ['customer_id' => $id, 'limit_amount' => '1500000.00', 'set_by' => $admin->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer.set_limit', 'entity_id' => $id, 'reason' => '60% gaji, data HRD']);
        $this->assertDatabaseMissing('notifications', ['entity_id' => $id, 'read_at' => null]);   // notifikasi selesai
    }

    public function test_verify_with_limit_in_one_step_and_cannot_verify_twice(): void
    {
        [, $customer] = $this->createAs('Kasir');
        $admin = $this->signIn('Admin', 'admin-b');

        $this->postJson("/api/customers/{$customer['id']}/verify", ['credit_limit' => 2000000])
            ->assertOk()->assertJsonPath('data.credit_state', 'available')->assertJsonPath('data.credit_limit', '2000000.00');

        $this->postJson("/api/customers/{$customer['id']}/verify")->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertSame(1, DB::table('customer_credit_limits')->where('customer_id', $customer['id'])->count());
        $this->assertSame($admin->id, (int) DB::table('customers')->where('id', $customer['id'])->value('verified_by'));
    }

    public function test_limit_requires_verified_customer_keeps_history_and_ignores_same_value(): void
    {
        [, $customer] = $this->createAs('Kasir');
        $id = $customer['id'];
        $this->signIn('Admin', 'admin-c');

        // belum diverifikasi
        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => 1000])
            ->assertUnprocessable()->assertJsonValidationErrors(['limit_amount']);

        $this->postJson("/api/customers/{$id}/verify", ['credit_limit' => 1000000])->assertOk();
        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => 1000000])->assertOk();   // sama: tanpa catatan baru
        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => 1200000, 'note' => 'naik gaji'])->assertOk()
            ->assertJsonPath('data.credit_limit', '1200000.00');

        $history = $this->getJson("/api/customers/{$id}/credit-limits")->assertOk()->json('data');
        $this->assertCount(2, $history);
        $this->assertSame('1200000.00', $history[0]['limit_amount']);   // terbaru dulu
        $this->assertSame('1000000.00', $history[1]['limit_amount']);

        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => -5])->assertUnprocessable();
    }

    public function test_cashier_sees_state_and_remaining_but_never_the_limit_value(): void
    {
        $admin = $this->makeUser('Admin', 'admin-d');
        [, $customer] = $this->createAs('Kasir', username: 'kasir-d');
        $this->signInExisting($admin);
        $this->postJson("/api/customers/{$customer['id']}/verify", ['credit_limit' => 900000])->assertOk();

        $this->signIn('Kasir', 'kasir-lain');

        $show = $this->getJson("/api/customers/{$customer['id']}")->assertOk();
        $show->assertJsonPath('data.credit_state', 'available')->assertJsonPath('data.credit_remaining', '900000.00');
        $this->assertArrayNotHasKey('credit_limit', $show->json('data'));
        $this->assertArrayNotHasKey('credit_used', $show->json('data'));

        $list = $this->getJson('/api/customers?q='.urlencode($customer['name']))->assertOk();
        $this->assertArrayNotHasKey('credit_limit', $list->json('data.0'));
    }

    public function test_remaining_limit_subtracts_unbilled_posted_credit_sales(): void
    {
        [, $customer] = $this->createAs('Kasir');
        $id = $customer['id'];
        $admin = $this->signIn('Admin', 'admin-e');
        $this->postJson("/api/customers/{$id}/verify", ['credit_limit' => 1000000])->assertOk();

        $registerId = DB::table('registers')->value('id');
        $shiftId = DB::table('cash_shifts')->insertGetId([
            'store_id' => $this->storeId(), 'doc_number' => 'SHIFT-TEST', 'register_id' => $registerId, 'cashier_id' => $admin->id,
            'opening_balance' => 0, 'status' => 'open', 'opened_at' => now(),
        ]);
        $sale = fn (string $total, string $status, ?int $period = null) => DB::table('sales')->insert([
            'store_id' => $this->storeId(), 'doc_number' => 'S-'.uniqid(), 'shift_id' => $shiftId, 'cashier_id' => $admin->id,
            'customer_id' => $id, 'payment_mode' => 'payroll_credit', 'subtotal' => $total, 'total' => $total,
            'status' => $status, 'billing_status' => 'unbilled', 'billing_period_id' => $period,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]);
        $sale('300000.00', 'posted');
        $sale('150000.00', 'posted');
        $sale('999999.00', 'voided');   // tidak dihitung

        $this->getJson("/api/customers/{$id}")
            ->assertJsonPath('data.credit_used', '450000.00')
            ->assertJsonPath('data.credit_remaining', '550000.00')
            ->assertJsonPath('data.credit_state', 'available');

        $sale('600000.00', 'posted');   // melewati batas
        $this->getJson("/api/customers/{$id}")
            ->assertJsonPath('data.credit_remaining', '0.00')
            ->assertJsonPath('data.credit_state', 'exhausted');
    }

    public function test_admin_updates_and_deactivates_customer_with_audit(): void
    {
        [, $customer] = $this->createAs('Kasir');
        $id = $customer['id'];
        $this->signIn('Admin', 'admin-f');

        // belum diverifikasi: status tidak boleh diubah lewat PATCH
        $this->patchJson("/api/customers/{$id}", ['status' => 'inactive'])->assertUnprocessable()->assertJsonValidationErrors(['status']);

        $this->postJson("/api/customers/{$id}/verify", ['credit_limit' => 500000])->assertOk();
        $this->patchJson("/api/customers/{$id}", ['name' => 'Nama Baru', 'department' => 'Gudang'])
            ->assertOk()->assertJsonPath('data.name', 'Nama Baru');
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer.update', 'entity_id' => $id]);

        $this->patchJson("/api/customers/{$id}", ['status' => 'inactive', 'reason' => 'resign'])
            ->assertOk()->assertJsonPath('data.status', 'inactive')->assertJsonPath('data.credit_state', 'inactive');
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer.status_change', 'entity_id' => $id, 'reason' => 'resign']);

        // tidak dapat memberi batas pada karyawan nonaktif
        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => 100])->assertUnprocessable();
    }

    public function test_list_filters_by_status_and_search(): void
    {
        $this->createAs('Kasir', ['customer_no' => 'AAA-1', 'name' => 'Andi Pratama']);
        $this->createAs('Kasir', ['customer_no' => 'BBB-1', 'name' => 'Budi Santoso']);

        $this->getJson('/api/customers?q=Andi')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.customer_no', 'AAA-1');
        $this->getJson('/api/customers?q=BBB')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/customers?status=pending_verification')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/customers?status=active')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/customers?status=bogus')->assertUnprocessable();
        $this->getJson('/api/customers/999999')->assertNotFound();
    }

    public function test_guest_is_unauthenticated(): void
    {
        $this->getJson('/api/customers')->assertUnauthorized();
    }

    /** Berganti ke pengguna yang sudah dibuat (Sanctum::actingAs). */
    private function signInExisting(\App\Models\User $user): void
    {
        \Laravel\Sanctum\Sanctum::actingAs($user, ['*']);
        app(\App\Services\PermissionResolver::class)->flush();
    }
}
