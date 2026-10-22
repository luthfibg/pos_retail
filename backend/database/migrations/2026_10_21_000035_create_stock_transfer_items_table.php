<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_transfer_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('transfer_id');
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('batch_id')->nullable();
            $table->unsignedBigInteger('from_position_id')->nullable();
            $table->unsignedBigInteger('to_position_id')->nullable();
            $table->decimal('qty', 18, 3);

            $table->index(['transfer_id'], 'idx_sti_transfer');
            $table->foreign('transfer_id', 'fk_sti_transfer')->references('id')->on('stock_transfers');
            $table->foreign('product_id', 'fk_sti_product')->references('id')->on('products');
            $table->foreign('batch_id', 'fk_sti_batch')->references('id')->on('product_batches');
        });

        DB::statement("ALTER TABLE `stock_transfer_items` ADD CONSTRAINT chk_sti_qty CHECK (qty > 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_transfer_items');
    }
};
