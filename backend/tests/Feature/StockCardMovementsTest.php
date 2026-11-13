<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class StockCardMovementsTest extends SeededTestCase
{
    use BuildsPurchasing;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = $this->makeUser('Kasir', 'kasir-stock-card');
        Sanctum::actingAs($this->cashier, ['*']);
    }

    public function test_stock_card_groups_receipts_returns_and_posted_sales_and_paginates(): void
    {
        $productId = $this->product(['track_expiry' => 1]);
        $supplierId = $this->supplier();
        $orderedQty = '10.000';
        $prId = $this->pr($this->cashier->id, [$productId => [$orderedQty, '2000.00']], 'converted');
        $poId = $this->po($prId, $supplierId, [$productId => [$orderedQty, '2000.00']]);
        $poItemId = $this->poItemId($poId, $productId);
        $locationId = (int) DB::table('locations')
            ->where('store_id', $this->storeId())
            ->where('type', 'store_floor')
            ->value('id');
        $now = Carbon::now('UTC');
        $receiptId = DB::table('goods_receipts')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => 'GR-CARD-000001',
            'po_id' => $poId,
            'supplier_id' => $supplierId,
            'receiving_location_id' => $locationId,
            'status' => 'posted',
            'document_status' => 'pending',
            'received_by' => $this->cashier->id,
            'posted_at' => $now->copy()->subDays(3)->format('Y-m-d H:i:s.v'),
        ]);
        DB::table('goods_receipt_items')->insert([
            'gr_id' => $receiptId,
            'po_item_id' => $poItemId,
            'product_id' => $productId,
            'qty_ordered' => $orderedQty,
            'qty_received' => '7.000',
            'qty_damaged' => '2.000',
            'qty_short' => '1.000',
            'unit_cost' => '2000.00',
            'expiry_date' => '2027-01-15',
            'damage_disposition' => 'direct_return',
        ]);

        $returnId = DB::table('supplier_returns')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => 'RET-CARD-000001',
            'supplier_id' => $supplierId,
            'status' => 'accepted',
            'requested_by' => $this->cashier->id,
        ]);
        $this->insertMovement($productId, 'supplier_return_out', 'supplier_return', $returnId, '1.000', $now->copy()->subDays(2));

        $shiftId = (int) $this->postJson('/api/shifts/open')->assertCreated()->json('data.id');
        $saleId = DB::table('sales')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => 'SALE-CARD-000001',
            'shift_id' => $shiftId,
            'cashier_id' => $this->cashier->id,
            'payment_mode' => 'cash',
            'status' => 'posted',
            'idempotency_key' => (string) Str::uuid(),
            'posted_at' => $now->copy()->subDay()->format('Y-m-d H:i:s.v'),
        ]);
        $this->insertMovement($productId, 'sale', 'sale', $saleId, '3.000', $now->copy()->subDay());

        $voidedSaleId = DB::table('sales')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => 'SALE-CARD-VOID',
            'shift_id' => $shiftId,
            'cashier_id' => $this->cashier->id,
            'payment_mode' => 'cash',
            'status' => 'voided',
            'idempotency_key' => (string) Str::uuid(),
            'posted_at' => $now->format('Y-m-d H:i:s.v'),
        ]);
        $this->insertMovement($productId, 'sale', 'sale', $voidedSaleId, '9.000', $now);
        $this->insertMovement($productId, 'write_off', 'stock_opname', 1, '4.000', $now);

        $this->getJson("/api/inventory/products/{$productId}/stock-movements?per_page=2")
            ->assertOk()
            ->assertJsonPath('total', 3)
            ->assertJsonPath('data.0.reference_type', 'sale')
            ->assertJsonPath('data.0.reference_no', 'SALE-CARD-000001')
            ->assertJsonPath('data.0.sale_out', '3.000')
            ->assertJsonPath('data.1.reference_type', 'supplier_return')
            ->assertJsonPath('data.1.return_out', '1.000');

        $this->getJson("/api/inventory/products/{$productId}/stock-movements?per_page=2&page=2")
            ->assertOk()
            ->assertJsonPath('total', 3)
            ->assertJsonPath('data.0.reference_type', 'goods_receipt')
            ->assertJsonPath('data.0.reference_no', 'GR-CARD-000001')
            ->assertJsonPath('data.0.expiry_date', '2027-01-15')
            ->assertJsonPath('data.0.good_in', '7.000')
            ->assertJsonPath('data.0.damaged_in', '2.000');
    }

    private function insertMovement(int $productId, string $movementType, string $refType, int $refId, string $qty, Carbon $occurredAt): void
    {
        DB::table('inventory_movements')->insert([
            'store_id' => $this->storeId(),
            'product_id' => $productId,
            'qty' => $qty,
            'movement_type' => $movementType,
            'ref_type' => $refType,
            'ref_id' => $refId,
            'occurred_at' => $occurredAt->format('Y-m-d H:i:s.v'),
        ]);
    }
}
