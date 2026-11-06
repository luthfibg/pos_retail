<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_returns', function (Blueprint $table) {
            $table->enum('return_type', ['incoming', 'outgoing'])->default('outgoing')->after('supplier_id');
            $table->unsignedBigInteger('goods_receipt_id')->nullable()->after('return_type');
            $table->string('invoice_no', 60)->nullable()->after('goods_receipt_id');
            $table->foreign('goods_receipt_id', 'fk_sr_gr')->references('id')->on('goods_receipts');
        });

        Schema::table('supplier_return_items', function (Blueprint $table) {
            $table->unsignedBigInteger('goods_receipt_item_id')->nullable()->after('supplier_return_id');
            $table->unsignedBigInteger('source_po_item_id')->nullable()->after('goods_receipt_item_id');
            $table->unsignedBigInteger('replacement_goods_receipt_item_id')->nullable()->after('source_po_item_id');
            $table->enum('disposition', ['direct_return', 'quarantine'])->nullable()->after('source_bucket');
            $table->foreign('goods_receipt_item_id', 'fk_sri_gri')->references('id')->on('goods_receipt_items');
            $table->foreign('source_po_item_id', 'fk_sri_source_poi')->references('id')->on('purchase_order_items');
            $table->foreign('replacement_goods_receipt_item_id', 'fk_sri_replacement_gri')->references('id')->on('goods_receipt_items');
        });

        Schema::table('goods_receipts', function (Blueprint $table) {
            $table->unsignedBigInteger('supplier_return_id')->nullable()->after('po_id');
            $table->foreign('supplier_return_id', 'fk_gr_supplier_return')->references('id')->on('supplier_returns');
        });

        Schema::table('goods_receipt_items', function (Blueprint $table) {
            $table->enum('damage_disposition', ['direct_return', 'quarantine'])->nullable()->after('qty_damaged');
            $table->unsignedBigInteger('supplier_return_item_id')->nullable()->after('damage_disposition');
            $table->foreign('supplier_return_item_id', 'fk_gri_supplier_return_item')->references('id')->on('supplier_return_items');
        });
    }

    public function down(): void
    {
        Schema::table('goods_receipt_items', function (Blueprint $table) {
            $table->dropForeign('fk_gri_supplier_return_item');
            $table->dropColumn('supplier_return_item_id');
            $table->dropColumn('damage_disposition');
        });

        Schema::table('goods_receipts', function (Blueprint $table) {
            $table->dropForeign('fk_gr_supplier_return');
            $table->dropColumn('supplier_return_id');
        });

        Schema::table('supplier_return_items', function (Blueprint $table) {
            $table->dropForeign('fk_sri_gri');
            $table->dropForeign('fk_sri_source_poi');
            $table->dropForeign('fk_sri_replacement_gri');
            $table->dropColumn(['goods_receipt_item_id', 'source_po_item_id', 'replacement_goods_receipt_item_id', 'disposition']);
        });

        Schema::table('supplier_returns', function (Blueprint $table) {
            $table->dropForeign('fk_sr_gr');
            $table->dropColumn(['goods_receipt_id', 'invoice_no', 'return_type']);
        });
    }
};
