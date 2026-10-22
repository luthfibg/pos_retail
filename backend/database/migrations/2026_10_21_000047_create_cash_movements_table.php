<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cash_movements', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('shift_id');
            $table->enum('type', ['in', 'out']);
            $table->decimal('amount', 18, 2);
            $table->string('reason', 255);
            $table->unsignedBigInteger('created_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['shift_id'], 'idx_cm_shift');
            $table->foreign('shift_id', 'fk_cm_shift')->references('id')->on('cash_shifts');
            $table->foreign('created_by', 'fk_cm_user')->references('id')->on('users');
        });

        DB::statement("ALTER TABLE `cash_movements` ADD CONSTRAINT chk_cm_amount CHECK (amount > 0)");
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_movements');
    }
};
