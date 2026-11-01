<?php

namespace App\Http\Controllers;

use App\Http\Requests\WarehouseSettingRequest;
use App\Services\StoreContext;
use App\Services\WarehouseSettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WarehouseSettingController extends Controller
{
    public function __construct(
        private WarehouseSettingService $warehouse,
        private StoreContext $stores,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->warehouse->get($this->stores->requireIdFor($request->user())),
        ]);
    }

    public function update(WarehouseSettingRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->warehouse->update(
                $user,
                $this->stores->requireIdFor($user),
                $request->validated(),
            ),
        ]);
    }
}
