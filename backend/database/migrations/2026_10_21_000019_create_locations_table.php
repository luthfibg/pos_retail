<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('locations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->enum('type', ['warehouse', 'store_floor']);
            $table->string('name', 100);
            $table->boolean('is_active')->default(true);

            $table->foreign('store_id', 'fk_loc_store')->references('id')->on('stores');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('locations');
    }
};
