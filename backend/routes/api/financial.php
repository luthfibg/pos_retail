<?php

use App\Http\Controllers\FinancialController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('financial')->group(function () {
    Route::get('report', [FinancialController::class, 'report'])->middleware('can:financial.report.view');
    Route::get('purchase-orders', [FinancialController::class, 'purchaseOrders'])->middleware('can:financial.report.view');
    Route::post('purchase-orders/{po}/payments', [FinancialController::class, 'recordPurchaseOrderPayment'])
        ->whereNumber('po')->middleware('can:financial.transaction.create');
    Route::post('expenses', [FinancialController::class, 'recordExpense'])->middleware('can:financial.transaction.create');
});
