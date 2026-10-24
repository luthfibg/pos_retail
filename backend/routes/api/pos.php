<?php

use App\Http\Controllers\CashDepositController;
use App\Http\Controllers\FloatPolicyController;
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
    Route::post('sales/{sale}/void', [SaleController::class, 'void'])->whereNumber('sale')->middleware('can:sales.void');

    // Setoran kasir (Kas Kecil -> Kas Besar) dan kebijakan endapan
    Route::post('shifts/{shift}/deposits', [CashDepositController::class, 'storePartial'])->whereNumber('shift')->middleware('can:cash_deposit.create');
    Route::get('cash-deposits', [CashDepositController::class, 'index'])->middleware('can:cash_deposit.create');
    Route::get('cash-deposits/{deposit}', [CashDepositController::class, 'show'])->whereNumber('deposit')->middleware('can:cash_deposit.create');
    Route::post('cash-deposits/{deposit}/submit', [CashDepositController::class, 'submit'])->whereNumber('deposit')->middleware('can:cash_deposit.create');
    Route::post('cash-deposits/{deposit}/cancel', [CashDepositController::class, 'cancel'])->whereNumber('deposit')->middleware('can:cash_deposit.create');
    Route::post('cash-deposits/{deposit}/receive', [CashDepositController::class, 'receive'])->whereNumber('deposit')->middleware('can:cash_deposit.receive');
    Route::post('cash-deposits/{deposit}/correct', [CashDepositController::class, 'correct'])->whereNumber('deposit')->middleware('can:cash_deposit.receive');
    Route::get('fund-accounts', [CashDepositController::class, 'funds'])->middleware('can:cash_deposit.receive');
    Route::get('float-policies', [FloatPolicyController::class, 'index'])->middleware('can:float.propose');
    Route::put('float-policies/{scope}', [FloatPolicyController::class, 'update'])->middleware('can:float.configure');
});
