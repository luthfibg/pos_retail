<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Override permission per user (opsional, untuk delegasi fungsi tanpa membuat role baru)
     */
    public function up(): void
    {
        Schema::create('user_permissions', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('permission_id');
            $table->unsignedBigInteger('store_id');
            $table->enum('effect', ['allow', 'deny'])->default('allow');

            $table->primary(['user_id', 'permission_id', 'store_id']);
            $table->foreign('user_id', 'fk_up_user')->references('id')->on('users');
            $table->foreign('permission_id', 'fk_up_perm')->references('id')->on('permissions');
            $table->foreign('store_id', 'fk_up_store')->references('id')->on('stores');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_permissions');
    }
};
