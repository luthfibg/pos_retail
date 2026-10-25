<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreDiscountRequest;
use App\Http\Requests\UpdateDiscountRequest;
use App\Services\DiscountService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DiscountController extends Controller
{
    public function __construct(private DiscountService $discounts, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $f = $request->validate([
            'target_type' => ['nullable', Rule::in(['product', 'category'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $f['active_only'] = $request->boolean('active_only');

        return response()->json($this->discounts->search($this->stores->requireIdFor($request->user()), $f, (int) ($f['per_page'] ?? 25)));
    }

    public function show(Request $request, int $discount): JsonResponse
    {
        return response()->json(['data' => $this->discounts->find($this->stores->requireIdFor($request->user()), $discount)]);
    }

    public function store(StoreDiscountRequest $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->discounts->create($user, $this->stores->requireIdFor($user), $request->validated())], 201);
    }

    public function update(UpdateDiscountRequest $request, int $discount): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->discounts->update($user, $this->stores->requireIdFor($user), $discount, $request->validated())]);
    }
}
