<?php

namespace App\Http\Controllers;

use App\Services\AuthorizationKeyService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AuthorizationKeyController extends Controller
{
    public function __construct(private AuthorizationKeyService $keys, private StoreContext $stores)
    {
    }

    /** Status kunci milik pengguna yang login. */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->keys->status($user, $this->stores->requireIdFor($user))]);
    }

    /** Buat atau ganti kunci sendiri. */
    public function set(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string', 'max:200'],
            'type' => ['required', Rule::in(['code', 'passphrase'])],
            'key' => ['nullable', 'string', 'max:200', 'required_without:generate'],
            'generate' => ['nullable', 'boolean'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->keys->set($user, $this->stores->requireIdFor($user), $data)]);
    }

    /** Hapus kunci sendiri. */
    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate(['current_password' => ['required', 'string', 'max:200']]);
        $user = $request->user();

        return response()->json(['data' => $this->keys->remove($user, $this->stores->requireIdFor($user), $data['current_password'])]);
    }

    /** Daftar pemegang izin persetujuan beserta status kuncinya (user.manage). */
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->keys->holders($this->stores->requireIdFor($request->user()))]);
    }

    /** Cabut kunci pengguna lain (user.manage). */
    public function revoke(Request $request, int $user): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);
        $actor = $request->user();
        $storeId = $this->stores->requireIdFor($actor);

        $this->keys->revoke($actor, $storeId, $user, $data['reason']);

        return response()->json(['data' => $this->keys->holders($storeId)]);
    }

    /** Mode kredensial persetujuan toko (settings.manage). */
    public function mode(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->keys->modeInfo($this->stores->requireIdFor($request->user()))]);
    }

    public function setMode(Request $request): JsonResponse
    {
        $data = $request->validate([
            'mode' => ['required', Rule::in(AuthorizationKeyService::MODES)],
            'current_password' => ['required', 'string', 'max:200'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->keys->setMode($user, $this->stores->requireIdFor($user), $data['mode'], $data['current_password'])]);
    }
}
