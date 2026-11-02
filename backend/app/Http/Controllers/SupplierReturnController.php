<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSupplierReturnRequest;
use App\Services\StoreContext;
use App\Services\SupplierReturnService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SupplierReturnController extends Controller
{
    public function __construct(private SupplierReturnService $returns, private StoreContext $stores) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['draft', 'submitted', 'accepted', 'rejected', 'replacement_received', 'written_off', 'cancelled'])],
            'supplier_id' => ['nullable', 'integer', 'min:1'],
            'q' => ['nullable', 'string', 'max:40'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();

        return response()->json($this->returns->search(
            $user,
            $this->stores->requireIdFor($user),
            $filters,
            (int) ($filters['per_page'] ?? 25),
        ));
    }

    public function show(Request $request, int $supplierReturn): JsonResponse
    {
        $user = $request->user();
        $found = $this->returns->find($user, $this->stores->requireIdFor($user), $supplierReturn);
        abort_if($found === null, 404, 'Retur supplier tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StoreSupplierReturnRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->returns->create(
            $user,
            $this->stores->requireIdFor($user),
            $request->validated(),
        )], 201);
    }

    public function submit(Request $request, int $supplierReturn): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->returns->submit(
            $user,
            $this->stores->requireIdFor($user),
            $supplierReturn,
        )]);
    }

    public function supplierDecision(Request $request, int $supplierReturn): JsonResponse
    {
        $data = $request->validate([
            'decision' => ['required', Rule::in(['accept', 'reject'])],
            'note' => ['nullable', 'required_if:decision,reject', 'string', 'max:500'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->returns->supplierDecision(
            $user,
            $this->stores->requireIdFor($user),
            $supplierReturn,
            $data,
        )]);
    }

    public function receiveReplacement(Request $request, int $supplierReturn): JsonResponse
    {
        $data = $request->validate([
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.return_item_id' => ['required', 'integer', 'min:1'],
            'items.*.expiry_date' => ['nullable', 'date_format:Y-m-d'],
            'items.*.batch_code' => ['nullable', 'string', 'max:60'],
            'items.*.shelf_position_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->returns->receiveReplacement(
            $user,
            $this->stores->requireIdFor($user),
            $supplierReturn,
            $data['items'],
        )]);
    }

    public function writeOff(Request $request, int $supplierReturn): JsonResponse
    {
        $data = $request->validate([
            'note' => ['nullable', 'string', 'max:500'],
            'approver_username' => ['nullable', 'string', 'max:60'],
            'approver_password' => ['nullable', 'string', 'max:200'],
            'approver_key' => ['nullable', 'string', 'max:200'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->returns->writeOff(
            $user,
            $this->stores->requireIdFor($user),
            $supplierReturn,
            $data,
        )]);
    }

    public function cancel(Request $request, int $supplierReturn): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $user = $request->user();

        return response()->json(['data' => $this->returns->cancel(
            $user,
            $this->stores->requireIdFor($user),
            $supplierReturn,
            $data['reason'] ?? null,
        )]);
    }
}
