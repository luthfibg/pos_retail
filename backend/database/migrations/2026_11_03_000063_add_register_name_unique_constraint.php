<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $duplicate = DB::table('registers')
            ->select('store_id', 'name')
            ->selectRaw('COUNT(*) as total')
            ->groupBy('store_id', 'name')
            ->havingRaw('COUNT(*) > 1')
            ->first();

        if ($duplicate !== null) {
            throw new RuntimeException("Duplicate register name '{$duplicate->name}' in store {$duplicate->store_id}; resolve duplicates before migrating.");
        }

        $duplicateCashAccount = DB::table('fund_accounts')
            ->whereNotNull('register_id')
            ->select('store_id', 'register_id', 'type')
            ->selectRaw('COUNT(*) as total')
            ->groupBy('store_id', 'register_id', 'type')
            ->havingRaw('COUNT(*) > 1')
            ->first();

        if ($duplicateCashAccount !== null) {
            throw new RuntimeException("Duplicate register cash account for register {$duplicateCashAccount->register_id}; resolve duplicates before migrating.");
        }

        Schema::table('registers', function (Blueprint $table) {
            $table->unique(['store_id', 'name'], 'uq_register_store_name');
        });
        Schema::table('fund_accounts', function (Blueprint $table) {
            $table->unique(['store_id', 'register_id', 'type'], 'uq_fund_register_type');
        });
    }

    public function down(): void
    {
        Schema::table('registers', function (Blueprint $table) {
            $table->dropUnique('uq_register_store_name');
        });
        Schema::table('fund_accounts', function (Blueprint $table) {
            $table->dropUnique('uq_fund_register_type');
        });
    }
};
