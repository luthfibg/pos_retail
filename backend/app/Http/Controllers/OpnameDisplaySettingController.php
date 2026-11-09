<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateOpnameDisplaySettingRequest;
use App\Services\OpnameApprovalSettingsService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OpnameDisplaySettingController extends Controller
{
    public function __construct(
        private OpnameApprovalSettingsService $settings,
        private StoreContext $stores,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->settings->get($request->user(), $this->stores->requireIdFor($request->user())),
        ]);
    }

    public function update(UpdateOpnameDisplaySettingRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->settings->update($user, $this->stores->requireIdFor($user), $request->validated()),
        ]);
    }
}
