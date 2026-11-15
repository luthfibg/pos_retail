<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_opname_items', function (Blueprint $table) {
            $table->decimal('reconciliation_diff_qty', 18, 3)->nullable()->after('reconciliation_action');
            $table->decimal('reconciliation_diff_good_qty', 18, 3)->nullable()->after('reconciliation_diff_qty');
            $table->decimal('reconciliation_diff_damaged_qty', 18, 3)->nullable()->after('reconciliation_diff_good_qty');
        });
    }

    public function down(): void
    {
        Schema::table('stock_opname_items', function (Blueprint $table) {
            $table->dropColumn([
                'reconciliation_diff_qty',
                'reconciliation_diff_good_qty',
                'reconciliation_diff_damaged_qty',
            ]);
        });
    }
};
