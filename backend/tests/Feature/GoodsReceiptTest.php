<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class GoodsReceiptTest extends SeededTestCase
{
    use BuildsPurchasing;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = $this->makeUser('Kasir', 'kasir-terima');
        Sanctum::actingAs($this->cashier, ['*']);
        Storage::fake('local');
    }

    /** PO berstatus sent dengan satu baris; mengembalikan [poId, poItemId]. */
    private function sentPo(int $productId, string $qty = '10', string $price = '2000', string $status = 'sent'): array
    {
        $pr = $this->pr($this->cashier->id, [$productId => [$qty, $price]], 'converted');
        $po = $this->po($pr, $this->supplier(), [$productId => [$qty, $price]], $status);

        return [$po, $this->poItemId($po, $productId)];
    }

    /** @return array<string, mixed> */
    private function receipt(int $poId, int $poItemId, array $item = [], array $extra = []): array
    {
        return $extra + ['po_id' => $poId, 'items' => [$item + ['po_item_id' => $poItemId, 'qty_received' => '10']]];
    }

    private function stock(int $productId): float
    {
        return (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_sellable');
    }

    private function sendIncomingReturn(int $goodsReceiptId, int $supplierId): int
    {
        Sanctum::actingAs($this->seededAdmin(), ['*']);
        $items = DB::table('goods_receipt_items')->where('gr_id', $goodsReceiptId)->where('qty_damaged', '>', 0)->get();
        $returnId = $this->postJson('/api/supplier-returns', [
            'return_type' => 'incoming',
            'supplier_id' => $supplierId,
            'goods_receipt_id' => $goodsReceiptId,
            'items' => $items->map(fn ($item) => [
                'goods_receipt_item_id' => (int) $item->id,
                'disposition' => $item->damage_disposition,
                'source_bucket' => 'damaged',
            ])->all(),
        ])->assertCreated()
            ->assertJsonPath('data.return_type', 'incoming')
            ->assertJsonPath('data.is_auto_generated', false)
            ->json('data.id');

        $this->postJson("/api/supplier-returns/{$returnId}/submit")
            ->assertOk()->assertJsonPath('data.status', 'submitted');
        Sanctum::actingAs($this->cashier, ['*']);

        return $returnId;
    }

    public function test_cashier_receives_full_order_and_stock_is_posted(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);

        $response = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, [], ['delivery_note_no' => 'SJ-001', 'post' => true]))
            ->assertCreated()
            ->assertJsonPath('data.document_status', 'pending')
            ->assertJsonPath('data.items.0.qty_received', '10.000')
            ->assertJsonPath('data.items.0.unit_cost', null);          // Kasir tidak melihat harga beli

        $this->assertMatchesRegularExpression('/^GR-\d{6}-000001$/', $response->json('data.doc_number'));
        $this->assertSame(10.0, $this->stock($p));
        $this->assertSame(2000.0, (float) DB::table('products')->where('id', $p)->value('unit_cost'));

        $grItem = (int) $response->json('data.items.0.id');
        $this->assertSame(1, DB::table('product_batches')->where('goods_receipt_item_id', $grItem)->count());
        $this->assertSame(1, DB::table('inventory_movements')->where('movement_type', 'receipt')->where('ref_type', 'goods_receipt')->where('product_id', $p)->count());

        $this->assertSame('received', DB::table('purchase_orders')->where('id', $po)->value('status'));
        $this->assertSame('complete', DB::table('purchase_orders')->where('id', $po)->value('receipt_status'));
        $this->assertSame(10.0, (float) DB::table('purchase_order_items')->where('id', $item)->value('qty_received'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'goods_receipt.post', 'actor_id' => $this->cashier->id]);
    }

    public function test_final_receipt_calculates_received_quantity_closes_shortage_and_creates_return(): void
    {
        $p = $this->product(['track_expiry' => 1]);
        [$po, $item] = $this->sentPo($p);

        $response = $this->postJson('/api/goods-receipts', [
            'po_id' => $po,
            'complete_po' => true,
            'post' => true,
            'items' => [[
                'po_item_id' => $item,
                'qty_damaged' => '2',
                'qty_short' => '1',
                'expiry_date' => $this->today(60),
            ]],
        ])->assertCreated()
            ->assertJsonPath('data.document_status', 'pending')
            ->assertJsonPath('data.items.0.qty_received', '7.000')
            ->assertJsonPath('data.items.0.qty_damaged', '2.000')
            ->assertJsonPath('data.items.0.qty_short', '1.000');

        $receiptId = (int) $response->json('data.id');
        $returnId = (int) DB::table('supplier_returns')->where('goods_receipt_id', $receiptId)->value('id');
        $this->assertGreaterThan(0, $returnId);
        $this->assertDatabaseHas('supplier_returns', [
            'id' => $returnId,
            'return_type' => 'incoming',
            'is_auto_generated' => 1,
            'status' => 'draft',
        ]);
        $this->assertDatabaseHas('supplier_return_items', [
            'supplier_return_id' => $returnId,
            'goods_receipt_item_id' => $response->json('data.items.0.id'),
            'qty' => '2.000',
            'disposition' => 'quarantine',
        ]);
        $this->actAsAdmin();
        $this->getJson('/api/supplier-returns')
            ->assertOk()
            ->assertJsonPath('data.0.is_auto_generated', true);
        $this->assertSame(7.0, $this->stock($p));
        $this->assertSame(2.0, (float) DB::table('inventory_balances')->where('product_id', $p)->sum('qty_quarantine'));
        $this->assertSame('received', DB::table('purchase_orders')->where('id', $po)->value('status'));
        $this->assertSame('partial', DB::table('purchase_orders')->where('id', $po)->value('receipt_status'));
        $this->assertSame(9.0, (float) DB::table('purchase_order_items')->where('id', $item)->value('qty_received'));
        $this->assertSame(1, DB::table('goods_receipts')->where('po_id', $po)->whereNull('supplier_return_id')->count());

        $this->postJson('/api/goods-receipts', [
            'po_id' => $po,
            'complete_po' => true,
            'post' => true,
            'items' => [['po_item_id' => $item, 'qty_damaged' => '0', 'qty_short' => '0']],
        ])->assertUnprocessable()->assertJsonValidationErrors(['po_id']);
    }

    public function test_final_receipt_without_damage_posts_once_and_hides_po_from_receivable_list(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);

        $this->postJson('/api/goods-receipts', [
            'po_id' => $po,
            'complete_po' => true,
            'post' => true,
            'items' => [['po_item_id' => $item, 'qty_damaged' => '0', 'qty_short' => '3']],
        ])->assertCreated()->assertJsonPath('data.items.0.qty_received', '7.000');

        $this->getJson('/api/purchase-orders?receivable=1')->assertOk()->assertJsonMissing(['doc_number' => DB::table('purchase_orders')->where('id', $po)->value('doc_number')]);
        $this->assertSame('received', DB::table('purchase_orders')->where('id', $po)->value('status'));
        $receiptId = (int) DB::table('goods_receipts')->where('po_id', $po)->value('id');
        $this->assertSame(0, DB::table('supplier_returns')->where('goods_receipt_id', $receiptId)->count());
    }

    public function test_admin_can_record_supplier_acceptance_directly_on_new_automatic_return(): void
    {
        $productId = $this->product(['unit_cost' => '2000.00']);
        [$poId, $poItemId] = $this->sentPo($productId);
        $receipt = $this->postJson('/api/goods-receipts', [
            'po_id' => $poId,
            'complete_po' => true,
            'post' => true,
            'items' => [['po_item_id' => $poItemId, 'qty_damaged' => '2', 'qty_short' => '0']],
        ])->assertCreated()->json('data');
        $returnId = (int) DB::table('supplier_returns')->where('goods_receipt_id', $receipt['id'])->value('id');

        $this->actAsAdmin();
        $this->postJson("/api/supplier-returns/{$returnId}/supplier-decision", ['decision' => 'accept'])
            ->assertOk()
            ->assertJsonPath('data.status', 'replacement_received')
            ->assertJsonPath('data.is_auto_generated', true);

        $this->assertSame(10.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_sellable'));
        $this->assertSame(0.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_quarantine'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $productId,
            'movement_type' => 'supplier_replacement_in',
            'qty' => '2.000',
            'ref_type' => 'supplier_return',
            'ref_id' => $returnId,
        ]);
    }

    public function test_admin_can_record_supplier_rejection_directly_and_calculate_loss_for_new_automatic_return(): void
    {
        $productId = $this->product(['unit_cost' => '2000.00']);
        [$poId, $poItemId] = $this->sentPo($productId);
        $receipt = $this->postJson('/api/goods-receipts', [
            'po_id' => $poId,
            'complete_po' => true,
            'post' => true,
            'items' => [['po_item_id' => $poItemId, 'qty_damaged' => '2', 'qty_short' => '0']],
        ])->assertCreated()->json('data');
        $returnId = (int) DB::table('supplier_returns')->where('goods_receipt_id', $receipt['id'])->value('id');

        $this->actAsAdmin();
        $this->postJson("/api/supplier-returns/{$returnId}/supplier-decision", [
            'decision' => 'reject',
            'note' => 'Supplier menolak klaim.',
        ])->assertOk()
            ->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.loss_amount', '4000.00');

        $this->assertSame(2.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_quarantine'));
        $this->assertSame(0, DB::table('inventory_movements')->where('ref_type', 'supplier_return')
            ->where('ref_id', $returnId)->whereIn('movement_type', ['supplier_return_out', 'supplier_replacement_in', 'write_off'])->count());
    }

    public function test_final_receipt_resynchronizes_low_stock_after_finishing_the_po(): void
    {
        $p = $this->product(['restock_quantity' => '5.000', 'unit_cost' => '2000.00']);
        $pr = $this->pr($this->cashier->id, [$p => ['10', '2000']], 'converted');
        DB::table('purchase_requisitions')->where('id', $pr)->update(['is_auto_generated' => 1]);
        $po = $this->po($pr, $this->supplier(), [$p => ['10', '2000']]);
        $item = $this->poItemId($po, $p);
        $this->setSetting('inventory_low_stock_threshold', '3.000');

        $this->postJson('/api/goods-receipts', [
            'po_id' => $po,
            'complete_po' => true,
            'items' => [['po_item_id' => $item, 'qty_short' => '9']],
        ])->assertCreated()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.items.0.qty_received', '1.000');

        $this->assertSame('received', DB::table('purchase_orders')->where('id', $po)->value('status'));
        $this->assertSame(1.0, $this->stock($p));

        $newDraft = DB::table('purchase_requisitions')
            ->where('store_id', $this->storeId())
            ->where('is_auto_generated', 1)
            ->where('status', 'draft')
            ->first();

        $this->assertNotNull($newDraft);
        $this->assertNotSame($pr, (int) $newDraft->id);
        $this->assertDatabaseHas('purchase_requisition_items', [
            'pr_id' => $newDraft->id,
            'product_id' => $p,
            'qty' => '5.000',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'purchase_requisition.auto_create',
            'entity_id' => $newDraft->id,
        ]);
    }

    public function test_existing_draft_receipt_can_be_posted_to_stock_by_its_owner(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item))
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->json('data.id');

        Sanctum::actingAs($this->makeUser('Kasir', 'kasir-posting-draft'), ['*']);
        $this->postJson("/api/goods-receipts/{$gr}/post")
            ->assertOk()
            ->assertJsonPath('data.status', 'posted');

        $this->assertSame(10.0, $this->stock($p));
        $this->getJson('/api/goods-receipts')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'posted');
    }

    public function test_a_po_cannot_receive_a_second_goods_receipt(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);

        $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '4'], ['post' => true]))
            ->assertCreated()->assertJsonPath('data.items.0.qty_short', '6.000');
        $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '1']))
            ->assertUnprocessable()->assertJsonValidationErrors(['po_id']);
        $this->assertSame(1, DB::table('goods_receipts')->where('po_id', $po)->whereNull('supplier_return_id')->count());
    }

    public function test_only_one_receipt_draft_can_exist_for_a_po(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);

        $one = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '8']))->assertCreated()->json('data.id');
        $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '8']))
            ->assertUnprocessable()->assertJsonValidationErrors(['po_id']);

        $this->postJson("/api/goods-receipts/{$one}/post")->assertOk();

        $this->assertSame('posted', DB::table('goods_receipts')->where('id', $one)->value('status'));
        $this->assertSame(8.0, $this->stock($p));
    }

    public function test_quarantined_damaged_goods_count_as_received_and_are_quarantined(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);

        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, [
            'qty_received' => '8',
            'qty_damaged' => '2',
            'damage_disposition' => 'quarantine',
        ]))
            ->assertCreated()
            ->assertJsonPath('data.items.0.qty_damaged', '2.000')
            ->json('data');
        $this->sendIncomingReturn($gr['id'], (int) DB::table('purchase_orders')->where('id', $po)->value('supplier_id'));
        $this->postJson("/api/goods-receipts/{$gr['id']}/post")
            ->assertOk()->assertJsonPath('data.items.0.qty_short', '0.000');

        $this->assertSame(8.0, $this->stock($p));
        $this->assertSame(2.0, (float) DB::table('inventory_balances')->where('product_id', $p)->sum('qty_quarantine'));
        $this->assertSame('received', DB::table('purchase_orders')->where('id', $po)->value('status'));
        $this->assertSame(10.0, (float) DB::table('purchase_order_items')->where('id', $item)->value('qty_received'));
        $this->assertSame(1, $this->notificationCount('goods_receipt.damaged', $this->seededAdmin()->id));
    }

    public function test_incoming_return_acceptance_receives_replacement_and_removes_quarantine_without_changing_po_receipt(): void
    {
        $productId = $this->product();
        [$poId, $poItemId] = $this->sentPo($productId);
        $receipt = $this->postJson('/api/goods-receipts', $this->receipt($poId, $poItemId, [
            'qty_received' => '8',
            'qty_damaged' => '2',
            'damage_disposition' => 'quarantine',
        ]))->assertCreated()->json('data');
        $returnId = $this->sendIncomingReturn($receipt['id'], (int) DB::table('purchase_orders')->where('id', $poId)->value('supplier_id'));

        $this->postJson("/api/goods-receipts/{$receipt['id']}/post")->assertOk();
        $receivedBeforeDecision = DB::table('purchase_order_items')->where('id', $poItemId)->value('qty_received');
        $returnItem = DB::table('supplier_return_items')->where('supplier_return_id', $returnId)->first();
        $this->assertNotNull($returnItem->batch_id);

        Sanctum::actingAs($this->seededAdmin(), ['*']);
        $this->postJson("/api/supplier-returns/{$returnId}/supplier-decision", [
            'decision' => 'accept',
        ])->assertOk()->assertJsonPath('data.status', 'replacement_received');

        $this->assertSame(10.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_sellable'));
        $this->assertSame(0.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_quarantine'));
        $this->assertSame($receivedBeforeDecision, DB::table('purchase_order_items')->where('id', $poItemId)->value('qty_received'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $productId,
            'movement_type' => 'supplier_replacement_in',
            'qty' => '2.000',
            'ref_type' => 'supplier_return',
            'ref_id' => $returnId,
        ]);
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $productId,
            'movement_type' => 'supplier_return_out',
            'from_bucket' => 'quarantine',
            'qty' => '2.000',
            'ref_id' => $returnId,
        ]);
    }

    public function test_incoming_return_rejection_records_hpp_loss_and_keeps_quarantine(): void
    {
        $productId = $this->product();
        [$poId, $poItemId] = $this->sentPo($productId);
        $receipt = $this->postJson('/api/goods-receipts', $this->receipt($poId, $poItemId, [
            'qty_received' => '8',
            'qty_damaged' => '2',
            'damage_disposition' => 'quarantine',
        ]))->assertCreated()->json('data');
        $returnId = $this->sendIncomingReturn($receipt['id'], (int) DB::table('purchase_orders')->where('id', $poId)->value('supplier_id'));

        $this->postJson("/api/goods-receipts/{$receipt['id']}/post")->assertOk();
        $returnItem = DB::table('supplier_return_items')->where('supplier_return_id', $returnId)->first();
        $expectedLoss = number_format(2 * (float) $returnItem->unit_cost, 2, '.', '');

        Sanctum::actingAs($this->seededAdmin(), ['*']);
        $this->postJson("/api/supplier-returns/{$returnId}/supplier-decision", [
            'decision' => 'reject',
            'note' => 'Supplier menolak klaim.',
        ])->assertOk()->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.loss_amount', $expectedLoss);

        $this->assertSame(2.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_quarantine'));
        $this->assertSame(0, DB::table('inventory_movements')->where('ref_type', 'supplier_return')
            ->where('ref_id', $returnId)->whereIn('movement_type', ['supplier_return_out', 'write_off'])->count());
        $this->assertSame(0, DB::table('inventory_movements')->where('ref_type', 'supplier_return')
            ->where('ref_id', $returnId)->where('movement_type', 'supplier_replacement_in')->count());
    }

    public function test_direct_return_acceptance_adds_replacement_to_stock(): void
    {
        $productId = $this->product();
        [$poId, $poItemId] = $this->sentPo($productId);
        $receipt = $this->postJson('/api/goods-receipts', $this->receipt($poId, $poItemId, [
            'qty_received' => '8',
            'qty_damaged' => '2',
            'damage_disposition' => 'direct_return',
        ]))->assertCreated()->json('data');
        $returnId = $this->sendIncomingReturn($receipt['id'], (int) DB::table('purchase_orders')->where('id', $poId)->value('supplier_id'));

        $this->postJson("/api/goods-receipts/{$receipt['id']}/post")->assertOk();
        Sanctum::actingAs($this->seededAdmin(), ['*']);
        $this->postJson("/api/supplier-returns/{$returnId}/supplier-decision", [
            'decision' => 'accept',
        ])->assertOk()->assertJsonPath('data.status', 'replacement_received');

        $this->assertSame(10.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_sellable'));
        $this->assertSame(0.0, (float) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_quarantine'));
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $productId,
            'movement_type' => 'supplier_replacement_in',
            'qty' => '2.000',
            'ref_id' => $returnId,
        ]);
    }

    public function test_gr_with_damaged_goods_cannot_be_posted_before_incoming_return_is_sent(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, [
            'qty_received' => '8',
            'qty_damaged' => '2',
            'damage_disposition' => 'quarantine',
        ]))->assertCreated()->json('data');

        $this->postJson("/api/goods-receipts/{$gr['id']}/post")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['items']);

        $this->assertSame(0.0, $this->stock($p));
        $this->assertSame('0.000', DB::table('inventory_balances')->where('product_id', $p)->value('qty_quarantine') ?? '0.000');
        $this->assertSame('0.000', DB::table('purchase_order_items')->where('id', $item)->value('qty_received'));
    }

    public function test_directly_returned_damaged_goods_do_not_count_toward_po_receipt(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);

        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, [
            'qty_received' => '8',
            'qty_damaged' => '2',
            'damage_disposition' => 'direct_return',
        ]))
            ->assertCreated()
            ->json('data');
        $this->sendIncomingReturn($gr['id'], (int) DB::table('purchase_orders')->where('id', $po)->value('supplier_id'));
        $this->postJson("/api/goods-receipts/{$gr['id']}/post")
            ->assertOk()->assertJsonPath('data.items.0.qty_short', '2.000');

        $this->assertSame(8.0, $this->stock($p));
        $this->assertSame('partially_received', DB::table('purchase_orders')->where('id', $po)->value('status'));
        $this->assertSame(8.0, (float) DB::table('purchase_order_items')->where('id', $item)->value('qty_received'));
        $this->assertSame(0.0, (float) DB::table('inventory_balances')->where('product_id', $p)->sum('qty_quarantine'));
    }

    public function test_expiry_rules(): void
    {
        $tracked = $this->product(['track_expiry' => 1]);
        $plain = $this->product();
        [$poT, $itemT] = $this->sentPo($tracked);
        [$poP, $itemP] = $this->sentPo($plain);

        $this->postJson('/api/goods-receipts', $this->receipt($poT, $itemT))
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.expiry_date']);
        $this->postJson('/api/goods-receipts', $this->receipt($poT, $itemT, ['expiry_date' => $this->today(-1)]))
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.expiry_date']);
        $this->postJson('/api/goods-receipts', $this->receipt($poP, $itemP, ['expiry_date' => $this->today(30)]))
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.expiry_date']);

        $expiry = $this->today(90);
        $this->postJson('/api/goods-receipts', $this->receipt($poT, $itemT, ['expiry_date' => $expiry, 'batch_code' => 'L9'], ['post' => true]))
            ->assertCreated()->assertJsonPath('data.items.0.expiry_date', $expiry);
        $this->assertSame($expiry, DB::table('product_batches')->where('product_id', $tracked)->value('expiry_date'));
        $this->assertSame(0, DB::table('goods_receipts')->where('po_id', $poP)->count());
    }

    public function test_unit_cost_defaults_to_po_price_and_only_verifier_may_override(): void
    {
        $p = $this->product();
        [$cashierPo, $cashierItem] = $this->sentPo($p);
        [$adminPo, $adminItem] = $this->sentPo($p);

        $this->postJson('/api/goods-receipts', $this->receipt($cashierPo, $cashierItem, ['unit_cost' => '2500'], ['complete_po' => true]))->assertForbidden();

        $this->actAsAdmin();
        $this->postJson('/api/goods-receipts', $this->receipt($cashierPo, $cashierItem, [], ['complete_po' => true]))
            ->assertCreated()->assertJsonPath('data.items.0.unit_cost', '2000.00');
        $this->postJson('/api/goods-receipts', $this->receipt($adminPo, $adminItem, ['unit_cost' => '2500'], ['complete_po' => true]))
            ->assertCreated()
            ->assertJsonPath('data.items.0.unit_cost', '2500.00')
            ->assertJsonPath('data.items.0.po_unit_price', '2000.00')
            ->assertJsonPath('data.items.0.price_variance', '500.00');

        $this->assertSame(2500.0, (float) DB::table('products')->where('id', $p)->value('unit_cost'));
    }

    public function test_warehouse_receipt_requires_enabled_active_location_and_supports_putaway_position(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        [$draftPo, $draftItem] = $this->sentPo($p, '10', '2000', 'draft');
        [$cancelledPo, $cancelledItem] = $this->sentPo($p, '10', '2000', 'cancelled');
        $warehouseId = (int) DB::table('locations')->where('store_id', $this->storeId())->where('type', 'warehouse')->value('id');

        $this->getJson('/api/goods-receipts/receiving-locations')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.type', 'store_floor');
        $this->postJson('/api/goods-receipts', $this->receipt($draftPo, $draftItem))->assertUnprocessable()->assertJsonValidationErrors(['po_id']);
        $this->postJson('/api/goods-receipts', $this->receipt($cancelledPo, $cancelledItem))->assertUnprocessable()->assertJsonValidationErrors(['po_id']);

        $warehouseReceipt = $this->receipt($po, $item, [], ['receiving_location_id' => $warehouseId, 'post' => true]);
        $this->postJson('/api/goods-receipts', $warehouseReceipt)->assertUnprocessable()->assertJsonValidationErrors(['receiving_location_id']);

        $this->setSetting('warehouse_enabled', true);
        $this->postJson('/api/goods-receipts', $warehouseReceipt)->assertUnprocessable()->assertJsonValidationErrors(['receiving_location_id']);
        $this->assertSame(0, DB::table('goods_receipts')->count());

        DB::table('locations')->where('id', $warehouseId)->update(['is_active' => 1]);
        $this->getJson('/api/goods-receipts/receiving-locations')
            ->assertOk()->assertJsonCount(2, 'data')->assertJsonFragment(['id' => $warehouseId, 'type' => 'warehouse', 'name' => 'Gudang']);
        $shelfId = DB::table('shelves')->insertGetId([
            'location_id' => $warehouseId,
            'code' => 'G-1',
            'name' => 'Rak Gudang 1',
        ]);
        $positionId = DB::table('shelf_positions')->insertGetId([
            'shelf_id' => $shelfId,
            'level' => 1,
            'slot' => 1,
        ]);
        $warehouseReceipt['items'][0]['shelf_position_id'] = $positionId;

        $response = $this->postJson('/api/goods-receipts', $warehouseReceipt)
            ->assertCreated()
            ->assertJsonPath('data.receiving_location_id', $warehouseId)
            ->assertJsonPath('data.receiving_location_name', 'Gudang')
            ->assertJsonPath('data.items.0.shelf_position_id', $positionId);

        $this->assertSame(10.0, $this->stock($p));
        $this->assertDatabaseHas('inventory_balances', [
            'product_id' => $p,
            'location_id' => $warehouseId,
            'shelf_position_id' => $positionId,
            'qty_sellable' => '10.000',
        ]);
        $this->assertDatabaseHas('inventory_movements', [
            'product_id' => $p,
            'to_location_id' => $warehouseId,
            'to_position_id' => $positionId,
            'movement_type' => 'receipt',
            'ref_type' => 'goods_receipt',
            'ref_id' => $response->json('data.id'),
        ]);
    }

    public function test_warehouse_draft_cannot_be_posted_after_warehouse_mode_is_disabled(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $warehouseId = (int) DB::table('locations')->where('store_id', $this->storeId())->where('type', 'warehouse')->value('id');
        DB::table('locations')->where('id', $warehouseId)->update(['is_active' => 1]);
        $this->setSetting('warehouse_enabled', true);

        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, [], ['receiving_location_id' => $warehouseId]))
            ->assertCreated()
            ->json('data.id');

        $this->setSetting('warehouse_enabled', false);
        $this->postJson("/api/goods-receipts/{$gr}/post")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['receiving_location_id']);

        $this->assertSame('draft', DB::table('goods_receipts')->where('id', $gr)->value('status'));
        $this->assertSame(0.0, $this->stock($p));
    }

    public function test_verify_documents_needs_permission_and_both_numbers(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '5'], ['post' => true]))->assertCreated()->json('data.id');

        $this->postJson("/api/goods-receipts/{$gr}/verify-documents", ['delivery_note_no' => 'SJ-1', 'invoice_no' => 'INV-1'])->assertForbidden();

        $admin = $this->actAsAdmin();
        $this->postJson("/api/goods-receipts/{$gr}/verify-documents")
            ->assertUnprocessable()->assertJsonValidationErrors(['delivery_note_no', 'invoice_no']);
        $this->postJson("/api/goods-receipts/{$gr}/verify-documents", ['delivery_note_no' => 'SJ-1', 'invoice_no' => 'INV-1'])
            ->assertOk()->assertJsonPath('data.document_status', 'verified')->assertJsonPath('data.verified_by', $admin->id);
        $this->postJson("/api/goods-receipts/{$gr}/verify-documents", ['delivery_note_no' => 'SJ-1', 'invoice_no' => 'INV-1'])
            ->assertUnprocessable()->assertJsonValidationErrors(['document_status']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'goods_receipt.verify_documents', 'entity_id' => $gr]);
    }

    public function test_goods_receipt_attachments_are_private_audited_and_available_in_detail(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, [], ['post' => true]))
            ->assertCreated()->json('data.id');

        $response = $this->post("/api/goods-receipts/{$gr}/attachments", [
            'file' => UploadedFile::fake()->image('SJ 001.jpg')->size(80),
        ])->assertCreated()
            ->assertJsonPath('data.original_name', 'SJ 001.jpg')
            ->assertJsonPath('data.mime_type', 'image/jpeg')
            ->assertJsonPath('data.uploaded_by_name', $this->cashier->name);

        $attachmentId = $response->json('data.id');
        $attachment = DB::table('attachments')->where('id', $attachmentId)->first();

        $this->assertSame('goods_receipt', $attachment->entity_type);
        $this->assertSame($gr, (int) $attachment->entity_id);
        Storage::disk('local')->assertExists($attachment->file_path);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'goods_receipt.attach',
            'entity_id' => $gr,
            'actor_id' => $this->cashier->id,
        ]);

        $this->getJson("/api/goods-receipts/{$gr}")
            ->assertOk()
            ->assertJsonPath('data.attachments.0.id', $attachmentId)
            ->assertJsonMissingPath('data.attachments.0.file_path');

        $this->get("/api/goods-receipts/{$gr}/attachments/{$attachmentId}")
            ->assertOk()
            ->assertHeader('content-type', 'image/jpeg')
            ->assertHeader('x-content-type-options', 'nosniff')
            ->assertHeader('content-disposition');
    }

    public function test_only_receipt_owner_or_document_verifier_can_access_attachments(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item))
            ->assertCreated()->json('data.id');
        $attachmentId = $this->post("/api/goods-receipts/{$gr}/attachments", [
            'file' => UploadedFile::fake()->image('surat-jalan.png'),
        ])->assertCreated()->json('data.id');

        Sanctum::actingAs($this->makeUser('Kasir', 'kasir-lain'), ['*']);
        $this->post("/api/goods-receipts/{$gr}/attachments", [
            'file' => UploadedFile::fake()->image('salinan.png'),
        ])->assertForbidden();
        $this->get("/api/goods-receipts/{$gr}/attachments/{$attachmentId}")->assertNotFound();

        $this->actAsAdmin();
        $this->get("/api/goods-receipts/{$gr}/attachments/{$attachmentId}")->assertOk();
    }

    public function test_attachment_upload_validates_file_type_and_size(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $gr = $this->postJson('/api/goods-receipts', $this->receipt($po, $item))
            ->assertCreated()->json('data.id');

        $this->post("/api/goods-receipts/{$gr}/attachments", [
            'file' => UploadedFile::fake()->create('payload.txt', 10, 'text/plain'),
        ])->assertUnprocessable()->assertJsonValidationErrors(['file']);

        $this->post("/api/goods-receipts/{$gr}/attachments", [
            'file' => UploadedFile::fake()->create('large.pdf', 10241, 'application/pdf'),
        ])->assertUnprocessable()->assertJsonValidationErrors(['file']);

        $this->assertSame(0, DB::table('attachments')->where('entity_type', 'goods_receipt')->where('entity_id', $gr)->count());
    }

    public function test_attachments_cannot_be_added_to_cancelled_or_verified_receipts(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $draft = $this->postJson('/api/goods-receipts', $this->receipt($po, $item))
            ->assertCreated()->json('data.id');

        $this->postJson("/api/goods-receipts/{$draft}/cancel")->assertOk();
        $this->post("/api/goods-receipts/{$draft}/attachments", [
            'file' => UploadedFile::fake()->image('cancelled.jpg'),
        ])->assertUnprocessable()->assertJsonValidationErrors(['status']);

        $posted = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, [], ['post' => true]))
            ->assertCreated()->json('data.id');

        $this->actAsAdmin();
        $this->postJson("/api/goods-receipts/{$posted}/verify-documents", [
            'delivery_note_no' => 'SJ-1',
            'invoice_no' => 'INV-1',
        ])->assertOk();

        $this->post("/api/goods-receipts/{$posted}/attachments", [
            'file' => UploadedFile::fake()->image('verified.jpg'),
        ])->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_cancel_only_drafts_and_only_by_owner_of_the_receipt(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $draft = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '3']))->assertCreated()->json('data.id');

        Sanctum::actingAs($this->makeUser('Kasir', 'kasir-lain'), ['*']);
        $this->postJson("/api/goods-receipts/{$draft}/cancel")->assertForbidden();
        $this->getJson('/api/goods-receipts')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $draft);
        $this->getJson("/api/goods-receipts/{$draft}")
            ->assertOk()
            ->assertJsonPath('data.id', $draft)
            ->assertJsonPath('data.received_by', $this->cashier->id);

        Sanctum::actingAs($this->cashier, ['*']);
        $this->postJson("/api/goods-receipts/{$draft}/cancel", ['reason' => 'salah hitung'])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->postJson("/api/goods-receipts/{$draft}/post")->assertUnprocessable()->assertJsonValidationErrors(['status']);

        $posted = $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '3'], ['post' => true]))->assertCreated()->json('data.id');
        $this->postJson("/api/goods-receipts/{$posted}/cancel")->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_close_po_after_partial_receipt_and_cancel_is_blocked_after_receipt(): void
    {
        $p = $this->product();
        [$po, $item] = $this->sentPo($p);
        $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '4'], ['post' => true]))->assertCreated();

        $this->actAsAdmin();
        $this->postJson("/api/purchase-orders/{$po}/cancel", ['reason' => 'batal'])->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->postJson("/api/purchase-orders/{$po}/close")->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $this->postJson("/api/purchase-orders/{$po}/close", ['reason' => 'Supplier tidak bisa kirim sisanya'])
            ->assertOk()->assertJsonPath('data.status', 'received')->assertJsonPath('data.receipt_status', 'partial');
        $this->assertDatabaseHas('audit_logs', ['action' => 'purchase_order.close', 'entity_id' => $po]);

        Sanctum::actingAs($this->cashier, ['*']);
        $this->postJson('/api/goods-receipts', $this->receipt($po, $item, ['qty_received' => '1']))
            ->assertUnprocessable()->assertJsonValidationErrors(['po_id']);
    }

    public function test_end_to_end_pr_to_stock_through_the_api(): void
    {
        $p = $this->product();
        $supplier = $this->supplier();
        DB::table('product_suppliers')->insert([
            'product_id' => $p,
            'supplier_id' => $supplier,
        ]);

        // Purchasing membuat PR manual
        $this->actAsAdmin();
        $pr = $this->postJson('/api/purchase-requisitions', ['reason' => 'Stok habis', 'items' => [['product_id' => $p, 'qty' => '12', 'est_price' => '2500']]])
            ->assertCreated()->json('data.id');
        $this->postJson("/api/purchase-requisitions/{$pr}/submit")->assertOk();

        // Admin memeriksa, menyetujui, membuat PO, mengirim
        $this->actAsAdmin();
        $this->postJson("/api/purchase-requisitions/{$pr}/finance-check", ['decision' => 'pass'])->assertOk();
        $bank = $this->postJson('/api/settings/bank-accounts', [
            'bank_name' => 'Bank Uji',
            'account_name' => 'POS Retail',
            'account_number' => '1234567890',
        ])->assertCreated()->json('data.id');
        $po = $this->postJson('/api/purchase-orders', [
            'pr_id' => $pr, 'supplier_id' => $supplier, 'bank_account_id' => $bank,
            ...$this->adminCreds(),
            'items' => [['product_id' => $p, 'qty_ordered' => '12', 'unit_price' => '2400']],
        ])->assertCreated()->json('data.id');
        $this->postJson("/api/purchase-orders/{$po}/send")->assertOk()->assertJsonPath('data.status', 'sent');

        // Kasir menerima barang
        Sanctum::actingAs($this->cashier, ['*']);
        $poItem = $this->getJson("/api/purchase-orders/{$po}")->assertOk()->json('data.items.0.id');
        $this->postJson('/api/goods-receipts', [
            'po_id' => $po, 'delivery_note_no' => 'SJ-77', 'post' => true,
            'items' => [['po_item_id' => $poItem, 'qty_received' => '12']],
        ])->assertCreated();

        $this->assertSame(12.0, $this->stock($p));
        $this->assertSame('received', DB::table('purchase_orders')->where('id', $po)->value('status'));
        $this->assertSame('converted', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));
        $this->actAsAdmin();
        $this->getJson("/api/purchase-requisitions/{$pr}")->assertOk()->assertJsonPath('data.purchase_orders.0.status', 'received');
    }
}
