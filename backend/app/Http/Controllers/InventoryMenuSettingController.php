<?php

namespace App\Http\Controllers;

use App\Services\InventoryMenuSettingService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InventoryMenuSettingController extends Controller
{
    public function __construct(
        private InventoryMenuSettingService $settings,
        private StoreContext $stores,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->settings->get(
            $this->stores->requireIdFor($request->user()),
        )]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'show_opening_balance' => ['required', 'boolean'],
            'show_stock_transfer' => ['required', 'boolean'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->settings->update(
            $user,
            $this->stores->requireIdFor($user),
            $data,
        )]);
    }
}
