<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Kunci otorisasi pemberi persetujuan (Owner/Admin): satu per pengguna, hanya hash. Tidak pernah menyimpan kunci asli.
        Schema::create('authorization_keys', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->unique();
            $table->enum('key_type', ['code', 'passphrase']);          // code = 6 karakter kapital; passphrase = kalimat rahasia
            $table->string('key_hash', 255);
            $table->unsignedSmallInteger('failed_attempts')->default(0);
            $table->dateTime('locked_at', 3)->nullable();              // terkunci setelah terlalu banyak percobaan gagal
            $table->dateTime('last_used_at', 3)->nullable();
            $table->dateTime('rotated_at', 3)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();

            $table->foreign('user_id', 'fk_authkey_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('authorization_keys');
    }
};
