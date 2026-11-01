<?php

namespace App\Http\Controllers;

use App\Http\Requests\StockAuthorityRequest;
use App\Services\StockAuthorityService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StockAuthorityController extends Controller
{
    public function __construct(private StockAuthorityService $authority, private StoreContext $stores)
    {
    }

    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->authority->get($this->stores->requireIdFor($request->user()))]);
    }

    public function update(StockAuthorityRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->authority->update($user, $this->stores->requireIdFor($user), $request->validated('rules'))]);
    }
}
