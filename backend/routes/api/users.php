<?php

use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang). Pengguna tidak dihapus; nonaktifkan lewat is_active.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('users', [UserController::class, 'index'])->middleware('can:user.manage');
    Route::post('users', [UserController::class, 'store'])->middleware('can:user.manage');
    Route::get('users/{user}', [UserController::class, 'show'])->whereNumber('user')->middleware('can:user.manage');
    Route::patch('users/{user}', [UserController::class, 'update'])->whereNumber('user')->middleware('can:user.manage');
    Route::post('users/{user}/reset-password', [UserController::class, 'resetPassword'])->whereNumber('user')->middleware('can:user.manage');
    Route::get('roles', [UserController::class, 'roles'])->middleware('can:user.manage');

    // Akun sendiri: semua pengguna yang login
    Route::post('auth/change-password', [UserController::class, 'changePassword']);
});
