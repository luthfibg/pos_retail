<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->renameColumn('avg_cost', 'unit_cost');
            $table->dropColumn('last_cost');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->renameColumn('unit_cost', 'avg_cost');
            $table->decimal('last_cost', 18, 2)->nullable()->after('avg_cost');
        });
    }
};
