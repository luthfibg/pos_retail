<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class CustomerTest extends SeededTestCase
{
    private int $customerNumber = 0;

    /** @param array<string, mixed> $overrides
     *  @return array<string, mixed>
     */
    private function customerPayload(array $overrides = []): array
    {
        $number = ++$this->customerNumber;

        return array_replace([
            'customer_no' => "NIK-{$number}",
            'ktp_no' => '320123456789'.str_pad((string) $number, 4, '0', STR_PAD_LEFT),
            'name' => "Karyawan {$number}",
            'phone' => '08123456789',
            'address' => 'Jl. KTP No. 1',
            'domicile' => 'Jl. Domisili No. 2',
            'company_name' => 'PT Contoh',
            'position' => 'Operator',
            'department' => 'Produksi',
            'employment_type' => 'permanent',
            'employment_start_date' => '2024-01-15',
            'hrd_name' => 'HRD Contoh',
            'hrd_phone' => '08123456780',
            'supervisor_name' => 'Atasan Contoh',
            'supervisor_phone' => '08123456781',
        ], $overrides);
    }

    /** @param array<string, mixed> $overrides
     *  @return array{0: \App\Models\User, 1: array<string, mixed>}
     */
    private function createAsAdmin(array $overrides = []): array
    {
        $user = $this->signIn('Admin');
        $customer = $this->postJson('/api/customers', $this->customerPayload($overrides))
            ->assertCreated()->json('data');

        return [$user, $customer];
    }

    public function test_only_admin_can_register_a_customer(): void
    {
        $this->signIn('Kasir');

        $this->postJson('/api/customers', $this->customerPayload())->assertForbidden();
        $this->assertSame(0, DB::table('customers')->count());
    }

    public function test_admin_registers_complete_profile_and_print_data_without_old_status(): void
    {
        [$admin, $customer] = $this->createAsAdmin();

        $this->assertSame('3201234567890001', $customer['ktp_no']);
        $this->assertSame('Jl. KTP No. 1', $customer['address']);
        $this->assertSame('PT Contoh', $customer['company_name']);
        $this->assertSame('permanent', $customer['employment_type']);
        $this->assertArrayNotHasKey('status', $customer);
        $this->assertArrayNotHasKey('verified_at', $customer);
        $this->assertDatabaseHas('customers', [
            'id' => $customer['id'],
            'created_by' => $admin->id,
            'ktp_no' => $customer['ktp_no'],
            'employment_start_date' => '2024-01-15',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'customer.create',
            'entity_id' => $customer['id'],
            'actor_id' => $admin->id,
        ]);
        $this->assertDatabaseMissing('notifications', [
            'type' => 'customer.limit_needed',
            'entity_type' => 'customer',
            'entity_id' => $customer['id'],
        ]);
    }

    public function test_profile_fields_are_required_and_validated(): void
    {
        $this->signIn('Admin');

        $this->postJson('/api/customers', [])->assertUnprocessable()
            ->assertJsonValidationErrors(['customer_no', 'ktp_no', 'name', 'address', 'company_name', 'employment_type']);
        $this->postJson('/api/customers', $this->customerPayload(['ktp_no' => '123']))
            ->assertUnprocessable()->assertJsonValidationErrors(['ktp_no']);
        $this->postJson('/api/customers', $this->customerPayload(['employment_type' => 'temporary']))
            ->assertUnprocessable()->assertJsonValidationErrors(['employment_type']);
        $this->postJson('/api/customers', $this->customerPayload(['hrd_phone' => 'bukan nomor']))
            ->assertUnprocessable()->assertJsonValidationErrors(['hrd_phone']);
    }

    public function test_employee_number_and_ktp_must_be_unique_per_store(): void
    {
        [, $existing] = $this->createAsAdmin();
        $this->postJson('/api/customers', $this->customerPayload([
            'customer_no' => 'NIK-OTHER',
            'ktp_no' => $existing['ktp_no'],
        ]))->assertUnprocessable()->assertJsonValidationErrors(['ktp_no']);

        $this->postJson('/api/customers', $this->customerPayload([
            'customer_no' => $existing['customer_no'],
        ]))->assertUnprocessable()->assertJsonValidationErrors(['customer_no']);
    }

    public function test_customer_profile_is_only_returned_to_admin(): void
    {
        [, $customer] = $this->createAsAdmin();
        $this->signIn('Kasir');

        $show = $this->getJson("/api/customers/{$customer['id']}")->assertOk();
        $this->assertArrayNotHasKey('ktp_no', $show->json('data'));
        $this->assertArrayNotHasKey('phone', $show->json('data'));
        $this->assertArrayNotHasKey('address', $show->json('data'));
        $this->assertArrayNotHasKey('credit_limit', $show->json('data'));

        $listRow = $this->getJson('/api/customers')->assertOk()->json('data.0');
        $this->assertArrayNotHasKey('ktp_no', $listRow);
        $this->assertArrayNotHasKey('address', $listRow);
    }

    public function test_admin_can_update_customer_profile_and_audit_the_changed_fields(): void
    {
        [, $customer] = $this->createAsAdmin();

        $this->patchJson("/api/customers/{$customer['id']}", [
            'name' => 'Nama Baru',
            'phone' => '08111111111',
        ])->assertOk()->assertJsonPath('data.name', 'Nama Baru')
            ->assertJsonPath('data.phone', '08111111111');

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'customer.update',
            'entity_id' => $customer['id'],
        ]);
    }

    public function test_admin_sets_credit_limit_and_keeps_history(): void
    {
        [, $customer] = $this->createAsAdmin();
        $id = $customer['id'];

        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => '1500000', 'note' => 'Disetujui HRD'])
            ->assertOk()->assertJsonPath('data.credit_state', 'available')
            ->assertJsonPath('data.credit_limit', '1500000.00')
            ->assertJsonPath('data.credit_remaining', '1500000.00');
        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => '1500000'])->assertOk();
        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => '1200000', 'note' => 'Perubahan'])
            ->assertOk()->assertJsonPath('data.credit_limit', '1200000.00');

        $history = $this->getJson("/api/customers/{$id}/credit-limits")->assertOk()->json('data');
        $this->assertCount(2, $history);
        $this->assertSame('1200000.00', $history[0]['limit_amount']);
        $this->assertSame('1500000.00', $history[1]['limit_amount']);
    }

    public function test_admin_can_archive_and_restore_without_deleting_customer(): void
    {
        [, $customer] = $this->createAsAdmin();
        $id = $customer['id'];

        $this->deleteJson("/api/customers/{$id}")->assertOk()->assertJsonPath('data.archived', true);
        $this->assertDatabaseHas('customers', ['id' => $id]);
        $this->getJson("/api/customers/{$id}")->assertOk()->assertJsonPath('data.credit_state', 'archived');
        $this->getJson('/api/customers')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/customers?archived=1')->assertOk()->assertJsonPath('total', 1);
        $this->putJson("/api/customers/{$id}/credit-limit", ['limit_amount' => '1000'])
            ->assertUnprocessable()->assertJsonValidationErrors(['limit_amount']);

        $this->postJson("/api/customers/{$id}/restore")->assertOk()->assertJsonPath('data.archived', false);
        $this->getJson('/api/customers')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_cashier_cannot_edit_or_archive_customer(): void
    {
        [, $customer] = $this->createAsAdmin();
        $this->signIn('Kasir');

        $this->patchJson("/api/customers/{$customer['id']}", ['name' => 'Tidak diizinkan'])->assertForbidden();
        $this->deleteJson("/api/customers/{$customer['id']}")->assertForbidden();
        $this->postJson("/api/customers/{$customer['id']}/restore")->assertForbidden();
    }

    public function test_guest_is_unauthenticated(): void
    {
        $this->getJson('/api/customers')->assertUnauthorized();
    }
}
