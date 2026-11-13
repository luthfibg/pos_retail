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
            $table->decimal('amount_paid', 18, 2)->default(0)->after('payment_status');
        });

        Schema::create('purchase_order_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->unsignedBigInteger('po_id');
            $table->decimal('amount', 18, 2);
            $table->dateTime('paid_at', 3);
            $table->string('reference', 100)->nullable();
            $table->string('note', 255)->nullable();
            $table->unsignedBigInteger('recorded_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['store_id', 'paid_at'], 'idx_pop_store_paid');
            $table->foreign('store_id', 'fk_pop_store')->references('id')->on('stores');
            $table->foreign('po_id', 'fk_pop_po')->references('id')->on('purchase_orders');
            $table->foreign('recorded_by', 'fk_pop_user')->references('id')->on('users');
        });

        Schema::create('financial_expenses', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->enum('category', ['operational', 'payroll']);
            $table->string('description', 255);
            $table->decimal('amount', 18, 2);
            $table->dateTime('paid_at', 3);
            $table->unsignedBigInteger('recorded_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['store_id', 'paid_at'], 'idx_fe_store_paid');
            $table->foreign('store_id', 'fk_fe_store')->references('id')->on('stores');
            $table->foreign('recorded_by', 'fk_fe_user')->references('id')->on('users');
        });

        $permissions = [
            'financial.report.view' => 'Melihat laporan keuangan',
            'financial.transaction.create' => 'Mencatat pembayaran dan biaya keuangan',
        ];
        foreach ($permissions as $code => $description) {
            DB::table('permissions')->updateOrInsert(
                ['code' => $code],
                ['module' => 'financial', 'description' => $description],
            );
        }

        $rolePermissions = [
            'Admin' => array_keys($permissions),
            'Owner' => ['financial.report.view'],
            'Finance' => array_keys($permissions),
            'Accounting' => array_keys($permissions),
        ];
        foreach ($rolePermissions as $roleName => $codes) {
            $roleId = DB::table('roles')->where('name', $roleName)->value('id');
            if ($roleId === null) {
                continue;
            }

            $permissionIds = DB::table('permissions')->whereIn('code', $codes)->pluck('id');
            foreach ($permissionIds as $permissionId) {
                DB::table('role_permissions')->insertOrIgnore([
                    'role_id' => $roleId,
                    'permission_id' => $permissionId,
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('financial_expenses');
        Schema::dropIfExists('purchase_order_payments');
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn('amount_paid');
        });

        $permissionIds = DB::table('permissions')
            ->whereIn('code', ['financial.report.view', 'financial.transaction.create'])
            ->pluck('id');
        DB::table('user_permissions')->whereIn('permission_id', $permissionIds)->delete();
        DB::table('role_permissions')->whereIn('permission_id', $permissionIds)->delete();
        DB::table('permissions')->whereIn('id', $permissionIds)->delete();
    }
};
