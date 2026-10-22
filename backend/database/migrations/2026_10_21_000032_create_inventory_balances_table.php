<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Saldo turunan dari inventory_movements. Kunci unik memakai kolom generated agar NULL
     * (tanpa posisi / tanpa batch) tidak lolos dari unique.
     */
    public function up(): void
    {
        Schema::create('inventory_balances', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('location_id');
            $table->unsignedBigInteger('shelf_position_id')->nullable();
            $table->unsignedBigInteger('batch_id')->nullable();
            $table->decimal('qty_sellable', 18, 3)->default(0);
            $table->decimal('qty_quarantine', 18, 3)->default(0);
            $table->decimal('qty_damaged', 18, 3)->default(0);
            $table->unsignedBigInteger('position_key')->storedAs('IFNULL(shelf_position_id, 0)');
            $table->unsignedBigInteger('batch_key')->storedAs('IFNULL(batch_id, 0)');
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['product_id', 'location_id', 'position_key', 'batch_key'], 'uq_balance');
            $table->index(['location_id', 'shelf_position_id'], 'idx_bal_location');
            $table->foreign('product_id', 'fk_bal_product')->references('id')->on('products');
            $table->foreign('location_id', 'fk_bal_location')->references('id')->on('locations');
            $table->foreign('shelf_position_id', 'fk_bal_pos')->references('id')->on('shelf_positions');
            $table->foreign('batch_id', 'fk_bal_batch')->references('id')->on('product_batches');
        });

        DB::statement("ALTER TABLE `inventory_balances` ADD CONSTRAINT chk_bal_nonneg CHECK (qty_sellable >= 0 AND qty_quarantine >= 0 AND qty_damaged >= 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_balances');
    }
};
