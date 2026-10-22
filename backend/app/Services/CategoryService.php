<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CategoryService
{
    public function __construct(private AuditLogger $audit)
    {
    }

    /** @return list<array<string, mixed>> */
    public function list(int $storeId, bool $activeOnly): array
    {
        return $this->baseQuery($storeId)
            ->when($activeOnly, fn ($q) => $q->where('categories.is_active', 1))
            ->orderBy('categories.name')
            ->get()
            ->map(fn ($row) => $this->present($row))
            ->all();
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId, int $id): ?array
    {
        $row = $this->baseQuery($storeId)->where('categories.id', $id)->first();

        return $row === null ? null : $this->present($row);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $parentId = isset($data['parent_id']) ? (int) $data['parent_id'] : null;

        return DB::transaction(function () use ($actor, $storeId, $data, $parentId) {
            $this->assertNameFree($storeId, $data['name'], $parentId, null);

            $id = DB::table('categories')->insertGetId([
                'store_id' => $storeId,
                'parent_id' => $parentId,
                'name' => $data['name'],
                'is_active' => 1,
            ]);

            $this->audit->log(
                'category.create',
                'category',
                $id,
                after: ['name' => $data['name'], 'parent_id' => $parentId],
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $this->find($storeId, $id);
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $current = DB::table('categories')
                ->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();

            abort_if($current === null, 404, 'Kategori tidak ditemukan.');

            $name = $data['name'] ?? $current->name;
            $parentId = array_key_exists('parent_id', $data) ? $data['parent_id'] : $current->parent_id;
            $parentId = $parentId === null ? null : (int) $parentId;
            $active = array_key_exists('is_active', $data) ? (bool) $data['is_active'] : (bool) $current->is_active;

            $this->assertNoCycle($storeId, $id, $parentId);
            $this->assertNameFree($storeId, $name, $parentId, $id);

            if (! $active && $current->is_active && $this->hasActiveChildren($storeId, $id)) {
                throw ValidationException::withMessages([
                    'is_active' => ['Nonaktifkan atau pindahkan subkategori yang masih aktif terlebih dahulu.'],
                ]);
            }

            $before = [
                'name' => $current->name,
                'parent_id' => $current->parent_id === null ? null : (int) $current->parent_id,
                'is_active' => (bool) $current->is_active,
            ];
            $after = ['name' => $name, 'parent_id' => $parentId, 'is_active' => $active];

            if ($before !== $after) {
                DB::table('categories')->where('id', $id)->update([
                    'name' => $name,
                    'parent_id' => $parentId,
                    'is_active' => $active ? 1 : 0,
                ]);

                $this->audit->log(
                    'category.update',
                    'category',
                    $id,
                    before: $before,
                    after: $after,
                    storeId: $storeId,
                    actorId: $actor->id,
                );
            }

            return $this->find($storeId, $id);
        });
    }

    private function baseQuery(int $storeId)
    {
        return DB::table('categories')
            ->where('categories.store_id', $storeId)
            ->selectRaw('categories.*, (select count(*) from products p where p.category_id = categories.id) as products_count');
    }

    private function hasActiveChildren(int $storeId, int $id): bool
    {
        return DB::table('categories')
            ->where('store_id', $storeId)->where('parent_id', $id)->where('is_active', 1)->exists();
    }

    private function assertNameFree(int $storeId, string $name, ?int $parentId, ?int $exceptId): void
    {
        $exists = DB::table('categories')
            ->where('store_id', $storeId)
            ->where('name', $name)
            ->when(
                $parentId === null,
                fn ($q) => $q->whereNull('parent_id'),
                fn ($q) => $q->where('parent_id', $parentId),
            )
            ->when($exceptId !== null, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages([
                'name' => ['Nama kategori sudah dipakai pada induk yang sama.'],
            ]);
        }
    }

    private function assertNoCycle(int $storeId, int $id, ?int $parentId): void
    {
        $cursor = $parentId;

        for ($depth = 0; $cursor !== null && $depth < 50; $depth++) {
            if ($cursor === $id) {
                throw ValidationException::withMessages([
                    'parent_id' => ['Induk kategori tidak boleh kategori itu sendiri atau turunannya.'],
                ]);
            }

            $next = DB::table('categories')->where('store_id', $storeId)->where('id', $cursor)->value('parent_id');
            $cursor = $next === null ? null : (int) $next;
        }
    }

    /** @return array<string, mixed> */
    private function present(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'parent_id' => $row->parent_id === null ? null : (int) $row->parent_id,
            'name' => $row->name,
            'is_active' => (bool) $row->is_active,
            'products_count' => (int) ($row->products_count ?? 0),
        ];
    }
}
