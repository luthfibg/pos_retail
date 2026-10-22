<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Alokasi FEFO: satu baris item dapat dipecah ke beberapa batch
     */
    public function up(): void
    {
        Schema::create('sale_item_batches', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('sale_item_id');
            $table->unsignedBigInteger('batch_id')->nullable();
            $table->unsignedBigInteger('shelf_position_id')->nullable();
            $table->decimal('qty', 18, 3);

            $table->index(['sale_item_id'], 'idx_sib_item');
            $table->foreign('sale_item_id', 'fk_sib_item')->references('id')->on('sale_items');
            $table->foreign('batch_id', 'fk_sib_batch')->references('id')->on('product_batches');
        });

        DB::statement("ALTER TABLE `sale_item_batches` ADD CONSTRAINT chk_sib_qty CHECK (qty > 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_item_batches');
    }
};
