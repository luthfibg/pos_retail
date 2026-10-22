<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('float_proposals', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->enum('scope', ['petty_cash', 'main_cash']);
            $table->unsignedBigInteger('proposed_by');
            $table->enum('mode', ['fixed', 'percent']);
            $table->decimal('fixed_amount', 18, 2)->nullable();
            $table->decimal('percent', 5, 2)->nullable();
            $table->enum('percent_base', ['cash_sales_shift', 'cash_on_hand'])->nullable();
            $table->string('reason', 500)->nullable();
            $table->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->unsignedBigInteger('decided_by')->nullable();
            $table->dateTime('decided_at', 3)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->foreign('proposed_by', 'fk_fprop_proposer')->references('id')->on('users');
            $table->foreign('decided_by', 'fk_fprop_decider')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('float_proposals');
    }
};
