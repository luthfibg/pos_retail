<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('invoice_id');
            $table->decimal('amount', 18, 2);
            $table->dateTime('received_at', 3);
            $table->string('reference', 100)->nullable();
            $table->string('note', 255)->nullable();
            $table->unsignedBigInteger('recorded_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['invoice_id'], 'idx_ip_invoice');
            $table->foreign('invoice_id', 'fk_ip_invoice')->references('id')->on('receivable_invoices');
            $table->foreign('recorded_by', 'fk_ip_user')->references('id')->on('users');
        });

        DB::statement("ALTER TABLE `invoice_payments` ADD CONSTRAINT chk_ip_amount CHECK (amount > 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_payments');
    }
};
