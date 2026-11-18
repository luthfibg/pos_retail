<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $partialDepositIds = DB::table('cash_deposits')->where('kind', 'partial')->pluck('id');

        DB::table('fund_ledger_entries')->where('ref_type', 'cash_movement')->delete();
        if ($partialDepositIds->isNotEmpty()) {
            DB::table('fund_ledger_entries')
                ->where('ref_type', 'cash_deposit')
                ->whereIn('ref_id', $partialDepositIds)
                ->delete();
            DB::table('cash_deposits')->whereIn('id', $partialDepositIds)->delete();
        }

        Schema::dropIfExists('cash_movements');
        Schema::table('cash_deposits', function (Blueprint $table) {
            $table->dropColumn('kind');
        });

        $cashSales = DB::table('sales')
            ->where('status', 'posted')
            ->where('payment_mode', 'cash')
            ->select('shift_id')
            ->selectRaw('coalesce(sum(total), 0) as cash_sales')
            ->groupBy('shift_id');
        DB::table('cash_shifts as s')
            ->leftJoinSub($cashSales, 'sales', 'sales.shift_id', '=', 's.id')
            ->whereIn('s.status', ['closed', 'reviewed'])
            ->update([
                'expected_cash' => DB::raw('s.opening_balance + coalesce(sales.cash_sales, 0)'),
                'variance' => DB::raw('s.counted_cash - (s.opening_balance + coalesce(sales.cash_sales, 0))'),
                'variance_note' => DB::raw(
                    "CASE
                        WHEN s.counted_cash - (s.opening_balance + coalesce(sales.cash_sales, 0)) = 0 THEN NULL
                        WHEN s.variance_note IS NULL OR trim(s.variance_note) = '' THEN 'Selisih dihitung ulang setelah penghapusan kas nonpenjualan dan setoran parsial.'
                        ELSE s.variance_note
                    END",
                ),
            ]);

        $permissionIds = DB::table('permissions')->where('code', 'cash_movement.create')->pluck('id');
        DB::table('user_permissions')->whereIn('permission_id', $permissionIds)->delete();
        DB::table('role_permissions')->whereIn('permission_id', $permissionIds)->delete();
        DB::table('permissions')->whereIn('id', $permissionIds)->delete();
    }

    public function down(): void
    {
        Schema::table('cash_deposits', function (Blueprint $table) {
            $table->enum('kind', ['partial', 'final'])->default('final');
        });

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
        DB::statement('ALTER TABLE `cash_movements` ADD CONSTRAINT chk_cm_amount CHECK (amount > 0)');

        DB::table('permissions')->insertOrIgnore([
            'code' => 'cash_movement.create',
            'module' => 'cash_movement',
            'description' => 'Mencatat kas masuk/keluar nonpenjualan',
        ]);
        $permissionId = DB::table('permissions')->where('code', 'cash_movement.create')->value('id');
        $cashierRoleId = DB::table('roles')->where('name', 'Kasir')->value('id');
        if ($permissionId !== null && $cashierRoleId !== null) {
            DB::table('role_permissions')->insertOrIgnore([
                'role_id' => $cashierRoleId,
                'permission_id' => $permissionId,
            ]);
        }
    }
};
