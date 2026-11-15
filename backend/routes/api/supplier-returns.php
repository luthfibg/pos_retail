<?php

use App\Http\Controllers\SupplierReturnController;
use Illuminate\Support\Facades\Route;

// Retur supplier dicatat dan diselesaikan dalam satu transaksi.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('supplier-returns', [SupplierReturnController::class, 'index'])
        ->middleware('can.any:supplier_return.create,inventory.adjust.approve');
    Route::post('supplier-returns', [SupplierReturnController::class, 'store'])
        ->middleware('can:supplier_return.create');
    Route::get('supplier-returns/{supplierReturn}', [SupplierReturnController::class, 'show'])
        ->whereNumber('supplierReturn')->middleware('can.any:supplier_return.create,inventory.adjust.approve');
});
