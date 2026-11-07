<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateOpnameDisplaySettingRequest;
use App\Services\OpnameDisplayPolicy;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OpnameDisplaySettingController extends Controller
{
    public function __construct(
        private OpnameDisplayPolicy $policy,
        private StoreContext $stores,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->policy->get($this->stores->requireIdFor($request->user())),
        ]);
    }

    public function update(UpdateOpnameDisplaySettingRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->policy->update(
                $user,
                $this->stores->requireIdFor($user),
                (bool) $request->validated('show_system_qty'),
            ),
        ]);
    }
}
