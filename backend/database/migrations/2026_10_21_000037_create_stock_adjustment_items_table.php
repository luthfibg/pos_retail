<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_adjustment_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('adjustment_id');
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('batch_id')->nullable();
            $table->unsignedBigInteger('location_id');
            $table->unsignedBigInteger('shelf_position_id')->nullable();
            $table->decimal('qty_before', 18, 3);
            $table->decimal('qty_counted', 18, 3);
            $table->decimal('qty_diff', 18, 3);

            $table->index(['adjustment_id'], 'idx_sai_adj');
            $table->foreign('adjustment_id', 'fk_sai_adj')->references('id')->on('stock_adjustments');
            $table->foreign('product_id', 'fk_sai_product')->references('id')->on('products');
            $table->foreign('batch_id', 'fk_sai_batch')->references('id')->on('product_batches');
            $table->foreign('location_id', 'fk_sai_loc')->references('id')->on('locations');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_adjustment_items');
    }
};
