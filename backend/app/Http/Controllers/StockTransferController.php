<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreStockTransferRequest;
use App\Services\StockTransferService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class StockTransferController extends Controller
{
    public function __construct(private StockTransferService $transfers, private StoreContext $stores) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['draft', 'posted', 'cancelled'])],
            'q' => ['nullable', 'string', 'max:30'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();

        return response()->json($this->transfers->search(
            $this->stores->requireIdFor($user),
            $filters,
            (int) ($filters['per_page'] ?? 25),
        ));
    }

    public function show(Request $request, int $transfer): JsonResponse
    {
        $found = $this->transfers->find($this->stores->requireIdFor($request->user()), $transfer);
        abort_if($found === null, 404, 'Transfer stok tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StoreStockTransferRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->transfers->create(
            $user,
            $this->stores->requireIdFor($user),
            $request->validated(),
        )], 201);
    }

    public function post(Request $request, int $transfer): JsonResponse
    {
        return response()->json(['data' => $this->transfers->post(
            $request->user(),
            $this->stores->requireIdFor($request->user()),
            $transfer,
        )]);
    }

    public function cancel(Request $request, int $transfer): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);

        return response()->json(['data' => $this->transfers->cancel(
            $request->user(),
            $this->stores->requireIdFor($request->user()),
            $transfer,
            $data['reason'] ?? null,
        )]);
    }
}
