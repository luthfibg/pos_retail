<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Satu jenis penjualan (K1/K2 lama tidak dimodelkan); kasir tercatat per transaksi.
     */
    public function up(): void
    {
        Schema::create('sales', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->unsignedBigInteger('shift_id');
            $table->unsignedBigInteger('cashier_id');
            $table->unsignedBigInteger('customer_id')->nullable();
            $table->enum('payment_mode', ['cash', 'payroll_credit']);
            $table->decimal('subtotal', 18, 2)->default(0);
            $table->decimal('discount_total', 18, 2)->default(0);
            $table->decimal('tax_rate_snapshot', 5, 2)->nullable()->comment('hanya untuk mode cash (bila PPN aktif)');
            $table->decimal('tax_amount', 18, 2)->default(0);
            $table->decimal('total', 18, 2)->default(0);
            $table->enum('status', ['draft', 'posted', 'voided'])->default('draft');
            $table->enum('billing_status', ['not_applicable', 'unbilled', 'invoiced', 'paid'])->default('not_applicable');
            $table->unsignedBigInteger('billing_period_id')->nullable();
            $table->unsignedBigInteger('invoice_id')->nullable();
            $table->boolean('over_limit_flag')->default(false)->comment('label "melebihi batas"');
            $table->unsignedBigInteger('credit_exception_by')->nullable();
            $table->string('credit_exception_note', 255)->nullable();
            $table->char('idempotency_key', 36);
            $table->dateTime('posted_at', 3)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['store_id', 'doc_number'], 'uq_sales_number');
            $table->unique(['idempotency_key'], 'uq_sales_idem');
            $table->index(['shift_id'], 'idx_sales_shift');
            $table->index(['customer_id', 'billing_status'], 'idx_sales_customer');
            $table->index(['billing_period_id'], 'idx_sales_period');
            $table->index(['posted_at'], 'idx_sales_posted');
            $table->foreign('shift_id', 'fk_sales_shift')->references('id')->on('cash_shifts');
            $table->foreign('cashier_id', 'fk_sales_cashier')->references('id')->on('users');
            $table->foreign('customer_id', 'fk_sales_customer')->references('id')->on('customers');
            $table->foreign('billing_period_id', 'fk_sales_period')->references('id')->on('billing_periods');
            $table->foreign('invoice_id', 'fk_sales_invoice')->references('id')->on('receivable_invoices');
            $table->foreign('credit_exception_by', 'fk_sales_exc')->references('id')->on('users');
        });

        DB::statement("ALTER TABLE `sales` ADD CONSTRAINT chk_sales_credit_customer CHECK (payment_mode <> 'payroll_credit' OR customer_id IS NOT NULL)");
    }

    public function down(): void
    {
        Schema::dropIfExists('sales');
    }
};
