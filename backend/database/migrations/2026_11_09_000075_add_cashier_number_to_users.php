<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('cashier_number', 16)->nullable()->unique();
        });

        Schema::create('cashier_number_sequences', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedInteger('next_number');
        });

        DB::table('cashier_number_sequences')->insert(['id' => 1, 'next_number' => 1]);
        $cashierIds = DB::table('user_roles as ur')
            ->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('r.name', 'Kasir')
            ->distinct()
            ->orderBy('ur.user_id')
            ->pluck('ur.user_id');

        foreach ($cashierIds as $index => $userId) {
            DB::table('users')->where('id', $userId)->update([
                'cashier_number' => 'K'.str_pad((string) ($index + 1), 3, '0', STR_PAD_LEFT),
            ]);
        }

        DB::table('cashier_number_sequences')->where('id', 1)->update([
            'next_number' => $cashierIds->count() + 1,
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('cashier_number_sequences');

        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_cashier_number_unique');
            $table->dropColumn('cashier_number');
        });
    }
};
