<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_order_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('po_id');
            $table->unsignedBigInteger('product_id');
            $table->decimal('qty_ordered', 18, 3);
            $table->decimal('qty_received', 18, 3)->default(0);
            $table->decimal('unit_price', 18, 2);

            $table->index(['po_id'], 'idx_poi_po');
            $table->foreign('po_id', 'fk_poi_po')->references('id')->on('purchase_orders');
            $table->foreign('product_id', 'fk_poi_product')->references('id')->on('products');
        });

        DB::statement("ALTER TABLE `purchase_order_items` ADD CONSTRAINT chk_poi_qty CHECK (qty_ordered > 0 AND qty_received >= 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_order_items');
    }
};
