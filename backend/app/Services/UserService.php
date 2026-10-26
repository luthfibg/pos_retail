<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Manajemen pengguna (user.manage), dibatasi pada toko aktif.
 *  - role ditentukan oleh user_roles (bukan username); satu role per pengguna per toko lewat API ini
 *  - Admin tidak dapat menonaktifkan atau mengubah role dirinya sendiri; toko tidak boleh kehilangan Admin aktif terakhir
 *  - menonaktifkan pengguna atau mereset sandi mencabut seluruh token aktifnya
 *  - sandi tidak pernah dikembalikan API maupun dicatat di audit log
 */
class UserService
{
    public function __construct(private AuditLogger $audit, private PermissionResolver $permissions)
    {
    }

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $page = DB::table('users as u')
            ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('user_roles as ur')->whereColumn('ur.user_id', 'u.id')->where('ur.store_id', $storeId))
            ->when(! empty($filters['q']), function ($q) use ($filters) {
                $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
                $q->where(fn ($w) => $w->where('u.name', 'like', "%{$term}%")->orWhere('u.username', 'like', "%{$term}%"));
            })
            ->when(($filters['status'] ?? null) === 'active', fn ($q) => $q->where('u.is_active', 1))
            ->when(($filters['status'] ?? null) === 'inactive', fn ($q) => $q->where('u.is_active', 0))
            ->when(! empty($filters['role']), fn ($q) => $q->whereExists(fn ($w) => $w->select(DB::raw(1))->from('user_roles as r2')
                ->join('roles as ro', 'ro.id', '=', 'r2.role_id')->whereColumn('r2.user_id', 'u.id')
                ->where('r2.store_id', $storeId)->where('ro.name', $filters['role'])))
            ->orderBy('u.name')
            ->select(['u.id', 'u.name', 'u.username', 'u.email', 'u.is_active', 'u.last_login_at'])
            ->paginate($perPage);

        $roles = $this->rolesFor($storeId, $page->pluck('id')->all());

        return $page->through(fn ($r) => $this->present($r, $roles[$r->id] ?? []));
    }

    /** @return array<string, mixed> */
    public function find(int $storeId, int $id): array
    {
        $row = $this->member($storeId, $id);
        abort_if($row === null, 404, 'Pengguna tidak ditemukan.');

        return $this->present($row, $this->rolesFor($storeId, [$id])[$id] ?? []);
    }

    /** @return list<array<string, mixed>> */
    public function roles(): array
    {
        return DB::table('roles')->orderBy('name')->get(['id', 'name', 'description', 'is_system'])
            ->map(fn ($r) => ['id' => (int) $r->id, 'name' => $r->name, 'description' => $r->description, 'is_system' => (bool) $r->is_system])->all();
    }

    /**
     * @param  array<string, mixed>  $data  name, username, email?, password, role
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            $id = DB::table('users')->insertGetId([
                'name' => $data['name'],
                'username' => $data['username'],
                'email' => $data['email'] ?? null,
                'password_hash' => Hash::make($data['password']),
                'is_active' => 1,
            ]);

            DB::table('user_roles')->insert(['user_id' => $id, 'role_id' => $this->roleId($data['role']), 'store_id' => $storeId]);

            $this->audit->log('user.create', 'user', $id,
                after: ['name' => $data['name'], 'username' => $data['username'], 'email' => $data['email'] ?? null, 'role' => $data['role']],
                storeId: $storeId, actorId: $actor->id);

            return $id;
        });

        return $this->find($storeId, $id);
    }

    /**
     * @param  array<string, mixed>  $data  name, email, is_active, role
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $cur = DB::table('users')->where('id', $id)->lockForUpdate()->first();
            abort_if($cur === null || $this->member($storeId, $id) === null, 404, 'Pengguna tidak ditemukan.');

            $currentRole = $this->rolesFor($storeId, [$id])[$id][0] ?? null;
            $self = $actor->id === $id;
            $before = [];
            $after = [];

            foreach (['name', 'email'] as $f) {
                if (array_key_exists($f, $data) && $data[$f] !== $cur->{$f}) {
                    $before[$f] = $cur->{$f};
                    $after[$f] = $data[$f];
                }
            }

            $deactivating = array_key_exists('is_active', $data) && ! $data['is_active'] && $cur->is_active;
            if (array_key_exists('is_active', $data) && (bool) $data['is_active'] !== (bool) $cur->is_active) {
                $before['is_active'] = (bool) $cur->is_active;
                $after['is_active'] = (bool) $data['is_active'];
            }

            $newRole = $data['role'] ?? null;
            $roleChanging = $newRole !== null && $newRole !== $currentRole;
            if ($roleChanging) {
                $before['role'] = $currentRole;
                $after['role'] = $newRole;
            }

            if ($self && ($deactivating || $roleChanging)) {
                throw ValidationException::withMessages([$deactivating ? 'is_active' : 'role' => ['Anda tidak dapat menonaktifkan atau mengubah role akun Anda sendiri.']]);
            }

            if (($deactivating || ($roleChanging && $currentRole === 'Admin')) && $cur->is_active && $currentRole === 'Admin'
                && $this->otherActiveAdmins($storeId, $id) === 0) {
                throw ValidationException::withMessages([$deactivating ? 'is_active' : 'role' => ['Toko harus memiliki minimal satu Admin aktif.']]);
            }

            if ($after === []) {
                return;
            }

            $columns = array_intersect_key($after, array_flip(['name', 'email']));
            if (isset($after['is_active'])) {
                $columns['is_active'] = $after['is_active'] ? 1 : 0;
            }
            if ($columns !== []) {
                DB::table('users')->where('id', $id)->update($columns);
            }

            if ($roleChanging) {
                DB::table('user_roles')->where('user_id', $id)->where('store_id', $storeId)->delete();
                DB::table('user_roles')->insert(['user_id' => $id, 'role_id' => $this->roleId($newRole), 'store_id' => $storeId]);
            }

            if ($deactivating) {
                $this->revokeTokens($id);
            }

            $this->permissions->flush();
            $this->audit->log('user.update', 'user', $id, before: $before, after: $after, storeId: $storeId, actorId: $actor->id);
        });

        return $this->find($storeId, $id);
    }

    /** Admin menetapkan sandi baru; semua sesi pengguna itu diakhiri. */
    public function resetPassword(User $actor, int $storeId, int $id, string $password): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $password) {
            abort_if($this->member($storeId, $id) === null, 404, 'Pengguna tidak ditemukan.');

            DB::table('users')->where('id', $id)->update(['password_hash' => Hash::make($password)]);
            $this->revokeTokens($id);
            $this->audit->log('user.reset_password', 'user', $id, storeId: $storeId, actorId: $actor->id);
        });

        return $this->find($storeId, $id);
    }

    /** Ganti sandi sendiri; sesi lain milik akun ini diakhiri (sesi yang sedang dipakai tetap). */
    public function changeOwnPassword(User $user, string $current, string $new, ?int $keepTokenId): void
    {
        if (! Hash::check($current, $user->password_hash)) {
            throw ValidationException::withMessages(['current_password' => ['Sandi saat ini salah.']]);
        }

        DB::transaction(function () use ($user, $new, $keepTokenId) {
            DB::table('users')->where('id', $user->id)->update(['password_hash' => Hash::make($new)]);
            $this->revokeTokens($user->id, $keepTokenId);
            $this->audit->log('auth.change_password', 'user', $user->id, actorId: $user->id);
        });
    }

    // ------------------------------------------------------------------ internal

    private function revokeTokens(int $userId, ?int $exceptTokenId = null): void
    {
        DB::table('personal_access_tokens')->where('tokenable_type', User::class)->where('tokenable_id', $userId)
            ->when($exceptTokenId !== null, fn ($q) => $q->where('id', '!=', $exceptTokenId))->delete();
    }

    private function otherActiveAdmins(int $storeId, int $exceptUserId): int
    {
        return DB::table('user_roles as ur')
            ->join('roles as r', 'r.id', '=', 'ur.role_id')->join('users as u', 'u.id', '=', 'ur.user_id')
            ->where('ur.store_id', $storeId)->where('r.name', 'Admin')->where('u.is_active', 1)->where('u.id', '!=', $exceptUserId)
            ->distinct()->count('u.id');
    }

    private function roleId(string $name): int
    {
        return (int) DB::table('roles')->where('name', $name)->value('id');
    }

    private function member(int $storeId, int $id): ?object
    {
        return DB::table('users as u')
            ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('user_roles as ur')->whereColumn('ur.user_id', 'u.id')->where('ur.store_id', $storeId))
            ->where('u.id', $id)->first(['u.id', 'u.name', 'u.username', 'u.email', 'u.is_active', 'u.last_login_at']);
    }

    /**
     * @param  list<int>  $ids
     * @return array<int, list<string>>
     */
    private function rolesFor(int $storeId, array $ids): array
    {
        $out = [];
        foreach (DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('ur.store_id', $storeId)->whereIn('ur.user_id', $ids)->orderBy('r.name')->get(['ur.user_id', 'r.name']) as $row) {
            $out[(int) $row->user_id][] = $row->name;
        }

        return $out;
    }

    /**
     * @param  list<string>  $roles
     * @return array<string, mixed>
     */
    private function present(object $r, array $roles): array
    {
        return [
            'id' => (int) $r->id,
            'name' => $r->name,
            'username' => $r->username,
            'email' => $r->email,
            'is_active' => (bool) $r->is_active,
            'roles' => $roles,
            'last_login_at' => $r->last_login_at,
        ];
    }
}
