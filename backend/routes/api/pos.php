<?php

use App\Http\Controllers\SaleController;
use App\Http\Controllers\ShiftController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang).
Route::middleware('auth:sanctum')->group(function () {
    // Shift kasir. Kasir hanya mengelola shift sendiri (dicek di service); Admin (shift.review) boleh semua.
    Route::get('shifts', [ShiftController::class, 'index'])->middleware('can:shift.review');
    Route::get('shifts/current', [ShiftController::class, 'current'])->middleware('can:shift.open');
    Route::post('shifts/open', [ShiftController::class, 'open'])->middleware('can:shift.open');
    Route::get('shifts/{shift}', [ShiftController::class, 'show'])->whereNumber('shift')->middleware('can:shift.open');
    Route::post('shifts/{shift}/start-count', [ShiftController::class, 'startCount'])->whereNumber('shift')->middleware('can:shift.close');
    Route::post('shifts/{shift}/close', [ShiftController::class, 'close'])->whereNumber('shift')->middleware('can:shift.close');
    Route::post('shifts/{shift}/review', [ShiftController::class, 'review'])->whereNumber('shift')->middleware('can:shift.review');

    // Penjualan. Kasir hanya melihat struknya sendiri; Admin (shift.review) melihat semua.
    Route::post('sales', [SaleController::class, 'store'])->middleware('can:sales.create');
    Route::get('sales', [SaleController::class, 'index'])->middleware('can:sales.create');
    Route::get('sales/{sale}', [SaleController::class, 'show'])->whereNumber('sale')->middleware('can:sales.create');
    Route::post('sales/{sale}/reprint', [SaleController::class, 'reprint'])->whereNumber('sale')->middleware('can:receipt.reprint');
});
