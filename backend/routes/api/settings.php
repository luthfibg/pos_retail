<?php

use App\Http\Controllers\AdminModelController;
use App\Http\Controllers\BankAccountController;
use App\Http\Controllers\DiscountController;
use App\Http\Controllers\InventoryMenuSettingController;
use App\Http\Controllers\StockAuthorityController;
use App\Http\Controllers\StockMonitoringSettingController;
use App\Http\Controllers\StoreNameSettingController;
use App\Http\Controllers\VatSettingController;
use App\Http\Controllers\WarehouseSettingController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang). Admin saja. Diskon tidak dihapus; gunakan is_active.
Route::middleware('auth:sanctum')->group(function () {
    // Pengguna Retail hanya dapat mengubah nama toko; CRUD tenant tetap khusus operator platform.
    Route::patch('settings/store-name', [StoreNameSettingController::class, 'update'])
        ->middleware('can:settings.manage');
    Route::get('settings/bank-accounts', [BankAccountController::class, 'settingsIndex'])->middleware('can:settings.manage');
    Route::post('settings/bank-accounts', [BankAccountController::class, 'store'])->middleware('can:settings.manage');
    Route::patch('settings/bank-accounts/{account}', [BankAccountController::class, 'update'])
        ->whereNumber('account')->middleware('can:settings.manage');
    Route::get('settings/inventory/menus', [InventoryMenuSettingController::class, 'show']);
    Route::put('settings/inventory/menus', [InventoryMenuSettingController::class, 'update'])->middleware('can:settings.manage');

    Route::get('discounts', [DiscountController::class, 'index'])->middleware('can:discount.manage');
    Route::post('discounts', [DiscountController::class, 'store'])->middleware('can:discount.manage');
    Route::get('discounts/{discount}', [DiscountController::class, 'show'])->whereNumber('discount')->middleware('can:discount.manage');
    Route::patch('discounts/{discount}', [DiscountController::class, 'update'])->whereNumber('discount')->middleware('can:discount.manage');

    Route::get('settings/vat', [VatSettingController::class, 'show'])->middleware('can:settings.manage');
    Route::put('settings/vat', [VatSettingController::class, 'update'])->middleware('can:settings.manage');
    Route::get('settings/warehouse', [WarehouseSettingController::class, 'show'])->middleware('can:settings.manage');
    Route::put('settings/warehouse', [WarehouseSettingController::class, 'update'])->middleware('can:settings.manage');
    Route::get('settings/inventory/stock-monitoring', [StockMonitoringSettingController::class, 'show'])
        ->middleware('can:settings.manage');
    Route::put('settings/inventory/stock-monitoring', [StockMonitoringSettingController::class, 'update'])
        ->middleware('can:settings.manage');
    Route::post('settings/inventory/stock-monitoring/purchase-order-reset/preview', [StockMonitoringSettingController::class, 'previewPurchaseOrderReset'])
        ->middleware('can:settings.manage');
    Route::post('settings/inventory/stock-monitoring/purchase-order-reset', [StockMonitoringSettingController::class, 'resetPurchaseOrderWorkflow'])
        ->middleware('can:settings.manage');

    // Model administrasi toko: simple (Admin + Kasir) atau standar retail (Kasir, Finance, Purchasing, Accounting, Owner)
    Route::get('settings/admin-model', [AdminModelController::class, 'show'])->middleware('can:settings.manage');
    Route::put('settings/admin-model', [AdminModelController::class, 'update'])->middleware('can:settings.manage');

    // Matriks kewenangan stok: siapa boleh stok awal, penerimaan, transfer, adjustment (per toko, bebas model dan gudang)
    Route::get('settings/stock-authority', [StockAuthorityController::class, 'show'])->middleware('can:settings.manage');
    Route::put('settings/stock-authority', [StockAuthorityController::class, 'update'])->middleware('can:settings.manage');
});
