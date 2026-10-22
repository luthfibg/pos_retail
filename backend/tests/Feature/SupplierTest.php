<?php

namespace Tests\Feature;

use Tests\SeededTestCase;

class SupplierTest extends SeededTestCase
{
    public function test_admin_creates_updates_and_lists_suppliers(): void
    {
        $admin = $this->signIn('Admin');

        $response = $this->postJson('/api/suppliers', [
            'code' => 'SUP-001',
            'name' => 'CV Maju Jaya',
            'phone' => '0812345678',
        ])->assertCreated()
            ->assertJsonPath('data.default_payment_terms', 'prepaid')
            ->assertJsonPath('data.is_active', true);

        $id = $response->json('data.id');
        $this->assertDatabaseHas('audit_logs', ['action' => 'supplier.create', 'entity_id' => $id, 'actor_id' => $admin->id]);

        $this->patchJson("/api/suppliers/{$id}", ['default_payment_terms' => 'credit', 'is_active' => false])
            ->assertOk()
            ->assertJsonPath('data.default_payment_terms', 'credit')
            ->assertJsonPath('data.is_active', false);
        $this->assertDatabaseHas('audit_logs', ['action' => 'supplier.update', 'entity_id' => $id]);

        $this->postJson('/api/suppliers', ['code' => 'SUP-002', 'name' => 'Toko Sumber Rejeki'])->assertCreated();

        $this->getJson('/api/suppliers')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/suppliers?q=rejeki')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/suppliers?active_only=1')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_duplicate_code_is_rejected_case_insensitively(): void
    {
        $this->signIn('Admin');

        $this->postJson('/api/suppliers', ['code' => 'SUP-001', 'name' => 'A'])->assertCreated();

        $this->postJson('/api/suppliers', ['code' => 'sup-001', 'name' => 'B'])
            ->assertStatus(422)->assertJsonValidationErrors('code');
    }

    public function test_code_cannot_be_changed_and_terms_are_validated(): void
    {
        $this->signIn('Admin');

        $id = $this->postJson('/api/suppliers', ['code' => 'SUP-001', 'name' => 'A'])->json('data.id');

        $this->patchJson("/api/suppliers/{$id}", ['code' => 'BARU'])
            ->assertStatus(422)->assertJsonValidationErrors('code');
        $this->patchJson("/api/suppliers/{$id}", ['default_payment_terms' => 'barter'])
            ->assertStatus(422)->assertJsonValidationErrors('default_payment_terms');
    }

    public function test_cashier_has_no_access(): void
    {
        $this->signIn('Kasir');

        $this->getJson('/api/suppliers')->assertForbidden();
        $this->postJson('/api/suppliers', ['code' => 'X', 'name' => 'Y'])->assertForbidden();
    }
}
