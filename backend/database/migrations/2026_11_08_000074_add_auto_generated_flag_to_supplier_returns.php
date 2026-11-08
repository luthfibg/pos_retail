<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_returns', function (Blueprint $table) {
            $table->boolean('is_auto_generated')->default(false)->after('return_type');
        });
    }

    public function down(): void
    {
        Schema::table('supplier_returns', function (Blueprint $table) {
            $table->dropColumn('is_auto_generated');
        });
    }
};
