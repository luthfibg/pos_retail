<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('float_policies', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->enum('scope', ['petty_cash', 'main_cash']);
            $table->enum('mode', ['fixed', 'percent']);
            $table->decimal('fixed_amount', 18, 2)->nullable();
            $table->decimal('percent', 5, 2)->nullable();
            $table->enum('percent_base', ['cash_sales_shift', 'cash_on_hand'])->nullable();
            $table->decimal('min_amount', 18, 2)->nullable()->comment('NULL = tanpa batas');
            $table->decimal('max_amount', 18, 2)->nullable();
            $table->unsignedInteger('rounding_unit')->default(1000)->comment('pembulatan setoran ke bawah');
            $table->boolean('is_active')->default(true);
            $table->dateTime('effective_from', 3)->useCurrent();
            $table->unsignedBigInteger('set_by');

            $table->index(['store_id', 'scope', 'is_active'], 'idx_fp_scope');
            $table->foreign('set_by', 'fk_fp_user')->references('id')->on('users');
        });

        DB::statement("ALTER TABLE `float_policies` ADD CONSTRAINT chk_fp_mode CHECK ((mode = 'fixed' AND fixed_amount IS NOT NULL) OR (mode = 'percent' AND percent IS NOT NULL AND percent_base IS NOT NULL))");
    }

    public function down(): void
    {
        Schema::dropIfExists('float_policies');
    }
};
