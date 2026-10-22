<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Satu produk = satu barcode, satuan terkecil (pcs). Barcode unik permanen
     * (produk nonaktif tetap memegang barcode; baris tidak dihapus).
     */
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('sku', 40);
            $table->string('barcode', 64);
            $table->string('name', 200);
            $table->unsignedBigInteger('category_id')->nullable();
            $table->string('unit_name', 20)->default('pcs');
            $table->boolean('track_expiry')->default(false);
            $table->decimal('sell_price', 18, 2)->nullable()->comment('NULL selama status pending_price');
            $table->decimal('avg_cost', 18, 4)->default(0)->comment('HPP rata-rata bergerak');
            $table->decimal('last_cost', 18, 2)->nullable();
            $table->decimal('min_stock', 18, 3)->default(0);
            $table->decimal('critical_stock', 18, 3)->default(0);
            $table->enum('status', ['pending_price', 'active', 'inactive'])->default('pending_price');
            $table->unsignedBigInteger('created_by')->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'sku'], 'uq_products_sku');
            $table->unique(['barcode'], 'uq_products_barcode');
            $table->index(['name'], 'idx_products_name');
            $table->index(['category_id'], 'idx_products_category');
            $table->foreign('category_id', 'fk_products_category')->references('id')->on('categories');
        });

        DB::statement("ALTER TABLE `products` ADD CONSTRAINT chk_products_active_price CHECK (status <> 'active' OR sell_price IS NOT NULL)");
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
