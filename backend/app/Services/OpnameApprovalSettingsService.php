<?php

namespace App\Services;

use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class OpnameApprovalSettingsService
{
    private const PER_PRODUCT = 'opname.approval.per_product_threshold';

    private const PER_SESSION = 'opname.approval.per_session_threshold';

    private const REQUIRE_FIRST = 'opname.approval.require_first_opname';

    private const REMINDER_ENABLED = 'opname.reminder.enabled';

    private const REMINDER_INTERVAL = 'opname.reminder.interval_days';

    private const REMINDER_BASIS = 'opname.reminder.basis';

    public function __construct(
        private OpnameDisplayPolicy $display,
        private PermissionResolver $permissions,
        private AuditLogger $audit,
    ) {}

    /** @return array<string, mixed> */
    public function get(User $user, int $storeId): array
    {
        $settings = [
            'show_system_qty' => $this->display->revealsSystemQty($storeId),
            ...$this->reminderSettings($storeId),
        ];
        if ($this->permissions->allows($user, 'opname.view_value', $storeId)) {
            $settings += $this->thresholds($storeId);
        }

        return $settings;
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function update(User $user, int $storeId, array $data): array
    {
        $hasThresholds = array_key_exists('per_product_threshold', $data)
            || array_key_exists('per_session_threshold', $data)
            || array_key_exists('require_first_opname', $data);
        $hasReminder = array_key_exists('reminder_enabled', $data)
            || array_key_exists('reminder_interval_days', $data)
            || array_key_exists('reminder_basis', $data);
        if ($hasThresholds && ! $this->isApprovalAuthority($user, $storeId)) {
            abort(403, 'Hanya Admin pada model sederhana atau Owner yang dapat mengubah ambang persetujuan opname.');
        }
        if ($hasReminder && ! $this->isAdminOrOwner($user, $storeId)) {
            abort(403, 'Hanya Admin atau Owner yang dapat mengubah pengingat opname.');
        }

        return DB::transaction(function () use ($user, $storeId, $data, $hasThresholds, $hasReminder) {
            if (array_key_exists('show_system_qty', $data)) {
                $this->display->update($user, $storeId, (bool) $data['show_system_qty']);
            }

            if ($hasThresholds) {
                $before = $this->thresholds($storeId);
                $after = [
                    'per_product_threshold' => (int) ($data['per_product_threshold'] ?? $before['per_product_threshold']),
                    'per_session_threshold' => (int) ($data['per_session_threshold'] ?? $before['per_session_threshold']),
                    'require_first_opname' => (bool) ($data['require_first_opname'] ?? $before['require_first_opname']),
                ];
                foreach ($after as $key => $value) {
                    $settingKey = match ($key) {
                        'per_product_threshold' => self::PER_PRODUCT,
                        'per_session_threshold' => self::PER_SESSION,
                        default => self::REQUIRE_FIRST,
                    };
                    $this->write($storeId, $settingKey, $value, $user->id);
                }
                if ($before !== $after) {
                    $this->audit->log(
                        'settings.opname_approval',
                        'setting',
                        null,
                        before: $before,
                        after: $after,
                        storeId: $storeId,
                        actorId: $user->id,
                    );
                }
            }

            if ($hasReminder) {
                $before = $this->reminderSettings($storeId);
                $after = [
                    'reminder_enabled' => (bool) ($data['reminder_enabled'] ?? $before['reminder_enabled']),
                    'reminder_interval_days' => (int) ($data['reminder_interval_days'] ?? $before['reminder_interval_days']),
                    'reminder_basis' => (string) ($data['reminder_basis'] ?? $before['reminder_basis']),
                ];
                foreach ([
                    self::REMINDER_ENABLED => $after['reminder_enabled'],
                    self::REMINDER_INTERVAL => $after['reminder_interval_days'],
                    self::REMINDER_BASIS => $after['reminder_basis'],
                ] as $key => $value) {
                    $this->write($storeId, $key, $value, $user->id);
                }
                if ($before !== $after) {
                    $this->audit->log(
                        'settings.opname_reminder',
                        'setting',
                        null,
                        before: $before,
                        after: $after,
                        storeId: $storeId,
                        actorId: $user->id,
                    );
                }
            }

            return $this->get($user, $storeId);
        });
    }

    /** @return array{per_product_threshold: int, per_session_threshold: int, require_first_opname: bool} */
    public function thresholds(int $storeId): array
    {
        return [
            'per_product_threshold' => $this->readInt($storeId, self::PER_PRODUCT, 25000),
            'per_session_threshold' => $this->readInt($storeId, self::PER_SESSION, 200000),
            'require_first_opname' => $this->readBool($storeId, self::REQUIRE_FIRST, true),
        ];
    }

    public function isOwner(User $user, int $storeId): bool
    {
        return DB::table('user_roles as ur')
            ->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('ur.user_id', $user->id)
            ->where('ur.store_id', $storeId)
            ->where('r.name', 'Owner')
            ->exists();
    }

    public function isApprovalAuthority(User $user, int $storeId): bool
    {
        if ($this->isOwner($user, $storeId)) {
            return true;
        }

        $simpleModel = DB::table('settings')->where('store_id', $storeId)
            ->where('setting_key', 'admin_model')->value('setting_value') !== json_encode('standard');

        return $simpleModel && DB::table('user_roles as ur')
            ->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('ur.user_id', $user->id)
            ->where('ur.store_id', $storeId)
            ->where('r.name', 'Admin')
            ->exists();
    }

    private function isAdminOrOwner(User $user, int $storeId): bool
    {
        return DB::table('user_roles as ur')
            ->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('ur.user_id', $user->id)
            ->where('ur.store_id', $storeId)
            ->whereIn('r.name', ['Admin', 'Owner'])
            ->exists();
    }

    /** @return array{reminder_enabled: bool, reminder_interval_days: int, reminder_basis: string} */
    private function reminderSettings(int $storeId): array
    {
        return [
            'reminder_enabled' => $this->readBool($storeId, self::REMINDER_ENABLED, false),
            'reminder_interval_days' => $this->readInt($storeId, self::REMINDER_INTERVAL, 30),
            'reminder_basis' => $this->readString($storeId, self::REMINDER_BASIS, 'all'),
        ];
    }

    private function readInt(int $storeId, string $key, int $default): int
    {
        $value = DB::table('settings')->where('store_id', $storeId)->where('setting_key', $key)->value('setting_value');

        return $value === null ? $default : (int) json_decode((string) $value, true);
    }

    private function readBool(int $storeId, string $key, bool $default): bool
    {
        $value = DB::table('settings')->where('store_id', $storeId)->where('setting_key', $key)->value('setting_value');

        return $value === null ? $default : json_decode((string) $value, true) === true;
    }

    private function readString(int $storeId, string $key, string $default): string
    {
        $value = DB::table('settings')->where('store_id', $storeId)->where('setting_key', $key)->value('setting_value');

        return $value === null ? $default : (string) json_decode((string) $value, true);
    }

    private function write(int $storeId, string $key, int|bool|string $value, int $actorId): void
    {
        DB::table('settings')->upsert([[
            'store_id' => $storeId,
            'setting_key' => $key,
            'setting_value' => json_encode($value),
            'updated_by' => $actorId,
            'updated_at' => Carbon::now('UTC')->format('Y-m-d H:i:s.v'),
        ]], ['store_id', 'setting_key'], ['setting_value', 'updated_by', 'updated_at']);
    }
}
