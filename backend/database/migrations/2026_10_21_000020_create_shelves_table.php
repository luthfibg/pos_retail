<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shelves', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('location_id');
            $table->string('code', 30);
            $table->string('name', 100);
            $table->unsignedBigInteger('category_id')->nullable();
            $table->smallInteger('layout_x')->default(0);
            $table->smallInteger('layout_y')->default(0);
            $table->smallInteger('layout_w')->default(1);
            $table->smallInteger('layout_h')->default(1);
            $table->boolean('is_active')->default(true);

            $table->unique(['location_id', 'code'], 'uq_shelves_code');
            $table->foreign('location_id', 'fk_shelves_loc')->references('id')->on('locations');
            $table->foreign('category_id', 'fk_shelves_cat')->references('id')->on('categories');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shelves');
    }
};
