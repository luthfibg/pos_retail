<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('permissions', function (Blueprint $table) {
            $table->id();
            $table->string('code', 80);
            $table->string('module', 40);
            $table->string('description', 255)->nullable();

            $table->unique(['code'], 'uq_permissions_code');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('permissions');
    }
};
