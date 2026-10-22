<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('suppliers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('code', 30);
            $table->string('name', 150);
            $table->string('contact_name', 120)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('address', 255)->nullable();
            $table->enum('default_payment_terms', ['prepaid', 'credit', 'cod'])->default('prepaid');
            $table->boolean('is_active')->default(true);
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'code'], 'uq_suppliers_code');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('suppliers');
    }
};
