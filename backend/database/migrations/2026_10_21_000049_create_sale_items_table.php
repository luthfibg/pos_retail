<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sale_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('sale_id');
            $table->unsignedBigInteger('product_id');
            $table->decimal('qty', 18, 3);
            $table->decimal('unit_price', 18, 2)->comment('snapshot harga saat transaksi');
            $table->unsignedBigInteger('discount_id')->nullable();
            $table->decimal('discount_amount', 18, 2)->default(0);
            $table->decimal('line_total', 18, 2);
            $table->decimal('cost_snapshot', 18, 4)->comment('HPP rata-rata saat transaksi');

            $table->index(['sale_id'], 'idx_si_sale');
            $table->index(['product_id'], 'idx_si_product');
            $table->foreign('sale_id', 'fk_si_sale')->references('id')->on('sales');
            $table->foreign('product_id', 'fk_si_product')->references('id')->on('products');
            $table->foreign('discount_id', 'fk_si_discount')->references('id')->on('discounts');
        });

        DB::statement("ALTER TABLE `sale_items` ADD CONSTRAINT chk_si_qty CHECK (qty > 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_items');
    }
};
