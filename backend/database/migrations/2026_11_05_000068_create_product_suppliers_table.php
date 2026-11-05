<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_suppliers', function (Blueprint $table) {
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('supplier_id');

            $table->primary(['product_id', 'supplier_id']);
            $table->index(['supplier_id', 'product_id'], 'idx_product_suppliers_supplier');
            $table->foreign('product_id', 'fk_product_suppliers_product')
                ->references('id')->on('products')->cascadeOnDelete();
            $table->foreign('supplier_id', 'fk_product_suppliers_supplier')
                ->references('id')->on('suppliers')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_suppliers');
    }
};
