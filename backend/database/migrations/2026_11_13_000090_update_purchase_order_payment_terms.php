<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->enum('payment_terms', ['prepaid', 'credit', 'cod', 'top', 'cbd'])->change();
            $table->unsignedSmallInteger('payment_term_days')->nullable()->after('payment_terms');
        });

        DB::table('purchase_orders')->where('payment_terms', 'credit')->update(['payment_terms' => 'top']);
        DB::table('purchase_orders')->where('payment_terms', 'prepaid')->update(['payment_terms' => 'cbd']);

        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->enum('payment_terms', ['top', 'cbd', 'cod'])->change();
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->enum('payment_terms', ['top', 'cbd', 'cod', 'prepaid', 'credit'])->change();
        });

        DB::table('purchase_orders')->where('payment_terms', 'top')->update(['payment_terms' => 'credit']);
        DB::table('purchase_orders')->where('payment_terms', 'cbd')->update(['payment_terms' => 'prepaid']);

        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn('payment_term_days');
            $table->enum('payment_terms', ['prepaid', 'credit', 'cod'])->change();
        });
    }
};
