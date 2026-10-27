<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreStockAdjustmentRequest;
use App\Services\StockAdjustmentService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class StockAdjustmentController extends Controller
{
    public function __construct(private StockAdjustmentService $adjustments, private StoreContext $stores) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['draft', 'requested', 'posted', 'rejected', 'cancelled'])],
            'reason' => ['nullable', Rule::in(['opname', 'loss', 'damage', 'expired', 'other'])],
            'q' => ['nullable', 'string', 'max:30'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();

        return response()->json($this->adjustments->search(
            $user,
            $this->stores->requireIdFor($user),
            $filters,
            (int) ($filters['per_page'] ?? 25),
        ));
    }

    public function show(Request $request, int $adjustment): JsonResponse
    {
        $user = $request->user();
        $found = $this->adjustments->find($user, $this->stores->requireIdFor($user), $adjustment);
        abort_if($found === null, 404, 'Adjustment stok tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StoreStockAdjustmentRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->adjustments->create(
            $user,
            $this->stores->requireIdFor($user),
            $request->validated(),
        )], 201);
    }

    public function request(Request $request, int $adjustment): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->adjustments->request(
            $user,
            $this->stores->requireIdFor($user),
            $adjustment,
        )]);
    }

    public function approve(Request $request, int $adjustment): JsonResponse
    {
        $data = $request->validate([
            'decision' => ['sometimes', Rule::in(['approve', 'reject'])],
            'note' => ['nullable', 'string', 'max:500'],
            'approver_username' => ['nullable', 'string', 'max:60'],
            'approver_password' => ['nullable', 'string', 'max:200'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->adjustments->approve(
            $user,
            $this->stores->requireIdFor($user),
            $adjustment,
            $data + ['decision' => 'approve'],
        )]);
    }

    public function cancel(Request $request, int $adjustment): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $user = $request->user();

        return response()->json(['data' => $this->adjustments->cancel(
            $user,
            $this->stores->requireIdFor($user),
            $adjustment,
            $data['reason'] ?? null,
        )]);
    }
}
