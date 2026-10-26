<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class CashMovementTest extends SeededTestCase
{
    public function test_cashier_can_record_in_and_out_movements_that_update_shift_and_fund_balances(): void
    {
        $cashier = $this->signIn('Kasir');
        $shiftId = $this->postJson('/api/shifts/open')->assertCreated()->json('data.id');

        $this->postJson("/api/shifts/{$shiftId}/cash-movements", [
            'type' => 'in',
            'amount' => '50000',
            'reason' => 'Tambahan modal',
        ])->assertCreated()
            ->assertJsonPath('data.type', 'in')
            ->assertJsonPath('data.amount', '50000.00')
            ->assertJsonPath('data.created_by', $cashier->id);

        $this->postJson("/api/shifts/{$shiftId}/cash-movements", [
            'type' => 'out',
            'amount' => '5000',
            'reason' => 'Beli plastik',
        ])->assertCreated()->assertJsonPath('data.amount', '5000.00');

        $this->getJson("/api/shifts/{$shiftId}/cash-movements")
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonPath('data.0.type', 'out');

        $this->signIn('Admin');
        $this->getJson("/api/shifts/{$shiftId}")
            ->assertOk()
            ->assertJsonPath('data.summary.cash_in', '50000.00')
            ->assertJsonPath('data.summary.cash_out', '5000.00')
            ->assertJsonPath('data.expected_cash', '45000.00');

        $fundId = DB::table('fund_accounts')->where('type', 'petty_cash')->value('id');
        $entries = DB::table('fund_ledger_entries')->where('fund_account_id', $fundId)->orderBy('id')->get();
        $this->assertSame('50000.00', $entries[0]->amount);
        $this->assertSame('cash_movement_in', $entries[0]->entry_type);
        $this->assertSame('-5000.00', $entries[1]->amount);
        $this->assertSame('cash_movement_out', $entries[1]->entry_type);
        $this->assertSame('cash_movement', $entries[0]->ref_type);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'cash_movement.create',
            'actor_id' => $cashier->id,
        ]);
    }

    public function test_cashier_cannot_record_or_view_movements_for_another_cashiers_shift(): void
    {
        $owner = $this->makeUser('Kasir', 'kasir-pemilik');
        Sanctum::actingAs($owner, ['*']);
        $shiftId = $this->postJson('/api/shifts/open')->json('data.id');

        $this->signIn('Kasir', 'kasir-dua');
        $this->postJson("/api/shifts/{$shiftId}/cash-movements", [
            'type' => 'in',
            'amount' => '100',
            'reason' => 'Modal',
        ])->assertForbidden();
        $this->getJson("/api/shifts/{$shiftId}/cash-movements")->assertNotFound();

        $this->signIn('Admin');
        $this->postJson("/api/shifts/{$shiftId}/cash-movements", [
            'type' => 'in',
            'amount' => '100',
            'reason' => 'Modal tambahan',
        ])->assertCreated();
    }

    public function test_cash_movements_are_rejected_after_shift_counting_starts(): void
    {
        $this->signIn('Kasir');
        $shiftId = $this->postJson('/api/shifts/open')->json('data.id');
        $this->postJson("/api/shifts/{$shiftId}/start-count")->assertOk();

        $this->postJson("/api/shifts/{$shiftId}/cash-movements", [
            'type' => 'in',
            'amount' => '100',
            'reason' => 'Terlambat dicatat',
        ])->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_cash_movement_requires_a_valid_type_positive_money_and_reason(): void
    {
        $this->signIn('Kasir');
        $shiftId = $this->postJson('/api/shifts/open')->json('data.id');

        $this->postJson("/api/shifts/{$shiftId}/cash-movements", [
            'type' => 'refund',
            'amount' => '0',
            'reason' => '   ',
        ])->assertUnprocessable()->assertJsonValidationErrors(['type', 'amount', 'reason']);

        $this->postJson("/api/shifts/{$shiftId}/cash-movements", [
            'type' => 'in',
            'amount' => '1.001',
            'reason' => 'Modal',
        ])->assertUnprocessable()->assertJsonValidationErrors(['amount']);
    }
}
