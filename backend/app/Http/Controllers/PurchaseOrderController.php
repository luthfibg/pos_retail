<?php

namespace App\Http\Controllers;

use App\Http\Requests\ApprovalRequest;
use App\Http\Requests\ReasonRequest;
use App\Http\Requests\StorePurchaseOrderRequest;
use App\Http\Requests\UpdatePurchaseOrderRequest;
use App\Services\PurchaseOrderService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PurchaseOrderController extends Controller
{
    public function __construct(private PurchaseOrderService $orders, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['draft', 'pending_confirmation', 'approved', 'sent', 'partially_received', 'received', 'cancelled'])],
            'receipt_status' => ['nullable', Rule::in(['none', 'partial', 'complete'])],
            'supplier_id' => ['nullable', 'integer'],
            'pr_id' => ['nullable', 'integer'],
            'receivable' => ['nullable', 'boolean'],
            'q' => ['nullable', 'string', 'max:40'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $filters['receivable'] = $request->boolean('receivable');

        $user = $request->user();

        return response()->json($this->orders->search(
            $user, $this->stores->requireIdFor($user), $filters, (int) ($filters['per_page'] ?? 25),
        ));
    }

    public function show(Request $request, int $po): JsonResponse
    {
        $user = $request->user();
        $found = $this->orders->find($user, $this->stores->requireIdFor($user), $po);

        abort_if($found === null, 404, 'PO tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StorePurchaseOrderRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->orders->create($user, $this->stores->requireIdFor($user), $request->validated()),
        ], 201);
    }

    public function update(UpdatePurchaseOrderRequest $request, int $po): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->orders->update($user, $this->stores->requireIdFor($user), $po, $request->validated()),
        ]);
    }

    public function submit(Request $request, int $po): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->orders->submit($user, $this->stores->requireIdFor($user), $po)]);
    }

    public function confirm(ApprovalRequest $request, int $po): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->orders->confirm($user, $this->stores->requireIdFor($user), $po, $request->validated())]);
    }

    public function send(Request $request, int $po): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->orders->send($user, $this->stores->requireIdFor($user), $po)]);
    }

    public function cancel(ReasonRequest $request, int $po): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->orders->cancel($user, $this->stores->requireIdFor($user), $po, $request->validated('reason'))]);
    }

    public function close(ReasonRequest $request, int $po): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->orders->close($user, $this->stores->requireIdFor($user), $po, $request->validated('reason'))]);
    }
}
