<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('role_permissions', function (Blueprint $table) {
            $table->unsignedBigInteger('role_id');
            $table->unsignedBigInteger('permission_id');

            $table->primary(['role_id', 'permission_id']);
            $table->foreign('role_id', 'fk_rp_role')->references('id')->on('roles');
            $table->foreign('permission_id', 'fk_rp_perm')->references('id')->on('permissions');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('role_permissions');
    }
};
