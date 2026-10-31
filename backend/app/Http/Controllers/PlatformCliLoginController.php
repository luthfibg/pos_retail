<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PlatformCliLoginController extends Controller
{
    public function __construct(private AuditLogger $audit) {}

    public function exchange(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ticket' => ['required', 'string', 'size:64', 'regex:/^[A-Za-z0-9]+$/'],
        ]);
        $ticketHash = hash('sha256', $validated['ticket']);

        $plainTextToken = DB::transaction(function () use ($ticketHash) {
            $ticket = DB::table('platform_cli_login_tickets')
                ->where('ticket_hash', $ticketHash)
                ->lockForUpdate()
                ->first();

            if ($ticket === null) {
                return null;
            }

            DB::table('platform_cli_login_tickets')->where('ticket_hash', $ticketHash)->delete();
            if (now()->greaterThanOrEqualTo($ticket->expires_at)) {
                return null;
            }

            $user = User::query()->whereKey($ticket->user_id)->first();
            $isActiveOperator = DB::table('platform_operators')
                ->where('user_id', $ticket->user_id)
                ->where('is_active', 1)
                ->exists();
            if ($user === null || ! $user->is_active || ! $isActiveOperator) {
                return null;
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

            return $token->plainTextToken;
        });

        abort_if($plainTextToken === null, 401, 'Tiket login tidak valid atau sudah kedaluwarsa.');

        return response()->json([
            'token' => $plainTextToken,
            'token_type' => 'Bearer',
        ]);
    }
}
