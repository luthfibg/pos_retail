<?php

namespace Tests\Feature;

use App\Exceptions\StockLockedByOpnameException;
use App\Services\InventoryService;
use App\Services\StockAdjustmentService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class OpnameLockTest extends SeededTestCase
{
    use BuildsPurchasing;

    private function category(string $name): int
    {
        return DB::table('categories')->insertGetId([
            'store_id' => $this->storeId(),
            'name' => $name,
            'is_active' => 1,
        ]);
    }

    private function start(string $scope, array $categoryIds = []): int
    {
        return (int) $this->postJson('/api/stock-opname-sessions', [
            'scope_type' => $scope,
            ...($scope === 'categories' ? ['category_ids' => $categoryIds] : []),
            'client_request_id' => fake()->uuid(),
        ])->assertCreated()->json('data.id');
    }

    private function receive(int $productId): void
    {
        DB::transaction(fn () => app(InventoryService::class)->receive(
            $this->storeId(), $productId, '1.000', '1000.0000', null, null, null, 'goods_receipt', 99, null,
        ));
    }

    public function test_category_session_locks_only_products_in_scope_and_cancel_releases_lock(): void
    {
        $this->actAsAdmin();
        $lockedCategory = $this->category('Kategori dikunci');
        $openCategory = $this->category('Kategori terbuka');
        $lockedProduct = $this->product(['category_id' => $lockedCategory]);
        $openProduct = $this->product(['category_id' => $openCategory]);
        $sessionId = $this->start('categories', [$lockedCategory]);

        try {
            $this->receive($lockedProduct);
            $this->fail('Produk dalam cakupan opname seharusnya terkunci.');
        } catch (StockLockedByOpnameException $exception) {
            $this->assertSame($lockedProduct, $exception->lockedProducts[0]['product_id']);
            $this->assertSame(DB::table('stock_opname_sessions')->where('id', $sessionId)->value('number'), $exception->lockedProducts[0]['session_number']);
            $this->assertArrayNotHasKey('stock', $exception->lockedProducts[0]);
        }

        $this->receive($openProduct);
        $this->assertSame(0, (int) DB::table('inventory_balances')->where('product_id', $lockedProduct)->count());
        $this->assertSame('1.000', DB::table('inventory_balances')->where('product_id', $openProduct)->value('qty_sellable'));

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/cancel", ['reason' => 'Tes kunci'])
            ->assertOk();
        $this->receive($lockedProduct);
        $this->assertSame('1.000', DB::table('inventory_balances')->where('product_id', $lockedProduct)->value('qty_sellable'));
    }

    public function test_store_wide_lock_includes_products_created_after_session_start_and_reports_409(): void
    {
        $this->actAsAdmin();
        $this->product();
        $sessionId = $this->start('all');
        $newProduct = $this->product();

        try {
            $this->receive($newProduct);
            $this->fail('Produk baru juga harus terkunci selama opname seluruh toko.');
        } catch (StockLockedByOpnameException $exception) {
            $this->assertSame($newProduct, $exception->lockedProducts[0]['product_id']);
        }

        $this->postJson("/api/stock-opname-sessions/{$sessionId}/cancel", ['reason' => 'Tes kunci'])
            ->assertOk();
    }

    public function test_pending_approval_keeps_the_lock_and_posted_session_releases_it(): void
    {
        $this->actAsAdmin();
        $productId = $this->product();
        $sessionId = $this->start('all');

        DB::table('stock_opname_sessions')->where('id', $sessionId)->update(['status' => 'pending_approval']);
        try {
            $this->receive($productId);
            $this->fail('Sesi yang menunggu persetujuan harus tetap mengunci stok.');
        } catch (StockLockedByOpnameException $exception) {
            $this->assertSame($productId, $exception->lockedProducts[0]['product_id']);
        }

        DB::table('stock_opname_sessions')->where('id', $sessionId)->update(['status' => 'posted']);
        $this->receive($productId);
        $this->assertSame('1.000', DB::table('inventory_balances')->where('product_id', $productId)->value('qty_sellable'));
    }

    public function test_multi_product_stock_mutation_is_rejected_atomically_when_one_product_is_locked(): void
    {
        $this->actAsAdmin();
        $category = $this->category('Cakupan terkunci');
        $lockedProduct = $this->product(['category_id' => $category]);
        $openProduct = $this->product();
        $this->start('categories', [$category]);
        $inventory = app(InventoryService::class);
        $callbackCalled = false;

        try {
            DB::transaction(function () use ($inventory, $lockedProduct, $openProduct, &$callbackCalled): void {
                $inventory->withUnlockedProducts(
                    $this->storeId(),
                    [$openProduct, $lockedProduct],
                    function () use ($inventory, $lockedProduct, $openProduct, &$callbackCalled): void {
                        $callbackCalled = true;
                        $inventory->receive($this->storeId(), $lockedProduct, '1.000', '1000.0000', null, null, null, 'goods_receipt', 99, null);
                        $inventory->receive($this->storeId(), $openProduct, '1.000', '1000.0000', null, null, null, 'goods_receipt', 99, null);
                    },
                );
            });
            $this->fail('Semua baris transaksi harus ditolak bila salah satu produk terkunci.');
        } catch (StockLockedByOpnameException $exception) {
            $this->assertSame([$lockedProduct], array_column($exception->lockedProducts, 'product_id'));
        }

        $this->assertFalse($callbackCalled);
        $this->assertSame(0, DB::table('inventory_balances')->whereIn('product_id', [$lockedProduct, $openProduct])->count());
        $this->assertSame(0, DB::table('inventory_movements')->whereIn('product_id', [$lockedProduct, $openProduct])->count());
    }

    public function test_opname_adjustment_reference_bypasses_only_the_matching_active_session_item(): void
    {
        $admin = $this->actAsAdmin();
        $firstCategory = $this->category('Sesi opname satu');
        $secondCategory = $this->category('Sesi opname dua');
        $firstProduct = $this->product(['category_id' => $firstCategory]);
        $secondProduct = $this->product(['category_id' => $secondCategory]);
        $firstSession = $this->start('categories', [$firstCategory]);
        $secondSession = $this->start('categories', [$secondCategory]);
        $adjustments = app(StockAdjustmentService::class);
        $input = ['type' => 'increase', 'quantity' => 1, 'reason_code' => 'opname_result'];

        $adjustments->record(
            $admin,
            $this->storeId(),
            $input + ['product_id' => $firstProduct],
            'opname',
            $firstSession,
        );
        $this->assertSame('1.000', DB::table('inventory_balances')->where('product_id', $firstProduct)->value('qty_sellable'));

        try {
            $adjustments->record(
                $admin,
                $this->storeId(),
                $input + ['product_id' => $secondProduct],
                'opname',
                $firstSession,
            );
            $this->fail('Referensi sesi yang salah tidak boleh membuka kunci produk sesi lain.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('opname_session_id', $exception->errors());
        }

        $this->assertSame(0, DB::table('inventory_balances')->where('product_id', $secondProduct)->count());

        DB::table('stock_opname_sessions')->where('id', $firstSession)->update(['status' => 'posted']);
        try {
            $adjustments->record(
                $admin,
                $this->storeId(),
                $input + ['product_id' => $firstProduct],
                'opname',
                $firstSession,
            );
            $this->fail('Referensi sesi yang sudah ditutup tidak boleh membuka kunci stok.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('opname_session_id', $exception->errors());
        }
        $this->assertSame('1.000', DB::table('inventory_balances')->where('product_id', $firstProduct)->value('qty_sellable'));
    }
}
