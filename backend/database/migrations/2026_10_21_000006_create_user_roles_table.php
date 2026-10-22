<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_roles', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('role_id');
            $table->unsignedBigInteger('store_id');

            $table->primary(['user_id', 'role_id', 'store_id']);
            $table->foreign('user_id', 'fk_ur_user')->references('id')->on('users');
            $table->foreign('role_id', 'fk_ur_role')->references('id')->on('roles');
            $table->foreign('store_id', 'fk_ur_store')->references('id')->on('stores');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_roles');
    }
};
