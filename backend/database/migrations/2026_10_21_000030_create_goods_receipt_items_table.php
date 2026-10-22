<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('goods_receipt_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('gr_id');
            $table->unsignedBigInteger('po_item_id');
            $table->unsignedBigInteger('product_id');
            $table->decimal('qty_ordered', 18, 3);
            $table->decimal('qty_received', 18, 3)->comment('diterima layak jual');
            $table->decimal('qty_damaged', 18, 3)->default(0);
            $table->decimal('qty_short', 18, 3)->default(0);
            $table->decimal('unit_cost', 18, 2);
            $table->date('expiry_date')->nullable();
            $table->string('batch_code', 60)->nullable();
            $table->unsignedBigInteger('shelf_position_id')->nullable();
            $table->string('note', 255)->nullable();

            $table->index(['gr_id'], 'idx_gri_gr');
            $table->foreign('gr_id', 'fk_gri_gr')->references('id')->on('goods_receipts');
            $table->foreign('po_item_id', 'fk_gri_poi')->references('id')->on('purchase_order_items');
            $table->foreign('product_id', 'fk_gri_product')->references('id')->on('products');
            $table->foreign('shelf_position_id', 'fk_gri_pos')->references('id')->on('shelf_positions');
        });

        DB::statement("ALTER TABLE `goods_receipt_items` ADD CONSTRAINT chk_gri_qty CHECK (qty_received >= 0 AND qty_damaged >= 0 AND qty_short >= 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('goods_receipt_items');
    }
};
