<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cash_shifts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->unsignedBigInteger('register_id');
            $table->unsignedBigInteger('cashier_id');
            $table->decimal('opening_balance', 18, 2)->default(0)->comment('= endapan shift/setoran sebelumnya');
            $table->decimal('expected_cash', 18, 2)->nullable();
            $table->decimal('counted_cash', 18, 2)->nullable();
            $table->decimal('variance', 18, 2)->nullable();
            $table->string('variance_note', 500)->nullable();
            $table->decimal('float_kept', 18, 2)->nullable();
            $table->enum('status', ['open', 'counting', 'closed', 'reviewed'])->default('open');
            $table->dateTime('opened_at', 3);
            $table->dateTime('closed_at', 3)->nullable();
            $table->unsignedBigInteger('reviewed_by')->nullable();
            $table->dateTime('reviewed_at', 3)->nullable();
            $table->unsignedBigInteger('open_register_key')->storedAs('CASE WHEN status IN (\'open\',\'counting\') THEN register_id ELSE NULL END');

            $table->unique(['store_id', 'doc_number'], 'uq_shift_number');
            $table->unique(['open_register_key'], 'uq_shift_one_open');
            $table->index(['cashier_id', 'opened_at'], 'idx_shift_cashier');
            $table->foreign('register_id', 'fk_shift_register')->references('id')->on('registers');
            $table->foreign('cashier_id', 'fk_shift_cashier')->references('id')->on('users');
            $table->foreign('reviewed_by', 'fk_shift_reviewer')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_shifts');
    }
};
