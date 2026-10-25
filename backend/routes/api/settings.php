<?php

use App\Http\Controllers\DiscountController;
use App\Http\Controllers\VatSettingController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang). Admin saja. Diskon tidak dihapus; gunakan is_active.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('discounts', [DiscountController::class, 'index'])->middleware('can:discount.manage');
    Route::post('discounts', [DiscountController::class, 'store'])->middleware('can:discount.manage');
    Route::get('discounts/{discount}', [DiscountController::class, 'show'])->whereNumber('discount')->middleware('can:discount.manage');
    Route::patch('discounts/{discount}', [DiscountController::class, 'update'])->whereNumber('discount')->middleware('can:discount.manage');

    Route::get('settings/vat', [VatSettingController::class, 'show'])->middleware('can:settings.manage');
    Route::put('settings/vat', [VatSettingController::class, 'update'])->middleware('can:settings.manage');
});
