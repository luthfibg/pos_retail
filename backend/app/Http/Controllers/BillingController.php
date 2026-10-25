<?php

namespace App\Http\Controllers;

use App\Http\Requests\BillingPeriodRequest;
use App\Http\Requests\GenerateInvoiceRequest;
use App\Http\Requests\RecordInvoicePaymentRequest;
use App\Services\BillingService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class BillingController extends Controller
{
    public function __construct(private BillingService $billing, private StoreContext $stores)
    {
    }

    private function store(Request $request): int
    {
        return $this->stores->requireIdFor($request->user());
    }

    public function periods(Request $request): JsonResponse
    {
        $f = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        return response()->json($this->billing->periods($this->store($request), (int) ($f['per_page'] ?? 25)));
    }

    public function currentPeriod(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->billing->currentPeriod($this->store($request))]);
    }

    public function showPeriod(Request $request, int $period): JsonResponse
    {
        return response()->json(['data' => $this->billing->findPeriod($this->store($request), $period)]);
    }

    public function openPeriod(BillingPeriodRequest $request): JsonResponse
    {
        return response()->json(['data' => $this->billing->openPeriod($request->user(), $this->store($request), $request->validated())], 201);
    }

    public function updatePeriod(BillingPeriodRequest $request, int $period): JsonResponse
    {
        return response()->json(['data' => $this->billing->updatePeriod($request->user(), $this->store($request), $period, $request->validated())]);
    }

    public function closePeriod(Request $request, int $period): JsonResponse
    {
        return response()->json(['data' => $this->billing->closePeriod($request->user(), $this->store($request), $period)]);
    }

    public function generateInvoice(GenerateInvoiceRequest $request, int $period): JsonResponse
    {
        return response()->json(['data' => $this->billing->generateInvoice($request->user(), $this->store($request), $period, $request->validated())], 201);
    }

    public function invoices(Request $request): JsonResponse
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in(['draft', 'issued', 'handed_to_hr', 'partially_paid', 'paid', 'cancelled'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json($this->billing->invoices($this->store($request), $f['status'] ?? null, (int) ($f['per_page'] ?? 25)));
    }

    public function showInvoice(Request $request, int $invoice): JsonResponse
    {
        return response()->json(['data' => $this->billing->findInvoice($this->store($request), $invoice)]);
    }

    public function issue(Request $request, int $invoice): JsonResponse
    {
        return response()->json(['data' => $this->billing->issueInvoice($request->user(), $this->store($request), $invoice)]);
    }

    public function handOver(Request $request, int $invoice): JsonResponse
    {
        return response()->json(['data' => $this->billing->handOver($request->user(), $this->store($request), $invoice)]);
    }

    public function recordPayment(RecordInvoicePaymentRequest $request, int $invoice): JsonResponse
    {
        return response()->json(['data' => $this->billing->recordPayment($request->user(), $this->store($request), $invoice, $request->validated())], 201);
    }
}
