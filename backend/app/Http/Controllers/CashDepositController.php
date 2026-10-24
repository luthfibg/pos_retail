<?php

namespace App\Http\Controllers;

use App\Services\CashDepositService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CashDepositController extends Controller
{
    public function __construct(private CashDepositService $deposits, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['draft', 'submitted', 'received', 'discrepancy', 'corrected'])],
            'kind' => ['nullable', Rule::in(['partial', 'final'])],
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
        $user = $request->user();
        $found = $this->deposits->find($user, $this->stores->requireIdFor($user), $deposit, $user->can('cash_deposit.receive'));

        abort_if($found === null, 404, 'Setoran tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    /** Setoran parsial di tengah shift. */
    public function storePartial(Request $request, int $shift): JsonResponse
    {
        $data = $request->validate([
            'counted_amount' => ['required', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,2'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $user = $request->user();

        return response()->json(['data' => $this->deposits->createPartial(
            $user, $this->stores->requireIdFor($user), $shift, (string) $data['counted_amount'], $data['note'] ?? null, $user->can('cash_deposit.receive'),
        )], 201);
    }

    public function submit(Request $request, int $deposit): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->deposits->submit($user, $this->stores->requireIdFor($user), $deposit, $user->can('cash_deposit.receive'))]);
    }

    public function cancel(Request $request, int $deposit): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $user = $request->user();

        return response()->json(['data' => $this->deposits->cancel(
            $user, $this->stores->requireIdFor($user), $deposit, $data['reason'] ?? null, $user->can('cash_deposit.receive'),
        )]);
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
