<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Penutupan periode = aksi eksplisit Admin pada hari gaji (closed_at). Transaksi kredit
     * setelah closed_at otomatis masuk periode berikutnya.
     */
    public function up(): void
    {
        Schema::create('billing_periods', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('label', 40);
            $table->date('scheduled_close_date')->nullable()->comment('tanggal gaji dari HRD (dapat berubah tiap bulan)');
            $table->dateTime('starts_at', 3);
            $table->dateTime('closed_at', 3)->nullable();
            $table->enum('status', ['open', 'closed', 'invoiced'])->default('open');
            $table->unsignedBigInteger('closed_by')->nullable();
            $table->unsignedBigInteger('open_store_key')->storedAs('CASE WHEN status = \'open\' THEN store_id ELSE NULL END');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->unique(['open_store_key'], 'uq_bp_one_open');
            $table->foreign('closed_by', 'fk_bp_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_periods');
    }
};
