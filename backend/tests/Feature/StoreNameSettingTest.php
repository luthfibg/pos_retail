<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class StoreNameSettingTest extends SeededTestCase
{
    public function test_store_admin_can_change_only_the_store_name(): void
    {
        $admin = $this->signIn('Admin');
        $storeId = $this->storeId();
        $before = DB::table('stores')->where('id', $storeId)->first();

        $this->patchJson('/api/settings/store-name', ['name' => 'Toko Retail Baru'])
            ->assertOk()
            ->assertExactJson(['data' => ['name' => 'Toko Retail Baru']]);

        $this->assertDatabaseHas('stores', [
            'id' => $storeId,
            'name' => 'Toko Retail Baru',
            'code' => $before->code,
            'timezone' => 'Asia/Jakarta',
            'currency' => 'IDR',
            'is_active' => 1,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'settings.store_name',
            'entity_type' => 'store',
            'entity_id' => $storeId,
            'actor_id' => $admin->id,
            'store_id' => $storeId,
        ]);
    }

    public function test_store_name_update_rejects_other_store_fields(): void
    {
        $this->signIn('Admin');
        $storeId = $this->storeId();
        $before = DB::table('stores')->where('id', $storeId)->first();

        $this->patchJson('/api/settings/store-name', [
            'name' => 'Nama Baru',
            'code' => 'CHANGED',
            'timezone' => 'UTC',
            'currency' => 'USD',
            'is_active' => false,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['code', 'timezone', 'currency', 'is_active']);

        $this->assertDatabaseHas('stores', [
            'id' => $storeId,
            'name' => $before->name,
            'code' => $before->code,
            'timezone' => $before->timezone,
            'currency' => $before->currency,
            'is_active' => $before->is_active,
        ]);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'settings.store_name', 'store_id' => $storeId]);
    }

    public function test_store_name_update_requires_settings_permission_and_has_no_read_endpoint(): void
    {
        $this->patchJson('/api/settings/store-name', ['name' => 'Tidak boleh'])
            ->assertUnauthorized();

        $this->signIn('Kasir');
        $this->patchJson('/api/settings/store-name', ['name' => 'Tidak boleh'])
            ->assertForbidden();

        $this->signIn('Admin');
        $this->getJson('/api/settings/store-name')->assertMethodNotAllowed();
        $this->patchJson('/api/settings/store-name', [])->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }
}
