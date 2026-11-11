<?php

use App\Http\Controllers\BillingController;
use Illuminate\Support\Facades\Route;

// Dimuat dari routes/api.php (prefix /api sudah terpasang). Seluruhnya Admin: Kasir tidak memegang permission ini.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('annual-receivable-reports', [BillingController::class, 'annualReportYears'])->middleware('can:invoice.generate');
    Route::get('annual-receivable-reports/{year}', [BillingController::class, 'annualReport'])->whereNumber('year')->middleware('can:invoice.generate');
    Route::get('settings/annual-receivable-report', [BillingController::class, 'annualReportSetting'])->middleware('can:settings.manage');
    Route::put('settings/annual-receivable-report', [BillingController::class, 'updateAnnualReportSetting'])->middleware('can:settings.manage');

    Route::get('billing-periods', [BillingController::class, 'periods'])->middleware('can:billing_period.manage');
    Route::get('billing-periods/current', [BillingController::class, 'currentPeriod'])->middleware('can:billing_period.manage');
    Route::post('billing-periods', [BillingController::class, 'openPeriod'])->middleware('can:billing_period.manage');
    Route::get('billing-periods/{period}', [BillingController::class, 'showPeriod'])->whereNumber('period')->middleware('can:billing_period.manage');
    Route::patch('billing-periods/{period}', [BillingController::class, 'updatePeriod'])->whereNumber('period')->middleware('can:billing_period.manage');
    Route::post('billing-periods/{period}/close', [BillingController::class, 'closePeriod'])->whereNumber('period')->middleware('can:billing_period.close');
    Route::post('billing-periods/{period}/cancel', [BillingController::class, 'cancelPeriod'])->whereNumber('period')->middleware('can:billing_period.manage');
    Route::post('billing-periods/{period}/invoice', [BillingController::class, 'generateInvoice'])->whereNumber('period')->middleware('can:invoice.generate');

    Route::get('invoices', [BillingController::class, 'invoices'])->middleware('can:invoice.generate');
    Route::get('invoices/{invoice}', [BillingController::class, 'showInvoice'])->whereNumber('invoice')->middleware('can:invoice.generate');
    Route::post('invoices/{invoice}/issue', [BillingController::class, 'issue'])->whereNumber('invoice')->middleware('can:invoice.issue');
    Route::post('invoices/{invoice}/hand-over', [BillingController::class, 'handOver'])->whereNumber('invoice')->middleware('can:invoice.issue');
    Route::post('invoices/{invoice}/payments', [BillingController::class, 'recordPayment'])->whereNumber('invoice')->middleware('can:invoice.record_payment');
});
