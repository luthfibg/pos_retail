<?php

use App\Http\Controllers\InventoryController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang).
Route::middleware('auth:sanctum')->prefix('inventory')->group(function () {
    Route::get('products/{product}/stock', [InventoryController::class, 'productStock'])
        ->whereNumber('product')->middleware('can:inventory.view');

    Route::get('movements', [InventoryController::class, 'movements'])->middleware('can:inventory.view');

    // Stok awal: hanya Admin. Memakai inventory.adjust.approve (belum ada permission khusus) [ASUMSI].
    Route::post('opening-balances', [InventoryController::class, 'openingBalance'])
        ->middleware('can:inventory.adjust.approve');
});
