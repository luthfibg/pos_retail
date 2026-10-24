<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSaleRequest;
use App\Services\SaleService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SaleController extends Controller
{
    public function __construct(private SaleService $sales, private StoreContext $stores)
    {
    }

    /** 201 = struk baru; 200 + replayed=true = permintaan ulang dengan idempotency_key yang sama. */
    public function store(StoreSaleRequest $request): JsonResponse
    {
        $user = $request->user();

        [$sale, $created] = $this->sales->post($user, $this->stores->requireIdFor($user), $request->validated());

        return response()->json(['data' => $sale, 'replayed' => ! $created], $created ? 201 : 200);
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:40'],
            'shift_id' => ['nullable', 'integer'],
            'customer_id' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::in(['posted', 'voided'])],
            'payment_mode' => ['nullable', Rule::in(['cash', 'payroll_credit'])],
            'date_from' => ['nullable', 'date_format:Y-m-d'],
            'date_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $user = $request->user();

        return response()->json($this->sales->search(
            $user, $this->stores->requireIdFor($user), $filters, (int) ($filters['per_page'] ?? 25), $user->can('shift.review'),
        ));
    }

    public function show(Request $request, int $sale): JsonResponse
    {
        $user = $request->user();
        $found = $this->sales->find($user, $this->stores->requireIdFor($user), $sale, $user->can('shift.review'));

        abort_if($found === null, 404, 'Penjualan tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    /** Batalkan penjualan terposting (Admin). */
    public function void(Request $request, int $sale): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);
        $user = $request->user();

        return response()->json(['data' => $this->sales->void($user, $this->stores->requireIdFor($user), $sale, $data['reason'])]);
    }

    public function reprint(Request $request, int $sale): JsonResponse
    {
        $user = $request->user();
        $receipt = $this->sales->reprint($user, $this->stores->requireIdFor($user), $sale, $user->can('shift.review'));

        abort_if($receipt === null, 404, 'Penjualan tidak ditemukan.');

        return response()->json(['data' => $receipt]);
    }
}
