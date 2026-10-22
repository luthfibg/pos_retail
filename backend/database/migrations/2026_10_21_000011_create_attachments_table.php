<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attachments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->string('entity_type', 60);
            $table->unsignedBigInteger('entity_id');
            $table->string('file_path', 500);
            $table->string('original_name', 255);
            $table->string('mime_type', 100);
            $table->unsignedBigInteger('size_bytes');
            $table->unsignedBigInteger('uploaded_by');
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['entity_type', 'entity_id'], 'idx_att_entity');
            $table->foreign('uploaded_by', 'fk_att_user')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attachments');
    }
};
