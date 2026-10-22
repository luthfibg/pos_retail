<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->unsignedBigInteger('parent_id')->nullable();
            $table->string('name', 120);
            $table->boolean('is_active')->default(true);
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['parent_id'], 'idx_cat_parent');
            $table->foreign('parent_id', 'fk_cat_parent')->references('id')->on('categories');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('categories');
    }
};
