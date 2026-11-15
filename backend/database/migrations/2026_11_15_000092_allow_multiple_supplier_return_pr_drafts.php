<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(
            'ALTER TABLE `purchase_requisitions` '.
            'DROP INDEX `uq_auto_pr_draft_store`, DROP COLUMN `auto_draft_store_key`'
        );
        DB::statement(
            'ALTER TABLE `purchase_requisitions` '.
            'ADD COLUMN `auto_draft_store_key` BIGINT UNSIGNED GENERATED ALWAYS AS '.
            "(IF(`is_auto_generated` = 1 AND `status` = 'draft' AND `reason` = 'Pemantauan stok otomatis', `store_id`, NULL)) STORED, ".
            'ADD UNIQUE KEY `uq_auto_pr_draft_store` (`auto_draft_store_key`)'
        );
    }

    public function down(): void
    {
        DB::table('purchase_requisitions')
            ->where('is_auto_generated', 1)
            ->where('status', 'draft')
            ->where('reason', '<>', 'Pemantauan stok otomatis')
            ->update(['is_auto_generated' => 0]);

        DB::statement(
            'ALTER TABLE `purchase_requisitions` '.
            'DROP INDEX `uq_auto_pr_draft_store`, DROP COLUMN `auto_draft_store_key`'
        );
        DB::statement(
            'ALTER TABLE `purchase_requisitions` '.
            'ADD COLUMN `auto_draft_store_key` BIGINT UNSIGNED GENERATED ALWAYS AS '.
            "(IF(`is_auto_generated` = 1 AND `status` = 'draft', `store_id`, NULL)) STORED, ".
            'ADD UNIQUE KEY `uq_auto_pr_draft_store` (`auto_draft_store_key`)'
        );
    }
};
