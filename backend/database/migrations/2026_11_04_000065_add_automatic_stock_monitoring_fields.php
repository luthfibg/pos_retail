<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->decimal('restock_quantity', 18, 3)->default(0)->after('critical_stock');
        });

        Schema::table('purchase_requisitions', function (Blueprint $table) {
            $table->boolean('is_auto_generated')->default(false)->after('status');
        });

        DB::statement(
            "ALTER TABLE `purchase_requisitions` ".
            "ADD COLUMN `auto_draft_store_key` BIGINT UNSIGNED GENERATED ALWAYS AS ".
            "(IF(`is_auto_generated` = 1 AND `status` = 'draft', `store_id`, NULL)) STORED, ".
            "ADD UNIQUE KEY `uq_auto_pr_draft_store` (`auto_draft_store_key`)"
        );
    }

    public function down(): void
    {
        DB::statement(
            'ALTER TABLE `purchase_requisitions` '.
            'DROP INDEX `uq_auto_pr_draft_store`, DROP COLUMN `auto_draft_store_key`'
        );

        Schema::table('purchase_requisitions', function (Blueprint $table) {
            $table->dropColumn('is_auto_generated');
        });

        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('restock_quantity');
        });
    }
};
