<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class ShiftTest extends SeededTestCase
{
    public function test_cashier_opens_shift_with_number_zero_opening_and_audit(): void
    {
        $cashier = $this->signIn('Kasir');

        $this->getJson('/api/shifts/current')->assertOk()->assertJsonPath('data', null);

        $response = $this->postJson('/api/shifts/open', ['counted_opening_cash' => '0'])->assertCreated();
        $period = now('Asia/Jakarta')->format('Ym');

        $response->assertJsonPath('data.doc_number', "SHIFT-{$period}-000001")
            ->assertJsonPath('data.status', 'open')
            ->assertJsonPath('data.opening_balance', '0.00')
            ->assertJsonPath('data.cashier_id', $cashier->id)
            ->assertJsonPath('data.expected_cash', null);   // hitung buta

        $this->assertDatabaseHas('audit_logs', ['action' => 'shift.open', 'actor_id' => $cashier->id]);
        $this->getJson('/api/shifts/current')->assertOk()->assertJsonPath('data.status', 'open');
    }

    public function test_cannot_open_twice_or_while_register_is_in_use(): void
    {
        $this->signIn('Kasir', 'kasir-satu');
        $this->postJson('/api/shifts/open')->assertCreated();
        $this->postJson('/api/shifts/open')->assertUnprocessable()->assertJsonValidationErrors(['shift']);

        $this->signIn('Kasir', 'kasir-dua');
        $this->postJson('/api/shifts/open')->assertUnprocessable()->assertJsonValidationErrors(['shift']);
    }

    public function test_close_computes_variance_requires_note_and_carries_float_to_next_shift(): void
    {
        $cashier = $this->signIn('Kasir');
        $shiftId = $this->postJson('/api/shifts/open')->json('data.id');

        DB::table('cash_movements')->insert(['shift_id' => $shiftId, 'type' => 'in', 'amount' => 50000, 'reason' => 'tambahan modal', 'created_by' => $cashier->id]);
        DB::table('cash_movements')->insert(['shift_id' => $shiftId, 'type' => 'out', 'amount' => 5000, 'reason' => 'beli plastik', 'created_by' => $cashier->id]);
        // diharapkan = 0 + 50.000 - 5.000 = 45.000

        $this->postJson("/api/shifts/{$shiftId}/close", ['counted_cash' => '44000'])
            ->assertUnprocessable()->assertJsonValidationErrors(['variance_note']);

        $this->postJson("/api/shifts/{$shiftId}/close", ['counted_cash' => '44000', 'variance_note' => 'uang kembalian kurang'])
            ->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.expected_cash', '45000.00')
            ->assertJsonPath('data.counted_cash', '44000.00')
            ->assertJsonPath('data.variance', '-1000.00')
            ->assertJsonPath('data.float_kept', '44000.00');

        $this->assertDatabaseHas('audit_logs', ['action' => 'shift.close', 'entity_id' => $shiftId, 'reason' => 'uang kembalian kurang']);
        $this->postJson("/api/shifts/{$shiftId}/close", ['counted_cash' => '44000'])->assertUnprocessable();

        // shift berikutnya: saldo awal = endapan shift sebelumnya
        $this->postJson('/api/shifts/open', ['counted_opening_cash' => '43000'])->assertCreated()
            ->assertJsonPath('data.opening_balance', '44000.00');
        $this->assertDatabaseHas('audit_logs', ['action' => 'shift.open']);
        $opened = DB::table('audit_logs')->where('action', 'shift.open')->orderByDesc('id')->first();
        $this->assertStringContainsString('-1000.00', (string) $opened->after_json);
    }

    public function test_exact_count_needs_no_note(): void
    {
        $this->signIn('Kasir');
        $shiftId = $this->postJson('/api/shifts/open')->json('data.id');

        $this->postJson("/api/shifts/{$shiftId}/close", ['counted_cash' => '0'])
            ->assertOk()->assertJsonPath('data.variance', '0.00');
    }

    public function test_start_count_moves_to_counting_and_close_still_works(): void
    {
        $this->signIn('Kasir');
        $shiftId = $this->postJson('/api/shifts/open')->json('data.id');

        $this->postJson("/api/shifts/{$shiftId}/start-count")->assertOk()->assertJsonPath('data.status', 'counting');
        $this->postJson("/api/shifts/{$shiftId}/start-count")->assertUnprocessable();
        $this->postJson("/api/shifts/{$shiftId}/close", ['counted_cash' => '0'])->assertOk();
    }

    public function test_cashier_cannot_manage_someone_elses_shift_but_admin_can(): void
    {
        $owner = $this->makeUser('Kasir', 'kasir-pemilik');
        Sanctum::actingAs($owner, ['*']);
        $shiftId = $this->postJson('/api/shifts/open')->json('data.id');

        $other = $this->makeUser('Kasir', 'kasir-lain');
        Sanctum::actingAs($other, ['*']);
        $this->postJson("/api/shifts/{$shiftId}/close", ['counted_cash' => '0'])->assertForbidden();
        $this->postJson("/api/shifts/{$shiftId}/start-count")->assertForbidden();
        $this->getJson("/api/shifts/{$shiftId}")->assertNotFound();

        $this->signIn('Admin');
        $this->getJson("/api/shifts/{$shiftId}")->assertOk()->assertJsonPath('data.expected_cash', '0.00');   // Admin melihat kas diharapkan
        $this->postJson("/api/shifts/{$shiftId}/close", ['counted_cash' => '0'])->assertOk();
    }

    public function test_review_only_admin_and_only_closed_shift(): void
    {
        $this->signIn('Kasir');
        $shiftId = $this->postJson('/api/shifts/open')->json('data.id');
        $this->postJson("/api/shifts/{$shiftId}/review")->assertForbidden();
        $this->getJson('/api/shifts')->assertForbidden();

        $this->postJson("/api/shifts/{$shiftId}/close", ['counted_cash' => '0'])->assertOk();

        $admin = $this->signIn('Admin');
        $this->postJson("/api/shifts/{$shiftId}/review", ['note' => 'sesuai'])
            ->assertOk()->assertJsonPath('data.status', 'reviewed');
        $this->assertDatabaseHas('cash_shifts', ['id' => $shiftId, 'status' => 'reviewed', 'reviewed_by' => $admin->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'shift.review', 'entity_id' => $shiftId]);
        $this->postJson("/api/shifts/{$shiftId}/review")->assertUnprocessable();
        $this->getJson('/api/shifts?status=reviewed')->assertOk()->assertJsonPath('total', 1);
    }
}
