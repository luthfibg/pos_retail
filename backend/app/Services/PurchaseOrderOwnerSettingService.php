<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PurchaseOrderOwnerSettingService
{
    private const SETTING_KEY = 'purchase_order_owner_user_id';

    public function __construct(
        private AuditLogger $audit,
        private PermissionResolver $permissions,
    ) {}

    /** @return array{owner: array{id: int, name: string, username: string, roles: list<string>}|null, owners: list<array{id: int, name: string, username: string, roles: list<string>}>} */
    public function get(int $storeId): array
    {
        $value = DB::table('settings')
            ->where('store_id', $storeId)
            ->where('setting_key', self::SETTING_KEY)
            ->value('setting_value');
        $ownerId = $value === null ? null : (int) json_decode((string) $value, true);
        $owners = $this->eligibleOwners($storeId);
        $owner = collect($owners)->first(fn ($candidate) => $candidate['id'] === $ownerId);

        if ($ownerId === null && count($owners) === 1) {
            $owner = $owners[0];
        }

        return ['owner' => $owner ?: null, 'owners' => $owners];
    }

    /** @return array{owner: array{id: int, name: string, username: string, roles: list<string>}|null, owners: list<array{id: int, name: string, username: string, roles: list<string>}>} */
    public function update(User $actor, int $storeId, int $ownerUserId): array
    {
        return DB::transaction(function () use ($actor, $storeId, $ownerUserId) {
            $before = $this->get($storeId)['owner']['id'] ?? null;
            $owner = collect($this->eligibleOwners($storeId))->first(fn ($candidate) => $candidate['id'] === $ownerUserId);
            if ($owner === null) {
                throw ValidationException::withMessages(['owner_user_id' => ['Pilih akun Owner aktif yang berwenang menyetujui PO.']]);
            }

            DB::table('settings')->upsert(
                [[
                    'store_id' => $storeId,
                    'setting_key' => self::SETTING_KEY,
                    'setting_value' => json_encode($ownerUserId, JSON_THROW_ON_ERROR),
                    'updated_by' => $actor->id,
                ]],
                ['store_id', 'setting_key'],
                ['setting_value', 'updated_by'],
            );

            if ($before !== $ownerUserId) {
                $this->audit->log(
                    'settings.purchase_order_owner',
                    'setting',
                    null,
                    before: ['owner_user_id' => $before],
                    after: ['owner_user_id' => $ownerUserId, 'owner_name' => $owner['name']],
                    actorId: $actor->id,
                    storeId: $storeId,
                );
            }

            return $this->get($storeId);
        });
    }

    /** @return list<array{id: int, name: string, username: string, roles: list<string>}> */
    private function eligibleOwners(int $storeId): array
    {
        $memberships = DB::table('users as u')
            ->join('user_roles as ur', 'ur.user_id', '=', 'u.id')
            ->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('ur.store_id', $storeId)
            ->where('u.is_active', true)
            ->orderBy('u.name')
            ->orderBy('u.username')
            ->get(['u.id', 'r.name as role_name'])
            ->groupBy('id');
        $users = User::whereIn('id', $memberships->keys())->get()->keyBy('id');
        $owners = [];

        foreach ($memberships as $id => $roles) {
            $user = $users->get((int) $id);
            if ($user === null || ! $this->permissions->allows($user, 'purchase_requisition.approve', $storeId)) {
                continue;
            }

            $owners[] = [
                'id' => (int) $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'roles' => $roles->pluck('role_name')->unique()->values()->all(),
            ];
        }

        return $owners;
    }
}
