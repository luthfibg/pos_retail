<?php

use App\Http\Controllers\GoodsReceiptController;
use App\Http\Controllers\PurchaseFundController;
use App\Http\Controllers\PurchaseOrderController;
use App\Http\Controllers\PurchaseRequisitionController;
use Illuminate\Support\Facades\Route;

// Pembelian (WS-C): PR -> PO -> penerimaan barang. Dimuat dari routes/api.php (prefix /api sudah terpasang).
Route::middleware('auth:sanctum')->group(function () {
    Route::get('bank-accounts', [PurchaseFundController::class, 'bankAccounts'])
        ->middleware('can.any:purchase_fund.view,purchase_fund.allocate');
    Route::post('bank-accounts', [PurchaseFundController::class, 'createBankAccount'])->middleware('can:bank_account.manage');
    Route::post('bank-accounts/{account}/adjustments', [PurchaseFundController::class, 'adjustBankAccount'])
        ->whereNumber('account')->middleware('can:bank_account.manage');
    Route::get('purchase-fund', [PurchaseFundController::class, 'summary'])
        ->middleware('can.any:purchase_fund.view,purchase_fund.allocate');

    // Purchase Requisition. Kasir hanya melihat/mengelola PR miliknya (dicek di service).
    Route::get('purchase-requisitions', [PurchaseRequisitionController::class, 'index']);
    Route::post('purchase-requisitions', [PurchaseRequisitionController::class, 'store'])->middleware('can:purchase_requisition.create');
    Route::get('purchase-requisitions/{pr}', [PurchaseRequisitionController::class, 'show'])->whereNumber('pr');
    Route::patch('purchase-requisitions/{pr}', [PurchaseRequisitionController::class, 'update'])->whereNumber('pr')->middleware('can:purchase_requisition.create');
    Route::post('purchase-requisitions/{pr}/submit', [PurchaseRequisitionController::class, 'submit'])->whereNumber('pr')->middleware('can:purchase_requisition.create');
    Route::post('purchase-requisitions/{pr}/cancel', [PurchaseRequisitionController::class, 'cancel'])->whereNumber('pr')->middleware('can:purchase_requisition.create');
    Route::post('purchase-requisitions/{pr}/finance-check', [PurchaseRequisitionController::class, 'financeCheck'])->whereNumber('pr')->middleware('can:purchase_requisition.finance_check');
    Route::post('purchase-requisitions/{pr}/approve', [PurchaseRequisitionController::class, 'approve'])->whereNumber('pr')->middleware('can:purchase_requisition.approve');

    // Purchase Order. Daftar/detail juga untuk Kasir penerima barang (PO yang dapat diterima, tanpa harga): izin dicek di service.
    Route::get('purchase-orders', [PurchaseOrderController::class, 'index']);
    Route::get('purchase-orders/{po}', [PurchaseOrderController::class, 'show'])->whereNumber('po');
    Route::post('purchase-orders', [PurchaseOrderController::class, 'store'])->middleware('can:purchase_order.create');
    Route::patch('purchase-orders/{po}', [PurchaseOrderController::class, 'update'])->whereNumber('po')->middleware('can:purchase_order.create');
    Route::post('purchase-orders/{po}/fund-allocation', [PurchaseOrderController::class, 'allocateFunds'])
        ->whereNumber('po')->middleware('can:purchase_fund.allocate');
    Route::post('purchase-orders/{po}/submit', [PurchaseOrderController::class, 'submit'])->whereNumber('po')->middleware('can.any:purchase_order.create,purchase_fund.allocate');
    Route::post('purchase-orders/{po}/confirm', [PurchaseOrderController::class, 'confirm'])->whereNumber('po')->middleware('can:purchase_requisition.approve');
    Route::post('purchase-orders/{po}/send', [PurchaseOrderController::class, 'send'])->whereNumber('po')->middleware('can:purchase_order.send');
    Route::post('purchase-orders/{po}/cancel', [PurchaseOrderController::class, 'cancel'])->whereNumber('po')->middleware('can:purchase_order.create');
    Route::post('purchase-orders/{po}/close', [PurchaseOrderController::class, 'close'])->whereNumber('po')->middleware('can:purchase_order.create');

    // Penerimaan barang. Kasir hanya melihat/mengelola penerimaannya sendiri (dicek di service).
    Route::get('goods-receipts', [GoodsReceiptController::class, 'index'])->middleware('can.any:goods_receipt.create,goods_receipt.verify_documents');
    Route::get('goods-receipts/receiving-locations', [GoodsReceiptController::class, 'receivingLocations'])
        ->middleware('can:goods_receipt.create');
    Route::post('goods-receipts', [GoodsReceiptController::class, 'store'])->middleware('can:goods_receipt.create');
    Route::get('goods-receipts/{gr}', [GoodsReceiptController::class, 'show'])->whereNumber('gr')->middleware('can.any:goods_receipt.create,goods_receipt.verify_documents');
    Route::post('goods-receipts/{gr}/attachments', [GoodsReceiptController::class, 'storeAttachment'])
        ->whereNumber('gr')->middleware('can:goods_receipt.create');
    Route::get('goods-receipts/{gr}/attachments/{attachment}', [GoodsReceiptController::class, 'downloadAttachment'])
        ->whereNumber('gr')->whereNumber('attachment')->middleware('can.any:goods_receipt.create,goods_receipt.verify_documents');
    Route::post('goods-receipts/{gr}/post', [GoodsReceiptController::class, 'post'])->whereNumber('gr')->middleware('can:goods_receipt.create');
    Route::post('goods-receipts/{gr}/cancel', [GoodsReceiptController::class, 'cancel'])->whereNumber('gr')->middleware('can:goods_receipt.create');
    Route::post('goods-receipts/{gr}/verify-documents', [GoodsReceiptController::class, 'verifyDocuments'])->whereNumber('gr')->middleware('can:goods_receipt.verify_documents');
});
