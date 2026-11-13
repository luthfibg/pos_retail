<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class StockAuthorityTest extends SeededTestCase
{
    use BuildsPurchasing;

    private function user(string $role, string $username): void
    {
        $this->postJson('/api/users', ['name' => ucfirst($username), 'username' => $username, 'password' => 'sandi-12345', 'role' => $role])->assertCreated();
    }

    /** Admin masuk lalu membuat Kasir dan Purchasing. */
    private function staff(): User
    {
        $admin = $this->signIn('Admin');
        $this->user('Kasir', 'kasir-s');
        $this->user('Purchasing', 'buy-s');

        return $admin;
    }

    private function actAs(string $username): User
    {
        $user = User::where('username', $username)->firstOrFail();
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function rule(string $key, ?array $roles): array
    {
        return ['rules' => [['key' => $key, 'roles' => $roles]]];
    }

    /** @return array<string, mixed> aturan berdasarkan kunci */
    private function rules(): array
    {
        $out = [];
        foreach ($this->getJson('/api/settings/stock-authority')->assertOk()->json('data.rules') as $rule) {
            $out[$rule['key']] = $rule;
        }

        return $out;
    }

    private function locationId(string $type): int
    {
        return (int) DB::table('locations')->where('store_id', $this->storeId())->where('type', $type)->value('id');
    }

    public function test_defaults_follow_the_admin_model_and_are_independent_of_warehouse(): void
    {
        $this->signIn('Admin');

        $data = $this->getJson('/api/settings/stock-authority')->assertOk()->assertJsonPath('data.admin_model', 'simple')
            ->assertJsonPath('data.warehouse_enabled', false)->json('data');

        $this->assertCount(8, $data['rules']);
        $this->assertSame(['opening_balance', 'receipt.store_floor', 'receipt.warehouse', 'supplier_return.store_floor',
            'supplier_return.warehouse', 'transfer.store_floor', 'transfer.warehouse', 'adjustment_approve'], array_column($data['rules'], 'key'));

        $rules = $this->rules();
        $this->assertSame(['Admin'], $rules['opening_balance']['roles']);
        $this->assertSame(['Admin', 'Kasir'], $rules['receipt.store_floor']['roles']);
        $this->assertSame(['Admin', 'Kasir'], $rules['supplier_return.store_floor']['roles']);
        $this->assertSame(['Admin'], $rules['adjustment_approve']['roles']);
        $this->assertFalse($rules['receipt.store_floor']['customized']);
        $this->assertTrue($rules['receipt.store_floor']['applies']);
        $this->assertFalse($rules['receipt.warehouse']['applies']); // Gudang nonaktif

        // aturan gudang tetap dapat disetel saat Gudang nonaktif
        $this->user('Purchasing', 'buy-s');
        $this->putJson('/api/settings/stock-authority', $this->rule('receipt.warehouse', ['Purchasing']))->assertOk();
        $this->assertSame(['Purchasing'], $this->rules()['receipt.warehouse']['roles']);
        $this->assertTrue($this->rules()['receipt.warehouse']['customized']);
    }

    public function test_only_settings_managers_can_read_or_change_the_matrix(): void
    {
        $this->signIn('Kasir');
        $this->getJson('/api/settings/stock-authority')->assertForbidden();
        $this->putJson('/api/settings/stock-authority', $this->rule('opening_balance', ['Kasir']))->assertForbidden();
    }

    public function test_guest_is_unauthenticated(): void
    {
        $this->getJson('/api/settings/stock-authority')->assertUnauthorized();
        $this->putJson('/api/settings/stock-authority', [])->assertUnauthorized();
    }

    public function test_matrix_moves_receiving_permission_between_roles_and_reset_restores_default(): void
    {
        $this->staff();
        $this->putJson('/api/settings/stock-authority', ['rules' => [
            ['key' => 'receipt.store_floor', 'roles' => ['Purchasing', 'Admin']],
            ['key' => 'receipt.warehouse', 'roles' => ['Purchasing', 'Admin']],
        ]])->assertOk();

        $this->actAs('kasir-s');
        $this->getJson('/api/goods-receipts')->assertForbidden();
        $me = $this->getJson('/api/auth/me')->assertOk();
        $this->assertNotContains('goods_receipt.create', $me->json('permissions'));
        $this->assertFalse($me->json('stock_authority')['receipt.store_floor']);
        $this->assertTrue($me->json('stock_authority')['transfer.store_floor']);

        $this->actAs('buy-s');
        $this->getJson('/api/goods-receipts')->assertOk();
        $me = $this->getJson('/api/auth/me')->assertOk();
        $this->assertContains('goods_receipt.create', $me->json('permissions'));
        $this->assertTrue($me->json('stock_authority')['receipt.store_floor']);
        $this->assertFalse($me->json('stock_authority')['opening_balance']);

        $this->actAs('admin-uji');
        $this->putJson('/api/settings/stock-authority', ['rules' => [
            ['key' => 'receipt.store_floor', 'roles' => null],
            ['key' => 'receipt.warehouse', 'roles' => null],
        ]])->assertOk();
        $this->assertFalse($this->rules()['receipt.store_floor']['customized']);
        $this->assertSame(['Admin', 'Kasir'], $this->rules()['receipt.store_floor']['roles']);

        $this->actAs('kasir-s');
        $this->getJson('/api/goods-receipts')->assertOk();
        $this->actAs('buy-s');
        $this->getJson('/api/goods-receipts')->assertForbidden();
    }

    public function test_receipt_scope_is_enforced_per_location_type_for_create_and_post(): void
    {
        $this->staff();
        $this->putJson('/api/settings/warehouse', ['enabled' => true])->assertOk();
        $warehouse = $this->locationId('warehouse');
        $floor = $this->locationId('store_floor');

        $kasir = User::where('username', 'kasir-s')->firstOrFail();
        $p = $this->product();
        // Satu PO hanya boleh punya satu penerimaan aktif, jadi setiap penerimaan yang berhasil dibuat memakai PO sendiri.
        $newPo = function () use ($kasir, $p): array {
            $pr = $this->pr($kasir->id, [$p => ['10', '2000']], 'converted');
            $po = $this->po($pr, $this->supplier(), [$p => ['10', '2000']], 'sent');

            return [$po, $this->poItemId($po, $p)];
        };
        $payload = fn (array $po, int $location) => ['po_id' => $po[0], 'receiving_location_id' => $location, 'items' => [['po_item_id' => $po[1], 'qty_received' => '1']]];
        $poWarehouseDraft = $newPo();
        $poFloor = $newPo();
        $poAdminWarehouse = $newPo();

        // default: Kasir boleh di toko dan gudang
        $this->actAs('kasir-s');
        $draftAtWarehouse = $this->postJson('/api/goods-receipts', $payload($poWarehouseDraft, $warehouse))->assertCreated()->json('data.id');

        // hanya Admin yang boleh menerima ke gudang
        $this->actAs('admin-uji');
        $this->putJson('/api/settings/stock-authority', $this->rule('receipt.warehouse', ['Admin']))->assertOk();

        $this->actAs('kasir-s');
        $this->postJson('/api/goods-receipts', $payload($poFloor, $warehouse))->assertForbidden();
        $this->postJson("/api/goods-receipts/{$draftAtWarehouse}/post")->assertForbidden();   // draft lama tidak lolos posting
        $this->postJson('/api/goods-receipts', $payload($poFloor, $floor))->assertCreated();

        $this->actAs('admin-uji');
        $this->postJson('/api/goods-receipts', $payload($poAdminWarehouse, $warehouse))->assertCreated();
    }

    public function test_transfer_and_adjustment_scope_for_warehouse(): void
    {
        $this->staff();
        $this->putJson('/api/settings/warehouse', ['enabled' => true])->assertOk();
        $warehouse = $this->locationId('warehouse');
        $floor = $this->locationId('store_floor');
        $p = $this->product();

        $this->putJson('/api/settings/stock-authority', ['rules' => [
            ['key' => 'transfer.warehouse', 'roles' => ['Admin']],
        ]])->assertOk();

        $this->actAs('kasir-s');
        foreach ([[$floor, $warehouse], [$warehouse, $floor]] as [$from, $to]) {
            $this->postJson('/api/inventory/transfers', ['from_location_id' => $from, 'to_location_id' => $to, 'items' => [['product_id' => $p, 'qty' => '1']]])
                ->assertForbidden();
        }
        $this->postJson('/api/inventory/adjustments', ['product_id' => $p, 'type' => 'increase', 'quantity' => 1, 'reason_code' => 'found', 'client_request_id' => fake()->uuid()])
            ->assertCreated();

        $this->actAs('admin-uji');
        $this->assertNotSame(403, $this->postJson('/api/inventory/transfers', ['from_location_id' => $floor, 'to_location_id' => $warehouse, 'items' => [['product_id' => $p, 'qty' => '1']]])->status());
        $this->postJson('/api/inventory/adjustments', ['product_id' => $p, 'type' => 'increase', 'quantity' => 1, 'reason_code' => 'found', 'client_request_id' => fake()->uuid()])
            ->assertCreated();
    }

    public function test_opening_balance_can_be_delegated_to_purchasing(): void
    {
        $this->staff();
        $p = $this->product();
        $body = ['note' => 'stok awal', 'items' => [['product_id' => $p, 'qty' => '5']]];

        $this->actAs('buy-s');
        $this->postJson('/api/inventory/opening-balances', $body)->assertForbidden();

        $this->actAs('admin-uji');
        $this->putJson('/api/settings/stock-authority', $this->rule('opening_balance', ['Admin', 'Purchasing']))->assertOk();

        $this->actAs('kasir-s');
        $this->postJson('/api/inventory/opening-balances', $body)->assertForbidden();

        $this->actAs('buy-s');
        $this->postJson('/api/inventory/opening-balances', $body)->assertCreated();
    }

    public function test_validation_warnings_audit_and_noop(): void
    {
        $this->signIn('Admin');
        $put = fn (array $rules) => $this->putJson('/api/settings/stock-authority', ['rules' => $rules]);

        $put([['key' => 'bogus', 'roles' => ['Admin']]])->assertUnprocessable()->assertJsonValidationErrors(['rules.0.key']);
        $put([['key' => 'opening_balance', 'roles' => []]])->assertUnprocessable()->assertJsonValidationErrors(['rules.0.roles']);
        $put([['key' => 'opening_balance', 'roles' => ['Owner']]])->assertUnprocessable()->assertJsonValidationErrors(['rules.0.roles']); // Owner tidak tersedia pada model simple
        $put([['key' => 'opening_balance', 'roles' => ['Admin']], ['key' => 'opening_balance', 'roles' => ['Admin']]])->assertUnprocessable()->assertJsonValidationErrors(['rules.1.key']);
        $put([['key' => 'opening_balance']])->assertUnprocessable()->assertJsonValidationErrors(['rules.0.roles']);
        $this->putJson('/api/settings/stock-authority', ['rules' => []])->assertUnprocessable()->assertJsonValidationErrors(['rules']);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'settings.stock_authority']);

        // sama dengan default: tidak ada perubahan dan tidak diaudit
        $put([['key' => 'opening_balance', 'roles' => ['Admin']]])->assertOk();
        $this->assertDatabaseMissing('audit_logs', ['action' => 'settings.stock_authority']);

        // role tanpa pengguna aktif -> peringatan, bukan penolakan
        $changed = $put([['key' => 'adjustment_approve', 'roles' => ['Finance']]])->assertOk()->json('data.rules');
        $approve = collect($changed)->firstWhere('key', 'adjustment_approve');
        $this->assertSame(0, $approve['active_users']);
        $this->assertSame('no_active_user', $approve['warnings'][0]['code']);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'settings.stock_authority')->count());

        $this->user('Finance', 'fin-w');
        $this->assertSame([], $this->rules()['adjustment_approve']['warnings']);
    }

    public function test_switching_admin_model_remaps_customized_roles_and_changes_defaults(): void
    {
        $this->signIn('Admin');
        foreach ([['Kasir', 'kasir-m'], ['Finance', 'fin-m'], ['Purchasing', 'buy-m'], ['Accounting', 'acc-m']] as [$role, $username]) {
            $this->user($role, $username);
        }
        $this->putJson('/api/settings/stock-authority', ['rules' => [
            ['key' => 'receipt.store_floor', 'roles' => ['Admin', 'Purchasing']],
            ['key' => 'transfer.store_floor', 'roles' => ['Kasir']],
        ]])->assertOk();

        $this->putJson('/api/settings/admin-model', ['model' => 'standard', 'confirm' => true])->assertOk();

        $rules = $this->rules();
        $this->assertSame(['Owner', 'Purchasing'], $rules['receipt.store_floor']['roles']);   // Admin -> Owner
        $this->assertSame(['Kasir'], $rules['transfer.store_floor']['roles']);
        $this->assertSame(['Owner'], $rules['opening_balance']['roles']);                      // default model standar
        $this->assertSame(['Owner'], $rules['adjustment_approve']['roles']);
        $me = $this->getJson('/api/auth/me')->assertOk();
        $this->assertTrue($me->json('stock_authority')['opening_balance']);
        $this->assertTrue($me->json('stock_authority')['receipt.store_floor']);
        $this->assertContains('inventory.opening_balance', $me->json('permissions'));

        // Admin tidak tersedia pada model standar
        $this->putJson('/api/settings/stock-authority', $this->rule('opening_balance', ['Admin']))->assertUnprocessable()->assertJsonValidationErrors(['rules.0.roles']);
    }

    public function test_explicit_user_override_still_works_on_top_of_the_matrix(): void
    {
        $this->staff();
        $kasir = User::where('username', 'kasir-s')->firstOrFail();
        DB::table('user_permissions')->insert([
            'user_id' => $kasir->id, 'permission_id' => DB::table('permissions')->where('code', 'goods_receipt.create')->value('id'),
            'store_id' => $this->storeId(), 'effect' => 'deny',
        ]);

        $this->actAs('kasir-s');
        $this->getJson('/api/goods-receipts')->assertForbidden();
        $this->assertNotContains('goods_receipt.create', $this->getJson('/api/auth/me')->json('permissions'));
    }

    public function test_owner_sees_pending_confirmation_purchase_orders_with_prices(): void
    {
        $owner = $this->makeUser('Owner', 'owner-po');
        $p = $this->product();
        $pr = $this->pr($owner->id, [$p => ['2', '5000']], 'approved');
        $po = $this->po($pr, $this->supplier(), [$p => ['2', '5000']], 'pending_confirmation');

        Sanctum::actingAs($owner, ['*']);
        $this->getJson('/api/purchase-orders')->assertOk()->assertJsonPath('data.0.id', $po)
            ->assertJsonPath('data.0.status', 'pending_confirmation')->assertJsonPath('data.0.total', '10000.00');
        $this->getJson("/api/purchase-orders/{$po}")->assertOk()->assertJsonPath('data.status', 'pending_confirmation');
    }
}
