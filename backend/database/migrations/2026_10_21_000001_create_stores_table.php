<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stores', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20);
            $table->string('name', 150);
            $table->string('timezone', 64)->default('Asia/Jakarta');
            $table->char('currency', 3)->default('IDR');
            $table->boolean('is_active')->default(true);
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['code'], 'uq_stores_code');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stores');
    }
};
