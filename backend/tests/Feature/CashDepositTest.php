<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\InventoryService;
use App\Services\PermissionResolver;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class CashDepositTest extends SeededTestCase
{
    private User $admin;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->makeUser('Admin', 'admin-setoran');
        $this->cashier = $this->makeUser('Kasir', 'kasir-setoran');
    }

    private function as(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
    }

    private function setPermission(User $user, string $code, string $effect): void
    {
        DB::table('user_permissions')->insert([
            'user_id' => $user->id,
            'permission_id' => DB::table('permissions')->where('code', $code)->value('id'),
            'store_id' => $this->storeId(),
            'effect' => $effect,
        ]);
        app(PermissionResolver::class)->flush();
    }

    private function policy(array $override = []): void
    {
        $this->as($this->admin);
        $this->putJson('/api/float-policies/petty_cash', $override + ['mode' => 'fixed', 'fixed_amount' => '500000', 'rounding_unit' => 1000])->assertOk();
    }

    /** Buka shift dengan saldo awal yang disiapkan seperti endapan shift sebelumnya. */
    private function openShiftWithOpeningCash(string $openingCash, ?User $user = null): int
    {
        $this->as($user ?? $this->cashier);
        $id = (int) $this->postJson('/api/shifts/open')->assertCreated()->json('data.id');
        DB::table('cash_shifts')->where('id', $id)->update(['opening_balance' => $openingCash]);

        return $id;
    }

    /** @return array{0:int,1:int} [shift_id, deposit_id] — kebijakan tetap 500.000, kas 1.234.567 */
    private function closedShiftWithDeposit(): array
    {
        $this->policy();
        $shift = $this->openShiftWithOpeningCash('1234567');
        $this->as($this->cashier);
        $close = $this->postJson("/api/shifts/{$shift}/close", ['counted_cash' => '1234567'])->assertOk();

        return [$shift, (int) $close->json('data.deposit.id')];
    }

    private function sellCash(string $price): void
    {
        static $n = 0;
        $n++;
        $product = DB::table('products')->insertGetId([
            'store_id' => $this->storeId(), 'sku' => "DP-{$n}", 'barcode' => sprintf('89940000%05d', $n),
            'name' => "Produk DP {$n}", 'sell_price' => $price, 'status' => 'active',
        ]);
        DB::transaction(fn () => app(InventoryService::class)->receive($this->storeId(), $product, '5', '1000', null, null, null, 'goods_receipt', 1, null));

        $this->as($this->cashier);
        $this->postJson('/api/sales', [
            'idempotency_key' => (string) Str::uuid(), 'payment_mode' => 'cash', 'amount_tendered' => $price,
            'items' => [['product_id' => $product, 'qty' => 1]],
        ])->assertCreated();
    }

    // ------------------------------------------------------------------ rencana endapan

    public function test_without_policy_whole_cash_stays_as_float_like_before(): void
    {
        $shift = $this->openShiftWithOpeningCash('300000');

        $r = $this->postJson("/api/shifts/{$shift}/close", ['counted_cash' => '300000'])->assertOk();

        $r->assertJsonPath('data.float_kept', '300000.00')->assertJsonPath('data.deposit', null)->assertJsonPath('data.float_flags', ['no_policy']);
        $this->assertSame(0, DB::table('cash_deposits')->count());
    }

    public function test_fixed_policy_rounds_deposit_down_and_leaves_remainder_in_float(): void
    {
        [$shift, $depositId] = $this->closedShiftWithDeposit();

        $this->assertDatabaseHas('cash_shifts', ['id' => $shift, 'status' => 'closed', 'float_kept' => '500567.00']);
        $this->assertDatabaseHas('cash_deposits', [
            'id' => $depositId, 'shift_id' => $shift, 'status' => 'draft',
            'counted_amount' => '1234567.00', 'float_kept' => '500567.00', 'deposit_amount' => '734000.00',
        ]);
        $period = now('Asia/Jakarta')->format('Ym');
        $this->getJson("/api/cash-deposits/{$depositId}")->assertOk()->assertJsonPath('data.doc_number', "DEP-{$period}-000001")
            ->assertJsonPath('data.shift_doc_number', DB::table('cash_shifts')->where('id', $shift)->value('doc_number'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'cash_deposit.create', 'entity_id' => $depositId]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'float.policy_set']);
    }

    public function test_percent_of_cash_sales_with_min_and_max_clamps(): void
    {
        $this->policy(['mode' => 'percent', 'percent' => '10', 'percent_base' => 'cash_sales_shift', 'fixed_amount' => null]);
        $shift = $this->openShiftWithOpeningCash('400000');
        $this->sellCash('100000');
        $this->as($this->cashier);
        // kas = 400.000 + 100.000 = 500.000; endapan = 10% x 100.000 = 10.000
        $this->postJson("/api/shifts/{$shift}/close", ['counted_cash' => '500000'])->assertOk()
            ->assertJsonPath('data.float_kept', '10000.00')->assertJsonPath('data.deposit.deposit_amount', '490000.00');
    }

    public function test_percent_of_cash_on_hand_and_min_clamp(): void
    {
        $this->policy(['mode' => 'percent', 'percent' => '10', 'percent_base' => 'cash_on_hand', 'min_amount' => '250000', 'fixed_amount' => null]);
        $shift = $this->openShiftWithOpeningCash('2000000');
        $this->as($this->cashier);
        // 10% x 2.000.000 = 200.000 -> dijepit ke minimum 250.000; setoran 1.750.000
        $this->postJson("/api/shifts/{$shift}/close", ['counted_cash' => '2000000'])->assertOk()
            ->assertJsonPath('data.float_kept', '250000.00')->assertJsonPath('data.deposit.deposit_amount', '1750000.00');
    }

    public function test_max_clamp_and_edge_cases(): void
    {
        $this->policy(['fixed_amount' => '500000', 'max_amount' => '20000']);
        $shift = $this->openShiftWithOpeningCash('300000');
        $this->as($this->cashier);
        $this->postJson("/api/shifts/{$shift}/close", ['counted_cash' => '300000'])->assertOk()
            ->assertJsonPath('data.float_kept', '20000.00')->assertJsonPath('data.deposit.deposit_amount', '280000.00');

        // kas tidak melebihi endapan -> tidak ada setoran
        $this->policy(['fixed_amount' => '500000', 'max_amount' => null]);
        $this->as($this->cashier);
        $this->postJson('/api/cash-deposits/'.DB::table('cash_deposits')->value('id').'/submit')->assertOk();
        $second = (int) $this->postJson('/api/shifts/open')->assertCreated()->json('data.id');
        $this->postJson("/api/shifts/{$second}/close", ['counted_cash' => '20000'])->assertOk()
            ->assertJsonPath('data.float_kept', '20000.00')->assertJsonPath('data.deposit', null)->assertJsonPath('data.float_flags', ['nothing_to_deposit']);
    }

    public function test_cash_below_minimum_is_flagged_and_nothing_is_deposited(): void
    {
        $this->policy(['fixed_amount' => '100000', 'min_amount' => '100000']);
        $shift = $this->openShiftWithOpeningCash('50000');
        $this->as($this->cashier);

        $this->postJson("/api/shifts/{$shift}/close", ['counted_cash' => '50000'])->assertOk()
            ->assertJsonPath('data.float_kept', '50000.00')->assertJsonPath('data.deposit', null)->assertJsonPath('data.float_flags', ['below_minimum']);
    }

    // ------------------------------------------------------------------ rantai kas antarshift

    public function test_next_shift_is_blocked_until_final_deposit_is_submitted_and_inherits_the_float(): void
    {
        [, $depositId] = $this->closedShiftWithDeposit();
        $this->as($this->cashier);

        $this->postJson('/api/shifts/open')->assertUnprocessable()->assertJsonValidationErrors(['shift']);

        $this->postJson("/api/cash-deposits/{$depositId}/submit")->assertOk()->assertJsonPath('data.status', 'submitted');
        $this->postJson('/api/shifts/open')->assertCreated()->assertJsonPath('data.opening_balance', '500567.00');
        $this->postJson("/api/cash-deposits/{$depositId}/submit")->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'cash_deposit.submit', 'entity_id' => $depositId]);
    }

    public function test_final_deposit_cannot_be_cancelled_and_others_cannot_touch_it(): void
    {
        [, $depositId] = $this->closedShiftWithDeposit();

        $this->as($this->cashier);
        $this->postJson("/api/cash-deposits/{$depositId}/cancel")->assertNotFound();

        $this->as($this->makeUser('Kasir', 'kasir-orang-lain'));
        $this->getJson("/api/cash-deposits/{$depositId}")->assertNotFound();
        $this->getJson('/api/cash-deposits')->assertOk()->assertJsonPath('total', 0);
        $this->postJson("/api/cash-deposits/{$depositId}/submit")->assertForbidden();

        $this->as($this->admin);
        $this->getJson('/api/cash-deposits')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/cash-deposits?status=draft')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/cash-deposits?status=bogus')->assertUnprocessable();
    }

    public function test_finance_can_read_deposit_queue_with_receive_permission_only(): void
    {
        [, $depositId] = $this->closedShiftWithDeposit();
        $this->as($this->cashier);
        $this->postJson("/api/cash-deposits/{$depositId}/submit")->assertOk();

        $finance = $this->makeUser('Kasir', 'finance-setoran');
        $this->setPermission($finance, 'cash_deposit.create', 'deny');
        $this->setPermission($finance, 'cash_deposit.receive', 'allow');
        $this->as($finance);

        $this->getJson('/api/cash-deposits')->assertOk()->assertJsonPath('total', 1);
        $this->getJson("/api/cash-deposits/{$depositId}")->assertOk()
            ->assertJsonPath('data.id', $depositId);
        $this->getJson('/api/fund-accounts')->assertOk();

        $shiftId = (int) DB::table('cash_deposits')->where('id', $depositId)->value('shift_id');
        $this->postJson("/api/shifts/{$shiftId}/deposits", ['counted_amount' => '800000'])->assertNotFound();
        $this->postJson("/api/cash-deposits/{$depositId}/submit")->assertForbidden();
        $this->postJson("/api/cash-deposits/{$depositId}/receive", ['received_amount' => '734000'])
            ->assertOk()->assertJsonPath('data.status', 'received');
        $this->postJson("/api/cash-deposits/{$depositId}/correct", ['reason' => 'koreksi'])
            ->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_user_without_either_deposit_permission_cannot_read_queue_or_detail(): void
    {
        [, $depositId] = $this->closedShiftWithDeposit();
        $user = $this->makeUser('Kasir', 'tanpa-izin-setoran');
        $this->setPermission($user, 'cash_deposit.create', 'deny');
        $this->setPermission($user, 'cash_deposit.receive', 'deny');
        $this->as($user);

        $this->getJson('/api/cash-deposits')->assertForbidden();
        $this->getJson("/api/cash-deposits/{$depositId}")->assertForbidden();
    }

    // ------------------------------------------------------------------ penerimaan Finance

    public function test_finance_receives_and_ledgers_move_between_funds(): void
    {
        [, $depositId] = $this->closedShiftWithDeposit();
        $this->as($this->cashier);
        $this->postJson("/api/cash-deposits/{$depositId}/submit")->assertOk();
        $this->postJson("/api/cash-deposits/{$depositId}/receive", ['received_amount' => '734000'])->assertForbidden();
        $this->getJson('/api/fund-accounts')->assertForbidden();

        $this->as($this->admin);
        $this->postJson("/api/cash-deposits/{$depositId}/receive", ['received_amount' => '734000'])
            ->assertOk()->assertJsonPath('data.status', 'received')->assertJsonPath('data.difference', '0.00')->assertJsonPath('data.received_by_name', 'Admin-setoran');

        $balances = collect($this->getJson('/api/fund-accounts')->assertOk()->json('data'))->pluck('balance', 'type');
        $this->assertSame('-734000.00', $balances['petty_cash']);
        $this->assertSame('734000.00', $balances['main_cash']);
        $this->assertDatabaseHas('fund_ledger_entries', ['ref_type' => 'cash_deposit', 'ref_id' => $depositId, 'entry_type' => 'deposit_out', 'amount' => '-734000.00']);
        $this->assertDatabaseHas('fund_ledger_entries', ['ref_type' => 'cash_deposit', 'ref_id' => $depositId, 'entry_type' => 'deposit_in', 'amount' => '734000.00']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'cash_deposit.receive', 'entity_id' => $depositId]);
        $this->postJson("/api/cash-deposits/{$depositId}/receive", ['received_amount' => '734000'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_finance_status_filter_has_waiting_and_received_buckets(): void
    {
        foreach (['734000', '733000', '733000'] as $index => $receivedAmount) {
            [, $depositId] = $this->closedShiftWithDeposit();
            $this->as($this->cashier);
            $this->postJson("/api/cash-deposits/{$depositId}/submit")->assertOk();

            $this->as($this->admin);
            $payload = ['received_amount' => $receivedAmount];
            if ($index > 0) {
                $payload['note'] = 'Selisih dicatat saat penerimaan.';
            }
            $this->postJson("/api/cash-deposits/{$depositId}/receive", $payload)
                ->assertOk()->assertJsonPath('data.status', $index === 0 ? 'received' : 'discrepancy');

            if ($index === 2) {
                $this->postJson("/api/cash-deposits/{$depositId}/correct", ['reason' => 'Selisih sudah ditinjau.'])
                    ->assertOk()->assertJsonPath('data.status', 'corrected');
            }
        }

        [, $pendingDepositId] = $this->closedShiftWithDeposit();
        $this->as($this->cashier);
        $this->postJson("/api/cash-deposits/{$pendingDepositId}/submit")->assertOk();

        $this->as($this->admin);
        $received = $this->getJson('/api/cash-deposits?status=received')->assertOk()->json('data');
        $this->assertSame(3, count($received));
        $this->assertEqualsCanonicalizing(['received', 'discrepancy', 'corrected'], array_column($received, 'status'));
        $this->getJson('/api/cash-deposits?status=submitted')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_draft_cannot_be_received(): void
    {
        [, $depositId] = $this->closedShiftWithDeposit();
        $this->as($this->admin);

        $this->postJson("/api/cash-deposits/{$depositId}/receive", ['received_amount' => '734000'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->assertSame(0, DB::table('fund_ledger_entries')->where('ref_type', 'cash_deposit')->count());
    }

    public function test_recount_difference_needs_note_then_can_be_corrected_without_changing_ledger(): void
    {
        [, $depositId] = $this->closedShiftWithDeposit();
        $this->as($this->cashier);
        $this->postJson("/api/cash-deposits/{$depositId}/submit")->assertOk();

        $this->as($this->admin);
        $this->postJson("/api/cash-deposits/{$depositId}/receive", ['received_amount' => '733000'])->assertUnprocessable()->assertJsonValidationErrors(['note']);
        $this->postJson("/api/cash-deposits/{$depositId}/receive", ['received_amount' => '733000', 'note' => 'uang kurang seribu'])
            ->assertOk()->assertJsonPath('data.status', 'discrepancy')->assertJsonPath('data.difference', '-1000.00');
        $this->assertDatabaseHas('fund_ledger_entries', ['ref_id' => $depositId, 'entry_type' => 'deposit_in', 'amount' => '733000.00']);

        $this->postJson("/api/cash-deposits/{$depositId}/correct")->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $before = DB::table('fund_ledger_entries')->count();
        $this->postJson("/api/cash-deposits/{$depositId}/correct", ['reason' => 'selisih ditanggung kasir'])->assertOk()->assertJsonPath('data.status', 'corrected');
        $this->assertSame($before, DB::table('fund_ledger_entries')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'cash_deposit.correct', 'entity_id' => $depositId, 'reason' => 'selisih ditanggung kasir']);
        $this->postJson("/api/cash-deposits/{$depositId}/correct", ['reason' => 'lagi'])->assertUnprocessable();
    }

    public function test_non_sales_cash_and_partial_deposit_endpoints_are_removed(): void
    {
        $shift = $this->openShiftWithOpeningCash('800000');
        $this->as($this->cashier);

        $this->postJson("/api/shifts/{$shift}/deposits", ['counted_amount' => '800000'])->assertNotFound();
        $this->getJson("/api/shifts/{$shift}/cash-movements")->assertNotFound();
        $this->postJson("/api/shifts/{$shift}/cash-movements", ['type' => 'in', 'amount' => '100', 'reason' => 'test'])->assertNotFound();
        $this->getJson("/api/shifts/{$shift}")->assertOk()
            ->assertJsonMissingPath('data.summary.cash_in')
            ->assertJsonMissingPath('data.summary.cash_out')
            ->assertJsonMissingPath('data.summary.partial_deposits');
    }

    // ------------------------------------------------------------------ kebijakan

    public function test_policy_is_versioned_validated_and_restricted(): void
    {
        $this->as($this->cashier);
        $this->getJson('/api/float-policies')->assertOk()->assertJsonPath('data.petty_cash', null);
        $this->putJson('/api/float-policies/petty_cash', ['mode' => 'fixed', 'fixed_amount' => '1000'])->assertForbidden();

        $this->as($this->admin);
        $this->putJson('/api/float-policies/petty_cash', [])->assertUnprocessable()->assertJsonValidationErrors(['mode']);
        $this->putJson('/api/float-policies/petty_cash', ['mode' => 'fixed'])->assertUnprocessable()->assertJsonValidationErrors(['fixed_amount']);
        $this->putJson('/api/float-policies/petty_cash', ['mode' => 'percent', 'percent' => '10'])->assertUnprocessable()->assertJsonValidationErrors(['percent_base']);
        $this->putJson('/api/float-policies/petty_cash', ['mode' => 'fixed', 'fixed_amount' => '1000', 'min_amount' => '9000', 'max_amount' => '5000'])
            ->assertUnprocessable()->assertJsonValidationErrors(['min_amount']);
        $this->putJson('/api/float-policies/bank', ['mode' => 'fixed', 'fixed_amount' => '1000'])->assertNotFound();

        $this->putJson('/api/float-policies/petty_cash', ['mode' => 'fixed', 'fixed_amount' => '500000', 'rounding_unit' => 1000, 'reason' => 'awal'])
            ->assertOk()->assertJsonPath('data.fixed_amount', '500000.00')->assertJsonPath('data.rounding_unit', 1000);
        $this->putJson('/api/float-policies/petty_cash', ['mode' => 'percent', 'percent' => '15', 'percent_base' => 'cash_on_hand', 'min_amount' => '200000', 'reason' => 'ubah ke persen'])
            ->assertOk()->assertJsonPath('data.mode', 'percent')->assertJsonPath('data.percent', '15.00')->assertJsonPath('data.fixed_amount', null);

        $this->assertSame(2, DB::table('float_policies')->where('scope', 'petty_cash')->count());
        $this->assertSame(1, DB::table('float_policies')->where('scope', 'petty_cash')->where('is_active', 1)->count());
        $this->getJson('/api/float-policies')->assertJsonPath('data.petty_cash.mode', 'percent');
        $this->assertSame(2, DB::table('audit_logs')->where('action', 'float.policy_set')->count());
    }
}
