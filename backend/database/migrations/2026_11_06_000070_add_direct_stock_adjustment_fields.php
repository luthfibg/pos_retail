<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_adjustments', function (Blueprint $table) {
            $table->unsignedBigInteger('product_id')->nullable()->after('store_id');
            $table->string('type', 16)->nullable()->after('reason');
            $table->unsignedInteger('quantity')->nullable()->after('type');
            $table->string('reason_code', 32)->nullable()->after('quantity');
            $table->decimal('stock_before', 18, 3)->nullable()->after('reason_code');
            $table->decimal('stock_after', 18, 3)->nullable()->after('stock_before');
            $table->string('source', 16)->nullable()->after('stock_after');
            $table->unsignedBigInteger('opname_session_id')->nullable()->after('source');
            $table->unsignedBigInteger('stock_movement_id')->nullable()->after('opname_session_id');
            $table->uuid('client_request_id')->nullable();
            $table->dateTime('updated_at', 3)->nullable();

            $table->foreign('product_id', 'fk_sa_direct_product')->references('id')->on('products');
            $table->foreign('stock_movement_id', 'fk_sa_direct_movement')->references('id')->on('inventory_movements');
            $table->unique('client_request_id', 'uq_sa_client_request');
            $table->index(['source', 'created_at'], 'idx_sa_source_created');
            $table->index(['product_id', 'created_at'], 'idx_sa_product_created');
            $table->index(['reason_code', 'created_at'], 'idx_sa_reason_created');
        });

        Schema::table('stock_adjustment_items', function (Blueprint $table) {
            $table->unsignedBigInteger('stock_movement_id')->nullable();
            $table->foreign('stock_movement_id', 'fk_sai_movement')->references('id')->on('inventory_movements');
        });
    }

    public function down(): void
    {
        Schema::table('stock_adjustment_items', function (Blueprint $table) {
            $table->dropForeign('fk_sai_movement');
            $table->dropColumn('stock_movement_id');
        });

        Schema::table('stock_adjustments', function (Blueprint $table) {
            $table->dropForeign('fk_sa_direct_product');
            $table->dropForeign('fk_sa_direct_movement');
            $table->dropUnique('uq_sa_client_request');
            $table->dropIndex('idx_sa_source_created');
            $table->dropIndex('idx_sa_product_created');
            $table->dropIndex('idx_sa_reason_created');
            $table->dropColumn([
                'product_id', 'type', 'quantity', 'reason_code', 'stock_before',
                'stock_after', 'source', 'opname_session_id', 'stock_movement_id',
                'client_request_id', 'updated_at',
            ]);
        });
    }
};
