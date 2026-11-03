<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('registers')->orderBy('id')->get(['id', 'store_id', 'name'])->each(function ($register) {
            $exists = DB::table('fund_accounts')
                ->where('store_id', $register->store_id)
                ->where('register_id', $register->id)
                ->where('type', 'petty_cash')
                ->exists();
            if ($exists) {
                return;
            }

            DB::table('fund_accounts')->insert([
                'store_id' => $register->store_id,
                'type' => 'petty_cash',
                'name' => 'Kas Kecil - '.$register->name,
                'register_id' => $register->id,
                'is_active' => true,
            ]);
        });
    }

    public function down(): void
    {
        // Keep cash accounts: they may have ledger history and are not safe to delete.
    }
};
