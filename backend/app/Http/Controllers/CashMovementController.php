<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreCashMovementRequest;
use App\Services\CashMovementService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CashMovementController extends Controller
{
    public function __construct(private CashMovementService $movements, private StoreContext $stores) {}

    public function index(Request $request, int $shift): JsonResponse
    {
        $filters = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();

        return response()->json($this->movements->search(
            $user,
            $this->stores->requireIdFor($user),
            $shift,
            (int) ($filters['per_page'] ?? 25),
            $user->can('shift.review'),
        ));
    }

    public function store(StoreCashMovementRequest $request, int $shift): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->movements->create(
            $user,
            $this->stores->requireIdFor($user),
            $shift,
            $request->validated(),
            $user->can('shift.review'),
        )], 201);
    }
}
