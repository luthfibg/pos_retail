<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\PermissionResolver;
use App\Services\PlatformAccess;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class AuthController extends Controller
{
    public function __construct(
        private PermissionResolver $permissions,
        private StoreContext $stores,
        private AuditLogger $audit,
        private PlatformAccess $platformAccess,
    ) {}

    public function login(LoginRequest $request): JsonResponse
    {
        $username = $request->validated('username');
        $user = User::where('username', $username)->first();

        $valid = $user !== null
            && $user->is_active
            && Hash::check($request->validated('password'), $user->password_hash);

        if (! $valid) {
            $this->audit->log(
                'auth.login_failed',
                'user',
                $user?->id,
                after: ['username' => $username],
                actorId: $user?->id,
            );

            throw ValidationException::withMessages([
                'username' => ['Username atau password salah.'],
            ]);
        }

        $expiresAt = now()->addHours((int) config('pos.token_ttl_hours', 12));
        $token = $user->createToken('api', ['*'], $expiresAt);

        $user->forceFill(['last_login_at' => now()])->save();

        $this->audit->log('auth.login', 'user', $user->id, actorId: $user->id);

        return response()->json([
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
            'expires_at' => $expiresAt->toIso8601String(),
            'user' => $this->userPayload($user),
            'platform_operator' => $this->platformAccess->isOperator($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $token = $request->user()->currentAccessToken();

        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        }

        $this->audit->log('auth.logout', 'user', $request->user()->id);

        return response()->json(['message' => 'Berhasil keluar.']);
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        $storeId = $this->stores->idFor($user);
        $isPlatformOperator = $this->platformAccess->isOperator($user);

        abort_if($storeId === null && ! $isPlatformOperator, 403, 'Pengguna belum ditugaskan ke toko aktif.');

        if ($storeId === null) {
            return response()->json([
                'user' => $this->userPayload($user),
                'platform_operator' => true,
                'store' => null,
                'roles' => [],
                'permissions' => [],
            ]);
        }

        $roles = DB::table('user_roles as ur')
            ->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('ur.user_id', $user->id)
            ->where('ur.store_id', $storeId)
            ->orderBy('r.name')
            ->pluck('r.name');

        return response()->json([
            'user' => $this->userPayload($user),
            'store' => DB::table('stores')->where('id', $storeId)->first(['id', 'code', 'name', 'timezone', 'currency']),
            'roles' => $roles,
            'permissions' => $this->permissions->codes($user, $storeId),
            'platform_operator' => $isPlatformOperator,
        ]);
    }

    /** @return array<string, mixed> */
    private function userPayload(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'username' => $user->username,
        ];
    }
}
