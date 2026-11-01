<?php

namespace App\Services;

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;
use JsonException;

class PlatformCliLoginTicket
{
    public function issue(int $userId, int $expiresAt): string
    {
        $encrypted = Crypt::encryptString(json_encode([
            'user_id' => $userId,
            'expires_at' => $expiresAt,
            'nonce' => Str::random(64),
        ], JSON_THROW_ON_ERROR));

        return rtrim(strtr($encrypted, '+/', '-_'), '=');
    }

    /**
     * @return array{user_id: int, expires_at: int, nonce: string}|null
     */
    public function decode(string $ticket): ?array
    {
        if (! preg_match('/^[A-Za-z0-9_-]+$/', $ticket)) {
            return null;
        }

        $encrypted = strtr($ticket, '-_', '+/');
        $encrypted .= str_repeat('=', (4 - strlen($encrypted) % 4) % 4);

        try {
            $payload = json_decode(Crypt::decryptString($encrypted), true, flags: JSON_THROW_ON_ERROR);
        } catch (DecryptException|JsonException) {
            return null;
        }

        if (
            ! is_array($payload)
            || ! isset($payload['user_id'], $payload['expires_at'], $payload['nonce'])
            || ! is_int($payload['user_id'])
            || ! is_int($payload['expires_at'])
            || ! is_string($payload['nonce'])
            || ! preg_match('/^[A-Za-z0-9_-]{64}$/', $payload['nonce'])
        ) {
            return null;
        }

        return [
            'user_id' => $payload['user_id'],
            'expires_at' => $payload['expires_at'],
            'nonce' => $payload['nonce'],
        ];
    }
}
