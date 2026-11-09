<?php

namespace App\Services;

use App\Exceptions\OpnameOverlapException;
use App\Models\User;
use App\Support\DocumentNumber;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OpnameSessionService
{
    public function __construct(
        private NumberSequence $sequences,
        private AuditLogger $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data
     * @return array{session: array<string, mixed>, created: bool}
     */
    public function start(User $actor, int $storeId, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $data) {
            DB::table('stores')->where('id', $storeId)->lockForUpdate()->first();

            $existing = DB::table('stock_opname_sessions')
                ->where('client_request_id', $data['client_request_id'])
                ->first(['id', 'store_id']);
            if ($existing !== null) {
                abort_if((int) $existing->store_id !== $storeId, 409, 'Kunci permintaan opname sudah digunakan.');

                return ['session' => $this->find($storeId, (int) $existing->id), 'created' => false];
            }

            $categoryIds = array_values(array_unique(array_map('intval', $data['category_ids'] ?? [])));
            $products = $this->resolveScopeProducts($storeId, $data['scope_type'], $categoryIds, true);
            if ($products->isEmpty()) {
                throw ValidationException::withMessages([
                    'category_ids' => ['Cakupan tidak memiliki produk aktif untuk dihitung.'],
                ]);
            }

            $productIds = $products->pluck('id')->map(fn ($id) => (int) $id)->all();
            $conflicts = $this->conflictingSessions($storeId, $productIds);
            if ($conflicts !== []) {
                throw new OpnameOverlapException($conflicts);
            }

            $now = Carbon::now('UTC')->format('Y-m-d H:i:s.v');
            $period = Carbon::now('Asia/Jakarta')->format('ymd');
            $number = DocumentNumber::format('OPN', $this->sequences->next($storeId, 'OPN', $period), $period);
            $sessionId = DB::table('stock_opname_sessions')->insertGetId([
                'store_id' => $storeId,
                'number' => $number,
                'name' => $this->nullableTrim($data['name'] ?? null),
                'scope_type' => $data['scope_type'],
                'status' => 'in_progress',
                'notes' => $this->nullableTrim($data['notes'] ?? null),
                'started_at' => $now,
                'created_by' => $actor->id,
                'client_request_id' => $data['client_request_id'],
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            if ($data['scope_type'] === 'categories') {
                $categoryRows = array_map(fn (int $categoryId) => [
                    'session_id' => $sessionId,
                    'category_id' => $categoryId,
                ], $categoryIds);
                DB::table('stock_opname_session_categories')->insert($categoryRows);
            }

            $balances = DB::table('inventory_balances')
                ->whereIn('product_id', $productIds)
                ->groupBy('product_id')
                ->selectRaw('product_id, SUM(qty_sellable + qty_quarantine + qty_damaged) as system_qty')
                ->pluck('system_qty', 'product_id');

            foreach ($products->chunk(500) as $chunk) {
                $items = $chunk->map(fn (object $product) => [
                    'session_id' => $sessionId,
                    'product_id' => (int) $product->id,
                    'category_id' => $product->category_id === null ? null : (int) $product->category_id,
                    'product_name_snapshot' => $product->product_name,
                    'barcode_snapshot' => $product->barcode,
                    'category_name_snapshot' => $product->category_name,
                    'category_parent_name_snapshot' => $product->parent_name,
                    'system_qty_at_start' => $balances->get($product->id, '0.000'),
                    'counted_qty' => null,
                    'system_qty_at_count' => null,
                    'counted_at' => null,
                    'counted_by' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all();
                DB::table('stock_opname_items')->insert($items);
            }

            $this->audit->log(
                'stock_opname.start',
                'stock_opname_session',
                $sessionId,
                after: ['number' => $number, 'scope_type' => $data['scope_type'], 'total_products' => count($productIds)],
                storeId: $storeId,
                actorId: $actor->id,
            );

            return ['session' => $this->find($storeId, $sessionId), 'created' => true];
        }, 3);
    }

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $query = $this->sessionQuery($storeId)
            ->selectRaw('(select count(*) from stock_opname_items oi where oi.session_id = s.id) as total_products');

        if (! empty($filters['status'])) {
            $query->where('s.status', $filters['status']);
        }
        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where(function ($builder) use ($term) {
                $builder->where('s.number', 'like', "%{$term}%")
                    ->orWhere('s.name', 'like', "%{$term}%");
            });
        }
        if (! empty($filters['date_from'])) {
            $query->whereDate('s.started_at', '>=', $filters['date_from']);
        }
        if (! empty($filters['date_to'])) {
            $query->whereDate('s.started_at', '<=', $filters['date_to']);
        }

        $direction = ($filters['sort'] ?? 'newest') === 'oldest' ? 'asc' : 'desc';

        $page = $query->orderBy('s.started_at', $direction)->orderBy('s.id', $direction)->paginate($perPage);
        $sessionIds = $page->getCollection()->pluck('id')->map(fn ($id) => (int) $id)->all();
        $counted = $sessionIds === [] ? collect() : DB::table('stock_opname_items')
            ->whereIn('session_id', $sessionIds)->whereNotNull('counted_qty')
            ->groupBy('session_id')->selectRaw('session_id, COUNT(*) as counted_count')
            ->pluck('counted_count', 'session_id');
        $categories = $sessionIds === [] ? collect() : DB::table('stock_opname_session_categories as sc')
            ->join('categories as c', 'c.id', '=', 'sc.category_id')
            ->whereIn('sc.session_id', $sessionIds)->orderBy('c.name')
            ->get(['sc.session_id', 'c.id', 'c.name'])
            ->groupBy('session_id')
            ->map(fn (Collection $rows) => $rows->map(fn ($category) => [
                'id' => (int) $category->id,
                'name' => $category->name,
            ])->all());

        return $page->through(fn ($row) => $this->present(
            $row,
            countedProducts: (int) $counted->get($row->id, 0),
            scopeCategories: $categories->get($row->id, []),
        ));
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId, int $id): ?array
    {
        $row = $this->sessionQuery($storeId)
            ->where('s.id', $id)
            ->selectRaw('(select count(*) from stock_opname_items oi where oi.session_id = s.id) as total_products')
            ->first();

        if ($row === null) {
            return null;
        }
        $counted = (int) DB::table('stock_opname_items')->where('session_id', $id)->whereNotNull('counted_qty')->count();
        $categories = DB::table('stock_opname_session_categories as sc')
            ->join('categories as c', 'c.id', '=', 'sc.category_id')
            ->where('sc.session_id', $id)->orderBy('c.name')
            ->get(['c.id', 'c.name'])
            ->map(fn ($category) => ['id' => (int) $category->id, 'name' => $category->name])
            ->all();

        return $this->present($row, true, $counted, $categories);
    }

    /** @return array<string, mixed> */
    public function cancel(User $actor, int $storeId, int $id, string $reason): array
    {
        return DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $session = DB::table('stock_opname_sessions')
                ->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($session === null, 404, 'Sesi opname tidak ditemukan.');
            if ($session->status !== 'in_progress') {
                throw ValidationException::withMessages([
                    'status' => ['Hanya sesi yang sedang berjalan yang dapat dibatalkan.'],
                ]);
            }

            $now = Carbon::now('UTC')->format('Y-m-d H:i:s.v');
            DB::table('stock_opname_sessions')->where('id', $id)->update([
                'status' => 'cancelled',
                'cancelled_at' => $now,
                'cancelled_by' => $actor->id,
                'cancel_reason' => trim($reason),
                'updated_at' => $now,
            ]);
            $this->audit->log(
                'stock_opname.cancel',
                'stock_opname_session',
                $id,
                before: ['status' => 'in_progress'],
                after: ['status' => 'cancelled'],
                reason: trim($reason),
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $this->find($storeId, $id);
        });
    }

    /**
     * Resolve active products within a scope. This is intentionally public for later opname steps.
     *
     * @param  list<int>  $categoryIds
     * @return Collection<int, object>
     */
    public function resolveScopeProducts(int $storeId, string $scopeType, array $categoryIds = [], bool $lock = false): Collection
    {
        $query = DB::table('products as p')
            ->leftJoin('categories as c', 'c.id', '=', 'p.category_id')
            ->leftJoin('categories as parent', 'parent.id', '=', 'c.parent_id')
            ->where('p.store_id', $storeId)->where('p.status', 'active')
            ->orderBy('p.id')
            ->select([
                'p.id', 'p.category_id', 'p.name as product_name', 'p.barcode',
                'c.name as category_name', 'parent.name as parent_name',
            ]);

        if ($scopeType === 'categories') {
            $valid = DB::table('categories')->where('store_id', $storeId)->where('is_active', 1)
                ->whereIn('id', $categoryIds)->pluck('id')->map(fn ($id) => (int) $id)->all();
            if (count($valid) !== count(array_unique($categoryIds)) || $valid === []) {
                throw ValidationException::withMessages(['category_ids' => ['Pilih minimal satu kategori aktif yang tersedia di toko ini.']]);
            }

            $descendants = $this->categoryDescendants($storeId, $categoryIds);
            $query->whereIn('p.category_id', $descendants);
        } elseif ($scopeType !== 'all' || $categoryIds !== []) {
            throw ValidationException::withMessages(['scope_type' => ['Cakupan opname tidak valid.']]);
        }

        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->get();
    }

    /** @return array{data: list<array<string, mixed>>, total_products: int} */
    public function scopeOptions(int $storeId): array
    {
        $categories = DB::table('categories')->where('store_id', $storeId)->where('is_active', 1)
            ->orderBy('name')->get(['id', 'parent_id', 'name']);
        $children = [];
        $categoryById = [];
        foreach ($categories as $category) {
            $parentId = $category->parent_id === null ? 0 : (int) $category->parent_id;
            $children[$parentId][] = (int) $category->id;
            $categoryById[(int) $category->id] = $category;
        }

        $directCounts = DB::table('products')->where('store_id', $storeId)->where('status', 'active')
            ->whereNotNull('category_id')->groupBy('category_id')
            ->selectRaw('category_id, COUNT(*) as product_count')->pluck('product_count', 'category_id');
        $activeSessions = DB::table('stock_opname_sessions')
            ->where('store_id', $storeId)->whereIn('status', ['in_progress', 'pending_approval'])
            ->orderBy('started_at')->get(['id', 'number', 'scope_type']);
        $locked = [];
        foreach ($activeSessions as $session) {
            if ($session->scope_type === 'all') {
                foreach ($categories as $category) {
                    $locked[(int) $category->id] ??= ['id' => (int) $session->id, 'number' => $session->number];
                }

                continue;
            }
            $selected = DB::table('stock_opname_session_categories')->where('session_id', $session->id)
                ->pluck('category_id')->map(fn ($id) => (int) $id)->all();
            foreach ($this->categoryDescendants($storeId, $selected) as $categoryId) {
                $locked[$categoryId] ??= ['id' => (int) $session->id, 'number' => $session->number];
            }
        }

        $build = function (int $parentId) use (&$build, $children, $directCounts, $locked, $categoryById) {
            $result = [];
            foreach ($children[$parentId] ?? [] as $categoryId) {
                $category = $categoryById[$categoryId];
                $childNodes = $build((int) $category->id);
                $count = (int) $directCounts->get($categoryId, 0);
                foreach ($childNodes as $childNode) {
                    $count += $childNode['product_count'];
                }
                $result[] = [
                    'id' => (int) $category->id,
                    'parent_id' => $category->parent_id === null ? null : (int) $category->parent_id,
                    'name' => $category->name,
                    'product_count' => $count,
                    'locked_by' => $locked[(int) $category->id] ?? null,
                    'children' => $childNodes,
                ];
            }

            return $result;
        };

        return [
            'data' => $build(0),
            'total_products' => (int) DB::table('products')->where('store_id', $storeId)->where('status', 'active')->count(),
        ];
    }

    /** @param list<int> $categoryIds @return list<int> */
    private function categoryDescendants(int $storeId, array $categoryIds): array
    {
        $categories = DB::table('categories')->where('store_id', $storeId)->where('is_active', 1)
            ->get(['id', 'parent_id']);
        $children = [];
        foreach ($categories as $category) {
            $children[$category->parent_id === null ? 0 : (int) $category->parent_id][] = (int) $category->id;
        }

        $result = [];
        foreach (array_unique($categoryIds) as $id) {
            array_push($result, ...$this->categoryDescendantsFromTree($id, $children));
        }

        return array_values(array_unique($result));
    }

    /** @param array<int, list<int>> $children @return list<int> */
    private function categoryDescendantsFromTree(int $categoryId, array $children): array
    {
        $result = [$categoryId];
        foreach ($children[$categoryId] ?? [] as $childId) {
            array_push($result, ...$this->categoryDescendantsFromTree($childId, $children));
        }

        return $result;
    }

    /** @param list<int> $productIds @return list<array{id: int, number: string}> */
    private function conflictingSessions(int $storeId, array $productIds): array
    {
        return DB::table('stock_opname_items as i')
            ->join('stock_opname_sessions as s', 's.id', '=', 'i.session_id')
            ->where('s.store_id', $storeId)->whereIn('s.status', ['in_progress', 'pending_approval'])
            ->whereIn('i.product_id', $productIds)
            ->groupBy('s.id', 's.number')->orderBy('s.id')
            ->get(['s.id', 's.number'])
            ->map(fn ($row) => ['id' => (int) $row->id, 'number' => $row->number])->all();
    }

    private function sessionQuery(int $storeId)
    {
        return DB::table('stock_opname_sessions as s')
            ->join('users as creator', 'creator.id', '=', 's.created_by')
            ->leftJoin('users as canceller', 'canceller.id', '=', 's.cancelled_by')
            ->leftJoin('users as submitter', 'submitter.id', '=', 's.submitted_by')
            ->leftJoin('users as approver', 'approver.id', '=', 's.approved_by')
            ->leftJoin('users as poster', 'poster.id', '=', 's.posted_by')
            ->leftJoin('users as rejector', 'rejector.id', '=', 's.rejected_by')
            ->where('s.store_id', $storeId)
            ->select([
                's.id', 's.number', 's.name', 's.scope_type', 's.status', 's.notes',
                's.started_at', 's.cancelled_at', 's.cancel_reason',
                's.submitted_at', 's.approval_required', 's.approval_reasons',
                's.approved_at', 's.posted_at', 's.rejected_at', 's.reject_reason',
                's.variance_products', 's.short_qty', 's.over_qty',
                'creator.id as creator_id', 'creator.name as creator_name',
                'canceller.id as canceller_id', 'canceller.name as canceller_name',
                'submitter.id as submitter_id', 'submitter.name as submitter_name',
                'approver.id as approver_id', 'approver.name as approver_name',
                'poster.id as poster_id', 'poster.name as poster_name',
                'rejector.id as rejector_id', 'rejector.name as rejector_name',
            ]);
    }

    /** @return array<string, mixed> */
    private function present(
        object $row,
        bool $detail = false,
        ?int $countedProducts = null,
        ?array $scopeCategories = null,
    ): array {
        $categories = $scopeCategories ?? DB::table('stock_opname_session_categories as sc')
            ->join('categories as c', 'c.id', '=', 'sc.category_id')
            ->where('sc.session_id', $row->id)->orderBy('c.name')
            ->get(['c.id', 'c.name'])
            ->map(fn ($category) => ['id' => (int) $category->id, 'name' => $category->name])->all();
        $scopeNames = array_column($categories, 'name');
        $scopeSummary = $row->scope_type === 'all' ? 'Seluruh toko' : implode(', ', array_slice($scopeNames, 0, 2));
        if (count($scopeNames) > 2) {
            $scopeSummary .= ' (+'.(count($scopeNames) - 2).')';
        }

        $record = [
            'id' => (int) $row->id,
            'number' => $row->number,
            'name' => $row->name,
            'scope_type' => $row->scope_type,
            'scope_summary' => $scopeSummary,
            'status' => $row->status,
            'total_products' => (int) $row->total_products,
            'counted_products' => $countedProducts ?? 0,
            'started_at' => $row->started_at,
            'created_by' => ['id' => (int) $row->creator_id, 'name' => $row->creator_name],
            'submitted_at' => $row->submitted_at,
            'submitted_by' => $row->submitter_id === null ? null : [
                'id' => (int) $row->submitter_id,
                'name' => $row->submitter_name,
            ],
            'approval_required' => $row->approval_required === null ? null : (bool) $row->approval_required,
            'approval_reasons' => $row->approval_reasons === null ? [] : json_decode((string) $row->approval_reasons, true),
            'approved_at' => $row->approved_at,
            'approved_by' => $row->approver_id === null ? null : [
                'id' => (int) $row->approver_id,
                'name' => $row->approver_name,
            ],
            'posted_at' => $row->posted_at,
            'posted_by' => $row->poster_id === null ? null : [
                'id' => (int) $row->poster_id,
                'name' => $row->poster_name,
            ],
            'rejected_at' => $row->rejected_at,
            'rejected_by' => $row->rejector_id === null ? null : [
                'id' => (int) $row->rejector_id,
                'name' => $row->rejector_name,
            ],
            'reject_reason' => $row->reject_reason,
            'variance_products' => $row->variance_products === null ? null : (int) $row->variance_products,
            'short_qty' => $row->short_qty,
            'over_qty' => $row->over_qty,
        ];
        if ($detail) {
            $record += [
                'notes' => $row->notes,
                'scope_categories' => $categories,
                'cancelled_at' => $row->cancelled_at,
                'cancelled_by' => $row->canceller_id === null ? null : [
                    'id' => (int) $row->canceller_id,
                    'name' => $row->canceller_name,
                ],
                'cancel_reason' => $row->cancel_reason,
            ];
        }

        return $record;
    }

    private function nullableTrim(?string $value): ?string
    {
        $value = $value === null ? null : trim($value);

        return $value === '' ? null : $value;
    }
}
