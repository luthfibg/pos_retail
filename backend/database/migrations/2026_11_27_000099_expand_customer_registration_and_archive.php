<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('ktp_no', 16)->nullable();
            $table->string('phone', 30)->nullable();
            $table->text('address')->nullable();
            $table->text('domicile')->nullable();
            $table->string('company_name', 190)->nullable();
            $table->string('position', 100)->nullable();
            $table->enum('employment_type', ['permanent', 'contract'])->nullable();
            $table->date('employment_start_date')->nullable();
            $table->string('hrd_name', 150)->nullable();
            $table->string('hrd_phone', 30)->nullable();
            $table->string('supervisor_name', 150)->nullable();
            $table->string('supervisor_phone', 30)->nullable();
            $table->dateTime('archived_at', 3)->nullable();
            $table->unsignedBigInteger('archived_by')->nullable();
            $table->unique(['store_id', 'ktp_no'], 'uq_customers_ktp');
            $table->foreign('archived_by', 'fk_cust_archiver')->references('id')->on('users');
            $table->dropForeign('fk_cust_verifier');
            $table->dropColumn(['status', 'verified_by', 'verified_at']);
        });

        DB::table('notifications')->where('type', 'customer.limit_needed')->delete();

        $cashierRoleId = DB::table('roles')->where('name', 'Kasir')->value('id');
        $createPermissionId = DB::table('permissions')->where('code', 'customer.create')->value('id');
        if ($cashierRoleId !== null && $createPermissionId !== null) {
            DB::table('role_permissions')->where('role_id', $cashierRoleId)->where('permission_id', $createPermissionId)->delete();
        }

        $updatePermissionId = DB::table('permissions')->where('code', 'customer.update')->value('id');
        if ($updatePermissionId !== null) {
            $restrictedRoleIds = DB::table('roles')->whereIn('name', ['Owner', 'Finance'])->pluck('id');
            DB::table('role_permissions')->whereIn('role_id', $restrictedRoleIds)
                ->where('permission_id', $updatePermissionId)->delete();
        }

        $archivePermissionId = DB::table('permissions')->where('code', 'customer.archive')->value('id');
        if ($archivePermissionId === null) {
            $archivePermissionId = DB::table('permissions')->insertGetId([
                'code' => 'customer.archive',
                'module' => 'customer',
                'description' => 'Mengarsipkan debitur (khusus Admin)',
            ]);
        }
        $adminRoleId = DB::table('roles')->where('name', 'Admin')->value('id');
        if ($adminRoleId !== null) {
            DB::table('role_permissions')->insertOrIgnore([
                'role_id' => $adminRoleId,
                'permission_id' => $archivePermissionId,
            ]);
        }

        $verifyPermissionIds = DB::table('permissions')->where('code', 'customer.verify')->pluck('id');
        DB::table('role_permissions')->whereIn('permission_id', $verifyPermissionIds)->delete();
        DB::table('user_permissions')->whereIn('permission_id', $verifyPermissionIds)->delete();
        DB::table('permissions')->whereIn('id', $verifyPermissionIds)->delete();
    }

    public function down(): void
    {
        $archivePermissionId = DB::table('permissions')->where('code', 'customer.archive')->value('id');
        if ($archivePermissionId !== null) {
            DB::table('user_permissions')->where('permission_id', $archivePermissionId)->delete();
            DB::table('role_permissions')->where('permission_id', $archivePermissionId)->delete();
            DB::table('permissions')->where('id', $archivePermissionId)->delete();
        }

        Schema::table('customers', function (Blueprint $table) {
            $table->dropForeign('fk_cust_archiver');
            $table->dropUnique('uq_customers_ktp');
            $table->dropColumn([
                'ktp_no', 'phone', 'address', 'domicile', 'company_name', 'position',
                'employment_type', 'employment_start_date', 'hrd_name', 'hrd_phone',
                'supervisor_name', 'supervisor_phone', 'archived_at', 'archived_by',
            ]);
            $table->enum('status', ['pending_verification', 'active', 'inactive'])->default('active');
            $table->unsignedBigInteger('verified_by')->nullable();
            $table->dateTime('verified_at', 3)->nullable();
            $table->foreign('verified_by', 'fk_cust_verifier')->references('id')->on('users');
        });
    }
};
