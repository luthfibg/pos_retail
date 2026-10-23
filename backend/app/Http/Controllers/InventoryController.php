<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreOpeningBalanceRequest;
use App\Services\InventoryService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class InventoryController extends Controller
{
    public function __construct(private InventoryService $inventory, private StoreContext $stores)
    {
    }

    public function productStock(Request $request, int $product): JsonResponse
    {
        $stock = $this->inventory->productStock($this->stores->requireIdFor($request->user()), $product);

        abort_if($stock === null, 404, 'Produk tidak ditemukan.');

        return response()->json(['data' => $stock]);
    }

    public function movements(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'product_id' => ['nullable', 'integer'],
            'movement_type' => ['nullable', Rule::in([
                'opening_balance', 'receipt', 'putaway', 'transfer', 'sale', 'sale_void', 'customer_return',
                'supplier_return_out', 'supplier_replacement_in', 'adjustment', 'write_off',
            ])],
            'date_from' => ['nullable', 'date_format:Y-m-d'],
            'date_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json($this->inventory->movements($storeId, $filters, (int) ($filters['per_page'] ?? 25)));
    }

    public function openingBalance(StoreOpeningBalanceRequest $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validated();

        $result = $this->inventory->openingBalance(
            $user,
            $this->stores->requireIdFor($user),
            $data['items'],
            $data['note'] ?? null,
        );

        return response()->json(['data' => $result], 201);
    }
}
