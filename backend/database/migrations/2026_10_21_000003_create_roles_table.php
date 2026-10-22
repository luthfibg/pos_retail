<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->string('name', 60);
            $table->string('description', 255)->nullable();
            $table->boolean('is_system')->default(false);
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['name'], 'uq_roles_name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('roles');
    }
};
