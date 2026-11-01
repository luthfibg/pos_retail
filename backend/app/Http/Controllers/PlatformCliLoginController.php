<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\AuditLogger;
use App\Services\PlatformCliLoginTicket;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PlatformCliLoginController extends Controller
{
    public function __construct(
        private AuditLogger $audit,
        private PlatformCliLoginTicket $tickets,
    ) {}

    public function exchange(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ticket' => ['required', 'string', 'min:100', 'max:2048'],
            'issued_fingerprint' => ['nullable', 'string', 'size:12', 'regex:/^[a-f0-9]{12}$/'],
            'client_fingerprint' => ['nullable', 'string', 'size:12', 'regex:/^[a-f0-9]{12}$/'],
        ]);
        $ticketFingerprint = substr(hash('sha256', $validated['ticket']), 0, 12);
        $diagnosticFingerprints = [
            'issued_ticket_fingerprint' => $validated['issued_fingerprint'] ?? null,
            'client_ticket_fingerprint' => $validated['client_fingerprint'] ?? null,
        ];
        $ticket = $this->tickets->decode($validated['ticket']);
        if ($ticket === null) {
            $this->logRejected('ticket_invalid_or_wrong_app_key', $ticketFingerprint, $request, fingerprints: $diagnosticFingerprints);
            abort(401, 'Tiket login tidak valid atau sudah kedaluwarsa.');
        }
        if (now()->timestamp >= $ticket['expires_at']) {
            $this->logRejected('ticket_expired', $ticketFingerprint, $request, $ticket['user_id'], $diagnosticFingerprints);
            abort(401, 'Tiket login tidak valid atau sudah kedaluwarsa.');
        }

        $result = DB::transaction(function () use ($ticket) {
            $user = User::query()
                ->whereKey($ticket['user_id'])
                ->useWritePdo()
                ->lockForUpdate()
                ->first();
            $isActiveOperator = DB::table('platform_operators')
                ->where('user_id', $ticket['user_id'])
                ->where('is_active', 1)
                ->useWritePdo()
                ->exists();
            if ($user === null || ! $user->is_active || ! $isActiveOperator) {
                return [
                    'failure_reason' => $user === null || ! $user->is_active ? 'user_inactive_or_missing' : 'operator_inactive',
                    'user_id' => $ticket['user_id'],
                ];
            }

            $consumed = DB::table('platform_cli_login_tickets')->insertOrIgnore([
                'ticket_hash' => hash('sha256', $ticket['nonce']),
                'user_id' => $ticket['user_id'],
                'expires_at' => Carbon::createFromTimestamp($ticket['expires_at'])->toDateTimeString(),
            ]);
            if ($consumed !== 1) {
                return [
                    'failure_reason' => 'ticket_already_used',
                    'user_id' => $ticket['user_id'],
                ];
            }

            $expiresAt = now()->addHours((int) config('pos.token_ttl_hours', 12));
            $token = $user->createToken('platform-cli-login', ['*'], $expiresAt);
            $this->audit->log(
                'platform.operator_cli_login',
                'platform_operator',
                (int) $user->id,
                after: ['username' => $user->username],
                actorId: (int) $user->id,
            );

            return ['token' => $token->plainTextToken];
        });

        if (isset($result['failure_reason'])) {
            $this->logRejected(
                $result['failure_reason'],
                $ticketFingerprint,
                $request,
                $result['user_id'] ?? null,
                $diagnosticFingerprints,
            );

            abort(401, 'Tiket login tidak valid atau sudah kedaluwarsa.');
        }

        return response()->json([
            'token' => $result['token'],
            'token_type' => 'Bearer',
        ]);
    }

    private function logRejected(
        string $reason,
        string $ticketFingerprint,
        Request $request,
        ?int $userId = null,
        array $fingerprints = [],
    ): void {
        Log::warning('Platform CLI login ticket exchange rejected.', [
            'reason' => $reason,
            'user_id' => $userId,
            'ticket_fingerprint' => $ticketFingerprint,
            ...$fingerprints,
            'request_host' => $request->getHost(),
            'database_connection' => DB::connection()->getName(),
            'database_host' => DB::connection()->getConfig('host'),
            'database_port' => DB::connection()->getConfig('port'),
            'database' => DB::connection()->getDatabaseName(),
        ]);
    }
}
