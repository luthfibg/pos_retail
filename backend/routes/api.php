<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\CategoryController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\SupplierController;
use Illuminate\Support\Facades\Route;

// Prefix `/api` ditambahkan otomatis oleh bootstrap/app.php.
Route::prefix('auth')->group(function () {
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
    });
});

Route::middleware('auth:sanctum')->group(function () {
    // Kategori (baca: inventory.view, kelola: category.manage). Tidak ada hapus; gunakan is_active.
    Route::get('categories', [CategoryController::class, 'index'])->middleware('can:inventory.view');
    Route::post('categories', [CategoryController::class, 'store'])->middleware('can:category.manage');
    Route::patch('categories/{category}', [CategoryController::class, 'update'])
        ->whereNumber('category')->middleware('can:category.manage');

    // Supplier (seluruhnya supplier.manage)
    Route::get('suppliers', [SupplierController::class, 'index'])->middleware('can:supplier.manage');
    Route::post('suppliers', [SupplierController::class, 'store'])->middleware('can:supplier.manage');
    Route::patch('suppliers/{supplier}', [SupplierController::class, 'update'])
        ->whereNumber('supplier')->middleware('can:supplier.manage');

    // Produk. Harga dan status dicek lagi di service (price.change / product.activate).
    Route::get('products', [ProductController::class, 'index'])->middleware('can:inventory.view');
    Route::get('products/by-barcode/{barcode}', [ProductController::class, 'byBarcode'])->middleware('can:inventory.view');
    Route::get('products/{product}', [ProductController::class, 'show'])
        ->whereNumber('product')->middleware('can:inventory.view');
    Route::post('products', [ProductController::class, 'store'])->middleware('can:product.create');
    Route::patch('products/{product}', [ProductController::class, 'update'])
        ->whereNumber('product')->middleware('can:product.update');
});

// Modul lain dipisah per berkas (aturan kerja bersama beberapa agent, handoff bagian 8).
require __DIR__.'/api/inventory.php';
require __DIR__.'/api/customers.php';
