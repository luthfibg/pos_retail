<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('stock_adjustments')->whereNotNull('opname_session_id')->exists()) {
            throw new RuntimeException('Tidak dapat memasang FK opname: stock_adjustments.opname_session_id harus seluruhnya NULL.');
        }

        Schema::create('stock_opname_sessions', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('number', 32);
            $table->string('name', 160)->nullable();
            $table->string('scope_type', 16);
            $table->string('status', 24)->default('in_progress');
            $table->text('notes')->nullable();
            $table->dateTime('started_at', 3);
            $table->unsignedBigInteger('created_by');
            $table->dateTime('cancelled_at', 3)->nullable();
            $table->unsignedBigInteger('cancelled_by')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->uuid('client_request_id')->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'number'], 'uq_opname_session_number');
            $table->unique('client_request_id', 'uq_opname_client_request');
            $table->index(['store_id', 'status', 'started_at'], 'idx_opname_store_status_started');
            $table->foreign('created_by', 'fk_opname_session_creator')->references('id')->on('users');
            $table->foreign('cancelled_by', 'fk_opname_session_canceller')->references('id')->on('users');
        });

        Schema::create('stock_opname_session_categories', function (Blueprint $table) {
            $table->unsignedBigInteger('session_id');
            $table->unsignedBigInteger('category_id');
            $table->primary(['session_id', 'category_id'], 'pk_opname_session_categories');
            $table->foreign('session_id', 'fk_opname_category_session')
                ->references('id')->on('stock_opname_sessions')->cascadeOnDelete();
            $table->foreign('category_id', 'fk_opname_session_category')
                ->references('id')->on('categories');
        });

        Schema::create('stock_opname_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('session_id');
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('category_id')->nullable();
            $table->string('product_name_snapshot', 200);
            $table->string('barcode_snapshot', 64);
            $table->string('category_name_snapshot', 120)->nullable();
            $table->string('category_parent_name_snapshot', 120)->nullable();
            $table->decimal('system_qty_at_start', 18, 3)->default(0);
            $table->decimal('counted_qty', 18, 3)->nullable();
            $table->decimal('system_qty_at_count', 18, 3)->nullable();
            $table->dateTime('counted_at', 3)->nullable();
            $table->unsignedBigInteger('counted_by')->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['session_id', 'product_id'], 'uq_opname_item_product');
            $table->index(['session_id', 'category_id'], 'idx_opname_item_session_category');
            $table->index('product_id', 'idx_opname_item_product');
            $table->foreign('session_id', 'fk_opname_item_session')
                ->references('id')->on('stock_opname_sessions')->cascadeOnDelete();
            $table->foreign('product_id', 'fk_opname_item_product')->references('id')->on('products');
            $table->foreign('category_id', 'fk_opname_item_category')->references('id')->on('categories');
            $table->foreign('counted_by', 'fk_opname_item_counter')->references('id')->on('users');
        });

        Schema::table('stock_adjustments', function (Blueprint $table) {
            $table->foreign('opname_session_id', 'fk_sa_opname_session')
                ->references('id')->on('stock_opname_sessions');
        });
    }

    public function down(): void
    {
        Schema::table('stock_adjustments', function (Blueprint $table) {
            $table->dropForeign('fk_sa_opname_session');
        });

        Schema::dropIfExists('stock_opname_items');
        Schema::dropIfExists('stock_opname_session_categories');
        Schema::dropIfExists('stock_opname_sessions');
    }
};
