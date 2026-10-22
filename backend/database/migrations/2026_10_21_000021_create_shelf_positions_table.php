<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shelf_positions', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('shelf_id');
            $table->unsignedTinyInteger('level')->default(1);
            $table->unsignedSmallInteger('slot')->default(1);

            $table->unique(['shelf_id', 'level', 'slot'], 'uq_shelf_pos');
            $table->foreign('shelf_id', 'fk_sp_shelf')->references('id')->on('shelves');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shelf_positions');
    }
};
