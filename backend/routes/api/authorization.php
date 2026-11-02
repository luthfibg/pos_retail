<?php

use App\Http\Controllers\AuthorizationKeyController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang).
Route::middleware('auth:sanctum')->group(function () {
    // Kunci milik sendiri (pemegang izin persetujuan; selain itu 403). Password akun diminta pada setiap perubahan.
    Route::get('authorization-key', [AuthorizationKeyController::class, 'show']);
    Route::put('authorization-key', [AuthorizationKeyController::class, 'set'])->middleware('throttle:20,1');
    Route::delete('authorization-key', [AuthorizationKeyController::class, 'destroy'])->middleware('throttle:20,1');

    // Pengelola pengguna: daftar status kunci pemegang izin persetujuan dan pencabutan kunci orang lain
    Route::get('authorization-keys', [AuthorizationKeyController::class, 'index'])->middleware('can:user.manage');
    Route::delete('authorization-keys/{user}', [AuthorizationKeyController::class, 'revoke'])->whereNumber('user')->middleware('can:user.manage');

    // Mode kredensial persetujuan toko
    Route::get('settings/approval-auth', [AuthorizationKeyController::class, 'mode'])->middleware('can:settings.manage');
    Route::put('settings/approval-auth', [AuthorizationKeyController::class, 'setMode'])->middleware(['can:settings.manage', 'throttle:20,1']);
});
