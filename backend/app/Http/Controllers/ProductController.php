<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Services\ProductService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ProductController extends Controller
{
    public function __construct(private ProductService $products, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'category_id' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::in(['pending_price', 'active', 'inactive'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json($this->products->search($storeId, $filters, (int) ($filters['per_page'] ?? 25)));
    }

    public function show(Request $request, int $product): JsonResponse
    {
        $found = $this->products->find($this->stores->requireIdFor($request->user()), $product);

        abort_if($found === null, 404, 'Produk tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function byBarcode(Request $request, string $barcode): JsonResponse
    {
        $found = $this->products->findByBarcode($this->stores->requireIdFor($request->user()), $barcode);

        abort_if($found === null, 404, 'Produk dengan barcode ini tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StoreProductRequest $request): JsonResponse
    {
        $user = $request->user();

        $product = $this->products->create(
            $user,
            $this->stores->requireIdFor($user),
            $request->validated(),
            $user->can('price.change'),
            $user->can('product.activate'),
        );

        return response()->json(['data' => $product], 201);
    }

    public function update(UpdateProductRequest $request, int $product): JsonResponse
    {
        $user = $request->user();

        $updated = $this->products->update(
            $user,
            $this->stores->requireIdFor($user),
            $product,
            $request->validated(),
            $user->can('price.change'),
            $user->can('product.activate'),
        );

        return response()->json(['data' => $updated]);
    }
}
