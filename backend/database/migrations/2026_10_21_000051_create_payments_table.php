<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Hanya untuk mode cash; mode payroll_credit tidak memiliki baris payment
     */
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('sale_id');
            $table->unsignedBigInteger('shift_id');
            $table->enum('method', ['cash'])->default('cash');
            $table->decimal('amount_tendered', 18, 2);
            $table->decimal('change_given', 18, 2)->default(0);
            $table->decimal('amount_applied', 18, 2);
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['sale_id'], 'uq_payments_sale');
            $table->index(['shift_id'], 'idx_payments_shift');
            $table->foreign('sale_id', 'fk_pay_sale')->references('id')->on('sales');
            $table->foreign('shift_id', 'fk_pay_shift')->references('id')->on('cash_shifts');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
