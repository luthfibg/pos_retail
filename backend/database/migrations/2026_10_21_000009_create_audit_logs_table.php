<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id')->nullable();
            $table->unsignedBigInteger('actor_id')->nullable();
            $table->string('action', 80);
            $table->string('entity_type', 60);
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->json('before_json')->nullable();
            $table->json('after_json')->nullable();
            $table->string('reason', 500)->nullable();
            $table->boolean('is_self_approval')->default(false);
            $table->string('ip_address', 45)->nullable();
            $table->dateTime('created_at', 3)->useCurrent();

            $table->index(['entity_type', 'entity_id'], 'idx_audit_entity');
            $table->index(['actor_id', 'created_at'], 'idx_audit_actor');
            $table->index(['action', 'created_at'], 'idx_audit_action');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
