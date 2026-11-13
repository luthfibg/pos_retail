<?php

namespace Tests\Feature;

use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class InventoryFifoMonitoringTest extends SeededTestCase
{
    use BuildsPurchasing;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = $this->makeUser('Kasir', 'kasir-fifo');
        Sanctum::actingAs($this->cashier, ['*']);
    }

    public function test_fifo_type_uses_calendar_months_and_oldest_active_receipt_batch(): void
    {
        $today = Carbon::now('Asia/Jakarta')->startOfDay();
        $fast = $this->product();
        $normalAtOneMonth = $this->product();
        $normalAtTwoMonths = $this->product();
        $slow = $this->product();
        $mixedBatches = $this->product();

        $this->setReceiptDate($this->receiveBatch($fast), $today->copy()->subMonthNoOverflow()->addDay());
        $this->setReceiptDate($this->receiveBatch($normalAtOneMonth), $today->copy()->subMonthNoOverflow());
        $this->setReceiptDate($this->receiveBatch($normalAtTwoMonths), $today->copy()->subMonthsNoOverflow(2));
        $this->setReceiptDate($this->receiveBatch($slow), $today->copy()->subMonthsNoOverflow(2)->subDay());
        $this->setReceiptDate($this->receiveBatch($mixedBatches), $today->copy()->subMonthsNoOverflow(2)->subDay());
        $this->setReceiptDate($this->receiveBatch($mixedBatches), $today->copy()->subDays(5));

        $response = $this->getJson('/api/inventory/fifo-monitoring?'.http_build_query([
            'product_ids' => [$fast, $normalAtOneMonth, $normalAtTwoMonths, $slow, $mixedBatches],
        ]))->assertOk();

        $types = collect($response->json('data.products'))->keyBy('product_id');
        $this->assertSame('fast_moving', $types[$fast]['fifo_type']);
        $this->assertSame('normal', $types[$normalAtOneMonth]['fifo_type']);
        $this->assertSame('normal', $types[$normalAtTwoMonths]['fifo_type']);
        $this->assertSame('slow_moving', $types[$slow]['fifo_type']);
        $this->assertSame('slow_moving', $types[$mixedBatches]['fifo_type']);
    }

    public function test_fifo_monitoring_distinguishes_empty_from_untraceable_stock(): void
    {
        $this->signIn('Admin');
        $empty = $this->product();
        $openingBalance = $this->product();

        $this->postJson('/api/inventory/opening-balances', [
            'items' => [['product_id' => $openingBalance, 'qty' => '5']],
        ])->assertCreated();

        $this->getJson('/api/inventory/fifo-monitoring?'.http_build_query([
            'product_ids' => [$empty, $openingBalance],
        ]))->assertOk()
            ->assertJsonPath('data.products.0.product_id', $empty)
            ->assertJsonPath('data.products.0.fifo_type', 'no_stock')
            ->assertJsonPath('data.products.1.product_id', $openingBalance)
            ->assertJsonPath('data.products.1.fifo_type', 'unclassified');
    }

    private function receiveBatch(int $productId): int
    {
        $qty = '10';
        $pr = $this->pr($this->cashier->id, [$productId => [$qty, '2000.00']], 'converted');
        $po = $this->po($pr, $this->supplier(), [$productId => [$qty, '2000.00']]);
        $poItem = $this->poItemId($po, $productId);

        $receipt = $this->postJson('/api/goods-receipts', [
            'po_id' => $po,
            'post' => true,
            'items' => [['po_item_id' => $poItem, 'qty_received' => $qty]],
        ])->assertCreated();

        $goodsReceiptItemId = (int) $receipt->json('data.items.0.id');

        return (int) DB::table('product_batches')->where('goods_receipt_item_id', $goodsReceiptItemId)->value('id');
    }

    private function setReceiptDate(int $batchId, Carbon $receivedAt): void
    {
        DB::table('product_batches')->where('id', $batchId)->update([
            'received_at' => $receivedAt->copy()->setTimezone('UTC')->format('Y-m-d H:i:s'),
        ]);
    }
}
