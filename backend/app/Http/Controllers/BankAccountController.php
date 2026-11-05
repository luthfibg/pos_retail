<?php

namespace App\Http\Controllers;

use App\Services\BankAccountService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BankAccountController extends Controller
{
    public function __construct(
        private BankAccountService $accounts,
        private StoreContext $stores,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->accounts->listForPurchase(
            $this->stores->requireIdFor($request->user()),
        )]);
    }

    public function settingsIndex(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->accounts->listForSettings(
            $this->stores->requireIdFor($request->user()),
        )]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'bank_name' => ['required', 'string', 'max:100'],
            'account_name' => ['required', 'string', 'max:150'],
            'account_number' => ['required', 'string', 'max:60'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->accounts->create(
            $user,
            $this->stores->requireIdFor($user),
            $data,
        )], 201);
    }

    public function update(Request $request, int $account): JsonResponse
    {
        $data = $request->validate([
            'bank_name' => ['sometimes', 'required', 'string', 'max:100'],
            'account_name' => ['sometimes', 'required', 'string', 'max:150'],
            'account_number' => ['sometimes', 'required', 'string', 'max:60'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->accounts->update(
            $user,
            $this->stores->requireIdFor($user),
            $account,
            $data,
        )]);
    }
}
