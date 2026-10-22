<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sale_voids', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('sale_id');
            $table->string('reason', 500);
            $table->unsignedBigInteger('requested_by');
            $table->unsignedBigInteger('approved_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['sale_id'], 'uq_sv_sale');
            $table->foreign('sale_id', 'fk_sv_sale')->references('id')->on('sales');
            $table->foreign('requested_by', 'fk_sv_req')->references('id')->on('users');
            $table->foreign('approved_by', 'fk_sv_app')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_voids');
    }
};
