<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Batas kredit bulanan (riwayat). Tidak ada baris = belum ada batas (kredit tertahan).
     */
    public function up(): void
    {
        Schema::create('customer_credit_limits', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('customer_id');
            $table->decimal('limit_amount', 18, 2);
            $table->dateTime('effective_from', 3)->useCurrent();
            $table->unsignedBigInteger('set_by');
            $table->string('note', 255)->nullable();

            $table->index(['customer_id', 'effective_from'], 'idx_ccl_customer');
            $table->foreign('customer_id', 'fk_ccl_customer')->references('id')->on('customers');
            $table->foreign('set_by', 'fk_ccl_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_credit_limits');
    }
};
