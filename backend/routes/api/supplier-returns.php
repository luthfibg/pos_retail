<?php

use App\Http\Controllers\SupplierReturnController;
use Illuminate\Support\Facades\Route;

// Retur supplier dan penerimaan barang pengganti.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('supplier-returns', [SupplierReturnController::class, 'index'])
        ->middleware('can.any:supplier_return.create,inventory.adjust.approve');
    Route::post('supplier-returns', [SupplierReturnController::class, 'store'])
        ->middleware('can:supplier_return.create');
    Route::get('supplier-returns/{supplierReturn}', [SupplierReturnController::class, 'show'])
        ->whereNumber('supplierReturn')->middleware('can.any:supplier_return.create,inventory.adjust.approve');
    Route::post('supplier-returns/{supplierReturn}/submit', [SupplierReturnController::class, 'submit'])
        ->whereNumber('supplierReturn')->middleware('can:supplier_return.create');
    Route::post('supplier-returns/{supplierReturn}/merge', [SupplierReturnController::class, 'merge'])
        ->whereNumber('supplierReturn')->middleware('can:supplier_return.create');
    Route::post('supplier-returns/{supplierReturn}/supplier-decision', [SupplierReturnController::class, 'supplierDecision'])
        ->whereNumber('supplierReturn')->middleware('can:supplier_return.create');
    Route::post('supplier-returns/{supplierReturn}/replacement-receipt', [SupplierReturnController::class, 'receiveReplacement'])
        ->whereNumber('supplierReturn')->middleware('can:supplier_return.create');
    Route::post('supplier-returns/{supplierReturn}/write-off', [SupplierReturnController::class, 'writeOff'])
        ->whereNumber('supplierReturn')->middleware('can:inventory.adjust.approve');
    Route::post('supplier-returns/{supplierReturn}/cancel', [SupplierReturnController::class, 'cancel'])
        ->whereNumber('supplierReturn')->middleware('can:supplier_return.create');
});
