<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Tarif PPN: R-04 ditunda; price_includes_tax NULL = belum diputuskan
     */
    public function up(): void
    {
        Schema::create('tax_rates', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('name', 60);
            $table->decimal('rate', 5, 2);
            $table->boolean('price_includes_tax')->nullable();
            $table->date('effective_from');
            $table->unsignedBigInteger('created_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['store_id', 'effective_from'], 'idx_tax_effective');
            $table->foreign('created_by', 'fk_tax_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tax_rates');
    }
};
