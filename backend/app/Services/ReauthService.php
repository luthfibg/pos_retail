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
 */
class ReauthService
{
    public function __construct(
        private PermissionResolver $permissions,
        private AuditLogger $audit,
    ) {
    }

    /**
     * @throws ValidationException
     */
    public function confirm(string $username, string $password, string $permission, ?User $requester = null): User
    {
        $key = 'reauth:'.Str::lower($username);
        $max = (int) config('pos.reauth_max_attempts', 5);

        if (RateLimiter::tooManyAttempts($key, $max)) {
            throw ValidationException::withMessages([
                'approver_password' => ['Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'],
            ]);
        }

        $approver = User::where('username', $username)->first();

        $valid = $approver !== null
            && $approver->is_active
            && Hash::check($password, $approver->password_hash)
            && $this->permissions->allows($approver, $permission);

        if (! $valid) {
            RateLimiter::hit($key, 300);

            $this->audit->log(
                'auth.reauth_failed',
                'user',
                $approver?->id,
                after: ['approver' => $username, 'permission' => $permission],
                actorId: $requester?->id,
            );

            throw ValidationException::withMessages([
                'approver_password' => ['Kredensial persetujuan tidak valid atau tidak berwenang.'],
            ]);
        }

        RateLimiter::clear($key);

        $this->audit->log(
            'auth.reauth_ok',
            'user',
            $approver->id,
            after: ['permission' => $permission],
            selfApproval: $requester !== null && $requester->id === $approver->id,
            actorId: $requester?->id ?? $approver->id,
        );

        return $approver;
    }
}
