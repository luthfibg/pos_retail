<?php

namespace Tests\Feature;

use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;
use Tests\SeededTestCase;

class InventoryServiceTest extends SeededTestCase
{
    private InventoryService $inventory;

    protected function setUp(): void
    {
        parent::setUp();
        $this->inventory = app(InventoryService::class);
    }

    private function makeProduct(bool $trackExpiry = false): int
    {
        static $n = 0;
        $n++;

        return DB::table('products')->insertGetId([
            'store_id' => $this->storeId(),
            'sku' => "IS-{$n}",
            'barcode' => sprintf('89970000%05d', $n),
            'name' => "Produk IS {$n}",
            'sell_price' => 5000,
            'status' => 'active',
            'track_expiry' => $trackExpiry ? 1 : 0,
        ]);
    }

    private function receive(int $productId, string $qty, string $cost, ?string $expiry = null, ?string $code = null): array
    {
        return DB::transaction(fn () => $this->inventory->receive(
            $this->storeId(), $productId, $qty, $cost, $expiry, $code, null, 'goods_receipt', 1, null,
        ));
    }

    private function sell(int $productId, string $qty): array
    {
        return DB::transaction(fn () => $this->inventory->sell($this->storeId(), $productId, $qty, 'sale', 10, null));
    }

    private function sellable(int $productId): string
    {
        return (string) DB::table('inventory_balances')->where('product_id', $productId)->sum('qty_sellable');
    }

    public function test_fefo_takes_earliest_expiry_first_then_undated_last(): void
    {
        $p = $this->makeProduct(true);
        $d = fn (int $days) => now('Asia/Jakarta')->addDays($days)->toDateString();

        $late = $this->receive($p, '5', '1000', $d(90), 'LATE');
        $soon = $this->receive($p, '5', '1000', $d(10), 'SOON');
        $mid = $this->receive($p, '5', '1000', $d(30), 'MID');

        $allocations = $this->sell($p, '7');

        $this->assertCount(2, $allocations);
        $this->assertSame($soon['batch_id'], $allocations[0]['batch_id']);
        $this->assertSame('5.000', $allocations[0]['qty']);
        $this->assertSame($mid['batch_id'], $allocations[1]['batch_id']);
        $this->assertSame('2.000', $allocations[1]['qty']);

        $this->assertSame('8.000', number_format((float) $this->sellable($p), 3, '.', ''));
        $this->assertSame(2, DB::table('inventory_movements')->where('movement_type', 'sale')->count());
        $this->assertDatabaseHas('inventory_balances', ['batch_id' => $late['batch_id'], 'qty_sellable' => '5.000']);
    }

    public function test_undated_batches_follow_receive_order_after_dated_ones(): void
    {
        $p = $this->makeProduct();
        $first = $this->receive($p, '3', '1000');
        $second = $this->receive($p, '3', '1000');
        $dated = $this->receive($p, '3', '1000', now('Asia/Jakarta')->addDays(400)->toDateString());

        $allocations = $this->sell($p, '8');

        $this->assertSame([$dated['batch_id'], $first['batch_id'], $second['batch_id']], array_column($allocations, 'batch_id'));
    }

    public function test_expired_batches_are_not_sold(): void
    {
        $p = $this->makeProduct(true);
        $this->receive($p, '5', '1000', now('Asia/Jakarta')->subDay()->toDateString(), 'OLD');

        try {
            $this->sell($p, '1');
            $this->fail('Penjualan dari batch kadaluarsa seharusnya ditolak.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('qty', $e->errors());
        }

        $this->assertSame('5.000', number_format((float) $this->sellable($p), 3, '.', ''));
    }

    public function test_negative_stock_is_blocked_and_nothing_changes(): void
    {
        $p = $this->makeProduct();
        $this->receive($p, '2', '1000');
        $movementsBefore = DB::table('inventory_movements')->count();

        try {
            $this->sell($p, '2.001');
            $this->fail('Stok negatif seharusnya ditolak.');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('tidak mencukupi', $e->errors()['qty'][0]);
        }

        $this->assertSame($movementsBefore, DB::table('inventory_movements')->count());
        $this->assertSame('2.000', number_format((float) $this->sellable($p), 3, '.', ''));
    }

    public function test_sale_failure_inside_caller_transaction_rolls_back_earlier_lines(): void
    {
        $a = $this->makeProduct();
        $b = $this->makeProduct();
        $this->receive($a, '5', '1000');
        $this->receive($b, '1', '1000');

        try {
            DB::transaction(function () use ($a, $b) {
                $this->inventory->sell($this->storeId(), $a, '3', 'sale', 11, null);
                $this->inventory->sell($this->storeId(), $b, '5', 'sale', 11, null); // gagal
            });
            $this->fail('Transaksi seharusnya gagal.');
        } catch (ValidationException) {
            // diharapkan
        }

        $this->assertSame('5.000', number_format((float) $this->sellable($a), 3, '.', ''));
    }

    public function test_void_sale_restores_each_batch(): void
    {
        $p = $this->makeProduct(true);
        $d = fn (int $days) => now('Asia/Jakarta')->addDays($days)->toDateString();
        $x = $this->receive($p, '2', '1000', $d(5));
        $y = $this->receive($p, '4', '1000', $d(20));

        $allocations = $this->sell($p, '5');
        DB::transaction(fn () => $this->inventory->voidSale($this->storeId(), $allocations, 'sale', 10, null));

        $this->assertDatabaseHas('inventory_balances', ['batch_id' => $x['batch_id'], 'qty_sellable' => '2.000']);
        $this->assertDatabaseHas('inventory_balances', ['batch_id' => $y['batch_id'], 'qty_sellable' => '4.000']);
        $this->assertSame(2, DB::table('inventory_movements')->where('movement_type', 'sale_void')->count());
    }

    public function test_moving_average_cost_and_last_cost(): void
    {
        $p = $this->makeProduct();

        $this->receive($p, '10', '1000');
        $this->assertSame('1000.0000', DB::table('products')->where('id', $p)->value('avg_cost'));

        $this->receive($p, '30', '2000');   // (10x1000 + 30x2000) / 40 = 1750
        $this->assertSame('1750.0000', DB::table('products')->where('id', $p)->value('avg_cost'));
        $this->assertSame('2000.00', DB::table('products')->where('id', $p)->value('last_cost'));

        // penjualan tidak mengubah HPP, dan snapshot biaya ikut alokasi
        $allocations = $this->sell($p, '5');
        $this->assertSame('1750.0000', $allocations[0]['unit_cost']);
        $this->assertSame('1750.0000', DB::table('products')->where('id', $p)->value('avg_cost'));
    }

    public function test_receive_requires_expiry_for_tracked_products(): void
    {
        $p = $this->makeProduct(true);

        $this->expectException(ValidationException::class);
        $this->receive($p, '5', '1000', null);
    }

    public function test_stock_operations_refuse_to_run_outside_a_transaction(): void
    {
        // RefreshDatabase membungkus test dalam transaksi; keluarkan sementara untuk menguji penjagaan.
        $storeId = $this->storeId();

        while (DB::transactionLevel() > 0) {
            DB::rollBack();
        }

        try {
            $this->inventory->sell($storeId, 1, '1', 'sale', 1, null);
            $this->fail('Seharusnya melempar LogicException.');
        } catch (LogicException $e) {
            $this->assertStringContainsString('DB::transaction', $e->getMessage());
        } finally {
            DB::beginTransaction(); // pulihkan agar teardown framework tetap konsisten
        }
    }

    public function test_balance_always_equals_sum_of_movements(): void
    {
        $p = $this->makeProduct();
        $this->receive($p, '10', '1000');
        $this->receive($p, '5', '1500');
        $allocations = $this->sell($p, '7');
        DB::transaction(fn () => $this->inventory->voidSale($this->storeId(), [$allocations[0]], 'sale', 10, null));

        $in = (float) DB::table('inventory_movements')->where('product_id', $p)->whereNotNull('to_bucket')->sum('qty');
        $out = (float) DB::table('inventory_movements')->where('product_id', $p)->whereNotNull('from_bucket')->sum('qty');

        $this->assertEqualsWithDelta($in - $out, (float) $this->sellable($p), 0.0001);
    }
}
