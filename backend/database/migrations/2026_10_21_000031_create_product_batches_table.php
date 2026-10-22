<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_batches', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('goods_receipt_item_id')->nullable()->comment('NULL untuk stok awal migrasi');
            $table->string('batch_code', 60)->nullable();
            $table->date('expiry_date')->nullable()->comment('NULL = tanpa kadaluarsa / belum diketahui');
            $table->dateTime('received_at', 3)->useCurrent();
            $table->boolean('is_opening')->default(false);

            $table->index(['product_id', 'expiry_date', 'received_at'], 'idx_batch_fefo');
            $table->foreign('product_id', 'fk_batch_product')->references('id')->on('products');
            $table->foreign('goods_receipt_item_id', 'fk_batch_gri')->references('id')->on('goods_receipt_items');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_batches');
    }
};
