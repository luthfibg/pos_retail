<?php

namespace App\Http\Controllers;

use App\Http\Requests\AdminModelRequest;
use App\Services\AdminModelService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminModelController extends Controller
{
    public function __construct(private AdminModelService $models, private StoreContext $stores)
    {
    }

    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->models->get($this->stores->requireIdFor($request->user()))]);
    }

    public function update(AdminModelRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->models->switchTo($user, $this->stores->requireIdFor($user), $request->validated('model'))]);
    }
}
