<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cash_shifts', function (Blueprint $table) {
            $table->string('doc_number', 180)->change();
        });
    }

    public function down(): void
    {
        if (DB::table('cash_shifts')->whereRaw('CHAR_LENGTH(doc_number) > 30')->exists()) {
            throw new RuntimeException('Cannot shrink shift document numbers while values exceed 30 characters.');
        }

        Schema::table('cash_shifts', function (Blueprint $table) {
            $table->string('doc_number', 30)->change();
        });
    }
};
