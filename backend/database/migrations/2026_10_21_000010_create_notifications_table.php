<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->unsignedBigInteger('user_id');
            $table->string('type', 60)->comment('contoh: customer.limit_needed');
            $table->string('entity_type', 60)->nullable();
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('message', 500);
            $table->dateTime('read_at', 3)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['user_id', 'read_at', 'created_at'], 'idx_notif_user');
            $table->foreign('user_id', 'fk_notif_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
