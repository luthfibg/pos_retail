<?php

use App\Http\Controllers\CustomerController;
use App\Http\Controllers\NotificationController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang).
Route::middleware('auth:sanctum')->group(function () {
    // Debitur. Pendaftaran dan arsip hanya untuk Admin; Kasir hanya dapat mencari dan memilih data aktif.
    Route::get('customers', [CustomerController::class, 'index'])->middleware('can:customer.select');
    Route::get('customers/{customer}', [CustomerController::class, 'show'])
        ->whereNumber('customer')->middleware('can:customer.select');
    Route::post('customers', [CustomerController::class, 'store'])->middleware('can:customer.create');
    Route::patch('customers/{customer}', [CustomerController::class, 'update'])
        ->whereNumber('customer')->middleware('can:customer.update');
    Route::put('customers/{customer}/credit-limit', [CustomerController::class, 'setLimit'])
        ->whereNumber('customer')->middleware('can:customer.set_limit');
    Route::delete('customers/{customer}', [CustomerController::class, 'archive'])
        ->whereNumber('customer')->middleware('can:customer.archive');
    Route::post('customers/{customer}/restore', [CustomerController::class, 'restore'])
        ->whereNumber('customer')->middleware('can:customer.archive');
    Route::get('customers/{customer}/credit-limits', [CustomerController::class, 'limitHistory'])
        ->whereNumber('customer')->middleware('can:customer.set_limit');

    // Notifikasi milik sendiri
    Route::get('notifications', [NotificationController::class, 'index']);
    Route::post('notifications/read-all', [NotificationController::class, 'readAll']);
    Route::post('notifications/{notification}/read', [NotificationController::class, 'read'])->whereNumber('notification');
});
