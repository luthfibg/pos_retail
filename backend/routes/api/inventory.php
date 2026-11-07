<?php

use App\Http\Controllers\InventoryController;
use App\Http\Controllers\OpnameDisplaySettingController;
use App\Http\Controllers\OpnameSessionController;
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

Route::middleware('auth:sanctum')->group(function () {
    Route::get('settings/opname', [OpnameDisplaySettingController::class, 'show'])->middleware('can:opname.settings.manage');
    Route::put('settings/opname', [OpnameDisplaySettingController::class, 'update'])->middleware('can:opname.settings.manage');
    Route::get('stock-opname-sessions', [OpnameSessionController::class, 'index'])->middleware('can:opname.view');
    Route::get('stock-opname-sessions/{session}', [OpnameSessionController::class, 'show'])
        ->whereNumber('session')->middleware('can:opname.view');
    Route::get('stock-opname-sessions/{session}/tree', [OpnameSessionController::class, 'tree'])
        ->whereNumber('session')->middleware('can:opname.view');
    Route::get('stock-opname-sessions/{session}/items', [OpnameSessionController::class, 'items'])
        ->whereNumber('session')->middleware('can:opname.view');
    Route::post('stock-opname-sessions', [OpnameSessionController::class, 'store'])->middleware('can:opname.create');
    Route::post('stock-opname-sessions/{session}/cancel', [OpnameSessionController::class, 'cancel'])
        ->whereNumber('session')->middleware('can:opname.cancel');
    Route::get('stock-opname/scope-options', [OpnameSessionController::class, 'scopeOptions'])->middleware('can:opname.view');
});
