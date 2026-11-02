<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Autentikasi ulang pemberi persetujuan (PR, pengecualian kredit, write-off, adjustment).
 * Pemberi persetujuan mengetik username dan password AKUNNYA SENDIRI pada saat aksi;
 * password tidak dibagikan, tidak disimpan, dan tidak diketik oleh orang lain.
 * Akun harus aktif dan memegang permission yang diminta di toko aktif.
 *
 * Mode toko (settings.approval_auth_mode, lihat AuthorizationKeyService): `password` (default), `key` (kunci otorisasi
 * menggantikan password), atau `password_and_key` (keduanya). Kunci dikirim lewat `approver_key`.
 */
class ReauthService
{
    public function __construct(
        private PermissionResolver $permissions,
        private AuditLogger $audit,
        private AuthorizationKeyService $keys,
        private StoreContext $stores,
    ) {
    }

    /** Mode kredensial persetujuan pada toko pengguna tersebut. */
    public function mode(?User $user): string
    {
        $storeId = $user === null ? null : $this->stores->idFor($user);

        return $storeId === null ? 'password' : $this->keys->mode($storeId);
    }

    /**
     * Pastikan kredensial yang dibutuhkan mode toko ada di data permintaan; bila tidak -> 422 pada kolom yang tepat.
     *
     * @param  array<string, mixed>  $data  approver_username, approver_password?, approver_key?
     */
    public function assertProvided(array $data, ?User $requester, string $message = 'Autentikasi ulang pemberi persetujuan diperlukan.'): void
    {
        $mode = $this->mode($requester);

        if (empty($data['approver_username'])) {
            throw ValidationException::withMessages([($mode === 'key' ? 'approver_key' : 'approver_password') => [$message]]);
        }
        if ($mode !== 'key' && empty($data['approver_password'])) {
            throw ValidationException::withMessages(['approver_password' => [$message]]);
        }
        if ($mode !== 'password' && empty($data['approver_key'])) {
            throw ValidationException::withMessages(['approver_key' => ['Kunci otorisasi pemberi persetujuan diperlukan.']]);
        }
    }

    /**
     * @throws ValidationException
     */
    public function confirm(string $username, string $password, string $permission, ?User $requester = null, ?string $key = null): User
    {
        $limiter = 'reauth:'.Str::lower($username);
        $max = (int) config('pos.reauth_max_attempts', 5);

        $approver = User::where('username', $username)->first();
        $mode = $this->mode($requester ?? $approver);
        $field = $mode === 'password' ? 'approver_password' : 'approver_key';

        if (RateLimiter::tooManyAttempts($limiter, $max)) {
            throw ValidationException::withMessages([
                $field => ['Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'],
            ]);
        }

        $valid = $approver !== null
            && $approver->is_active
            && $this->permissions->allows($approver, $permission);

        if ($valid && $mode !== 'key') {
            $valid = Hash::check($password, $approver->password_hash);
        }
        if ($valid && $mode !== 'password') {
            $valid = $key !== null && $key !== '' && $this->keys->verify($approver, $key);
        }

        if (! $valid) {
            RateLimiter::hit($limiter, 300);

            $this->audit->log(
                'auth.reauth_failed',
                'user',
                $approver?->id,
                after: ['approver' => $username, 'permission' => $permission, 'method' => $mode],
                actorId: $requester?->id,
            );

            throw ValidationException::withMessages([
                $field => ['Kredensial persetujuan tidak valid atau tidak berwenang.'],
            ]);
        }

        RateLimiter::clear($limiter);

        $this->audit->log(
            'auth.reauth_ok',
            'user',
            $approver->id,
            after: ['permission' => $permission, 'method' => $mode],
            selfApproval: $requester !== null && $requester->id === $approver->id,
            actorId: $requester?->id ?? $approver->id,
        );

        return $approver;
    }
}
