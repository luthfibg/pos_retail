<?php

namespace App\Http\Controllers;

use App\Exceptions\InsufficientStockException;
use App\Http\Requests\StoreDirectStockAdjustmentRequest;
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

    public function directMeta(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->adjustments->directMeta(
            $user,
            $this->stores->requireIdFor($user),
        )]);
    }

    public function directIndex(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'type' => ['nullable', Rule::in(['increase', 'decrease'])],
            'reason_code' => ['nullable', Rule::in([
                'damaged', 'expired', 'lost', 'found', 'input_correction', 'own_use', 'sample', 'other', 'opname_result',
            ])],
            'source' => ['nullable', Rule::in(['manual', 'opname'])],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date', 'after_or_equal:date_from'],
            'sort' => ['nullable', Rule::in(['newest', 'oldest'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();

        return response()->json($this->adjustments->searchDirect(
            $user,
            $this->stores->requireIdFor($user),
            $filters,
            (int) ($filters['per_page'] ?? 20),
        ));
    }

    public function directShow(Request $request, int $adjustment): JsonResponse
    {
        $user = $request->user();
        $found = $this->adjustments->findDirect($user, $this->stores->requireIdFor($user), $adjustment);
        abort_if($found === null, 404, 'Adjustment stok tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function directStore(StoreDirectStockAdjustmentRequest $request): JsonResponse
    {
        $user = $request->user();
        try {
            $result = $this->adjustments->record(
                $user,
                $this->stores->requireIdFor($user),
                $request->validated(),
            );
        } catch (InsufficientStockException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => 'insufficient_stock',
                'errors' => ['quantity' => [$exception->getMessage()]],
            ], 422);
        }

        return response()->json(['data' => $result['adjustment']], $result['created'] ? 201 : 200);
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
            'approver_key' => ['nullable', 'string', 'max:200'],
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
