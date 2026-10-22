<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_requisition_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('pr_id');
            $table->unsignedBigInteger('product_id');
            $table->decimal('qty', 18, 3);
            $table->decimal('est_price', 18, 2)->nullable();
            $table->string('note', 255)->nullable();

            $table->index(['pr_id'], 'idx_pri_pr');
            $table->foreign('pr_id', 'fk_pri_pr')->references('id')->on('purchase_requisitions');
            $table->foreign('product_id', 'fk_pri_product')->references('id')->on('products');
        });

        DB::statement("ALTER TABLE `purchase_requisition_items` ADD CONSTRAINT chk_pri_qty CHECK (qty > 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_requisition_items');
    }
};
