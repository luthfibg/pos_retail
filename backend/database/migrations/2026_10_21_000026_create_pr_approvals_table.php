<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pr_approvals', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('pr_id');
            $table->enum('step', ['finance_check', 'owner_auth']);
            $table->enum('decision', ['approved', 'rejected', 'returned']);
            $table->unsignedBigInteger('decided_by');
            $table->string('note', 500)->nullable();
            $table->dateTime('reauth_at', 3)->nullable()->comment('waktu autentikasi ulang Owner');
            $table->boolean('is_self_approval')->default(false);
            $table->dateTime('decided_at', 3)->useCurrent();

            $table->index(['pr_id'], 'idx_pra_pr');
            $table->foreign('pr_id', 'fk_pra_pr')->references('id')->on('purchase_requisitions');
            $table->foreign('decided_by', 'fk_pra_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pr_approvals');
    }
};
