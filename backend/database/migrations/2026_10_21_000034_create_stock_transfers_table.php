<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Transfer (gudang -> rak, antar-rak). Bukan adjustment.
     */
    public function up(): void
    {
        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('doc_number', 30);
            $table->unsignedBigInteger('from_location_id');
            $table->unsignedBigInteger('to_location_id');
            $table->enum('status', ['draft', 'posted', 'cancelled'])->default('draft');
            $table->unsignedBigInteger('created_by');
            $table->unsignedBigInteger('posted_by')->nullable();
            $table->dateTime('posted_at', 3)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['store_id', 'doc_number'], 'uq_st_number');
            $table->foreign('from_location_id', 'fk_st_from')->references('id')->on('locations');
            $table->foreign('to_location_id', 'fk_st_to')->references('id')->on('locations');
            $table->foreign('created_by', 'fk_st_creator')->references('id')->on('users');
            $table->foreign('posted_by', 'fk_st_poster')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_transfers');
    }
};
