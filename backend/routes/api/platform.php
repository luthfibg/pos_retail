<?php

use App\Http\Controllers\PlatformCliLoginController;
use App\Http\Controllers\PlatformStoreController;
use Illuminate\Support\Facades\Route;

Route::post('platform/cli-login/exchange', [PlatformCliLoginController::class, 'exchange'])
    ->middleware('throttle:10,1');

Route::middleware(['auth:sanctum', 'platform.operator'])->prefix('platform')->group(function () {
    Route::get('stores', [PlatformStoreController::class, 'index']);
    Route::post('stores', [PlatformStoreController::class, 'store']);
    Route::get('stores/{store}', [PlatformStoreController::class, 'show'])->whereNumber('store');
    Route::patch('stores/{store}/status', [PlatformStoreController::class, 'updateStatus'])->whereNumber('store');
});
