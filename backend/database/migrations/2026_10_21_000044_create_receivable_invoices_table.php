<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Satu invoice gabungan per periode untuk HRD, rincian per karyawan
     */
    public function up(): void
    {
        Schema::create('receivable_invoices', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->unsignedBigInteger('billing_period_id');
            $table->string('bill_to', 150);
            $table->decimal('subtotal', 18, 2);
            $table->decimal('tax_rate_snapshot', 5, 2)->nullable()->comment('NULL selama PPN belum dikonfigurasi (R-04)');
            $table->decimal('tax_amount', 18, 2)->default(0);
            $table->decimal('total', 18, 2);
            $table->decimal('amount_paid', 18, 2)->default(0);
            $table->enum('status', ['draft', 'issued', 'handed_to_hr', 'partially_paid', 'paid', 'cancelled'])->default('draft');
            $table->dateTime('issued_at', 3)->nullable();
            $table->dateTime('handed_at', 3)->nullable();
            $table->date('due_date')->nullable();
            $table->unsignedBigInteger('created_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['store_id', 'doc_number'], 'uq_inv_number');
            $table->unique(['billing_period_id'], 'uq_inv_period');
            $table->foreign('billing_period_id', 'fk_inv_period')->references('id')->on('billing_periods');
            $table->foreign('created_by', 'fk_inv_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('receivable_invoices');
    }
};
