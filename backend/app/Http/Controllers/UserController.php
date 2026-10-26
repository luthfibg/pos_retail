<?php

namespace App\Http\Controllers;

use App\Http\Requests\ChangePasswordRequest;
use App\Http\Requests\ResetPasswordRequest;
use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Services\StoreContext;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Laravel\Sanctum\PersonalAccessToken;

class UserController extends Controller
{
    public function __construct(private UserService $users, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $f = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['active', 'inactive'])],
            'role' => ['nullable', 'string', 'max:60'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json($this->users->search($this->stores->requireIdFor($request->user()), $f, (int) ($f['per_page'] ?? 25)));
    }

    public function show(Request $request, int $user): JsonResponse
    {
        return response()->json(['data' => $this->users->find($this->stores->requireIdFor($request->user()), $user)]);
    }

    public function roles(): JsonResponse
    {
        return response()->json(['data' => $this->users->roles()]);
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $actor = $request->user();

        return response()->json(['data' => $this->users->create($actor, $this->stores->requireIdFor($actor), $request->validated())], 201);
    }

    public function update(UpdateUserRequest $request, int $user): JsonResponse
    {
        $actor = $request->user();

        return response()->json(['data' => $this->users->update($actor, $this->stores->requireIdFor($actor), $user, $request->validated())]);
    }

    public function resetPassword(ResetPasswordRequest $request, int $user): JsonResponse
    {
        $actor = $request->user();

        return response()->json(['data' => $this->users->resetPassword($actor, $this->stores->requireIdFor($actor), $user, $request->validated('password'))]);
    }

    /** Ganti sandi sendiri (tanpa permission khusus). */
    public function changePassword(ChangePasswordRequest $request): JsonResponse
    {
        $token = $request->user()->currentAccessToken();

        $this->users->changeOwnPassword(
            $request->user(),
            $request->validated('current_password'),
            $request->validated('password'),
            $token instanceof PersonalAccessToken ? (int) $token->id : null,
        );

        return response()->json(['message' => 'Sandi berhasil diganti.']);
    }
}
