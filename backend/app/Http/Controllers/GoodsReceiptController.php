<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreGoodsReceiptRequest;
use App\Http\Requests\VerifyDocumentsRequest;
use App\Services\GoodsReceiptService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class GoodsReceiptController extends Controller
{
    public function __construct(private GoodsReceiptService $receipts, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['draft', 'checked', 'posted', 'cancelled'])],
            'document_status' => ['nullable', Rule::in(['pending', 'verified'])],
            'po_id' => ['nullable', 'integer'],
            'q' => ['nullable', 'string', 'max:40'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $user = $request->user();

        return response()->json($this->receipts->search(
            $user, $this->stores->requireIdFor($user), $filters, (int) ($filters['per_page'] ?? 25),
        ));
    }

    public function show(Request $request, int $gr): JsonResponse
    {
        $user = $request->user();
        $found = $this->receipts->find($user, $this->stores->requireIdFor($user), $gr);

        abort_if($found === null, 404, 'Penerimaan tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StoreGoodsReceiptRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->receipts->create($user, $this->stores->requireIdFor($user), $request->validated()),
        ], 201);
    }

    public function post(Request $request, int $gr): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->receipts->post($user, $this->stores->requireIdFor($user), $gr)]);
    }

    public function verifyDocuments(VerifyDocumentsRequest $request, int $gr): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->receipts->verifyDocuments($user, $this->stores->requireIdFor($user), $gr, $request->validated()),
        ]);
    }

    public function cancel(Request $request, int $gr): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $user = $request->user();

        return response()->json(['data' => $this->receipts->cancel($user, $this->stores->requireIdFor($user), $gr, $data['reason'] ?? null)]);
    }
}
