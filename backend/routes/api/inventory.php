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

    // Stok awal: permission khusus inventory.opening_balance, diberikan lewat matriks kewenangan stok (settings/stock-authority).
    Route::post('opening-balances', [InventoryController::class, 'openingBalance'])
        ->middleware('can:inventory.opening_balance');

    // Adjustment langsung; stok dicatat segera dan setiap dokumen dapat dibuka kembali.
    Route::get('adjustments/meta', [StockAdjustmentController::class, 'meta']);
    Route::get('adjustments', [StockAdjustmentController::class, 'index']);
    Route::post('adjustments', [StockAdjustmentController::class, 'store']);
    Route::get('adjustments/{adjustment}', [StockAdjustmentController::class, 'show'])
        ->whereNumber('adjustment');

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
