<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('supplier_returns', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->unsignedBigInteger('supplier_id');
            $table->enum('status', ['draft', 'submitted', 'accepted', 'rejected', 'replacement_received', 'written_off', 'cancelled'])->default('draft');
            $table->unsignedBigInteger('requested_by');
            $table->dateTime('submitted_at', 3)->nullable();
            $table->unsignedBigInteger('decided_by')->nullable();
            $table->dateTime('decided_at', 3)->nullable();
            $table->string('decision_note', 500)->nullable();
            $table->decimal('loss_amount', 18, 2)->nullable();
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->dateTime('approved_at', 3)->nullable();
            $table->dateTime('reauth_at', 3)->nullable();
            $table->string('note', 500)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'doc_number'], 'uq_sr_number');
            $table->index(['store_id', 'status', 'id'], 'idx_sr_store_status');
            $table->foreign('supplier_id', 'fk_sr_supplier')->references('id')->on('suppliers');
            $table->foreign('requested_by', 'fk_sr_requester')->references('id')->on('users');
            $table->foreign('decided_by', 'fk_sr_decider')->references('id')->on('users');
            $table->foreign('approved_by', 'fk_sr_approver')->references('id')->on('users');
        });

        Schema::create('supplier_return_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('supplier_return_id');
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('batch_id')->nullable();
            $table->unsignedBigInteger('location_id');
            $table->unsignedBigInteger('shelf_position_id')->nullable();
            $table->enum('source_bucket', ['sellable', 'damaged']);
            $table->decimal('qty', 18, 3);
            $table->decimal('unit_cost', 18, 4)->nullable();
            $table->unsignedBigInteger('replacement_batch_id')->nullable();

            $table->index(['supplier_return_id'], 'idx_sri_return');
            $table->foreign('supplier_return_id', 'fk_sri_return')->references('id')->on('supplier_returns');
            $table->foreign('product_id', 'fk_sri_product')->references('id')->on('products');
            $table->foreign('batch_id', 'fk_sri_batch')->references('id')->on('product_batches');
            $table->foreign('location_id', 'fk_sri_loc')->references('id')->on('locations');
            $table->foreign('shelf_position_id', 'fk_sri_pos')->references('id')->on('shelf_positions');
            $table->foreign('replacement_batch_id', 'fk_sri_replacement_batch')->references('id')->on('product_batches');
        });

        DB::statement('ALTER TABLE `supplier_return_items` ADD CONSTRAINT chk_sri_qty CHECK (qty > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_return_items');
        Schema::dropIfExists('supplier_returns');
    }
};
