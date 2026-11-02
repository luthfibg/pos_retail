<?php

use App\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang).
Route::middleware(['auth:sanctum', 'can:reports.view'])->prefix('reports')->group(function () {
    Route::get('dashboard', [ReportController::class, 'dashboard']);
    Route::get('sales-daily', [ReportController::class, 'salesDaily']);
    Route::get('inventory', [ReportController::class, 'inventory']);
    Route::get('cash-summary', [ReportController::class, 'cashSummary']);
});

Route::middleware(['auth:sanctum', 'can:reports.profit.view'])->prefix('reports')->group(function () {
    Route::get('profit', [ReportController::class, 'profit']);
});
