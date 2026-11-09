<?php

namespace App\Http\Controllers;

use App\Exceptions\OpnameCountConflictException;
use App\Exceptions\OpnameLookupException;
use App\Exceptions\OpnameOverlapException;
use App\Exceptions\OpnameWorkflowException;
use App\Http\Requests\ApproveOpnameSessionRequest;
use App\Http\Requests\CancelOpnameSessionRequest;
use App\Http\Requests\ClearOpnameCountRequest;
use App\Http\Requests\RejectOpnameSessionRequest;
use App\Http\Requests\StartOpnameSessionRequest;
use App\Http\Requests\StoreOpnameCountRequest;
use App\Http\Requests\SubmitOpnameSessionRequest;
use App\Services\OpnameCountService;
use App\Services\OpnameProgressService;
use App\Services\OpnameSessionService;
use App\Services\OpnameWorkflowService;
use App\Services\PermissionResolver;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OpnameSessionController extends Controller
{
    public function __construct(
        private OpnameSessionService $sessions,
        private OpnameProgressService $progress,
        private OpnameCountService $counts,
        private OpnameWorkflowService $workflow,
        private PermissionResolver $permissions,
        private StoreContext $stores,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'status' => ['sometimes', 'nullable', 'in:in_progress,pending_approval,posted,cancelled'],
            'q' => ['sometimes', 'nullable', 'string', 'max:160'],
            'date_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'sort' => ['sometimes', 'in:newest,oldest'],
        ]);
        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json($this->sessions->search($storeId, $filters, (int) ($filters['per_page'] ?? 20)));
    }

    public function show(Request $request, int $session): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());
        $data = $this->sessions->find($storeId, $session);
        abort_if($data === null, 404, 'Sesi opname tidak ditemukan.');

        return response()->json(['data' => $data]);
    }

    public function report(Request $request, int $session): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());
        $data = $this->sessions->find($storeId, $session);
        abort_if($data === null, 404, 'Sesi opname tidak ditemukan.');
        if ($data['status'] === 'in_progress') {
            abort_unless($this->permissions->allows($request->user(), 'opname.review', $storeId), 403);
        }

        try {
            return response()->json(['data' => $this->workflow->report($request->user(), $storeId, $session)]);
        } catch (OpnameWorkflowException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
                ...$exception->details,
            ], $exception->httpStatus);
        }
    }

    public function submit(SubmitOpnameSessionRequest $request, int $session): JsonResponse
    {
        try {
            return response()->json(['data' => $this->workflow->submit(
                $request->user(),
                $this->stores->requireIdFor($request->user()),
                $session,
                $request->validated(),
            )]);
        } catch (OpnameWorkflowException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
                ...$exception->details,
            ], $exception->httpStatus);
        }
    }

    public function approve(ApproveOpnameSessionRequest $request, int $session): JsonResponse
    {
        try {
            return response()->json(['data' => $this->workflow->approve(
                $request->user(),
                $this->stores->requireIdFor($request->user()),
                $session,
                $request->validated(),
            )]);
        } catch (OpnameWorkflowException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
                ...$exception->details,
            ], $exception->httpStatus);
        }
    }

    public function reject(RejectOpnameSessionRequest $request, int $session): JsonResponse
    {
        try {
            return response()->json(['data' => $this->workflow->reject(
                $request->user(),
                $this->stores->requireIdFor($request->user()),
                $session,
                $request->validated(),
            )]);
        } catch (OpnameWorkflowException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
                ...$exception->details,
            ], $exception->httpStatus);
        }
    }

    public function store(StartOpnameSessionRequest $request): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());

        try {
            $result = $this->sessions->start($request->user(), $storeId, $request->validated());
        } catch (OpnameOverlapException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'errors' => ['scope' => [$exception->getMessage()]],
                'conflicting_sessions' => $exception->conflictingSessions,
            ], 422);
        }

        return response()->json(['data' => $result['session']], $result['created'] ? 201 : 200);
    }

    public function cancel(CancelOpnameSessionRequest $request, int $session): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json([
            'data' => $this->sessions->cancel($request->user(), $storeId, $session, $request->validated('reason')),
        ]);
    }

    public function scopeOptions(Request $request): JsonResponse
    {
        $storeId = $this->stores->requireIdFor($request->user());

        return response()->json($this->sessions->scopeOptions($storeId));
    }

    public function tree(Request $request, int $session): JsonResponse
    {
        $tree = $this->progress->tree($this->stores->requireIdFor($request->user()), $session);
        abort_if($tree === null, 404, 'Sesi opname tidak ditemukan.');

        return response()->json($tree);
    }

    public function items(Request $request, int $session): JsonResponse
    {
        $filters = $request->validate([
            'category_id' => ['sometimes', 'integer', 'min:0'],
            'scope' => ['sometimes', 'in:direct,all'],
            'q' => ['sometimes', 'nullable', 'string', 'min:2', 'max:120'],
            'only_uncounted' => ['sometimes', 'in:0,1,false,true'],
            'only_counted' => ['sometimes', 'in:0,1,false,true'],
            'sort' => ['sometimes', 'in:-counted_at'],
            'exclude_item_ids' => ['sometimes', 'array', 'max:10'],
            'exclude_item_ids.*' => ['integer', 'min:1'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:200'],
        ]);
        foreach (['only_uncounted', 'only_counted'] as $booleanFilter) {
            if (array_key_exists($booleanFilter, $filters)) {
                $filters[$booleanFilter] = filter_var($filters[$booleanFilter], FILTER_VALIDATE_BOOLEAN);
            }
        }
        if (! empty($filters['q'])) {
            $filters['q'] = trim($filters['q']);
            if (mb_strlen($filters['q']) < 2) {
                abort(422, 'Pencarian produk minimal dua karakter.');
            }
        }

        return response()->json($this->progress->items(
            $this->stores->requireIdFor($request->user()),
            $session,
            $filters,
            (int) ($filters['per_page'] ?? 100),
        ));
    }

    public function storeCount(StoreOpnameCountRequest $request, int $session): JsonResponse
    {
        try {
            $data = $this->counts->store(
                $request->user(),
                $this->stores->requireIdFor($request->user()),
                $session,
                $request->validated(),
            );
        } catch (OpnameCountConflictException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
            ], 409);
        }

        return response()->json($data);
    }

    public function clearCount(ClearOpnameCountRequest $request, int $session, int $item): JsonResponse
    {
        try {
            $data = $this->counts->clear(
                $request->user(),
                $this->stores->requireIdFor($request->user()),
                $session,
                $item,
                $request->validated('client_request_id'),
            );
        } catch (OpnameCountConflictException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
            ], 409);
        }

        return response()->json($data);
    }

    public function lookup(Request $request, int $session): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['required', 'string', 'min:1', 'max:120'],
            'mode' => ['sometimes', 'in:auto,barcode,search'],
        ]);
        try {
            return response()->json($this->counts->lookup(
                $this->stores->requireIdFor($request->user()),
                $session,
                trim($filters['q']),
                $filters['mode'] ?? 'auto',
            ));
        } catch (OpnameLookupException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
                'product_name' => $exception->productName,
            ], 404);
        }
    }

    public function counts(Request $request, int $session): JsonResponse
    {
        $filters = $request->validate(['limit' => ['sometimes', 'integer', 'min:1', 'max:10']]);

        return response()->json($this->counts->recent(
            $this->stores->requireIdFor($request->user()),
            $session,
            (int) ($filters['limit'] ?? 10),
        ));
    }
}
