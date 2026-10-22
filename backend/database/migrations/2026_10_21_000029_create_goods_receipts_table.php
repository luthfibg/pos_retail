<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Penerimaan wajib dari PO (po_id NOT NULL). Tanggal kadaluarsa diisi per item
     * untuk produk dengan track_expiry = 1.
     */
    public function up(): void
    {
        Schema::create('goods_receipts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->unsignedBigInteger('po_id');
            $table->unsignedBigInteger('supplier_id');
            $table->string('delivery_note_no', 60)->nullable();
            $table->string('invoice_no', 60)->nullable();
            $table->unsignedBigInteger('receiving_location_id');
            $table->enum('status', ['draft', 'checked', 'posted', 'cancelled'])->default('draft');
            $table->enum('document_status', ['pending', 'verified'])->default('pending');
            $table->unsignedBigInteger('received_by');
            $table->dateTime('posted_at', 3)->nullable();
            $table->unsignedBigInteger('verified_by')->nullable();
            $table->dateTime('verified_at', 3)->nullable();
            $table->string('note', 500)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'doc_number'], 'uq_gr_number');
            $table->index(['po_id'], 'idx_gr_po');
            $table->foreign('po_id', 'fk_gr_po')->references('id')->on('purchase_orders');
            $table->foreign('supplier_id', 'fk_gr_supplier')->references('id')->on('suppliers');
            $table->foreign('receiving_location_id', 'fk_gr_loc')->references('id')->on('locations');
            $table->foreign('received_by', 'fk_gr_receiver')->references('id')->on('users');
            $table->foreign('verified_by', 'fk_gr_verifier')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('goods_receipts');
    }
};
