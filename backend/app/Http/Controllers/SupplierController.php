<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSupplierRequest;
use App\Http\Requests\UpdateSupplierRequest;
use App\Services\StoreContext;
use App\Services\SupplierService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SupplierController extends Controller
{
    public function __construct(private SupplierService $suppliers, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $storeId = $this->stores->requireIdFor($request->user());
        $filters['active_only'] = $request->boolean('active_only');

        return response()->json($this->suppliers->search($storeId, $filters, (int) ($filters['per_page'] ?? 25)));
    }

    public function store(StoreSupplierRequest $request): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json([
            'data' => $this->suppliers->create($request->user(), $storeId, $request->validated()),
        ], 201);
    }

    public function update(UpdateSupplierRequest $request, int $supplier): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json([
            'data' => $this->suppliers->update($request->user(), $storeId, $supplier, $request->validated()),
        ]);
    }
}
