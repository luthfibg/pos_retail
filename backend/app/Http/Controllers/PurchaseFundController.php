<?php

namespace App\Http\Controllers;

use App\Services\BankAccountService;
use App\Services\PurchaseFundService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PurchaseFundController extends Controller
{
    public function __construct(
        private BankAccountService $banks,
        private PurchaseFundService $funds,
        private StoreContext $stores,
    ) {}

    public function bankAccounts(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->banks->list($this->stores->requireIdFor($request->user()))]);
    }

    public function createBankAccount(Request $request): JsonResponse
    {
        $data = $request->validate([
            'bank_name' => ['required', 'string', 'max:100'],
            'account_name' => ['required', 'string', 'max:150'],
            'account_number' => ['required', 'string', 'max:60'],
            'opening_balance' => ['required', 'numeric', 'min:0', 'max:9999999999999999', 'decimal:0,2'],
            'reason' => ['required', 'string', 'max:255'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->banks->create(
            $user, $this->stores->requireIdFor($user), $data,
        )], 201);
    }

    public function adjustBankAccount(Request $request, int $account): JsonResponse
    {
        $data = $request->validate([
            'direction' => ['required', 'in:increase,decrease'],
            'amount' => ['required', 'numeric', 'gt:0', 'max:9999999999999999', 'decimal:0,2'],
            'reason' => ['required', 'string', 'max:255'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->banks->adjust(
            $user, $this->stores->requireIdFor($user), $account, $data,
        )]);
    }

    public function summary(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->funds->summary($this->stores->requireIdFor($request->user()))]);
    }
}
