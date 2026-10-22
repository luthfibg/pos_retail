<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SupplierService
{
    private const EDITABLE = ['name', 'contact_name', 'phone', 'address', 'default_payment_terms', 'is_active'];

    public function __construct(private AuditLogger $audit)
    {
    }

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $query = DB::table('suppliers')->where('store_id', $storeId);

        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where(function ($q) use ($term) {
                $q->where('name', 'like', "%{$term}%")->orWhere('code', 'like', "%{$term}%");
            });
        }

        if (! empty($filters['active_only'])) {
            $query->where('is_active', 1);
        }

        return $query->orderBy('name')->paginate($perPage)->through(fn ($row) => $this->present($row));
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId, int $id): ?array
    {
        $row = DB::table('suppliers')->where('store_id', $storeId)->where('id', $id)->first();

        return $row === null ? null : $this->present($row);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $payload = [
            'store_id' => $storeId,
            'code' => $data['code'],
            'name' => $data['name'],
            'contact_name' => $data['contact_name'] ?? null,
            'phone' => $data['phone'] ?? null,
            'address' => $data['address'] ?? null,
            'default_payment_terms' => $data['default_payment_terms'] ?? 'prepaid',
            'is_active' => 1,
        ];

        try {
            $id = DB::transaction(function () use ($actor, $storeId, $payload) {
                $id = DB::table('suppliers')->insertGetId($payload);

                $this->audit->log(
                    'supplier.create',
                    'supplier',
                    $id,
                    after: ['code' => $payload['code'], 'name' => $payload['name']],
                    storeId: $storeId,
                    actorId: $actor->id,
                );

                return $id;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['code' => ['Kode supplier sudah dipakai.']]);
        }

        return $this->find($storeId, $id);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $current = DB::table('suppliers')
                ->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();

            abort_if($current === null, 404, 'Supplier tidak ditemukan.');

            $before = [];
            $after = [];

            foreach (self::EDITABLE as $field) {
                if (! array_key_exists($field, $data)) {
                    continue;
                }

                $new = $field === 'is_active' ? ((bool) $data[$field] ? 1 : 0) : $data[$field];

                if ($current->{$field} !== $new) {
                    $before[$field] = $current->{$field};
                    $after[$field] = $new;
                }
            }

            if ($after !== []) {
                DB::table('suppliers')->where('id', $id)->update($after);

                $this->audit->log(
                    'supplier.update',
                    'supplier',
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

    /** @return array<string, mixed> */
    private function present(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'code' => $row->code,
            'name' => $row->name,
            'contact_name' => $row->contact_name,
            'phone' => $row->phone,
            'address' => $row->address,
            'default_payment_terms' => $row->default_payment_terms,
            'is_active' => (bool) $row->is_active,
        ];
    }
}
