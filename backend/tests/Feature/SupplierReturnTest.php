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

    private function receiveStock(
        array $fixture,
        string $qty,
        string $unitCost = '2500.00',
        ?string $expiryDate = null,
        ?int $locationId = null,
    ): void {
        static $number = 0;
        $number++;
        $locationId ??= $fixture['location_id'];
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
            'receiving_location_id' => $locationId,
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
            locationId: $locationId,
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
            ->assertJsonMissingPath('data.status')
            ->json('data.id');
    }

    public function test_manual_return_immediately_removes_stock_and_creates_exact_restock_pr(): void
    {
        $fixture = $this->fixture();
        DB::table('products')->where('id', $fixture['product_id'])->update(['restock_quantity' => '5.000']);
        $this->receiveStock($fixture, '5');
        $id = $this->createReturn($fixture, '2');

        $balance = DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->first();
        $this->assertSame('3.000', $balance->qty_sellable);
        $this->assertSame('0.000', $balance->qty_quarantine);
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $fixture['product_id'],
            'movement_type' => 'supplier_return_out',
            'from_bucket' => 'sellable',
            'ref_type' => 'supplier_return',
            'ref_id' => $id,
            'qty' => '2.000',
        ]);
        $pr = DB::table('purchase_requisitions as pr')
            ->join('purchase_requisition_items as pri', 'pri.pr_id', '=', 'pr.id')
            ->where('pr.reason', 'like', '%RET-000001%')
            ->where('pri.product_id', $fixture['product_id'])
            ->first(['pr.is_auto_generated', 'pri.qty']);
        $this->assertNotNull($pr);
        $this->assertSame(1, (int) $pr->is_auto_generated);
        $this->assertSame('2.000', $pr->qty);
        $this->assertDatabaseHas('purchase_requisitions', [
            'store_id' => $this->storeId(),
            'reason' => 'Pemantauan stok otomatis',
            'status' => 'draft',
            'is_auto_generated' => 1,
        ]);
        $this->assertSame(2, DB::table('purchase_requisitions')
            ->where('store_id', $this->storeId())
            ->where('status', 'draft')
            ->where('is_auto_generated', 1)
            ->count());
        $this->assertDatabaseHas('supplier_returns', ['id' => $id, 'status' => 'completed']);
    }

    public function test_return_without_source_bucket_allocates_damaged_then_sellable_stock(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '5');
        DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->update([
            'qty_sellable' => '3.000',
            'qty_damaged' => '2.000',
        ]);
        $item = [
            'product_id' => $fixture['product_id'],
            'qty' => '4.000',
        ];

        $id = $this->postJson('/api/supplier-returns', [
            'supplier_id' => $fixture['supplier_id'],
            'items' => [$item],
        ])->assertCreated()->json('data.id');

        $allocated = DB::table('supplier_return_items')
            ->where('supplier_return_id', $id)
            ->orderBy('id')
            ->get(['source_bucket', 'qty']);
        $this->assertSame([
            ['source_bucket' => 'damaged', 'qty' => '2.000'],
            ['source_bucket' => 'sellable', 'qty' => '2.000'],
        ], $allocated->map(fn ($row) => (array) $row)->all());
    }

    public function test_each_manual_return_creates_its_own_pr_without_supplier_binding(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '5');
        $firstId = $this->createReturn($fixture, '1');

        $secondProduct = $this->product();
        DB::table('product_suppliers')->insertOrIgnore([
            'product_id' => $secondProduct,
            'supplier_id' => $fixture['supplier_id'],
        ]);
        $secondFixture = $fixture;
        $secondFixture['product_id'] = $secondProduct;
        $this->receiveStock($secondFixture, '4');

        $secondId = $this->createReturn($secondFixture, '2');
        $this->assertNotSame($firstId, $secondId);
        $this->assertSame(2, DB::table('purchase_requisitions')->where('reason', 'like', 'Retur RET-%')->count());
        $this->assertDatabaseHas('purchase_requisitions', [
            'is_auto_generated' => 1,
        ]);
        $this->assertSame(2, DB::table('purchase_requisition_items as pri')
            ->join('purchase_requisitions as pr', 'pr.id', '=', 'pri.pr_id')
            ->where('pr.reason', 'like', 'Retur RET-%')->count());
    }

    public function test_return_cannot_be_submitted_or_decided_again(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '5');
        $id = $this->createReturn($fixture, '2');

        $this->postJson("/api/supplier-returns/{$id}/submit")->assertNotFound();
        $this->postJson("/api/supplier-returns/{$id}/supplier-decision", ['decision' => 'accept'])->assertNotFound();
        $this->postJson("/api/supplier-returns/{$id}/replacement-receipt", ['items' => []])->assertNotFound();
        $this->assertSame(1, DB::table('inventory_movements')
            ->where('ref_type', 'supplier_return')->where('ref_id', $id)->count());
        $this->assertSame(1, DB::table('purchase_requisitions')->where('reason', 'like', '%RET-000001%')->count());
    }

    public function test_return_permission_is_configured_by_stock_authority_roles(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '2');
        $cashier = $this->makeUser('Kasir', 'return-cashier');
        $this->actAsAdmin();
        $this->putJson('/api/settings/stock-authority', ['rules' => [
            ['key' => 'supplier_return.store_floor', 'roles' => ['Admin']],
        ]])->assertOk();

        $payload = [
            'supplier_id' => $fixture['supplier_id'],
            'items' => [[
                'product_id' => $fixture['product_id'],
                'batch_id' => DB::table('product_batches')->where('product_id', $fixture['product_id'])->value('id'),
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
        $this->receiveStock($fixture, '2');
        $this->receiveStock($fixture, '2', '2500.00', null, $warehouseId);
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
                'batch_id' => DB::table('product_batches')->where('product_id', $fixture['product_id'])->value('id'),
                'location_id' => $fixture['location_id'],
                'qty' => '1',
            ]],
        ])->assertCreated();
        DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->where('location_id', $fixture['location_id'])
            ->update(['qty_sellable' => '0.000']);
        $this->postJson('/api/supplier-returns', [
            'supplier_id' => $fixture['supplier_id'],
            'items' => [[
                'product_id' => $fixture['product_id'],
                'batch_id' => DB::table('product_batches as b')
                    ->join('goods_receipt_items as gri', 'gri.id', '=', 'b.goods_receipt_item_id')
                    ->join('goods_receipts as gr', 'gr.id', '=', 'gri.gr_id')
                    ->where('b.product_id', $fixture['product_id'])
                    ->where('gr.receiving_location_id', $warehouseId)
                    ->value('b.id'),
                'location_id' => $warehouseId,
                'qty' => '1',
            ]],
        ])->assertForbidden();
    }

    public function test_return_is_not_put_into_quarantine_while_waiting_for_supplier(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '3');
        $id = $this->createReturn($fixture, '1');
        $this->assertSame('2.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_sellable'));
        $this->assertSame('0.000', DB::table('inventory_balances')->where('product_id', $fixture['product_id'])->sum('qty_quarantine'));
        $this->assertSame(0, DB::table('inventory_movements')->where('movement_type', 'supplier_replacement_in')->count());
    }

    public function test_insufficient_stock_does_not_submit_or_move_any_items(): void
    {
        $fixture = $this->fixture();
        $this->receiveStock($fixture, '1');
        $prCount = DB::table('purchase_requisitions')->count();
        $this->postJson('/api/supplier-returns', [
            'supplier_id' => $fixture['supplier_id'],
            'items' => [[
                'product_id' => $fixture['product_id'],
                'batch_id' => DB::table('product_batches')->where('product_id', $fixture['product_id'])->value('id'),
                'location_id' => $fixture['location_id'],
                'source_bucket' => 'sellable',
                'qty' => '2',
            ]],
        ])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty']);
        $this->assertSame(0, DB::table('supplier_returns')->count());
        $this->assertSame($prCount, DB::table('purchase_requisitions')->count());
        $this->assertSame(1, DB::table('inventory_movements')->where('product_id', $fixture['product_id'])->count());
    }
}
