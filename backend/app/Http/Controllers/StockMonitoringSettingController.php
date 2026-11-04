<?php

namespace App\Http\Controllers;

use App\Http\Requests\StockMonitoringSettingRequest;
use App\Services\StockMonitoringSettingService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StockMonitoringSettingController extends Controller
{
    public function __construct(
        private StockMonitoringSettingService $settings,
        private StoreContext $stores,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->settings->get($this->stores->requireIdFor($request->user())),
        ]);
    }

    public function update(StockMonitoringSettingRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->settings->update(
                $user,
                $this->stores->requireIdFor($user),
                $request->validated(),
            ),
        ]);
    }
}
