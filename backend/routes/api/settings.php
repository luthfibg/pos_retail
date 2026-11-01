<?php

use App\Http\Controllers\AdminModelController;
use App\Http\Controllers\DiscountController;
use App\Http\Controllers\VatSettingController;
use App\Http\Controllers\WarehouseSettingController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang). Admin saja. Diskon tidak dihapus; gunakan is_active.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('discounts', [DiscountController::class, 'index'])->middleware('can:discount.manage');
    Route::post('discounts', [DiscountController::class, 'store'])->middleware('can:discount.manage');
    Route::get('discounts/{discount}', [DiscountController::class, 'show'])->whereNumber('discount')->middleware('can:discount.manage');
    Route::patch('discounts/{discount}', [DiscountController::class, 'update'])->whereNumber('discount')->middleware('can:discount.manage');

    Route::get('settings/vat', [VatSettingController::class, 'show'])->middleware('can:settings.manage');
    Route::put('settings/vat', [VatSettingController::class, 'update'])->middleware('can:settings.manage');
    Route::get('settings/warehouse', [WarehouseSettingController::class, 'show'])->middleware('can:settings.manage');
    Route::put('settings/warehouse', [WarehouseSettingController::class, 'update'])->middleware('can:settings.manage');

    // Model administrasi toko: simple (Admin + Kasir) atau standar retail (Kasir, Finance, Purchasing, Accounting, Owner)
    Route::get('settings/admin-model', [AdminModelController::class, 'show'])->middleware('can:settings.manage');
    Route::put('settings/admin-model', [AdminModelController::class, 'update'])->middleware('can:settings.manage');
});
