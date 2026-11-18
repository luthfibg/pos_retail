<?php

namespace App\Http\Controllers;

use App\Services\CashDepositService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CashDepositController extends Controller
{
    public function __construct(private CashDepositService $deposits, private StoreContext $stores) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizeViewing($request);

        $filters = $request->validate([
            'status' => ['nullable', 'in:draft,submitted,received,discrepancy,corrected'],
            'shift_id' => ['nullable', 'integer'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();

        return response()->json($this->deposits->search(
            $user, $this->stores->requireIdFor($user), $filters, (int) ($filters['per_page'] ?? 25), $user->can('cash_deposit.receive'),
        ));
    }

    public function show(Request $request, int $deposit): JsonResponse
    {
        $this->authorizeViewing($request);

        $user = $request->user();
        $found = $this->deposits->find($user, $this->stores->requireIdFor($user), $deposit, $user->can('cash_deposit.receive'));

        abort_if($found === null, 404, 'Setoran tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    private function authorizeViewing(Request $request): void
    {
        $user = $request->user();
        abort_unless($user->can('cash_deposit.create') || $user->can('cash_deposit.receive'), 403);
    }

    public function submit(Request $request, int $deposit): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->deposits->submit($user, $this->stores->requireIdFor($user), $deposit, $user->can('cash_deposit.receive'))]);
    }

    public function receive(Request $request, int $deposit): JsonResponse
    {
        $data = $request->validate([
            'received_amount' => ['required', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,2'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->deposits->receive(
            $user, $this->stores->requireIdFor($user), $deposit, (string) $data['received_amount'], $data['note'] ?? null,
        )]);
    }

    public function correct(Request $request, int $deposit): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);
        $user = $request->user();

        return response()->json(['data' => $this->deposits->correct($user, $this->stores->requireIdFor($user), $deposit, $data['reason'])]);
    }

    /** Saldo Kas Kecil dan Kas Besar dari ledger. */
    public function funds(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->deposits->balances($this->stores->requireIdFor($request->user()))]);
    }
}
