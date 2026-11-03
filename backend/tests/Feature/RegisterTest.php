<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\SeededTestCase;

class RegisterTest extends SeededTestCase
{
    public function test_admin_can_create_rename_deactivate_and_reactivate_registers(): void
    {
        $this->signIn('Admin', 'admin-mesin-test');
        $register = $this->postJson('/api/registers', ['name' => 'Kasir Depan'])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Kasir Depan')
            ->assertJsonPath('data.is_active', true)
            ->json('data');

        $this->assertDatabaseHas('fund_accounts', [
            'id' => $register['fund_account_id'],
            'type' => 'petty_cash',
            'register_id' => $register['id'],
            'name' => 'Kas Kecil - Kasir Depan',
        ]);
        $this->getJson('/api/registers')->assertOk()->assertJsonFragment(['name' => 'Kasir Depan']);
        $this->getJson("/api/registers/{$register['id']}")->assertOk()->assertJsonPath('data.id', $register['id']);
        $this->postJson('/api/registers', ['name' => 'kasir depan'])
            ->assertUnprocessable()->assertJsonValidationErrors(['name']);
        $this->patchJson("/api/registers/{$register['id']}", ['name' => 'Kasir Belakang'])
            ->assertOk()->assertJsonPath('data.name', 'Kasir Belakang');
        $this->assertDatabaseHas('fund_accounts', [
            'id' => $register['fund_account_id'],
            'name' => 'Kas Kecil - Kasir Belakang',
        ]);

        $this->deleteJson("/api/registers/{$register['id']}", ['reason' => 'Mesin diganti'])
            ->assertOk()->assertJsonPath('data.is_active', false);
        $this->assertDatabaseHas('registers', ['id' => $register['id'], 'is_active' => 0]);
        $this->assertDatabaseHas('fund_accounts', ['id' => $register['fund_account_id'], 'is_active' => 1]);
        $this->patchJson("/api/registers/{$register['id']}", ['is_active' => true])
            ->assertOk()->assertJsonPath('data.is_active', true);
    }

    public function test_register_cannot_be_deactivated_while_shift_is_open_and_cashiers_can_alternate(): void
    {
        $admin = $this->signIn('Admin', 'admin-register-shift');
        $primary = (int) DB::table('registers')->where('store_id', $this->storeId())->value('id');
        $secondary = $this->postJson('/api/registers', ['name' => 'Kasir Kedua'])->assertCreated()->json('data.id');

        $firstCashier = $this->makeUser('Kasir', 'kasir-mesin-1');
        Sanctum::actingAs($firstCashier, ['*']);
        $firstShift = $this->postJson('/api/shifts/open', ['register_id' => $primary])
            ->assertCreated()->assertJsonPath('data.register_id', $primary);
        Sanctum::actingAs($admin, ['*']);
        $this->deleteJson("/api/registers/{$primary}", ['reason' => 'Tidak boleh saat berjalan'])
            ->assertUnprocessable()->assertJsonValidationErrors(['is_active']);
        Sanctum::actingAs($firstCashier, ['*']);
        $this->getJson('/api/registers/available')
            ->assertOk()->assertJsonFragment(['id' => $primary, 'is_available' => false]);

        $secondCashier = $this->makeUser('Kasir', 'kasir-mesin-2');
        Sanctum::actingAs($secondCashier, ['*']);
        $secondShift = $this->postJson('/api/shifts/open', ['register_id' => $secondary])
            ->assertCreated()->assertJsonPath('data.register_id', $secondary);

        $this->postJson("/api/shifts/{$secondShift->json('data.id')}/close", ['counted_cash' => '0'])->assertOk();
        Sanctum::actingAs($firstCashier, ['*']);
        $this->postJson("/api/shifts/{$firstShift->json('data.id')}/close", ['counted_cash' => '0'])->assertOk();

        Sanctum::actingAs($secondCashier, ['*']);
        $this->postJson('/api/shifts/open', ['register_id' => $primary])
            ->assertCreated()->assertJsonPath('data.register_id', $primary);
    }

    public function test_open_shift_requires_explicit_register_when_a_store_has_multiple_active_machines(): void
    {
        $this->signIn('Admin', 'admin-register-permission');
        $this->postJson('/api/registers', ['name' => 'Kasir Tambahan'])->assertCreated();

        $this->signIn('Kasir', 'kasir-pilih-mesin');
        $this->postJson('/api/shifts/open')
            ->assertUnprocessable()->assertJsonValidationErrors(['register_id']);
    }

    public function test_register_management_is_permission_protected_and_tenant_scoped(): void
    {
        $this->signIn('Admin');
        $otherStoreId = DB::table('stores')->insertGetId(['code' => 'STORE-OTHER', 'name' => 'Toko Lain']);
        $foreignRegisterId = DB::table('registers')->insertGetId([
            'store_id' => $otherStoreId,
            'name' => 'Kasir Asing',
            'is_active' => true,
        ]);
        $this->getJson('/api/registers')->assertOk()->assertJsonMissing(['name' => 'Kasir Asing']);
        $this->getJson("/api/registers/{$foreignRegisterId}")->assertNotFound();

        $this->signIn('Kasir');
        $this->getJson('/api/registers')->assertForbidden();
        $this->postJson('/api/registers', ['name' => 'Tidak diizinkan'])->assertForbidden();
    }
}
