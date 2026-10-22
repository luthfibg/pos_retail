<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_requisitions', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->unsignedBigInteger('requested_by');
            $table->string('reason', 500)->nullable();
            $table->decimal('est_total', 18, 2)->default(0);
            $table->enum('status', ['draft', 'submitted', 'finance_checked', 'approved', 'rejected', 'returned', 'converted', 'cancelled'])->default('draft');
            $table->dateTime('submitted_at', 3)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'doc_number'], 'uq_pr_number');
            $table->index(['status'], 'idx_pr_status');
            $table->foreign('requested_by', 'fk_pr_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_requisitions');
    }
};
