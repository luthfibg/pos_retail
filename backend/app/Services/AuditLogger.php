<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Menulis audit_logs (append-only). Dipanggil oleh service saat ada perubahan penting:
 * login, persetujuan, perubahan harga, pembatalan, adjustment, dan sebagainya.
 */
class AuditLogger
{
    /**
     * @param  array<string, mixed>|null  $before
     * @param  array<string, mixed>|null  $after
     */
    public function log(
        string $action,
        string $entityType,
        ?int $entityId = null,
        ?array $before = null,
        ?array $after = null,
        ?string $reason = null,
        bool $selfApproval = false,
        ?int $actorId = null,
        ?int $storeId = null,
    ): void {
        DB::table('audit_logs')->insert([
            'store_id' => $storeId,
            'actor_id' => $actorId ?? request()->user()?->id,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'before_json' => $before === null ? null : json_encode($before, JSON_UNESCAPED_UNICODE),
            'after_json' => $after === null ? null : json_encode($after, JSON_UNESCAPED_UNICODE),
            'reason' => $reason,
            'is_self_approval' => $selfApproval ? 1 : 0,
            'ip_address' => request()->ip(),
        ]);
    }
}
