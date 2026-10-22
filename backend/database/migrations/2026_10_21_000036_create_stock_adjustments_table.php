<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Adjustment (opname, kehilangan, rusak, kadaluarsa). Kasir hanya mengajukan.
     */
    public function up(): void
    {
        Schema::create('stock_adjustments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->enum('reason', ['opname', 'loss', 'damage', 'expired', 'other']);
            $table->enum('status', ['draft', 'requested', 'approved', 'posted', 'rejected', 'cancelled'])->default('draft');
            $table->unsignedBigInteger('requested_by');
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->dateTime('approved_at', 3)->nullable();
            $table->dateTime('reauth_at', 3)->nullable();
            $table->string('note', 500)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['store_id', 'doc_number'], 'uq_sa_number');
            $table->foreign('requested_by', 'fk_sa_requester')->references('id')->on('users');
            $table->foreign('approved_by', 'fk_sa_approver')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_adjustments');
    }
};
