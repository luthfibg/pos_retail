<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Sumber kebenaran stok; append-only (tidak ada UPDATE/DELETE dari aplikasi)
     */
    public function up(): void
    {
        Schema::create('inventory_movements', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('batch_id')->nullable();
            $table->unsignedBigInteger('from_location_id')->nullable();
            $table->unsignedBigInteger('from_position_id')->nullable();
            $table->enum('from_bucket', ['sellable', 'quarantine', 'damaged'])->nullable();
            $table->unsignedBigInteger('to_location_id')->nullable();
            $table->unsignedBigInteger('to_position_id')->nullable();
            $table->enum('to_bucket', ['sellable', 'quarantine', 'damaged'])->nullable();
            $table->decimal('qty', 18, 3);
            $table->enum('movement_type', ['opening_balance', 'receipt', 'putaway', 'transfer', 'sale', 'sale_void', 'customer_return', 'supplier_return_out', 'supplier_replacement_in', 'adjustment', 'write_off']);
            $table->decimal('unit_cost', 18, 4)->nullable();
            $table->string('ref_type', 40);
            $table->unsignedBigInteger('ref_id');
            $table->dateTime('occurred_at', 3);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['product_id', 'occurred_at'], 'idx_mov_product');
            $table->index(['ref_type', 'ref_id'], 'idx_mov_ref');
            $table->foreign('product_id', 'fk_mov_product')->references('id')->on('products');
            $table->foreign('batch_id', 'fk_mov_batch')->references('id')->on('product_batches');
            $table->foreign('created_by', 'fk_mov_user')->references('id')->on('users');
        });

        DB::statement("ALTER TABLE `inventory_movements` ADD CONSTRAINT chk_mov_qty CHECK (qty > 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_movements');
    }
};
