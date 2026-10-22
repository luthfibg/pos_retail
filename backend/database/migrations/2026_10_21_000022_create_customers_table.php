<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Karyawan pabrik sebagai pelanggan. Kasir boleh membuat (pending_verification);
     * Admin memverifikasi dan menetapkan batas kredit.
     */
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('customer_no', 40)->comment('nomor induk karyawan');
            $table->string('name', 150);
            $table->string('department', 100)->nullable();
            $table->enum('status', ['pending_verification', 'active', 'inactive'])->default('pending_verification');
            $table->unsignedBigInteger('created_by');
            $table->unsignedBigInteger('verified_by')->nullable();
            $table->dateTime('verified_at', 3)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'customer_no'], 'uq_customers_no');
            $table->index(['name'], 'idx_customers_name');
            $table->foreign('created_by', 'fk_cust_creator')->references('id')->on('users');
            $table->foreign('verified_by', 'fk_cust_verifier')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};
