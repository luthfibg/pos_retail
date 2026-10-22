<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Arsip struk tetap di sistem; cetak ulang berlabel SALINAN dan tercatat
     */
    public function up(): void
    {
        Schema::create('receipt_print_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('sale_id')->nullable();
            $table->unsignedBigInteger('invoice_id')->nullable();
            $table->enum('print_type', ['original', 'copy']);
            $table->unsignedBigInteger('printed_by');
            $table->dateTime('printed_at', 3)->useCurrent();

            $table->index(['sale_id'], 'idx_rpl_sale');
            $table->index(['invoice_id'], 'idx_rpl_invoice');
            $table->foreign('sale_id', 'fk_rpl_sale')->references('id')->on('sales');
            $table->foreign('invoice_id', 'fk_rpl_invoice')->references('id')->on('receivable_invoices');
            $table->foreign('printed_by', 'fk_rpl_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('receipt_print_logs');
    }
};
