<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_opname_sessions', function (Blueprint $table) {
            $table->dateTime('submitted_at', 3)->nullable();
            $table->unsignedBigInteger('submitted_by')->nullable();
            $table->boolean('approval_required')->nullable();
            $table->json('approval_reasons')->nullable();
            $table->dateTime('approved_at', 3)->nullable();
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->dateTime('posted_at', 3)->nullable();
            $table->unsignedBigInteger('posted_by')->nullable();
            $table->dateTime('rejected_at', 3)->nullable();
            $table->unsignedBigInteger('rejected_by')->nullable();
            $table->text('reject_reason')->nullable();
            $table->unsignedInteger('variance_products')->nullable();
            $table->decimal('short_qty', 18, 3)->nullable();
            $table->decimal('over_qty', 18, 3)->nullable();
            $table->decimal('short_value', 18, 2)->nullable();
            $table->decimal('over_value', 18, 2)->nullable();
            $table->decimal('abs_value', 18, 2)->nullable();
            $table->index(['store_id', 'status', 'posted_at'], 'idx_opname_store_status_posted');
            $table->foreign('submitted_by', 'fk_opname_session_submitter')->references('id')->on('users');
            $table->foreign('approved_by', 'fk_opname_session_approver')->references('id')->on('users');
            $table->foreign('posted_by', 'fk_opname_session_poster')->references('id')->on('users');
            $table->foreign('rejected_by', 'fk_opname_session_rejector')->references('id')->on('users');
        });

        Schema::table('stock_opname_items', function (Blueprint $table) {
            $table->decimal('diff_qty', 18, 3)->nullable();
            $table->decimal('unit_cost_snapshot', 18, 4)->nullable();
            $table->decimal('diff_value', 18, 2)->nullable();
            $table->unsignedBigInteger('stock_movement_id')->nullable();
            $table->unsignedInteger('revision_count')->default(0);
            $table->foreign('stock_movement_id', 'fk_opname_item_movement')
                ->references('id')->on('inventory_movements');
            $table->unique('stock_movement_id', 'uq_opname_item_movement');
        });

        Schema::create('stock_opname_approvals', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('session_id');
            $table->string('action', 16);
            $table->unsignedBigInteger('by');
            $table->dateTime('at', 3);
            $table->text('note')->nullable();
            $table->uuid('client_request_id')->unique('uq_opname_approval_request');
            $table->index(['session_id', 'at'], 'idx_opname_approval_session_at');
            $table->foreign('session_id', 'fk_opname_approval_session')
                ->references('id')->on('stock_opname_sessions');
            $table->foreign('by', 'fk_opname_approval_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_opname_approvals');
        Schema::table('stock_opname_items', function (Blueprint $table) {
            $table->dropUnique('uq_opname_item_movement');
            $table->dropForeign('fk_opname_item_movement');
            $table->dropColumn([
                'diff_qty', 'unit_cost_snapshot', 'diff_value', 'stock_movement_id', 'revision_count',
            ]);
        });
        Schema::table('stock_opname_sessions', function (Blueprint $table) {
            $table->dropIndex('idx_opname_store_status_posted');
            $table->dropForeign('fk_opname_session_submitter');
            $table->dropForeign('fk_opname_session_approver');
            $table->dropForeign('fk_opname_session_poster');
            $table->dropForeign('fk_opname_session_rejector');
            $table->dropColumn([
                'submitted_at', 'submitted_by', 'approval_required', 'approval_reasons',
                'approved_at', 'approved_by', 'posted_at', 'posted_by',
                'rejected_at', 'rejected_by', 'reject_reason', 'variance_products',
                'short_qty', 'over_qty', 'short_value', 'over_value', 'abs_value',
            ]);
        });
    }
};
