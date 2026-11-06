<?php

namespace Tests\Feature;

use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\Concerns\CreatesUsers;
use Tests\SeededTestCase;

class SupplierReturnTest extends SeededTestCase
{
    use BuildsPurchasing;
    use CreatesUsers;

    /** @return array{product_id: int, supplier_id: int, location_id: int} */
    private function fixture(): array
    {
        $this->actAsAdmin();
        $productId = $this->product();
        $supplierId = $this->supplier();
        $locationId = (int) DB::table('locations')
            ->where('store_id', $this->storeId())
            ->where('type', 'store_floor')
            ->value('id');

        return ['product_id' => $productId, 'supplier_id' => $supplierId, 'location_id' => $locationId];
    }

    private function receiveStock(array $fixture, string $qty, string $unitCost = '2500.00', ?string $expiryDate = null): void
    {
        static $number = 0;
        $number++;
        $productId = $fixture['product_id'];
        $admin = $this->seededAdmin();
        $pr = $this->pr($admin->id, [$productId => [$qty, $unitCost]], 'converted');
        $po = $this->po($pr, $fixture['supplier_id'], [$productId => [$qty, $unitCost]], 'received', $admin->id);
        $poItemId = $this->poItemId($po, $productId);
        DB::table('purchase_order_items')->where('id', $poItemId)->update(['qty_received' => $qty]);
        DB::table('purchase_orders')->where('id', $po)->update(['receipt_status' => 'complete']);
        DB::table('product_suppliers')->insertOrIgnore([
            'product_id' => $productId,
            'supplier_id' => $fixture['supplier_id'],
        ]);
        $goodsReceiptId = DB::table('goods_receipts')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => sprintf('GR-ORIG-%06d', $number),
            'po_id' => $po,
            'supplier_id' => $fixture['supplier_id'],
            'receiving_location_id' => $fixture['location_id'],
            'status' => 'posted',
            'document_status' => 'pending',
            'received_by' => $admin->id,
            'posted_at' => now(),
        ]);
        $goodsReceiptItemId = DB::table('goods_receipt_items')->insertGetId([
            'gr_id' => $goodsReceiptId,
            'po_item_id' => $poItemId,
            'product_id' => $productId,
            'qty_ordered' => $qty,
            'qty_received' => $qty,
            'qty_damaged' => '0.000',
            'qty_short' => '0.000',
            'unit_cost' => $unitCost,
            'expiry_date' => $expiryDate,
        ]);

        DB::transaction(fn () => app(InventoryService::class)->receive(
            storeId: $this->storeId(),
            productId: $productId,
            qty: $qty,
            unitCost: $unitCost,
            expiryDate: $expiryDate,
            batchCode: null,
            goodsReceiptItemId: $goodsReceiptItemId,
            refType: 'goods_receipt',
            refId: $goodsReceiptId,
            actorId: $admin->id,
            locationId: $fixture['location_id'],
        ));
    }

    /** @param array{product_id: int, supplier_id: int, location_id: int} $fixture */
    private function createReturn(array $fixture, string $qty = '2', string $bucket = 'sellable'): int
    {
        $batchId = DB::table('product_batches')->where('product_id', $fixture['product_id'])->value('id');

        return (int) $this->postJson('/api/supplier-returns', [
            'supplier_id' => $fixture['supplier_id'],
            'note' => 'Barang rusak dari penerimaan',
            'items' => [[
                'product_id' => $fixture['product_id'],
                'batch_id' => $batchId,
                'location_id' => $fixture['location_id'],
                'source_bucket' => $bucket,
                'qty' => $qty,
            ]],
        ])->assertCreated()
            ->assertJsonPath('data.doc_number', 'RET-000001')
            ->assertJsonPath('data.status', 'draft')
            ->json('data.id');
    }

    public function test_supplier_return_acceptance_quarantines_items_and_receives_replacement(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '5');
        $id = $this->createReturn($fixture, '2');

        $this->postJson("/api/supplier-returns/{$id}/submit")
            ->assertOk()->assertJsonPath('data.status', 'submitted');
        $balance = DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->first();
        $this->assertSame('3.000', $balance->qty_sellable);
        $this->assertSame('2.000', $balance->qty_quarantine);

        $this->postJson("/api/supplier-returns/{$id}/supplier-decision", [
            'decision' => 'accept',
            'note' => 'Supplier menyetujui klaim.',
        ])->assertOk()->assertJsonPath('data.status', 'accepted');
        $this->assertSame('0.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_quarantine'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'supplier_return_out',
            'from_bucket' => 'quarantine',
            'ref_type' => 'supplier_return',
            'ref_id' => $id,
        ]);

        $returnItemId = (int) DB::table('supplier_return_items')->where('supplier_return_id', $id)->value('id');
        $replacement = $this->postJson("/api/supplier-returns/{$id}/replacement-receipt", [
            'items' => [['return_item_id' => $returnItemId, 'batch_code' => 'REPL-001']],
        ])->assertOk()
            ->assertJsonPath('data.status', 'accepted')
            ->json('data.replacement_goods_receipts.0.id');

        $this->postJson("/api/goods-receipts/{$replacement}/post")
            ->assertOk()->assertJsonPath('data.status', 'posted');
        $this->assertSame('replacement_received', DB::table('supplier_returns')->where('id', $id)->value('status'));

        $this->assertSame('5.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'receipt',
            'to_bucket' => 'sellable',
            'qty' => '2.000',
            'ref_type' => 'goods_receipt',
        ]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'supplier_return.replacement_gr_created', 'entity_id' => $id]);
    }

    public function test_supplier_rejection_records_loss_until_owner_reauthenticates_write_off(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '5', '2500.50');
        $batchId = (int) DB::table('product_batches')->where('product_id', $fixture['product_id'])->value('id');
        DB::transaction(fn () => app(InventoryService::class)->adjust(
            storeId: $this->storeId(),
            adjustmentId: 1,
            reason: 'damage',
            items: [[
                'product_id' => $fixture['product_id'],
                'batch_id' => $batchId,
                'location_id' => $fixture['location_id'],
                'shelf_position_id' => null,
                'qty_before' => '5.000',
                'qty_counted' => '3.000',
                'qty_diff' => '-2.000',
            ]],
            actorId: $this->seededAdmin()->id,
        ));
        $id = $this->createReturn($fixture, '2', 'damaged');
        $this->postJson("/api/supplier-returns/{$id}/submit")->assertOk();

        $this->postJson("/api/supplier-returns/{$id}/supplier-decision", [
            'decision' => 'reject',
            'note' => 'Klaim melewati batas waktu.',
        ])->assertOk()
            ->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.loss_amount', '5001.00');
        $this->assertSame('2.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_quarantine'));

        $this->postJson("/api/supplier-returns/{$id}/write-off")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['approver_password']);

        $this->postJson("/api/supplier-returns/{$id}/write-off", [
            'approver_username' => 'admin',
            'approver_password' => 'sandi-admin-123',
            'note' => 'Setujui sebagai kerugian toko.',
        ])->assertOk()
            ->assertJsonPath('data.status', 'written_off')
            ->assertJsonPath('data.loss_amount', '5001.00');

        $this->assertSame('0.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->value('qty_quarantine'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'write_off',
            'from_bucket' => 'quarantine',
            'qty' => '2.000',
            'ref_type' => 'supplier_return',
            'ref_id' => $id,
        ]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'supplier_return.write_off', 'entity_id' => $id]);
    }

    public function test_return_permission_is_configured_by_stock_authority_roles(): void
    {
        $fixture = $this->fixture();
        $cashier = $this->makeUser('Kasir', 'return-cashier');
        $this->actAsAdmin();
        $this->putJson('/api/settings/stock-authority', ['rules' => [
            ['key' => 'supplier_return.store_floor', 'roles' => ['Admin']],
        ]])->assertOk();

        $payload = [
            'supplier_id' => $fixture['supplier_id'],
            'items' => [[
                'product_id' => $fixture['product_id'],
                'location_id' => $fixture['location_id'],
                'qty' => '1',
            ]],
        ];
        Sanctum::actingAs($cashier, ['*']);
        $this->postJson('/api/supplier-returns', $payload)->assertForbidden();

        $this->actAsAdmin();
        $this->postJson('/api/supplier-returns', $payload)->assertCreated();
    }

    public function test_return_location_scope_is_enforced_by_stock_authority(): void
    {
        $fixture = $this->fixture();
        $this->putJson('/api/settings/warehouse', ['enabled' => true])->assertOk();
        $warehouseId = (int) DB::table('locations')
            ->where('store_id', $this->storeId())
            ->where('type', 'warehouse')
            ->value('id');
        $cashier = $this->makeUser('Kasir', 'return-warehouse-cashier');
        $this->actAsAdmin();
        $this->putJson('/api/settings/stock-authority', ['rules' => [
            ['key' => 'supplier_return.warehouse', 'roles' => ['Admin']],
        ]])->assertOk();

        Sanctum::actingAs($cashier, ['*']);
        $this->postJson('/api/supplier-returns', [
            'supplier_id' => $fixture['supplier_id'],
            'items' => [[
                'product_id' => $fixture['product_id'],
                'location_id' => $fixture['location_id'],
                'qty' => '1',
            ]],
        ])->assertCreated();
        $this->postJson('/api/supplier-returns', [
            'supplier_id' => $fixture['supplier_id'],
            'items' => [[
                'product_id' => $fixture['product_id'],
                'location_id' => $warehouseId,
                'qty' => '1',
            ]],
        ])->assertForbidden();
    }

    public function test_expired_replacement_goods_are_not_received_into_sellable_stock(): void
    {
        $fixture = $this->fixture();
        DB::table('products')->where('id', $fixture['product_id'])->update(['track_expiry' => 1]);
        $this->receiveStock($fixture, '3', '2500.00', '2027-01-01');
        $id = $this->createReturn($fixture, '1');
        $this->postJson("/api/supplier-returns/{$id}/submit")->assertOk();
        $this->postJson("/api/supplier-returns/{$id}/supplier-decision", ['decision' => 'accept'])->assertOk();
        $returnItemId = (int) DB::table('supplier_return_items')->where('supplier_return_id', $id)->value('id');

        $this->postJson("/api/supplier-returns/{$id}/replacement-receipt", [
            'items' => [['return_item_id' => $returnItemId, 'expiry_date' => '2026-01-01']],
        ])->assertUnprocessable()->assertJsonValidationErrors(["items.{$returnItemId}.expiry_date"]);

        $this->assertDatabaseHas('supplier_returns', ['id' => $id, 'status' => 'accepted']);
        $this->assertSame('2.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->assertSame(0, DB::table('inventory_movements')->where('movement_type', 'supplier_replacement_in')->count());
    }

    public function test_insufficient_stock_does_not_submit_or_move_any_items(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '1');
        $id = $this->createReturn($fixture, '2');

        $this->postJson("/api/supplier-returns/{$id}/submit")
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);
        $this->assertDatabaseHas('supplier_returns', ['id' => $id, 'status' => 'draft']);
        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
    }
}
