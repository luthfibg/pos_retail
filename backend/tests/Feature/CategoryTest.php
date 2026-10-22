<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class CategoryTest extends SeededTestCase
{
    private function makeCategory(string $name, ?int $parentId = null): int
    {
        return $this->postJson('/api/categories', ['name' => $name, 'parent_id' => $parentId])
            ->assertCreated()
            ->json('data.id');
    }

    public function test_admin_creates_lists_renames_and_deactivates(): void
    {
        $admin = $this->signIn('Admin');

        $id = $this->makeCategory('Minuman');

        $this->assertDatabaseHas('audit_logs', ['action' => 'category.create', 'entity_id' => $id, 'actor_id' => $admin->id]);

        $this->patchJson("/api/categories/{$id}", ['name' => 'Minuman Dingin'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Minuman Dingin');
        $this->assertDatabaseHas('audit_logs', ['action' => 'category.update', 'entity_id' => $id]);

        $this->patchJson("/api/categories/{$id}", ['is_active' => false])
            ->assertOk()
            ->assertJsonPath('data.is_active', false);

        $this->getJson('/api/categories')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/categories?active_only=1')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_cashier_can_list_but_not_manage(): void
    {
        $this->signIn('Admin', 'admin-uji');
        $id = $this->makeCategory('Snack');

        $this->signIn('Kasir', 'kasir-uji');

        $this->getJson('/api/categories')->assertOk()->assertJsonCount(1, 'data');
        $this->postJson('/api/categories', ['name' => 'Baru'])->assertForbidden();
        $this->patchJson("/api/categories/{$id}", ['name' => 'Ubah'])->assertForbidden();
    }

    public function test_requires_authentication(): void
    {
        $this->getJson('/api/categories')->assertUnauthorized();
    }

    public function test_duplicate_name_under_same_parent_is_rejected_but_allowed_under_other_parent(): void
    {
        $this->signIn('Admin');

        $a = $this->makeCategory('Makanan');
        $b = $this->makeCategory('Minuman');
        $this->makeCategory('Dingin', $a);

        $this->postJson('/api/categories', ['name' => 'dingin', 'parent_id' => $a])
            ->assertStatus(422)->assertJsonValidationErrors('name');

        $this->postJson('/api/categories', ['name' => 'Dingin', 'parent_id' => $b])->assertCreated();
        $this->postJson('/api/categories', ['name' => 'Makanan'])->assertStatus(422);
    }

    public function test_cycle_in_hierarchy_is_rejected(): void
    {
        $this->signIn('Admin');

        $a = $this->makeCategory('A');
        $b = $this->makeCategory('B', $a);

        $this->patchJson("/api/categories/{$a}", ['parent_id' => $b])
            ->assertStatus(422)->assertJsonValidationErrors('parent_id');
        $this->patchJson("/api/categories/{$a}", ['parent_id' => $a])
            ->assertStatus(422)->assertJsonValidationErrors('parent_id');
    }

    public function test_cannot_deactivate_category_with_active_children(): void
    {
        $this->signIn('Admin');

        $a = $this->makeCategory('A');
        $this->makeCategory('B', $a);

        $this->patchJson("/api/categories/{$a}", ['is_active' => false])
            ->assertStatus(422)->assertJsonValidationErrors('is_active');
    }

    public function test_parent_from_another_store_is_rejected(): void
    {
        $this->signIn('Admin');

        $otherStore = DB::table('stores')->insertGetId(['code' => 'LAIN', 'name' => 'Toko Lain']);
        $foreign = DB::table('categories')->insertGetId(['store_id' => $otherStore, 'name' => 'Asing']);

        $this->postJson('/api/categories', ['name' => 'X', 'parent_id' => $foreign])
            ->assertStatus(422)->assertJsonValidationErrors('parent_id');
    }

    public function test_unknown_category_returns_404(): void
    {
        $this->signIn('Admin');

        $this->patchJson('/api/categories/99999', ['name' => 'X'])->assertNotFound();
    }
}
