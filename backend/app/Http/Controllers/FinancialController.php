<?php

namespace App\Http\Controllers;

use App\Services\FinancialService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FinancialController extends Controller
{
    public function __construct(
        private FinancialService $financial,
        private StoreContext $stores,
    ) {}

    public function report(Request $request): JsonResponse
    {
        $filters = $this->dateFilters($request);

        return response()->json(['data' => $this->financial->report(
            $this->stores->requireIdFor($request->user()),
            $filters,
        )]);
    }

    public function purchaseOrders(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json($this->financial->purchaseOrders(
            $this->stores->requireIdFor($request->user()),
            (int) ($filters['per_page'] ?? 25),
        ));
    }

    public function recordPurchaseOrderPayment(Request $request, int $po): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0', 'decimal:0,2'],
            'paid_on' => ['nullable', 'date_format:Y-m-d'],
            'reference' => ['nullable', 'string', 'max:100'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        return response()->json(['data' => $this->financial->recordPurchaseOrderPayment(
            $request->user(),
            $this->stores->requireIdFor($request->user()),
            $po,
            $data,
        )], 201);
    }

    public function recordExpense(Request $request): JsonResponse
    {
        $data = $request->validate([
            'category' => ['required', Rule::in(['operational', 'payroll'])],
            'description' => ['required', 'string', 'max:255'],
            'amount' => ['required', 'numeric', 'gt:0', 'decimal:0,2'],
            'paid_on' => ['nullable', 'date_format:Y-m-d'],
        ]);

        return response()->json(['data' => $this->financial->recordExpense(
            $request->user(),
            $this->stores->requireIdFor($request->user()),
            $data,
        )], 201);
    }

    /** @return array{date_from: string, date_to: string} */
    private function dateFilters(Request $request): array
    {
        $filters = $request->validate([
            'date_from' => ['nullable', 'date_format:Y-m-d'],
            'date_to' => ['nullable', 'date_format:Y-m-d'],
        ]);

        $to = $filters['date_to'] ?? now('Asia/Jakarta')->toDateString();
        $from = $filters['date_from'] ?? $to;
        abort_if($from > $to, 422, 'Tanggal awal tidak boleh setelah tanggal akhir.');
        abort_if(now('Asia/Jakarta')->parse($from)->diffInDays(now('Asia/Jakarta')->parse($to)) > 365, 422, 'Rentang laporan maksimal 365 hari.');

        return ['date_from' => $from, 'date_to' => $to];
    }
}
