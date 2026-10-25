<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class PricingSettingsTest extends SeededTestCase
{
    private function product(): int
    {
        static $n = 0;
        $n++;

        return DB::table('products')->insertGetId([
            'store_id' => $this->storeId(), 'sku' => "DSC-{$n}", 'barcode' => sprintf('89950000%05d', $n),
            'name' => "Produk Diskon {$n}", 'sell_price' => 10000, 'status' => 'active',
        ]);
    }

    private function category(string $name = 'Minuman'): int
    {
        return DB::table('categories')->insertGetId(['store_id' => $this->storeId(), 'name' => $name]);
    }

    public function test_admin_creates_lists_updates_and_deactivates_discount(): void
    {
        $admin = $this->signIn('Admin');
        $p = $this->product();
        $c = $this->category();

        $id = $this->postJson('/api/discounts', ['name' => 'Promo Akhir Bulan', 'target_type' => 'product', 'target_id' => $p, 'discount_type' => 'percent', 'value' => '10'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'active')->assertJsonPath('data.value', '10.00')->assertJsonPath('data.target_name', DB::table('products')->where('id', $p)->value('name'))
            ->json('data.id');
        $this->assertDatabaseHas('audit_logs', ['action' => 'discount.create', 'entity_id' => $id, 'actor_id' => $admin->id]);

        $this->postJson('/api/discounts', ['name' => 'Kategori', 'target_type' => 'category', 'target_id' => $c, 'discount_type' => 'amount', 'value' => '500.50'])
            ->assertCreated()->assertJsonPath('data.target_name', 'Minuman');

        $this->getJson('/api/discounts')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/discounts?target_type=category')->assertOk()->assertJsonPath('total', 1);
        $this->getJson("/api/discounts/{$id}")->assertOk()->assertJsonPath('data.name', 'Promo Akhir Bulan');

        $this->patchJson("/api/discounts/{$id}", ['value' => '15', 'ends_at' => now('Asia/Jakarta')->addDays(7)->toDateString()])
            ->assertOk()->assertJsonPath('data.value', '15.00')->assertJsonPath('data.status', 'active');
        $this->assertDatabaseHas('audit_logs', ['action' => 'discount.update', 'entity_id' => $id]);

        $this->patchJson("/api/discounts/{$id}", ['is_active' => false])->assertOk()->assertJsonPath('data.status', 'inactive');
        $this->getJson('/api/discounts?active_only=1')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_status_scheduled_and_expired(): void
    {
        $this->signIn('Admin');
        $p = $this->product();
        $base = ['name' => 'X', 'target_type' => 'product', 'target_id' => $p, 'discount_type' => 'amount', 'value' => '1000'];

        $this->postJson('/api/discounts', $base + ['starts_at' => now('Asia/Jakarta')->addDays(3)->toDateString()])
            ->assertCreated()->assertJsonPath('data.status', 'scheduled');
        $this->postJson('/api/discounts', $base + ['starts_at' => now('Asia/Jakarta')->subDays(5)->toDateString(), 'ends_at' => now('Asia/Jakarta')->subDays(2)->toDateString()])
            ->assertCreated()->assertJsonPath('data.status', 'expired');
    }

    public function test_discount_validation(): void
    {
        $this->signIn('Admin');
        $p = $this->product();
        $ok = ['name' => 'X', 'target_type' => 'product', 'target_id' => $p, 'discount_type' => 'percent', 'value' => '10'];

        $this->postJson('/api/discounts', [])->assertUnprocessable()->assertJsonValidationErrors(['name', 'target_type', 'target_id', 'discount_type', 'value']);
        $this->postJson('/api/discounts', ['value' => '101'] + $ok)->assertUnprocessable()->assertJsonValidationErrors(['value']);
        $this->postJson('/api/discounts', ['value' => '0'] + $ok)->assertUnprocessable()->assertJsonValidationErrors(['value']);
        $this->postJson('/api/discounts', ['value' => '1.234'] + $ok)->assertUnprocessable()->assertJsonValidationErrors(['value']);
        $this->postJson('/api/discounts', ['target_id' => 99999] + $ok)->assertUnprocessable()->assertJsonValidationErrors(['target_id']);
        $this->postJson('/api/discounts', ['target_type' => 'category', 'target_id' => 99999] + $ok)->assertUnprocessable()->assertJsonValidationErrors(['target_id']);
        $this->postJson('/api/discounts', ['starts_at' => '2026-11-10', 'ends_at' => '2026-11-01'] + $ok)->assertUnprocessable()->assertJsonValidationErrors(['ends_at']);
        $this->postJson('/api/discounts', ['starts_at' => '10-11-2026'] + $ok)->assertUnprocessable()->assertJsonValidationErrors(['starts_at']);

        $foreign = DB::table('categories')->insertGetId(['store_id' => DB::table('stores')->insertGetId(['code' => 'LAIN', 'name' => 'Toko Lain']), 'name' => 'Asing']);
        $this->postJson('/api/discounts', ['target_type' => 'category', 'target_id' => $foreign] + $ok)->assertUnprocessable()->assertJsonValidationErrors(['target_id']);

        $id = $this->postJson('/api/discounts', $ok)->assertCreated()->json('data.id');
        $this->patchJson("/api/discounts/{$id}", ['target_id' => $p])->assertUnprocessable()->assertJsonValidationErrors(['target_id']);
        $this->patchJson("/api/discounts/{$id}", ['value' => '150'])->assertUnprocessable()->assertJsonValidationErrors(['value']);
        $this->patchJson("/api/discounts/{$id}", ['discount_type' => 'amount', 'value' => '150'])->assertOk();   // 150 rupiah sah
        $this->patchJson("/api/discounts/{$id}", ['discount_type' => 'percent'])->assertUnprocessable()->assertJsonValidationErrors(['value']);   // 150% tidak sah
        $this->patchJson("/api/discounts/{$id}", ['ends_at' => '2000-01-01'])->assertUnprocessable()->assertJsonValidationErrors(['ends_at']);
        $this->patchJson('/api/discounts/99999', ['name' => 'Y'])->assertNotFound();
        $this->getJson('/api/discounts/99999')->assertNotFound();
    }

    public function test_cashier_cannot_manage_discounts_or_vat(): void
    {
        $this->signIn('Kasir');

        $this->getJson('/api/discounts')->assertForbidden();
        $this->postJson('/api/discounts', [])->assertForbidden();
        $this->patchJson('/api/discounts/1', [])->assertForbidden();
        $this->getJson('/api/settings/vat')->assertForbidden();
        $this->putJson('/api/settings/vat', ['enabled' => false])->assertForbidden();
    }

    public function test_vat_defaults_to_disabled_and_requires_full_config_when_enabled(): void
    {
        $this->signIn('Admin');

        $this->getJson('/api/settings/vat')->assertOk()
            ->assertJsonPath('data.enabled', false)->assertJsonPath('data.rate', null)->assertJsonPath('data.price_includes_tax', null);

        $this->putJson('/api/settings/vat', [])->assertUnprocessable()->assertJsonValidationErrors(['enabled']);
        $this->putJson('/api/settings/vat', ['enabled' => true])->assertUnprocessable()->assertJsonValidationErrors(['rate']);
        $this->putJson('/api/settings/vat', ['enabled' => true, 'rate' => '11'])->assertUnprocessable()->assertJsonValidationErrors(['rate']);
        $this->putJson('/api/settings/vat', ['enabled' => true, 'rate' => '101', 'price_includes_tax' => false])->assertUnprocessable()->assertJsonValidationErrors(['rate']);
        $this->assertSame(0, DB::table('tax_rates')->count());
    }

    public function test_vat_enable_version_rates_and_disable(): void
    {
        $admin = $this->signIn('Admin');

        $this->putJson('/api/settings/vat', ['enabled' => true, 'rate' => '11', 'price_includes_tax' => false])->assertOk()
            ->assertJsonPath('data.enabled', true)->assertJsonPath('data.rate', '11.00')->assertJsonPath('data.price_includes_tax', false);
        $this->assertSame(1, DB::table('tax_rates')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.vat', 'actor_id' => $admin->id]);

        // nilai sama: tidak menambah versi
        $this->putJson('/api/settings/vat', ['enabled' => true, 'rate' => '11.00', 'price_includes_tax' => false])->assertOk();
        $this->assertSame(1, DB::table('tax_rates')->count());

        // perubahan tarif dan mode: versi baru, yang terbaru berlaku
        $this->putJson('/api/settings/vat', ['enabled' => true, 'rate' => '12', 'price_includes_tax' => true])->assertOk()
            ->assertJsonPath('data.rate', '12.00')->assertJsonPath('data.price_includes_tax', true);
        $this->assertSame(2, DB::table('tax_rates')->count());

        // dinonaktifkan: tarif tetap tersimpan sebagai riwayat
        $this->putJson('/api/settings/vat', ['enabled' => false])->assertOk()->assertJsonPath('data.enabled', false);
        $this->assertSame(2, DB::table('tax_rates')->count());
        $this->assertSame('false', DB::table('settings')->where('setting_key', 'vat_enabled')->value('setting_value'));
        $this->assertSame(1, DB::table('settings')->where('setting_key', 'vat_enabled')->count());
    }
}
