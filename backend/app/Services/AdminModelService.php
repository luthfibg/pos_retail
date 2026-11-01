<?php

namespace App\Services;

use App\Models\User;
use App\Support\PermissionCatalog;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Model administrasi toko (settings.admin_model, per toko; default `simple`).
 *
 *  - simple   : Admin memegang seluruh fungsi + Kasir. Finance/Purchasing/Accounting boleh dibuat sebagai delegasi.
 *  - standard : standar retail: Kasir, Finance, Purchasing, Accounting, Owner (Owner = persetujuan/kebijakan/pengawasan,
 *               tanpa fungsi operasional). Role Admin tidak lagi dapat ditugaskan.
 *
 * Beralih ke `standard` hanya bila tiap role operasional (Kasir, Finance, Purchasing, Accounting) sudah punya minimal satu
 * akun AKTIF; semua pemegang Admin otomatis menjadi Owner (konfirmasi eksplisit wajib). Kembali ke `simple`: pemegang Owner
 * menjadi Admin. Izin tetap ditegakkan backend lewat permission role; model ini hanya menentukan role yang tersedia.
 * Role bersifat global (tabel roles), sehingga pembeda antar toko adalah penugasan (user_roles) dan setting ini.
 */
class AdminModelService
{
    public const SIMPLE = 'simple';

    public const STANDARD = 'standard';

    /** Role operasional yang wajib punya akun aktif sebelum model standar diaktifkan. */
    public const REQUIRED_STANDARD = ['Kasir', 'Finance', 'Purchasing', 'Accounting'];

    public function __construct(
        private AuditLogger $audit,
        private PermissionResolver $permissions,
    ) {
    }

    public function current(int $storeId): string
    {
        $raw = DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'admin_model')->value('setting_value');

        return $raw !== null && json_decode((string) $raw, true) === self::STANDARD ? self::STANDARD : self::SIMPLE;
    }

    /** Role yang dapat ditugaskan pada model tertentu. @return list<string> */
    public function assignableRoles(string $model): array
    {
        return $model === self::STANDARD
            ? ['Kasir', 'Finance', 'Purchasing', 'Accounting', 'Owner']
            : ['Admin', 'Kasir', 'Finance', 'Purchasing', 'Accounting'];
    }

    /** Role pengendali toko (pemegang settings.manage + user.manage). */
    public function controllingRole(string $model): string
    {
        return $model === self::STANDARD ? 'Owner' : 'Admin';
    }

    /** @return array<string, mixed> */
    public function get(int $storeId): array
    {
        $model = $this->current($storeId);

        $roles = DB::table('roles')->orderBy('name')->get(['id', 'name', 'description'])->map(function ($r) use ($storeId, $model) {
            $counts = DB::table('user_roles as ur')->join('users as u', 'u.id', '=', 'ur.user_id')
                ->where('ur.store_id', $storeId)->where('ur.role_id', $r->id)
                ->selectRaw('COUNT(*) as total, COALESCE(SUM(u.is_active), 0) as active')->first();

            return [
                'name' => $r->name,
                'description' => $r->description,
                'assignable' => in_array($r->name, $this->assignableRoles($model), true),
                'total_users' => (int) $counts->total,
                'active_users' => (int) $counts->active,
            ];
        })->all();

        $options = [];
        foreach ([self::SIMPLE, self::STANDARD] as $target) {
            $plan = $target === $model ? ['blockers' => [], 'conversions' => []] : $this->plan($storeId, $model, $target);
            $options[] = [
                'model' => $target,
                'label' => $target === self::STANDARD ? 'Standar retail (Kasir, Finance, Purchasing, Accounting, Owner)' : 'Simple (Admin dan Kasir)',
                'current' => $target === $model,
                'can_switch' => $target !== $model && $plan['blockers'] === [],
                'blockers' => $plan['blockers'],
                'conversions' => $plan['conversions'],
            ];
        }

        return [
            'model' => $model,
            'controlling_role' => $this->controllingRole($model),
            'assignable_roles' => $this->assignableRoles($model),
            'roles' => $roles,
            'options' => $options,
        ];
    }

    /** @return array<string, mixed> */
    public function switchTo(User $actor, int $storeId, string $target): array
    {
        DB::transaction(function () use ($actor, $storeId, $target) {
            DB::table('stores')->where('id', $storeId)->lockForUpdate()->first();

            $from = $this->current($storeId);

            if ($from === $target) {
                throw ValidationException::withMessages(['model' => ['Toko sudah memakai model administrasi ini.']]);
            }

            $plan = $this->plan($storeId, $from, $target);

            if ($plan['blockers'] !== []) {
                throw ValidationException::withMessages(['model' => array_column($plan['blockers'], 'message')]);
            }

            $converted = [];
            foreach ($plan['conversions'] as $c) {
                $toId = (int) DB::table('roles')->where('name', $c['to'])->value('id');
                $fromId = (int) DB::table('roles')->where('name', $c['from'])->value('id');
                $ids = array_column($c['users'], 'id');

                DB::table('user_roles')->where('store_id', $storeId)->where('role_id', $fromId)->whereIn('user_id', $ids)
                    ->update(['role_id' => $toId]);
                $converted[] = ['from' => $c['from'], 'to' => $c['to'], 'user_ids' => $ids];
            }

            DB::table('settings')->updateOrInsert(
                ['store_id' => $storeId, 'setting_key' => 'admin_model'],
                ['setting_value' => json_encode($target), 'updated_by' => $actor->id],
            );

            $this->permissions->flush();

            $this->audit->log('settings.admin_model', 'setting', null,
                before: ['model' => $from], after: ['model' => $target, 'converted' => $converted],
                storeId: $storeId, actorId: $actor->id);
        });

        return $this->get($storeId);
    }

    /**
     * Rencana peralihan: penghalang (blockers) dan konversi role (conversions).
     *
     * @return array{blockers: list<array<string, mixed>>, conversions: list<array<string, mixed>>}
     */
    private function plan(int $storeId, string $from, string $target): array
    {
        $blockers = [];
        $fromControl = $this->controllingRole($from);
        $toControl = $this->controllingRole($target);

        $holders = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->join('users as u', 'u.id', '=', 'ur.user_id')
            ->where('ur.store_id', $storeId)->where('r.name', $fromControl)
            ->orderBy('u.name')->get(['u.id', 'u.name', 'u.username', 'u.is_active']);

        if ($holders->where('is_active', 1)->isEmpty()) {
            $blockers[] = ['code' => 'role_missing', 'role' => $fromControl, 'message' => "Belum ada akun aktif dengan role {$fromControl} yang dapat menjadi {$toControl}."];
        }

        if ($target === self::STANDARD) {
            foreach (self::REQUIRED_STANDARD as $role) {
                $active = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->join('users as u', 'u.id', '=', 'ur.user_id')
                    ->where('ur.store_id', $storeId)->where('r.name', $role)->where('u.is_active', 1)->count();

                if ($active === 0) {
                    $blockers[] = ['code' => 'role_missing', 'role' => $role, 'message' => "Buat minimal satu akun aktif dengan role {$role} sebelum beralih ke model standar retail."];
                }
            }
        }

        $conversions = $holders->isEmpty() ? [] : [[
            'from' => $fromControl,
            'to' => $toControl,
            'users' => $holders->map(fn ($u) => ['id' => (int) $u->id, 'name' => $u->name, 'username' => $u->username, 'is_active' => (bool) $u->is_active])->all(),
        ]];

        return ['blockers' => $blockers, 'conversions' => $conversions];
    }
}
