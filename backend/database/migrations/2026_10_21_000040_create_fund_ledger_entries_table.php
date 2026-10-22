<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Ledger append-only; saldo = SUM(amount). amount bertanda (+/-).
     */
    public function up(): void
    {
        Schema::create('fund_ledger_entries', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('fund_account_id');
            $table->string('entry_type', 30)->comment('opening, deposit_out, deposit_in, ...');
            $table->decimal('amount', 18, 2);
            $table->string('ref_type', 40);
            $table->unsignedBigInteger('ref_id');
            $table->dateTime('occurred_at', 3);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->string('note', 255)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['fund_account_id', 'occurred_at'], 'idx_fle_account');
            $table->index(['ref_type', 'ref_id'], 'idx_fle_ref');
            $table->foreign('fund_account_id', 'fk_fle_account')->references('id')->on('fund_accounts');
            $table->foreign('created_by', 'fk_fle_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fund_ledger_entries');
    }
};
