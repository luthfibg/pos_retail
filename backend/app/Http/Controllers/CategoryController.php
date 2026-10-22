<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreCategoryRequest;
use App\Http\Requests\UpdateCategoryRequest;
use App\Services\CategoryService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CategoryController extends Controller
{
    public function __construct(private CategoryService $categories, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json([
            'data' => $this->categories->list($storeId, $request->boolean('active_only')),
        ]);
    }

    public function store(StoreCategoryRequest $request): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json([
            'data' => $this->categories->create($request->user(), $storeId, $request->validated()),
        ], 201);
    }

    public function update(UpdateCategoryRequest $request, int $category): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json([
            'data' => $this->categories->update($request->user(), $storeId, $category, $request->validated()),
        ]);
    }
}
