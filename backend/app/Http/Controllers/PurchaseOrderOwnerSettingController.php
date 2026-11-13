<?php

namespace App\Http\Controllers;

use App\Services\PermissionResolver;
use App\Services\PurchaseOrderOwnerSettingService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PurchaseOrderOwnerSettingController extends Controller
{
    public function __construct(
        private PurchaseOrderOwnerSettingService $settings,
        private PermissionResolver $permissions,
        private StoreContext $stores,
    ) {}

    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        $storeId = $this->stores->requireIdFor($user);
        abort_unless(
            $this->permissions->allows($user, 'settings.manage', $storeId)
                || $this->permissions->allows($user, 'purchase_order.create', $storeId),
            403,
        );

        return response()->json(['data' => $this->settings->get($storeId)]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate(['owner_user_id' => ['required', 'integer', 'min:1']]);
        $user = $request->user();

        return response()->json([
            'data' => $this->settings->update(
                $user,
                $this->stores->requireIdFor($user),
                (int) $validated['owner_user_id'],
            ),
        ]);
    }
}
