<?php

namespace App\Http\Controllers;

use App\Services\OpnameLockService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OpnameLockStatusController extends Controller
{
    public function __construct(private OpnameLockService $locks, private StoreContext $stores) {}

    public function show(Request $request): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());
        $sessions = $this->locks->activeSessionsSummary($storeId);

        return response()->json([
            'locked' => $sessions !== [],
            'store_wide' => $this->locks->hasStoreWideLock($storeId) !== null,
            'sessions' => $sessions,
        ]);
    }
}
