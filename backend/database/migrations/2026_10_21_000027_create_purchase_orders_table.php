<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * PO wajib berasal dari PR (pr_id NOT NULL). Status dokumen, penerimaan, pembayaran dipisah.
     */
    public function up(): void
    {
        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->unsignedBigInteger('pr_id');
            $table->unsignedBigInteger('supplier_id');
            $table->enum('payment_terms', ['prepaid', 'credit', 'cod']);
            $table->decimal('total', 18, 2)->default(0);
            $table->enum('status', ['draft', 'pending_confirmation', 'approved', 'sent', 'partially_received', 'received', 'cancelled'])->default('draft');
            $table->enum('receipt_status', ['none', 'partial', 'complete'])->default('none');
            $table->enum('payment_status', ['unpaid', 'partial', 'paid'])->default('unpaid');
            $table->date('order_date');
            $table->date('expected_date')->nullable();
            $table->unsignedBigInteger('created_by');
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'doc_number'], 'uq_po_number');
            $table->index(['status'], 'idx_po_status');
            $table->foreign('pr_id', 'fk_po_pr')->references('id')->on('purchase_requisitions');
            $table->foreign('supplier_id', 'fk_po_supplier')->references('id')->on('suppliers');
            $table->foreign('created_by', 'fk_po_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_orders');
    }
};
