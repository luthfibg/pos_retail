<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Penomoran dokumen: dikunci dengan SELECT ... FOR UPDATE dalam transaksi
     */
    public function up(): void
    {
        Schema::create('number_sequences', function (Blueprint $table) {
            $table->unsignedBigInteger('store_id');
            $table->string('doc_type', 30)->comment('SALE, PR, PO, GR, SHIFT, INV, ...');
            $table->string('period_key', 10)->comment('contoh: 202610');
            $table->unsignedBigInteger('last_number')->default(0);

            $table->primary(['store_id', 'doc_type', 'period_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('number_sequences');
    }
};
