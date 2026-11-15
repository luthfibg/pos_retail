<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_opname_sessions', function (Blueprint $table) {
            $table->boolean('condition_counting')->default(false)->after('status');
        });

        Schema::table('stock_opname_items', function (Blueprint $table) {
            $table->string('product_sku_snapshot', 60)->nullable()->after('product_name_snapshot');
            $table->decimal('counted_good_qty', 18, 3)->nullable()->after('counted_qty');
            $table->decimal('counted_damaged_qty', 18, 3)->nullable()->after('counted_good_qty');
            $table->decimal('system_good_qty_at_count', 18, 3)->nullable()->after('system_qty_at_count');
            $table->decimal('system_damaged_qty_at_count', 18, 3)->nullable()->after('system_good_qty_at_count');
            $table->decimal('diff_good_qty', 18, 3)->nullable()->after('system_damaged_qty_at_count');
            $table->decimal('diff_damaged_qty', 18, 3)->nullable()->after('diff_good_qty');
        });

        Schema::table('stock_opname_count_logs', function (Blueprint $table) {
            $table->decimal('input_qty', 18, 3)->nullable()->change();
            $table->decimal('counted_before', 18, 3)->nullable()->change();
            $table->decimal('counted_after', 18, 3)->nullable()->change();
            $table->decimal('input_good_qty', 18, 3)->nullable();
            $table->decimal('input_damaged_qty', 18, 3)->nullable();
            $table->decimal('counted_good_before', 18, 3)->nullable();
            $table->decimal('counted_good_after', 18, 3)->nullable();
            $table->decimal('counted_damaged_before', 18, 3)->nullable();
            $table->decimal('counted_damaged_after', 18, 3)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('stock_opname_count_logs', function (Blueprint $table) {
            $table->dropColumn([
                'input_good_qty',
                'input_damaged_qty',
                'counted_good_before',
                'counted_good_after',
                'counted_damaged_before',
                'counted_damaged_after',
            ]);
            $table->unsignedInteger('input_qty')->nullable()->change();
            $table->unsignedInteger('counted_before')->nullable()->change();
            $table->unsignedInteger('counted_after')->nullable()->change();
        });

        Schema::table('stock_opname_items', function (Blueprint $table) {
            $table->dropColumn([
                'product_sku_snapshot',
                'counted_good_qty',
                'counted_damaged_qty',
                'system_good_qty_at_count',
                'system_damaged_qty_at_count',
                'diff_good_qty',
                'diff_damaged_qty',
            ]);
        });

        Schema::table('stock_opname_sessions', function (Blueprint $table) {
            $table->dropColumn('condition_counting');
        });
    }
};
