<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_history', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('product_id');
            $table->decimal('old_price', 18, 2)->nullable();
            $table->decimal('new_price', 18, 2);
            $table->unsignedBigInteger('changed_by');
            $table->dateTime('changed_at', 3)->useCurrent();

            $table->index(['product_id', 'changed_at'], 'idx_ph_product');
            $table->foreign('product_id', 'fk_ph_product')->references('id')->on('products');
            $table->foreign('changed_by', 'fk_ph_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('price_history');
    }
};
