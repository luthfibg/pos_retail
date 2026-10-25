<?php

namespace App\Http\Controllers;

use App\Http\Requests\VatSettingRequest;
use App\Services\StoreContext;
use App\Services\VatSettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VatSettingController extends Controller
{
    public function __construct(private VatSettingService $vat, private StoreContext $stores)
    {
    }

    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->vat->get($this->stores->requireIdFor($request->user()))]);
    }

    public function update(VatSettingRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->vat->update($user, $this->stores->requireIdFor($user), $request->validated())]);
    }
}
