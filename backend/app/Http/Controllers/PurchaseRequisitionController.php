<?php

namespace App\Http\Controllers;

use App\Http\Requests\ApprovalRequest;
use App\Http\Requests\FinanceCheckRequest;
use App\Http\Requests\StorePurchaseRequisitionRequest;
use App\Http\Requests\UpdatePurchaseRequisitionRequest;
use App\Services\PurchaseRequisitionService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PurchaseRequisitionController extends Controller
{
    public function __construct(private PurchaseRequisitionService $requisitions, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['draft', 'submitted', 'finance_checked', 'approved', 'rejected', 'returned', 'converted', 'cancelled'])],
            'q' => ['nullable', 'string', 'max:40'],
            'mine' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $filters['mine'] = $request->boolean('mine');

        $user = $request->user();

        return response()->json($this->requisitions->search(
            $user, $this->stores->requireIdFor($user), $filters, (int) ($filters['per_page'] ?? 25),
        ));
    }

    public function show(Request $request, int $pr): JsonResponse
    {
        $user = $request->user();
        $found = $this->requisitions->find($user, $this->stores->requireIdFor($user), $pr);

        abort_if($found === null, 404, 'PR tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StorePurchaseRequisitionRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->requisitions->create($user, $this->stores->requireIdFor($user), $request->validated()),
        ], 201);
    }

    public function update(UpdatePurchaseRequisitionRequest $request, int $pr): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->requisitions->update($user, $this->stores->requireIdFor($user), $pr, $request->validated()),
        ]);
    }

    public function submit(Request $request, int $pr): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->requisitions->submit($user, $this->stores->requireIdFor($user), $pr)]);
    }

    public function financeCheck(FinanceCheckRequest $request, int $pr): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->requisitions->financeCheck(
            $user, $this->stores->requireIdFor($user), $pr, $request->validated('decision'), $request->validated('note'),
        )]);
    }

    public function approve(ApprovalRequest $request, int $pr): JsonResponse
    {
        $user = $request->user();
        $data = $request->validated() + ['decision' => 'approve'];

        return response()->json(['data' => $this->requisitions->approve($user, $this->stores->requireIdFor($user), $pr, $data)]);
    }

    public function cancel(Request $request, int $pr): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $user = $request->user();

        return response()->json(['data' => $this->requisitions->cancel($user, $this->stores->requireIdFor($user), $pr, $data['reason'] ?? null)]);
    }
}
