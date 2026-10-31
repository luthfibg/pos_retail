<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_operators', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id')->primary();
            $table->unsignedBigInteger('granted_by')->nullable();
            $table->boolean('is_active')->default(true);
            $table->dateTime('created_at', 3)->useCurrent();

            $table->foreign('user_id', 'fk_platform_operator_user')->references('id')->on('users');
            $table->foreign('granted_by', 'fk_platform_operator_granter')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_operators');
    }
};
