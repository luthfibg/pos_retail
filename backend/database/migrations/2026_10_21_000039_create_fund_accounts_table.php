<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fund_accounts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->enum('type', ['petty_cash', 'main_cash', 'purchase_fund']);
            $table->string('name', 100);
            $table->unsignedBigInteger('register_id')->nullable();
            $table->unsignedBigInteger('holder_user_id')->nullable();
            $table->boolean('is_active')->default(true);

            $table->foreign('store_id', 'fk_fa_store')->references('id')->on('stores');
            $table->foreign('register_id', 'fk_fa_register')->references('id')->on('registers');
            $table->foreign('holder_user_id', 'fk_fa_holder')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fund_accounts');
    }
};
