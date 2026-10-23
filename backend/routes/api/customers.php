<?php

use App\Http\Controllers\CustomerController;
use App\Http\Controllers\NotificationController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang).
Route::middleware('auth:sanctum')->group(function () {
    // Karyawan. Kasir: customer.select (baca) + customer.create; Admin: sisanya. Nilai batas hanya terlihat customer.set_limit.
    Route::get('customers', [CustomerController::class, 'index'])->middleware('can:customer.select');
    Route::get('customers/{customer}', [CustomerController::class, 'show'])
        ->whereNumber('customer')->middleware('can:customer.select');
    Route::post('customers', [CustomerController::class, 'store'])->middleware('can:customer.create');
    Route::patch('customers/{customer}', [CustomerController::class, 'update'])
        ->whereNumber('customer')->middleware('can:customer.update');
    Route::post('customers/{customer}/verify', [CustomerController::class, 'verify'])
        ->whereNumber('customer')->middleware('can:customer.verify');
    Route::put('customers/{customer}/credit-limit', [CustomerController::class, 'setLimit'])
        ->whereNumber('customer')->middleware('can:customer.set_limit');
    Route::get('customers/{customer}/credit-limits', [CustomerController::class, 'limitHistory'])
        ->whereNumber('customer')->middleware('can:customer.set_limit');

    // Notifikasi milik sendiri
    Route::get('notifications', [NotificationController::class, 'index']);
    Route::post('notifications/read-all', [NotificationController::class, 'readAll']);
    Route::post('notifications/{notification}/read', [NotificationController::class, 'read'])->whereNumber('notification');
});
