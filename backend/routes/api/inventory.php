<?php

use App\Http\Controllers\InventoryController;
use App\Http\Controllers\StockAdjustmentController;
use App\Http\Controllers\StockTransferController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang).
Route::middleware('auth:sanctum')->prefix('inventory')->group(function () {
    Route::get('products/{product}/stock', [InventoryController::class, 'productStock'])
        ->whereNumber('product')->middleware('can:inventory.view');

    Route::get('movements', [InventoryController::class, 'movements'])->middleware('can:inventory.view');

    // Stok awal: hanya Admin. Memakai inventory.adjust.approve (belum ada permission khusus) [ASUMSI].
    Route::post('opening-balances', [InventoryController::class, 'openingBalance'])
        ->middleware('can:inventory.adjust.approve');

    // Adjustment dan opname; perubahan saldo terjadi setelah persetujuan.
    Route::get('adjustments', [StockAdjustmentController::class, 'index']);
    Route::post('adjustments', [StockAdjustmentController::class, 'store'])
        ->middleware('can:inventory.adjust.request');
    Route::get('adjustments/{adjustment}', [StockAdjustmentController::class, 'show'])
        ->whereNumber('adjustment');
    Route::post('adjustments/{adjustment}/request', [StockAdjustmentController::class, 'request'])
        ->whereNumber('adjustment')->middleware('can:inventory.adjust.request');
    Route::post('adjustments/{adjustment}/approve', [StockAdjustmentController::class, 'approve'])
        ->whereNumber('adjustment')->middleware('can:inventory.adjust.approve');
    Route::post('adjustments/{adjustment}/cancel', [StockAdjustmentController::class, 'cancel'])
        ->whereNumber('adjustment')->middleware('can:inventory.adjust.request');

    // Transfer stok; sumber/tujuan tervalidasi per toko dan stok berpindah saat posting.
    Route::get('transfers', [StockTransferController::class, 'index'])->middleware('can:stock_transfer.create');
    Route::post('transfers', [StockTransferController::class, 'store'])->middleware('can:stock_transfer.create');
    Route::get('transfers/{transfer}', [StockTransferController::class, 'show'])
        ->whereNumber('transfer')->middleware('can:stock_transfer.create');
    Route::post('transfers/{transfer}/post', [StockTransferController::class, 'post'])
        ->whereNumber('transfer')->middleware('can:stock_transfer.create');
    Route::post('transfers/{transfer}/cancel', [StockTransferController::class, 'cancel'])
        ->whereNumber('transfer')->middleware('can:stock_transfer.create');
});
