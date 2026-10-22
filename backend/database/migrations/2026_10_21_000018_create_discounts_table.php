<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Diskon hanya ditetapkan Admin; kasir tidak dapat memberi diskon manual
     */
    public function up(): void
    {
        Schema::create('discounts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('name', 120);
            $table->enum('target_type', ['product', 'category']);
            $table->unsignedBigInteger('target_id');
            $table->enum('discount_type', ['percent', 'amount']);
            $table->decimal('value', 18, 2);
            $table->dateTime('starts_at', 3);
            $table->dateTime('ends_at', 3)->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedBigInteger('created_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['target_type', 'target_id', 'is_active'], 'idx_disc_target');
            $table->foreign('created_by', 'fk_disc_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('discounts');
    }
};
