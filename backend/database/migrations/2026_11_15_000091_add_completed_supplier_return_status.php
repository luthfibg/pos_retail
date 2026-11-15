<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(
            "ALTER TABLE supplier_returns MODIFY status ENUM('draft', 'submitted', 'accepted', 'rejected', 'replacement_received', 'written_off', 'cancelled', 'completed') NOT NULL DEFAULT 'completed'"
        );
    }

    public function down(): void
    {
        DB::table('supplier_returns')->where('status', 'completed')->update(['status' => 'written_off']);
        DB::statement(
            "ALTER TABLE supplier_returns MODIFY status ENUM('draft', 'submitted', 'accepted', 'rejected', 'replacement_received', 'written_off', 'cancelled') NOT NULL DEFAULT 'draft'"
        );
    }
};
