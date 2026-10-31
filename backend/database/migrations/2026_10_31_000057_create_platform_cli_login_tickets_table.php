<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_cli_login_tickets', function (Blueprint $table) {
            $table->char('ticket_hash', 64)->primary();
            $table->unsignedBigInteger('user_id');
            $table->dateTime('expires_at', 3)->index();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->foreign('user_id', 'fk_platform_cli_ticket_user')
                ->references('id')
                ->on('users')
                ->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_cli_login_tickets');
    }
};
