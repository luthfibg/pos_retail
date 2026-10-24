<?php

namespace App\Http\Controllers;

use App\Http\Requests\SetFloatPolicyRequest;
use App\Services\CashDepositService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FloatPolicyController extends Controller
{
    public function __construct(private CashDepositService $deposits, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->deposits->policies($this->stores->requireIdFor($request->user()))]);
    }

    public function update(SetFloatPolicyRequest $request, string $scope): JsonResponse
    {
        abort_unless(in_array($scope, ['petty_cash', 'main_cash'], true), 404, 'Cakupan kebijakan tidak dikenal.');
        $user = $request->user();

        return response()->json(['data' => $this->deposits->setPolicy($user, $this->stores->requireIdFor($user), $scope, $request->validated())]);
    }
}
