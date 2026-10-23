<?php

namespace App\Http\Controllers;

use App\Http\Requests\CloseShiftRequest;
use App\Http\Requests\OpenShiftRequest;
use App\Services\ShiftService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ShiftController extends Controller
{
    public function __construct(private ShiftService $shifts, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['open', 'counting', 'closed', 'reviewed'])],
            'cashier_id' => ['nullable', 'integer'],
            'date_from' => ['nullable', 'date_format:Y-m-d'],
            'date_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json($this->shifts->search(
            $this->stores->requireIdFor($request->user()), $filters, (int) ($filters['per_page'] ?? 25),
        ));
    }

    /** Shift aktif milik pengguna; data = null bila belum ada (frontend: tampilkan "Buka shift"). */
    public function current(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->shifts->current($user, $this->stores->requireIdFor($user))]);
    }

    public function show(Request $request, int $shift): JsonResponse
    {
        $user = $request->user();
        $found = $this->shifts->find($user, $this->stores->requireIdFor($user), $shift, $user->can('shift.review'));

        abort_if($found === null, 404, 'Shift tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function open(OpenShiftRequest $request): JsonResponse
    {
        $user = $request->user();
        $counted = $request->validated('counted_opening_cash');

        return response()->json([
            'data' => $this->shifts->open($user, $this->stores->requireIdFor($user), $counted === null ? null : (string) $counted),
        ], 201);
    }

    public function startCount(Request $request, int $shift): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->shifts->startCount(
            $user, $this->stores->requireIdFor($user), $shift, $user->can('shift.review'),
        )]);
    }

    public function close(CloseShiftRequest $request, int $shift): JsonResponse
    {
        $user = $request->user();
        $data = $request->validated();

        return response()->json(['data' => $this->shifts->close(
            $user, $this->stores->requireIdFor($user), $shift,
            (string) $data['counted_cash'], $data['variance_note'] ?? null, $user->can('shift.review'),
        )]);
    }

    public function review(Request $request, int $shift): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        $user = $request->user();

        return response()->json(['data' => $this->shifts->review(
            $user, $this->stores->requireIdFor($user), $shift, $data['note'] ?? null,
        )]);
    }
}
