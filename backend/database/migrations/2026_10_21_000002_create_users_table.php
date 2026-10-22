<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150);
            $table->string('username', 60);
            $table->string('email', 190)->nullable();
            $table->string('password_hash', 255);
            $table->boolean('is_active')->default(true);
            $table->dateTime('last_login_at', 3)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->unique(['username'], 'uq_users_username');
            $table->unique(['email'], 'uq_users_email');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
