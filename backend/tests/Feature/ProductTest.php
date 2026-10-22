<?php

namespace Tests\Feature;

use App\Support\Ean13;
use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class ProductTest extends SeededTestCase
{
    private function makeCategory(string $name = 'Minuman', bool $active = true): int
    {
        return DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(),
            'name' => $name,
            'is_active' => $active ? 1 : 0,
        ]);
    }

    /** Membuat produk aktif sebagai Admin (harus sudah signIn). */
    private function makeProduct(array $overrides = []): int
    {
        static $n = 0;
        $n++;

        return $this->postJson('/api/products', $overrides + [
            'sku' => "SKU-{$n}",
            'barcode' => sprintf('89990000%05d', $n),
            'name' => "Produk {$n}",
            'sell_price' => 5000,
        ])->assertCreated()->json('data.id');
    }

    private function setStock(int $productId, string $qty): void
    {
        $locationId = DB::table('locations')->where('type', 'store_floor')->value('id');

        DB::table('inventory_balances')->updateOrInsert(
            ['product_id' => $productId, 'location_id' => $locationId],
            ['qty_sellable' => $qty],
        );
    }

    public function test_admin_creates_active_product_with_price_history_and_audit(): void
    {
        $admin = $this->signIn('Admin');
        $categoryId = $this->makeCategory();

        $response = $this->postJson('/api/products', [
            'sku' => 'AQ-600',
            'barcode' => '8999999000011',
            'name' => 'Air Mineral 600ml',
            'category_id' => $categoryId,
            'sell_price' => 3500,
            'min_stock' => 24,
            'critical_stock' => 6,
            'track_expiry' => true,
        ])->assertCreated();

        $response->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.sell_price', '3500.00')
            ->assertJsonPath('data.track_expiry', true)
            ->assertJsonPath('data.unit_name', 'pcs')
            ->assertJsonPath('data.category_name', 'Minuman')
            ->assertJsonPath('data.stock_status', 'habis');

        $id = $response->json('data.id');
        $this->assertDatabaseHas('price_history', ['product_id' => $id, 'new_price' => '3500.00', 'changed_by' => $admin->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.create', 'entity_id' => $id, 'actor_id' => $admin->id]);
    }

    public function test_admin_product_without_price_is_pending_price(): void
    {
        $this->signIn('Admin');

        $this->postJson('/api/products', ['name' => 'Tanpa Harga'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'pending_price')
            ->assertJsonPath('data.sell_price', null);

        $this->assertDatabaseCount('price_history', 0);
    }

    public function test_cashier_creates_pending_product_with_generated_sku_and_barcode(): void
    {
        $this->signIn('Kasir');

        $first = $this->postJson('/api/products', ['name' => 'Permen Baru'])->assertCreated();
        $second = $this->postJson('/api/products', ['name' => 'Permen Lain'])->assertCreated();

        $first->assertJsonPath('data.status', 'pending_price')->assertJsonPath('data.sell_price', null);

        $barcode = $first->json('data.barcode');
        $this->assertTrue(Ean13::isValid($barcode));
        $this->assertStringStartsWith('20', $barcode);
        $this->assertMatchesRegularExpression('/^P-\d{6}$/', $first->json('data.sku'));

        $this->assertNotSame($barcode, $second->json('data.barcode'));
        $this->assertNotSame($first->json('data.sku'), $second->json('data.sku'));
    }

    public function test_cashier_cannot_set_price_or_update_products(): void
    {
        $this->signIn('Admin', 'admin-uji');
        $id = $this->makeProduct();

        $this->signIn('Kasir', 'kasir-uji');

        $this->postJson('/api/products', ['name' => 'Coba Harga', 'sell_price' => 1000])->assertForbidden();
        $this->patchJson("/api/products/{$id}", ['name' => 'Ubah'])->assertForbidden();
        $this->patchJson("/api/products/{$id}", ['sell_price' => 1])->assertForbidden();
    }

    public function test_duplicate_sku_and_barcode_are_rejected_even_for_inactive_products(): void
    {
        $this->signIn('Admin');

        $id = $this->makeProduct(['sku' => 'A-1', 'barcode' => '111111']);
        $this->patchJson("/api/products/{$id}", ['status' => 'inactive'])->assertOk();

        $this->postJson('/api/products', ['name' => 'Baru', 'barcode' => '111111'])
            ->assertStatus(422)->assertJsonValidationErrors('barcode');
        $this->postJson('/api/products', ['name' => 'Baru', 'sku' => 'a-1'])
            ->assertStatus(422)->assertJsonValidationErrors('sku');
    }

    public function test_sku_and_barcode_cannot_be_changed(): void
    {
        $this->signIn('Admin');
        $id = $this->makeProduct();

        $this->patchJson("/api/products/{$id}", ['barcode' => '999'])
            ->assertStatus(422)->assertJsonValidationErrors('barcode');
        $this->patchJson("/api/products/{$id}", ['sku' => 'BARU'])
            ->assertStatus(422)->assertJsonValidationErrors('sku');
    }

    public function test_price_change_is_recorded_and_unchanged_price_is_a_no_op(): void
    {
        $admin = $this->signIn('Admin');
        $id = $this->makeProduct(['sell_price' => 3000]);

        $this->patchJson("/api/products/{$id}", ['sell_price' => 4000])
            ->assertOk()->assertJsonPath('data.sell_price', '4000.00');

        $this->assertDatabaseHas('price_history', ['product_id' => $id, 'old_price' => '3000.00', 'new_price' => '4000.00', 'changed_by' => $admin->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.price_change', 'entity_id' => $id]);
        $this->assertSame(2, DB::table('price_history')->where('product_id', $id)->count());

        $this->patchJson("/api/products/{$id}", ['sell_price' => 4000])->assertOk();
        $this->assertSame(2, DB::table('price_history')->where('product_id', $id)->count());
    }

    public function test_activation_requires_a_price(): void
    {
        $this->signIn('Kasir', 'kasir-uji');
        $id = $this->postJson('/api/products', ['name' => 'Menunggu Harga'])->json('data.id');

        $this->signIn('Admin', 'admin-uji');

        $this->patchJson("/api/products/{$id}", ['status' => 'active'])
            ->assertStatus(422)->assertJsonValidationErrors('status');

        $this->patchJson("/api/products/{$id}", ['sell_price' => 5000, 'status' => 'active'])
            ->assertOk()
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.sell_price', '5000.00');

        $this->assertDatabaseHas('audit_logs', ['action' => 'product.status_change', 'entity_id' => $id]);
    }

    public function test_product_with_stock_cannot_be_deactivated(): void
    {
        $this->signIn('Admin');
        $id = $this->makeProduct();
        $this->setStock($id, '5.000');

        $this->patchJson("/api/products/{$id}", ['status' => 'inactive'])
            ->assertStatus(422)->assertJsonValidationErrors('status');

        $this->setStock($id, '0.000');

        $this->patchJson("/api/products/{$id}", ['status' => 'inactive', 'reason' => 'Dihentikan supplier'])
            ->assertOk()->assertJsonPath('data.status', 'inactive');

        $this->assertDatabaseHas('audit_logs', ['action' => 'product.status_change', 'entity_id' => $id, 'reason' => 'Dihentikan supplier']);
    }

    public function test_critical_threshold_cannot_exceed_minimum(): void
    {
        $this->signIn('Admin');

        $this->postJson('/api/products', ['name' => 'X', 'min_stock' => 5, 'critical_stock' => 9])
            ->assertStatus(422)->assertJsonValidationErrors('critical_stock');

        $id = $this->makeProduct(['min_stock' => 10, 'critical_stock' => 3]);
        $this->patchJson("/api/products/{$id}", ['min_stock' => 2])
            ->assertStatus(422)->assertJsonValidationErrors('critical_stock');
    }

    public function test_inactive_category_cannot_be_assigned(): void
    {
        $this->signIn('Admin');
        $inactive = $this->makeCategory('Lama', active: false);

        $this->postJson('/api/products', ['name' => 'X', 'category_id' => $inactive])
            ->assertStatus(422)->assertJsonValidationErrors('category_id');
    }

    public function test_stock_status_is_derived_from_thresholds(): void
    {
        $this->signIn('Admin');
        $id = $this->makeProduct(['min_stock' => 10, 'critical_stock' => 3]);

        $expected = ['0.000' => 'habis', '2.000' => 'kritis', '8.000' => 'hampir_habis', '20.000' => 'aman'];

        foreach ($expected as $qty => $status) {
            $this->setStock($id, $qty);
            $this->getJson("/api/products/{$id}")
                ->assertOk()
                ->assertJsonPath('data.stock_status', $status);
        }
    }

    public function test_search_filters_and_pagination(): void
    {
        $this->signIn('Admin');
        $categoryId = $this->makeCategory();

        $this->makeProduct(['sku' => 'AQ-600', 'barcode' => '8991111000011', 'name' => 'Air Mineral 600ml', 'category_id' => $categoryId]);
        $this->makeProduct(['sku' => 'TB-250', 'barcode' => '8992222000022', 'name' => 'Teh Botol 250ml']);
        $this->postJson('/api/products', ['name' => 'Belum Berharga']);

        $this->getJson('/api/products')->assertOk()->assertJsonPath('total', 3);
        $this->getJson('/api/products?q=mineral')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/products?q=TB-2')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/products?q=89922')->assertOk()->assertJsonPath('total', 1);
        $this->getJson("/api/products?category_id={$categoryId}")->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/products?status=pending_price')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/products?per_page=2')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('total', 3);
        $this->getJson('/api/products?status=salah')->assertStatus(422);
    }

    public function test_lookup_by_barcode_for_pos(): void
    {
        $this->signIn('Admin', 'admin-uji');
        $this->makeProduct(['barcode' => '8993333000033', 'name' => 'Biskuit']);

        $this->signIn('Kasir', 'kasir-uji');

        $this->getJson('/api/products/by-barcode/8993333000033')
            ->assertOk()
            ->assertJsonPath('data.name', 'Biskuit')
            ->assertJsonPath('data.status', 'active');

        $this->getJson('/api/products/by-barcode/0000000000000')->assertNotFound();
    }

    public function test_unauthenticated_and_unknown_product(): void
    {
        $this->getJson('/api/products')->assertUnauthorized();

        $this->signIn('Admin');
        $this->getJson('/api/products/99999')->assertNotFound();
        $this->patchJson('/api/products/99999', ['name' => 'X'])->assertNotFound();
    }
}
