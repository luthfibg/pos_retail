<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('registers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('name', 60);
            $table->boolean('is_active')->default(true);

            $table->foreign('store_id', 'fk_reg_store')->references('id')->on('stores');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('registers');
    }
};
