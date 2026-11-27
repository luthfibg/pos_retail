<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('sales')->where('status', 'draft')->exists()) {
            throw new RuntimeException('Penghapusan status struk dihentikan: masih ada penjualan draft yang perlu ditinjau.');
        }

        $voidedSaleIds = DB::table('sales')->where('status', 'voided')->pluck('id');

        if ($voidedSaleIds->isNotEmpty()) {
            $hasInvoiceLines = DB::table('receivable_invoice_lines')->whereIn('sale_id', $voidedSaleIds)->exists();
            $hasInvoiceReference = DB::table('sales')->whereIn('id', $voidedSaleIds)
                ->where(function ($query) {
                    $query->whereNotNull('invoice_id')->orWhereIn('billing_status', ['invoiced', 'paid']);
                })->exists();

            if ($hasInvoiceLines || $hasInvoiceReference) {
                throw new RuntimeException('Penghapusan struk batal dihentikan: ditemukan struk batal yang terkait invoice. Tinjau data tagihan sebelum menjalankan migrasi.');
            }

        }

        DB::transaction(function () use ($voidedSaleIds) {
            if ($voidedSaleIds->isNotEmpty()) {
                DB::table('sale_voids')->whereIn('sale_id', $voidedSaleIds)->delete();
                DB::table('receipt_print_logs')->whereIn('sale_id', $voidedSaleIds)->delete();
                DB::table('payments')->whereIn('sale_id', $voidedSaleIds)->delete();

                $saleItemIds = DB::table('sale_items')->whereIn('sale_id', $voidedSaleIds)->pluck('id');
                DB::table('sale_item_batches')->whereIn('sale_item_id', $saleItemIds)->delete();
                DB::table('sale_items')->whereIn('sale_id', $voidedSaleIds)->delete();
                DB::table('sales')->whereIn('id', $voidedSaleIds)->delete();
            }

            $permissionIds = DB::table('permissions')->where('code', 'sales.void')->pluck('id');
            DB::table('user_permissions')->whereIn('permission_id', $permissionIds)->delete();
            DB::table('role_permissions')->whereIn('permission_id', $permissionIds)->delete();
            DB::table('permissions')->whereIn('id', $permissionIds)->delete();
        });

        Schema::dropIfExists('sale_voids');
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn('status');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->enum('status', ['draft', 'posted', 'voided'])->default('draft');
        });
        DB::table('sales')->update(['status' => 'posted']);

        Schema::create('sale_voids', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('sale_id');
            $table->string('reason', 500);
            $table->unsignedBigInteger('requested_by');
            $table->unsignedBigInteger('approved_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['sale_id'], 'uq_sv_sale');
            $table->foreign('sale_id', 'fk_sv_sale')->references('id')->on('sales');
            $table->foreign('requested_by', 'fk_sv_req')->references('id')->on('users');
            $table->foreign('approved_by', 'fk_sv_app')->references('id')->on('users');
        });

        DB::table('permissions')->insertOrIgnore([
            'code' => 'sales.void',
            'module' => 'sales',
            'description' => 'Membatalkan penjualan terposting',
        ]);
    }
};
