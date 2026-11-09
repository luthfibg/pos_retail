<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_opname_count_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('session_id');
            $table->unsignedBigInteger('item_id');
            $table->unsignedBigInteger('product_id');
            $table->string('action', 16);
            $table->unsignedInteger('input_qty')->nullable();
            $table->unsignedInteger('counted_before')->nullable();
            $table->unsignedInteger('counted_after')->nullable();
            $table->uuid('client_request_id')->unique('uq_opname_count_request');
            $table->unsignedBigInteger('created_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['session_id', 'created_at'], 'idx_opname_count_session_created');
            $table->index('item_id', 'idx_opname_count_item');
            $table->foreign('session_id', 'fk_opname_count_session')->references('id')->on('stock_opname_sessions');
            $table->foreign('item_id', 'fk_opname_count_item')->references('id')->on('stock_opname_items');
            $table->foreign('product_id', 'fk_opname_count_product')->references('id')->on('products');
            $table->foreign('created_by', 'fk_opname_count_creator')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_opname_count_logs');
    }
};
