<?php

namespace App\Http\Controllers;

use App\Http\Requests\SetCreditLimitRequest;
use App\Http\Requests\StoreCustomerRequest;
use App\Http\Requests\UpdateCustomerRequest;
use App\Http\Requests\VerifyCustomerRequest;
use App\Services\CustomerService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CustomerController extends Controller
{
    public function __construct(private CustomerService $customers, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['pending_verification', 'active', 'inactive'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $user = $request->user();
        $storeId = $this->stores->requireIdFor($user);

        return response()->json(
            $this->customers->search($storeId, $filters, (int) ($filters['per_page'] ?? 25), $user->can('customer.set_limit'))
        );
    }

    public function show(Request $request, int $customer): JsonResponse
    {
        $user = $request->user();
        $found = $this->customers->find($this->stores->requireIdFor($user), $customer, $user->can('customer.set_limit'));

        abort_if($found === null, 404, 'Karyawan tidak ditemukan.');

        return response()->json(['data' => $found]);
    }

    public function store(StoreCustomerRequest $request): JsonResponse
    {
        $user = $request->user();

        $created = $this->customers->create(
            $user,
            $this->stores->requireIdFor($user),
            $request->validated(),
            $user->can('customer.set_limit'),
        );

        return response()->json(['data' => $created], 201);
    }

    public function update(UpdateCustomerRequest $request, int $customer): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => $this->customers->update(
            $user,
            $this->stores->requireIdFor($user),
            $customer,
            $request->validated(),
            $user->can('customer.set_limit'),
        )]);
    }

    public function verify(VerifyCustomerRequest $request, int $customer): JsonResponse
    {
        $user = $request->user();
        $data = $request->validated();

        return response()->json(['data' => $this->customers->verify(
            $user,
            $this->stores->requireIdFor($user),
            $customer,
            isset($data['credit_limit']) ? (string) $data['credit_limit'] : null,
            $data['note'] ?? null,
            $user->can('customer.set_limit'),
        )]);
    }

    public function setLimit(SetCreditLimitRequest $request, int $customer): JsonResponse
    {
        $user = $request->user();
        $data = $request->validated();

        return response()->json(['data' => $this->customers->setLimit(
            $user,
            $this->stores->requireIdFor($user),
            $customer,
            (string) $data['limit_amount'],
            $data['note'] ?? null,
        )]);
    }

    public function limitHistory(Request $request, int $customer): JsonResponse
    {
        return response()->json([
            'data' => $this->customers->limitHistory($this->stores->requireIdFor($request->user()), $customer),
        ]);
    }
}
