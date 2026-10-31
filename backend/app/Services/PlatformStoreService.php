<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class PlatformStoreService
{
    public function __construct(
        private TenantProvisioner $provisioner,
        private AuditLogger $audit,
        private StoreContext $stores,
        private PermissionResolver $permissions,
    ) {}

    /** @param array<string, mixed> $filters */
    public function search(array $filters, int $perPage): LengthAwarePaginator
    {
        $query = DB::table('stores')->orderBy('id');

        if (! empty($filters['q'])) {
            $query->where(function ($query) use ($filters) {
                $query->where('code', 'like', '%'.$filters['q'].'%')
                    ->orWhere('name', 'like', '%'.$filters['q'].'%');
            });
        }
        if (! empty($filters['status'])) {
            $query->where('is_active', $filters['status'] === 'active');
        }

        return $query->paginate($perPage)->through(fn ($store) => $this->present($store));
    }

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function create(User $actor, array $data): array
    {
        return DB::transaction(function () use ($actor, $data) {
            $storeId = DB::table('stores')->insertGetId([
                'code' => $data['code'],
                'name' => $data['name'],
                'timezone' => $data['timezone'] ?? 'Asia/Jakarta',
                'currency' => strtoupper($data['currency'] ?? 'IDR'),
                'is_active' => 1,
            ]);

            $ownerId = DB::table('users')->insertGetId([
                'name' => $data['owner']['name'],
                'username' => $data['owner']['username'],
                'email' => $data['owner']['email'] ?? null,
                'password_hash' => Hash::make($data['owner']['password']),
                'is_active' => 1,
            ]);
            $adminRoleId = DB::table('roles')->where('name', 'Admin')->value('id');
            if ($adminRoleId === null) {
                throw new \LogicException('Role Admin belum tersedia. Jalankan seeder permission sebelum membuat tenant.');
            }

            DB::table('user_roles')->insert([
                'user_id' => $ownerId,
                'role_id' => $adminRoleId,
                'store_id' => $storeId,
            ]);

            $this->provisioner->initialize((int) $storeId);
            $store = DB::table('stores')->where('id', $storeId)->first();

            $this->audit->log(
                'platform.store_create',
                'store',
                (int) $storeId,
                after: ['code' => $store->code, 'name' => $store->name, 'owner_username' => $data['owner']['username']],
                actorId: $actor->id,
            );

            return $this->present($store) + [
                'initial_owner' => [
                    'id' => (int) $ownerId,
                    'name' => $data['owner']['name'],
                    'username' => $data['owner']['username'],
                    'role' => 'Admin',
                ],
            ];
        });
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId): ?array
    {
        $store = DB::table('stores')->where('id', $storeId)->first();
        if ($store === null) {
            return null;
        }

        $admins = DB::table('user_roles as ur')
            ->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->join('users as u', 'u.id', '=', 'ur.user_id')
            ->where('ur.store_id', $storeId)
            ->where('r.name', 'Admin')
            ->orderBy('u.id')
            ->get(['u.id', 'u.name', 'u.username', 'u.email', 'u.is_active'])
            ->map(fn ($user) => [
                'id' => (int) $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'email' => $user->email,
                'is_active' => (bool) $user->is_active,
            ])->all();

        return $this->present($store) + [
            'admin_users' => $admins,
            'user_count' => (int) DB::table('user_roles')->where('store_id', $storeId)->distinct('user_id')->count('user_id'),
        ];
    }

    /** @param array{is_active: bool, reason?: string|null} $data
     * @return array<string, mixed>
     */
    public function setActive(User $actor, int $storeId, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $data) {
            $store = DB::table('stores')->where('id', $storeId)->lockForUpdate()->first();
            abort_if($store === null, 404, 'Toko tidak ditemukan.');

            $active = (bool) $data['is_active'];
            if ((bool) $store->is_active !== $active) {
                DB::table('stores')->where('id', $storeId)->update(['is_active' => $active]);

                $this->audit->log(
                    'platform.store_status',
                    'store',
                    $storeId,
                    before: ['is_active' => (bool) $store->is_active],
                    after: ['is_active' => $active],
                    reason: $data['reason'] ?? null,
                    actorId: $actor->id,
                );
                $this->permissions->flush();
                $this->stores->flush();
            }

            return $this->present(DB::table('stores')->where('id', $storeId)->first());
        });
    }

    /** @return array<string, mixed> */
    private function present(object $store): array
    {
        return [
            'id' => (int) $store->id,
            'code' => $store->code,
            'name' => $store->name,
            'timezone' => $store->timezone,
            'currency' => $store->currency,
            'is_active' => (bool) $store->is_active,
            'created_at' => $store->created_at,
        ];
    }
}
