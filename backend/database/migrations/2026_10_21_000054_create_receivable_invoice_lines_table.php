<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('receivable_invoice_lines', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('invoice_id');
            $table->unsignedBigInteger('customer_id');
            $table->unsignedBigInteger('sale_id');
            $table->decimal('amount', 18, 2);

            $table->unique(['sale_id'], 'uq_ril_sale');
            $table->index(['invoice_id', 'customer_id'], 'idx_ril_invoice');
            $table->foreign('invoice_id', 'fk_ril_invoice')->references('id')->on('receivable_invoices');
            $table->foreign('customer_id', 'fk_ril_customer')->references('id')->on('customers');
            $table->foreign('sale_id', 'fk_ril_sale')->references('id')->on('sales');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('receivable_invoice_lines');
    }
};
