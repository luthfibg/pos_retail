<?php

namespace App\Http\Controllers;

use App\Services\RegisterService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class RegisterController extends Controller
{
    public function __construct(private RegisterService $registers, private StoreContext $stores) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->registers->list($this->stores->requireIdFor($request->user()))]);
    }

    public function available(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->registers->available($this->stores->requireIdFor($request->user()))]);
    }

    public function show(Request $request, int $register): JsonResponse
    {
        $found = $this->registers->find($this->stores->requireIdFor($request->user()), $register);
        abort_if($found === null, 404, 'Mesin kasir tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:60']]);
        $user = $request->user();

        return response()->json(['data' => $this->registers->create(
            $user, $this->stores->requireIdFor($user), $data['name'],
        )], 201);
    }

    public function update(Request $request, int $register): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:60'],
            'is_active' => ['sometimes', 'required', 'boolean'],
            'reason' => ['nullable', 'required_if:is_active,false', 'string', 'max:255'],
        ]);
        if (! array_key_exists('name', $data) && ! array_key_exists('is_active', $data)) {
            throw ValidationException::withMessages(['register' => ['Tidak ada perubahan mesin kasir yang dikirim.']]);
        }
        $user = $request->user();

        return response()->json(['data' => $this->registers->update(
            $user, $this->stores->requireIdFor($user), $register, $data,
        )]);
    }

    public function destroy(Request $request, int $register): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        $user = $request->user();

        return response()->json(['data' => $this->registers->deactivate(
            $user, $this->stores->requireIdFor($user), $register, $data['reason'],
        )]);
    }
}
