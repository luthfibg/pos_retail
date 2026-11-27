<?php

namespace App\Http\Controllers;

use App\Http\Requests\SetCreditLimitRequest;
use App\Http\Requests\StoreCustomerRequest;
use App\Http\Requests\UpdateCustomerRequest;
use App\Services\CustomerService;
use App\Services\StoreContext;
use App\Support\StockAuthorityPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CustomerController extends Controller
{
    public function __construct(private CustomerService $customers, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'archived' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $user = $request->user();
        $storeId = $this->stores->requireIdFor($user);
        $isAdmin = $this->isAdmin($user, $storeId);
        abort_if(! $isAdmin && ! empty($filters['archived']), 403, 'Arsip debitur hanya dapat dilihat Admin.');

        return response()->json(
            $this->customers->search(
                $storeId,
                $filters,
                (int) ($filters['per_page'] ?? 25),
                $user->can('customer.set_limit'),
                false,
                $isAdmin,
            )
        );
    }

    public function show(Request $request, int $customer): JsonResponse
    {
        $user = $request->user();
        $storeId = $this->stores->requireIdFor($user);
        $isAdmin = $this->isAdmin($user, $storeId);
        $found = $this->customers->find($storeId, $customer, $user->can('customer.set_limit'), $isAdmin, $isAdmin);

        abort_if($found === null, 404, 'Debitur tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StoreCustomerRequest $request): JsonResponse
    {
        $user = $request->user();
        $storeId = $this->stores->requireIdFor($user);
        abort_unless($this->isAdmin($user, $storeId), 403, 'Hanya Admin yang dapat mendaftarkan debitur.');

        $created = $this->customers->create(
            $user,
            $storeId,
            $request->validated(),
            $user->can('customer.set_limit'),
        );

        return response()->json(['data' => $created], 201);
    }

    public function update(UpdateCustomerRequest $request, int $customer): JsonResponse
    {
        $user = $request->user();
        $storeId = $this->stores->requireIdFor($user);
        abort_unless($this->isAdmin($user, $storeId), 403, 'Hanya Admin yang dapat mengubah data debitur.');

        return response()->json(['data' => $this->customers->update(
            $user,
            $storeId,
            $customer,
            $request->validated(),
            true,
        )]);
    }

    public function archive(Request $request, int $customer): JsonResponse
    {
        $user = $request->user();
        $storeId = $this->stores->requireIdFor($user);
        abort_unless($this->isAdmin($user, $storeId), 403, 'Hanya Admin yang dapat mengarsipkan debitur.');

        $this->customers->archive($user, $storeId, $customer);

        return response()->json(['data' => ['archived' => true]]);
    }

    public function restore(Request $request, int $customer): JsonResponse
    {
        $user = $request->user();
        $storeId = $this->stores->requireIdFor($user);
        abort_unless($this->isAdmin($user, $storeId), 403, 'Hanya Admin yang dapat memulihkan debitur arsip.');

        $this->customers->restore($user, $storeId, $customer);

        return response()->json(['data' => ['archived' => false]]);
    }

    public function setLimit(SetCreditLimitRequest $request, int $customer): JsonResponse
    {
        $user = $request->user();
        $data = $request->validated();
        $storeId = $this->stores->requireIdFor($user);

        return response()->json(['data' => $this->customers->setLimit(
            $user,
            $storeId,
            $customer,
            (string) $data['limit_amount'],
            $data['note'] ?? null,
            $this->isAdmin($user, $storeId),
        )]);
    }

    public function limitHistory(Request $request, int $customer): JsonResponse
    {
        return response()->json([
            'data' => $this->customers->limitHistory($this->stores->requireIdFor($request->user()), $customer),
        ]);
    }

    private function isAdmin(\App\Models\User $user, int $storeId): bool
    {
        return in_array('Admin', StockAuthorityPolicy::roleNames($user->id, $storeId), true);
    }
}
