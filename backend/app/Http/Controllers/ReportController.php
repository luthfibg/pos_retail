<?php

namespace App\Http\Controllers;

use App\Services\ReportService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    public function __construct(private ReportService $reports, private StoreContext $stores) {}

    public function dashboard(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json(['data' => $this->reports->dashboard(
            $request->user(),
            $this->stores->requireIdFor($request->user()),
            $filters,
            $request->user()->can('shift.review'),
        )]);
    }

    public function salesDaily(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json(['data' => $this->reports->salesDaily(
            $request->user(),
            $this->stores->requireIdFor($request->user()),
            $filters,
            $request->user()->can('shift.review'),
        )]);
    }

    public function inventory(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'expiry_days' => ['nullable', 'integer', 'min:1', 'max:365'],
            'include_expired' => ['nullable', 'boolean'],
        ]);

        return response()->json(['data' => $this->reports->inventory(
            $this->stores->requireIdFor($request->user()),
            $filters,
        )]);
    }

    public function cashSummary(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json(['data' => $this->reports->cashSummary(
            $request->user(),
            $this->stores->requireIdFor($request->user()),
            $filters,
            $request->user()->can('shift.review'),
        )]);
    }

    /** @return array<string, mixed> */
    private function filters(Request $request): array
    {
        $filters = $request->validate([
            'date_from' => ['nullable', 'date_format:Y-m-d'],
            'date_to' => ['nullable', 'date_format:Y-m-d'],
            'cashier_id' => ['nullable', 'integer', 'min:1'],
        ]);

        $to = $filters['date_to'] ?? now('Asia/Jakarta')->toDateString();
        $from = $filters['date_from'] ?? $to;

        abort_if($from > $to, 422, 'Tanggal awal tidak boleh setelah tanggal akhir.');
        abort_if(now('Asia/Jakarta')->parse($from)->diffInDays(now('Asia/Jakarta')->parse($to)) > 365, 422, 'Rentang laporan maksimal 365 hari.');

        if (($filters['cashier_id'] ?? null) !== null && ! $request->user()->can('shift.review')) {
            abort(403, 'Kasir hanya dapat memilih laporan shift miliknya sendiri.');
        }

        return $filters + ['date_from' => $from, 'date_to' => $to];
    }
}
