<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('setting_key', 100);
            $table->json('setting_value');
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['store_id', 'setting_key'], 'uq_settings');
            $table->foreign('store_id', 'fk_settings_store')->references('id')->on('stores');
            $table->foreign('updated_by', 'fk_settings_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settings');
    }
};
