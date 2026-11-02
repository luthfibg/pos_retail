<?php

namespace App\Services;

use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Kunci otorisasi pemberi persetujuan (Owner/Admin dan pemegang izin persetujuan lain).
 *
 *  - Pemegang = pengguna aktif yang memegang salah satu izin persetujuan (APPROVAL_PERMISSIONS); dasarnya izin, bukan nama role.
 *  - Dua jenis: `code` (6 karakter kapital A-Z/0-9, dapat dibuatkan sistem) atau `passphrase` (kalimat rahasia, min. 16 karakter, 3 kata).
 *  - Hanya HASH yang disimpan (bcrypt); kunci asli tidak pernah disimpan, dicatat di audit, atau dikembalikan lagi
 *    (kecuali kode yang dibuatkan sistem: ditampilkan SEKALI pada respons pembuatan).
 *  - Hanya pemilik yang dapat membuat/mengganti/menghapus kuncinya, dengan mengetik password akun; pengelola pengguna (user.manage)
 *    hanya dapat MENCABUT kunci orang lain (kunci hilang/dicurigai bocor), tidak dapat menyetel atau melihatnya.
 *  - Percobaan salah: terkunci permanen setelah MAX_FAILED kali berturut-turut sampai pemilik menyetel ulang (dengan password)
 *    atau kunci dicabut; selain itu ReauthService membatasi laju percobaan per username.
 *  - Mode per toko (settings.approval_auth_mode): password (default) | key (kunci menggantikan password) | password_and_key (keduanya).
 */
class AuthorizationKeyService
{
    public const APPROVAL_PERMISSIONS = ['purchase_requisition.approve', 'inventory.adjust.approve', 'sales.credit_exception'];

    public const MODES = ['password', 'key', 'password_and_key'];

    public const MAX_FAILED = 10;

    private const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // tanpa I, O, 0, 1 agar tidak ambigu

    public function __construct(
        private PermissionResolver $permissions,
        private AuditLogger $audit,
    ) {
    }

    // ------------------------------------------------------------------ eligibility & status

    public function isEligible(User $user, int $storeId): bool
    {
        if (! $user->is_active) {
            return false;
        }

        foreach (self::APPROVAL_PERMISSIONS as $permission) {
            if ($this->permissions->allows($user, $permission, $storeId)) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, mixed> */
    public function status(User $user, int $storeId): array
    {
        $row = DB::table('authorization_keys')->where('user_id', $user->id)->first();

        return [
            'eligible' => $this->isEligible($user, $storeId),
            'has_key' => $row !== null,
            'type' => $row?->key_type,
            'locked' => $row !== null && $row->locked_at !== null,
            'created_at' => $row?->created_at,
            'rotated_at' => $row?->rotated_at,
            'last_used_at' => $row?->last_used_at,
            'mode' => $this->mode($storeId),
        ];
    }

    /** Pengguna aktif toko yang boleh menyetujui, beserta status kuncinya. @return list<array<string, mixed>> */
    public function holders(int $storeId): array
    {
        $users = DB::table('user_roles as ur')->join('users as u', 'u.id', '=', 'ur.user_id')
            ->where('ur.store_id', $storeId)->where('u.is_active', 1)->distinct()->orderBy('u.name')
            ->get(['u.id', 'u.name', 'u.username']);

        $keys = DB::table('authorization_keys')->whereIn('user_id', $users->pluck('id'))->get()->keyBy('user_id');
        $out = [];

        foreach ($users as $u) {
            $model = User::find($u->id);

            if ($model === null || ! $this->isEligible($model, $storeId)) {
                continue;
            }

            $k = $keys->get($u->id);
            $out[] = [
                'user_id' => (int) $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'has_key' => $k !== null,
                'type' => $k?->key_type,
                'locked' => $k !== null && $k->locked_at !== null,
                'last_used_at' => $k?->last_used_at,
                'rotated_at' => $k?->rotated_at,
            ];
        }

        return $out;
    }

    // ------------------------------------------------------------------ own key: set / remove

    /**
     * Buat atau ganti kunci sendiri.
     *
     * @param  array<string, mixed>  $data  current_password, type (code|passphrase), key?, generate?
     * @return array<string, mixed>  status (+ generated_key sekali bila dibuatkan sistem)
     */
    public function set(User $user, int $storeId, array $data): array
    {
        abort_unless($this->isEligible($user, $storeId), 403, 'Akun Anda tidak memegang izin persetujuan sehingga tidak memerlukan kunci otorisasi.');
        $this->assertPassword($user, (string) ($data['current_password'] ?? ''));

        $type = (string) $data['type'];
        $generate = ! empty($data['generate']);
        $generated = null;

        if ($generate) {
            if ($type !== 'code' || ! empty($data['key'])) {
                throw ValidationException::withMessages(['generate' => ['Pembuatan otomatis hanya untuk kode 6 karakter dan tidak boleh disertai kunci.']]);
            }
            $generated = $this->randomCode();
            $plain = $generated;
        } else {
            $plain = $this->normalize($type, (string) ($data['key'] ?? ''));
            $this->assertStrength($type, $plain, $user);
        }

        DB::transaction(function () use ($user, $storeId, $type, $plain) {
            $existing = DB::table('authorization_keys')->where('user_id', $user->id)->lockForUpdate()->first();
            $now = $this->now();
            $values = [
                'key_type' => $type,
                'key_hash' => Hash::make($plain),
                'failed_attempts' => 0,
                'locked_at' => null,
            ];

            if ($existing === null) {
                DB::table('authorization_keys')->insert($values + ['user_id' => $user->id]);
            } else {
                DB::table('authorization_keys')->where('id', $existing->id)->update($values + ['rotated_at' => $now]);
            }

            $this->audit->log('authorization_key.set', 'user', $user->id,
                after: ['type' => $type, 'rotated' => $existing !== null, 'unlocked' => $existing !== null && $existing->locked_at !== null],
                storeId: $storeId, actorId: $user->id);
        });

        return $this->status($user, $storeId) + ($generated !== null ? ['generated_key' => $generated] : []);
    }

    /** Hapus kunci sendiri. @return array<string, mixed> */
    public function remove(User $user, int $storeId, string $currentPassword): array
    {
        $this->assertPassword($user, $currentPassword);

        DB::transaction(function () use ($user, $storeId) {
            $row = DB::table('authorization_keys')->where('user_id', $user->id)->lockForUpdate()->first();

            if ($row === null) {
                throw ValidationException::withMessages(['key' => ['Anda belum memiliki kunci otorisasi.']]);
            }

            $this->assertNotLastKeyed($storeId, $user->id);

            DB::table('authorization_keys')->where('id', $row->id)->delete();
            $this->audit->log('authorization_key.delete', 'user', $user->id, after: ['type' => $row->key_type], storeId: $storeId, actorId: $user->id);
        });

        return $this->status($user, $storeId);
    }

    /** Pengelola pengguna mencabut kunci orang lain (kunci hilang/bocor). */
    public function revoke(User $actor, int $storeId, int $targetUserId, string $reason): void
    {
        if ($targetUserId === $actor->id) {
            throw ValidationException::withMessages(['user' => ['Gunakan menu kunci otorisasi Anda sendiri untuk menghapus kunci sendiri.']]);
        }

        DB::transaction(function () use ($actor, $storeId, $targetUserId, $reason) {
            abort_unless(DB::table('user_roles')->where('store_id', $storeId)->where('user_id', $targetUserId)->exists(), 404, 'Pengguna tidak ditemukan.');

            $row = DB::table('authorization_keys')->where('user_id', $targetUserId)->lockForUpdate()->first();

            if ($row === null) {
                throw ValidationException::withMessages(['user' => ['Pengguna ini belum memiliki kunci otorisasi.']]);
            }

            $this->assertNotLastKeyed($storeId, $targetUserId);

            DB::table('authorization_keys')->where('id', $row->id)->delete();
            $this->audit->log('authorization_key.revoke', 'user', $targetUserId, after: ['type' => $row->key_type], reason: $reason, storeId: $storeId, actorId: $actor->id);
        });
    }

    // ------------------------------------------------------------------ verification (dipakai ReauthService)

    /** Cocokkan kunci milik pemberi persetujuan; mengelola penghitung gagal dan penguncian. */
    public function verify(User $approver, string $key): bool
    {
        return DB::transaction(function () use ($approver, $key) {
            $row = DB::table('authorization_keys')->where('user_id', $approver->id)->lockForUpdate()->first();

            if ($row === null || $row->locked_at !== null) {
                return false;
            }

            if (Hash::check($this->normalize($row->key_type, $key), $row->key_hash)) {
                DB::table('authorization_keys')->where('id', $row->id)->update(['failed_attempts' => 0, 'last_used_at' => $this->now()]);

                return true;
            }

            $failed = (int) $row->failed_attempts + 1;
            $lock = $failed >= self::MAX_FAILED;
            DB::table('authorization_keys')->where('id', $row->id)->update(['failed_attempts' => $failed, 'locked_at' => $lock ? $this->now() : null]);

            if ($lock) {
                $this->audit->log('authorization_key.locked', 'user', $approver->id, after: ['failed_attempts' => $failed], actorId: $approver->id);
            }

            return false;
        });
    }

    // ------------------------------------------------------------------ mode per toko

    public function mode(int $storeId): string
    {
        $raw = DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'approval_auth_mode')->value('setting_value');
        $mode = $raw === null ? null : json_decode((string) $raw, true);

        return in_array($mode, self::MODES, true) ? $mode : 'password';
    }

    /** @return array<string, mixed> */
    public function modeInfo(int $storeId): array
    {
        $holders = $this->holders($storeId);
        $blockers = [];

        foreach ($holders as $h) {
            if (! $h['has_key'] || $h['locked']) {
                $blockers[] = [
                    'code' => $h['locked'] ? 'key_locked' : 'key_missing',
                    'user_id' => $h['user_id'],
                    'username' => $h['username'],
                    'message' => $h['locked']
                        ? "Kunci {$h['name']} terkunci; minta yang bersangkutan menyetel ulang kuncinya."
                        : "{$h['name']} ({$h['username']}) belum mengatur kunci otorisasi.",
                ];
            }
        }
        if ($holders === []) {
            $blockers[] = ['code' => 'no_approver', 'user_id' => null, 'username' => null, 'message' => 'Belum ada pengguna aktif yang memegang izin persetujuan.'];
        }

        return [
            'mode' => $this->mode($storeId),
            'modes' => [
                ['mode' => 'password', 'label' => 'Password akun saja', 'can_switch' => true, 'blockers' => []],
                ['mode' => 'key', 'label' => 'Kunci otorisasi menggantikan password', 'can_switch' => $blockers === [], 'blockers' => $blockers],
                ['mode' => 'password_and_key', 'label' => 'Password akun dan kunci otorisasi', 'can_switch' => $blockers === [], 'blockers' => $blockers],
            ],
            'holders' => $holders,
        ];
    }

    /** @return array<string, mixed> */
    public function setMode(User $actor, int $storeId, string $mode, string $currentPassword): array
    {
        $this->assertPassword($actor, $currentPassword);

        DB::transaction(function () use ($actor, $storeId, $mode) {
            DB::table('stores')->where('id', $storeId)->lockForUpdate()->first();
            $before = $this->mode($storeId);

            if ($before === $mode) {
                throw ValidationException::withMessages(['mode' => ['Toko sudah memakai mode ini.']]);
            }

            if ($mode !== 'password') {
                $blockers = collect($this->modeInfo($storeId)['modes'])->firstWhere('mode', $mode)['blockers'];

                if ($blockers !== []) {
                    throw ValidationException::withMessages(['mode' => array_column($blockers, 'message')]);
                }
            }

            DB::table('settings')->updateOrInsert(
                ['store_id' => $storeId, 'setting_key' => 'approval_auth_mode'],
                ['setting_value' => json_encode($mode), 'updated_by' => $actor->id],
            );

            $this->audit->log('settings.approval_auth', 'setting', null, before: ['mode' => $before], after: ['mode' => $mode], storeId: $storeId, actorId: $actor->id);
        });

        return $this->modeInfo($storeId);
    }

    // ------------------------------------------------------------------ internal

    /** Password akun pemilik (dibatasi lajunya agar tidak dapat ditebak lewat endpoint ini). */
    private function assertPassword(User $user, string $password): void
    {
        $limiter = 'authkey-pw:'.$user->id;

        if (RateLimiter::tooManyAttempts($limiter, 5)) {
            throw ValidationException::withMessages(['current_password' => ['Terlalu banyak percobaan. Coba lagi beberapa menit lagi.']]);
        }

        if ($password === '' || ! Hash::check($password, $user->password_hash)) {
            RateLimiter::hit($limiter, 300);
            throw ValidationException::withMessages(['current_password' => ['Password akun tidak sesuai.']]);
        }

        RateLimiter::clear($limiter);
    }

    /** Pada mode kunci, pencabutan/penghapusan tidak boleh menyisakan nol pemegang kunci yang dapat menyetujui. */
    private function assertNotLastKeyed(int $storeId, int $removingUserId): void
    {
        if ($this->mode($storeId) === 'password') {
            return;
        }

        $others = collect($this->holders($storeId))->filter(fn ($h) => $h['user_id'] !== $removingUserId && $h['has_key'] && ! $h['locked']);

        if ($others->isEmpty()) {
            throw ValidationException::withMessages(['key' => ['Toko memakai mode kunci otorisasi; kunci terakhir tidak dapat dihapus. Ubah mode ke password terlebih dahulu.']]);
        }
    }

    private function normalize(string $type, string $key): string
    {
        $key = trim($key);

        return $type === 'code' ? strtoupper($key) : (string) preg_replace('/\s+/u', ' ', $key);
    }

    private function assertStrength(string $type, string $plain, User $user): void
    {
        if ($type === 'code') {
            if (! preg_match('/^[A-Z0-9]{6}$/', $plain)) {
                throw ValidationException::withMessages(['key' => ['Kode harus tepat 6 karakter huruf kapital A-Z atau angka 0-9.']]);
            }
            if (count(array_unique(str_split($plain))) === 1) {
                throw ValidationException::withMessages(['key' => ['Kode tidak boleh berupa satu karakter yang diulang.']]);
            }
        } else {
            $words = preg_split('/\s+/u', $plain, -1, PREG_SPLIT_NO_EMPTY) ?: [];

            if (mb_strlen($plain) < 16 || mb_strlen($plain) > 100 || count($words) < 3) {
                throw ValidationException::withMessages(['key' => ['Kalimat rahasia minimal 16 karakter dan 3 kata (maksimal 100 karakter).']]);
            }
            if (mb_strtolower($plain) === mb_strtolower($user->username)) {
                throw ValidationException::withMessages(['key' => ['Kalimat rahasia tidak boleh sama dengan username.']]);
            }
        }

        if (Hash::check($plain, $user->password_hash)) {
            throw ValidationException::withMessages(['key' => ['Kunci harus berbeda dari password akun.']]);
        }
    }

    private function randomCode(): string
    {
        $out = '';
        for ($i = 0; $i < 6; $i++) {
            $out .= self::CODE_ALPHABET[random_int(0, strlen(self::CODE_ALPHABET) - 1)];
        }

        return count(array_unique(str_split($out))) === 1 ? $this->randomCode() : $out;
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
