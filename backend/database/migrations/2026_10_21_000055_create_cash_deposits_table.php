<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cash_deposits', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->enum('kind', ['partial', 'final']);
            $table->unsignedBigInteger('shift_id');
            $table->unsignedBigInteger('source_fund_id');
            $table->unsignedBigInteger('destination_fund_id');
            $table->decimal('counted_amount', 18, 2)->comment('kas fisik terhitung saat setoran');
            $table->decimal('float_kept', 18, 2)->comment('endapan yang tinggal di laci');
            $table->decimal('deposit_amount', 18, 2)->comment('dibulatkan ke bawah (rounding_unit)');
            $table->unsignedBigInteger('policy_id')->nullable();
            $table->enum('status', ['draft', 'submitted', 'received', 'discrepancy', 'corrected'])->default('draft');
            $table->decimal('received_amount', 18, 2)->nullable();
            $table->unsignedBigInteger('received_by')->nullable();
            $table->dateTime('received_at', 3)->nullable();
            $table->string('note', 500)->nullable();
            $table->unsignedBigInteger('created_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['store_id', 'doc_number'], 'uq_cd_number');
            $table->index(['shift_id'], 'idx_cd_shift');
            $table->foreign('shift_id', 'fk_cd_shift')->references('id')->on('cash_shifts');
            $table->foreign('source_fund_id', 'fk_cd_source')->references('id')->on('fund_accounts');
            $table->foreign('destination_fund_id', 'fk_cd_dest')->references('id')->on('fund_accounts');
            $table->foreign('policy_id', 'fk_cd_policy')->references('id')->on('float_policies');
            $table->foreign('received_by', 'fk_cd_receiver')->references('id')->on('users');
            $table->foreign('created_by', 'fk_cd_creator')->references('id')->on('users');
        });

        DB::statement("ALTER TABLE `cash_deposits` ADD CONSTRAINT chk_cd_amounts CHECK (counted_amount >= 0 AND float_kept >= 0 AND deposit_amount >= 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_deposits');
    }
};
