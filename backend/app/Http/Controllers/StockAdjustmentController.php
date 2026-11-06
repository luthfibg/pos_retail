<?php

namespace App\Http\Controllers;

use App\Exceptions\InsufficientStockException;
use App\Http\Requests\StoreStockAdjustmentRequest;
use App\Services\StockAdjustmentService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class StockAdjustmentController extends Controller
{
    public function __construct(private StockAdjustmentService $adjustments, private StoreContext $stores) {}

    public function meta(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->adjustments->meta(
            $user,
            $this->stores->requireIdFor($user),
        )]);
    }

    public function index(Request $request): JsonResponse
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

        return response()->json($this->adjustments->search(
            $user,
            $this->stores->requireIdFor($user),
            $filters,
            (int) ($filters['per_page'] ?? 20),
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
}
