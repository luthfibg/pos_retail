<?php

namespace App\Http\Controllers;

use App\Http\Requests\StorePlatformTenantRequest;
use App\Services\PlatformStoreService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PlatformStoreController extends Controller
{
    public function __construct(private PlatformStoreService $stores) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['active', 'inactive'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json($this->stores->search($filters, (int) ($filters['per_page'] ?? 25)));
    }

    public function show(int $store): JsonResponse
    {
        $found = $this->stores->find($store);
        abort_if($found === null, 404, 'Toko tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StorePlatformTenantRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->stores->create($request->user(), $request->validated()),
        ], 201);
    }

    public function updateStatus(Request $request, int $store): JsonResponse
    {
        $data = $request->validate([
            'is_active' => ['required', 'boolean'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json([
            'data' => $this->stores->setActive($request->user(), $store, $data),
        ]);
    }
}
