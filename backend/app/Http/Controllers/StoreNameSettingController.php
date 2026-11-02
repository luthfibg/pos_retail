<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateStoreNameRequest;
use App\Services\StoreContext;
use App\Services\StoreNameSettingService;
use Illuminate\Http\JsonResponse;

class StoreNameSettingController extends Controller
{
    public function __construct(
        private StoreNameSettingService $storeName,
        private StoreContext $stores,
    ) {}

    public function update(UpdateStoreNameRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->storeName->update(
                $user,
                $this->stores->requireIdFor($user),
                $request->validated('name'),
            ),
        ]);
    }
}
