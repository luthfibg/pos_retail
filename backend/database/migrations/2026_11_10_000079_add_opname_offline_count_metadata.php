<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_opname_count_logs', function (Blueprint $table) {
            $table->dateTime('client_created_at', 3)->nullable()->after('created_by');
            $table->boolean('via_batch')->default(false)->after('client_created_at');
        });
    }

    public function down(): void
    {
        Schema::table('stock_opname_count_logs', function (Blueprint $table) {
            $table->dropColumn(['client_created_at', 'via_batch']);
        });
    }
};
