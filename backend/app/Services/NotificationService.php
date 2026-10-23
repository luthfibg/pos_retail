<?php

namespace App\Services;

use App\Models\User;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/** Notifikasi dalam aplikasi (tabel notifications), per pengguna dan per toko. */
class NotificationService
{
    public function __construct(private PermissionResolver $permissions)
    {
    }

    /** Kirim ke semua pengguna aktif di toko yang memegang $permission (kecuali $exceptUserId). */
    public function notifyPermission(
        int $storeId,
        string $permission,
        string $type,
        string $message,
        ?string $entityType = null,
        ?int $entityId = null,
        ?int $exceptUserId = null,
    ): int {
        $ids = DB::table('user_roles')->where('store_id', $storeId)->distinct()->pluck('user_id')->map(fn ($id) => (int) $id)->all();

        $count = 0;

        foreach (User::query()->whereIn('id', $ids)->where('is_active', 1)->get() as $user) {
            if ($user->id === $exceptUserId || ! $this->permissions->allows($user, $permission, $storeId)) {
                continue;
            }

            DB::table('notifications')->insert([
                'store_id' => $storeId,
                'user_id' => $user->id,
                'type' => $type,
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'message' => mb_substr($message, 0, 500),
            ]);
            $count++;
        }

        return $count;
    }

    /** Tandai selesai (terbaca) semua notifikasi tipe tertentu untuk satu entitas, bagi siapa pun. */
    public function resolveForEntity(int $storeId, string $type, string $entityType, int $entityId): void
    {
        DB::table('notifications')
            ->where('store_id', $storeId)->where('type', $type)
            ->where('entity_type', $entityType)->where('entity_id', $entityId)
            ->whereNull('read_at')
            ->update(['read_at' => $this->now()]);
    }

    /** @return array<string, mixed> paginator + unread_count */
    public function listFor(User $user, int $storeId, bool $unreadOnly, int $perPage): array
    {
        $base = fn () => DB::table('notifications')->where('store_id', $storeId)->where('user_id', $user->id);

        $query = $base()->orderByDesc('created_at')->orderByDesc('id');
        if ($unreadOnly) {
            $query->whereNull('read_at');
        }

        /** @var LengthAwarePaginator $page */
        $page = $query->paginate($perPage)->through(fn ($row) => [
            'id' => (int) $row->id,
            'type' => $row->type,
            'entity_type' => $row->entity_type,
            'entity_id' => $row->entity_id === null ? null : (int) $row->entity_id,
            'message' => $row->message,
            'read_at' => $row->read_at,
            'created_at' => $row->created_at,
        ]);

        return $page->toArray() + ['unread_count' => $base()->whereNull('read_at')->count()];
    }

    public function markRead(User $user, int $storeId, int $id): bool
    {
        $row = DB::table('notifications')->where('store_id', $storeId)->where('user_id', $user->id)->where('id', $id)->first();

        if ($row === null) {
            return false;
        }

        if ($row->read_at === null) {
            DB::table('notifications')->where('id', $id)->update(['read_at' => $this->now()]);
        }

        return true;
    }

    public function markAllRead(User $user, int $storeId): int
    {
        return DB::table('notifications')
            ->where('store_id', $storeId)->where('user_id', $user->id)->whereNull('read_at')
            ->update(['read_at' => $this->now()]);
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
