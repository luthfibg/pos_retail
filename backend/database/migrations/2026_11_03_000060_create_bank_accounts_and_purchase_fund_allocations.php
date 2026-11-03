<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bank_accounts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('bank_name', 100);
            $table->string('account_name', 150);
            $table->string('account_number', 60);
            $table->boolean('is_active')->default(true);
            $table->unsignedBigInteger('created_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['store_id', 'account_number'], 'uq_bank_account_store_number');
            $table->foreign('store_id', 'fk_bank_account_store')->references('id')->on('stores');
            $table->foreign('created_by', 'fk_bank_account_user')->references('id')->on('users');
        });

        Schema::create('bank_account_ledger_entries', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('bank_account_id');
            $table->string('entry_type', 40);
            $table->decimal('amount', 18, 2);
            $table->string('ref_type', 40)->nullable();
            $table->unsignedBigInteger('ref_id')->nullable();
            $table->string('note', 255);
            $table->unsignedBigInteger('created_by');
            $table->dateTime('occurred_at', 3);
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['bank_account_id', 'occurred_at'], 'idx_bank_ledger_account');
            $table->index(['ref_type', 'ref_id'], 'idx_bank_ledger_ref');
            $table->foreign('bank_account_id', 'fk_bank_ledger_account')->references('id')->on('bank_accounts');
            $table->foreign('created_by', 'fk_bank_ledger_user')->references('id')->on('users');
        });

        Schema::create('purchase_fund_allocations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->unsignedBigInteger('purchase_order_id');
            $table->unsignedBigInteger('bank_account_id');
            $table->decimal('amount', 18, 2);
            $table->enum('status', ['reserved', 'released'])->default('reserved');
            $table->unsignedBigInteger('allocated_by');
            $table->unsignedBigInteger('released_by')->nullable();
            $table->string('release_reason', 255)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('released_at', 3)->nullable();

            $table->index(['purchase_order_id', 'status'], 'idx_pfa_po_status');
            $table->index(['store_id', 'status'], 'idx_pfa_store_status');
            $table->foreign('store_id', 'fk_pfa_store')->references('id')->on('stores');
            $table->foreign('purchase_order_id', 'fk_pfa_po')->references('id')->on('purchase_orders');
            $table->foreign('bank_account_id', 'fk_pfa_bank')->references('id')->on('bank_accounts');
            $table->foreign('allocated_by', 'fk_pfa_allocator')->references('id')->on('users');
            $table->foreign('released_by', 'fk_pfa_releaser')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_fund_allocations');
        Schema::dropIfExists('bank_account_ledger_entries');
        Schema::dropIfExists('bank_accounts');
    }
};
