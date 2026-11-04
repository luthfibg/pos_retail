<?php

use Carbon\Carbon;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('billing_periods', function (Blueprint $table) {
            $table->date('period_month')->nullable()->after('store_id');
        });

        DB::table('billing_periods as p')
            ->join('stores as s', 's.id', '=', 'p.store_id')
            ->select(['p.id', 'p.starts_at', 's.timezone'])
            ->orderBy('p.id')
            ->chunk(100, function ($periods) {
                foreach ($periods as $period) {
                    $month = Carbon::parse($period->starts_at, 'UTC')
                        ->setTimezone($period->timezone)
                        ->startOfMonth()
                        ->toDateString();

                    DB::table('billing_periods')->where('id', $period->id)->update(['period_month' => $month]);
                }
            });

        DB::statement('ALTER TABLE billing_periods MODIFY period_month DATE NOT NULL');
        DB::statement("ALTER TABLE billing_periods MODIFY status ENUM('open', 'closed', 'invoiced', 'cancelled') NOT NULL DEFAULT 'open'");
    }

    public function down(): void
    {
        DB::table('billing_periods')->where('status', 'cancelled')->update(['status' => 'closed']);
        DB::statement("ALTER TABLE billing_periods MODIFY status ENUM('open', 'closed', 'invoiced') NOT NULL DEFAULT 'open'");

        Schema::table('billing_periods', function (Blueprint $table) {
            $table->dropColumn('period_month');
        });
    }
};
