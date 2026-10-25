<?php

namespace App\Services;

use App\Models\User;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Diskon: hanya Admin (discount.manage). Target (produk/kategori) tidak dapat diubah setelah dibuat;
 * diskon tidak dihapus, hanya dinonaktifkan. Penjualan memilih diskon terbaik yang sedang berlaku (SaleService).
 * starts_at / ends_at dikirim sebagai tanggal WIB: mulai = awal hari, berakhir = akhir hari.
 */
class DiscountService
{
    private const EDITABLE = ['name', 'discount_type', 'value', 'starts_at', 'ends_at', 'is_active'];

    public function __construct(private AuditLogger $audit)
    {
    }

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        return $this->baseQuery($storeId)
            ->when(! empty($filters['active_only']), fn ($q) => $q->where('d.is_active', 1))
            ->when(! empty($filters['target_type']), fn ($q) => $q->where('d.target_type', $filters['target_type']))
            ->orderByDesc('d.id')->paginate($perPage)->through(fn ($r) => $this->present($r));
    }

    /** @return array<string, mixed> */
    public function find(int $storeId, int $id): array
    {
        $row = $this->baseQuery($storeId)->where('d.id', $id)->first();
        abort_if($row === null, 404, 'Diskon tidak ditemukan.');

        return $this->present($row);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $this->assertTarget($storeId, $data['target_type'], (int) $data['target_id']);
        $this->assertValue($data['discount_type'], (string) $data['value']);

        $startsAt = isset($data['starts_at']) ? $this->dayStart($data['starts_at']) : $this->now();
        $endsAt = isset($data['ends_at']) ? $this->dayEnd($data['ends_at']) : null;
        $this->assertRange($startsAt, $endsAt);

        $id = DB::transaction(function () use ($actor, $storeId, $data, $startsAt, $endsAt) {
            $id = DB::table('discounts')->insertGetId([
                'store_id' => $storeId,
                'name' => $data['name'],
                'target_type' => $data['target_type'],
                'target_id' => $data['target_id'],
                'discount_type' => $data['discount_type'],
                'value' => $data['value'],
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
                'is_active' => 1,
                'created_by' => $actor->id,
            ]);

            $this->audit->log('discount.create', 'discount', $id,
                after: ['name' => $data['name'], 'target_type' => $data['target_type'], 'target_id' => (int) $data['target_id'],
                    'discount_type' => $data['discount_type'], 'value' => (string) $data['value'], 'starts_at' => $startsAt, 'ends_at' => $endsAt],
                storeId: $storeId, actorId: $actor->id);

            return $id;
        });

        return $this->find($storeId, $id);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $cur = DB::table('discounts')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($cur === null, 404, 'Diskon tidak ditemukan.');

            $new = [];
            foreach (self::EDITABLE as $f) {
                if (! array_key_exists($f, $data)) {
                    continue;
                }
                $v = match ($f) {
                    'starts_at' => $this->dayStart($data[$f]),
                    'ends_at' => $data[$f] === null ? null : $this->dayEnd($data[$f]),
                    'is_active' => $data[$f] ? 1 : 0,
                    default => $data[$f],
                };
                if ((string) $v !== (string) $cur->{$f} || ($v === null) !== ($cur->{$f} === null)) {
                    $new[$f] = $v;
                }
            }
            if ($new === []) {
                return;
            }

            $this->assertValue($new['discount_type'] ?? $cur->discount_type, (string) ($new['value'] ?? $cur->value));
            $this->assertRange((string) ($new['starts_at'] ?? $cur->starts_at), array_key_exists('ends_at', $new) ? $new['ends_at'] : $cur->ends_at);

            DB::table('discounts')->where('id', $id)->update($new);
            $this->audit->log('discount.update', 'discount', $id,
                before: array_intersect_key((array) $cur, $new), after: $new, storeId: $storeId, actorId: $actor->id);
        });

        return $this->find($storeId, $id);
    }

    // ------------------------------------------------------------------ internal

    private function assertTarget(int $storeId, string $type, int $id): void
    {
        $table = $type === 'product' ? 'products' : 'categories';

        if (! DB::table($table)->where('store_id', $storeId)->where('id', $id)->exists()) {
            throw ValidationException::withMessages(['target_id' => [$type === 'product' ? 'Produk tidak ditemukan.' : 'Kategori tidak ditemukan.']]);
        }
    }

    private function assertValue(string $type, string $value): void
    {
        if ($type === 'percent' && (float) $value > 100) {
            throw ValidationException::withMessages(['value' => ['Diskon persen tidak boleh lebih dari 100.']]);
        }
    }

    private function assertRange(string $startsAt, ?string $endsAt): void
    {
        if ($endsAt !== null && $endsAt < $startsAt) {
            throw ValidationException::withMessages(['ends_at' => ['Tanggal berakhir tidak boleh sebelum tanggal mulai.']]);
        }
    }

    private function dayStart(string $date): string
    {
        return Carbon::parse($date, 'Asia/Jakarta')->startOfDay()->utc()->format('Y-m-d H:i:s.v');
    }

    private function dayEnd(string $date): string
    {
        return Carbon::parse($date, 'Asia/Jakarta')->endOfDay()->utc()->format('Y-m-d H:i:s.v');
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }

    private function baseQuery(int $storeId)
    {
        return DB::table('discounts as d')
            ->leftJoin('products as p', fn ($j) => $j->on('p.id', '=', 'd.target_id')->where('d.target_type', 'product'))
            ->leftJoin('categories as c', fn ($j) => $j->on('c.id', '=', 'd.target_id')->where('d.target_type', 'category'))
            ->where('d.store_id', $storeId)
            ->select(['d.*', DB::raw('coalesce(p.name, c.name) as target_name')]);
    }

    /** @return array<string, mixed> */
    private function present(object $r): array
    {
        $now = $this->now();
        $status = match (true) {
            ! $r->is_active => 'inactive',
            $r->starts_at > $now => 'scheduled',
            $r->ends_at !== null && $r->ends_at < $now => 'expired',
            default => 'active',
        };

        return [
            'id' => (int) $r->id,
            'name' => $r->name,
            'target_type' => $r->target_type,
            'target_id' => (int) $r->target_id,
            'target_name' => $r->target_name,
            'discount_type' => $r->discount_type,
            'value' => $r->value,
            'starts_at' => $r->starts_at,
            'ends_at' => $r->ends_at,
            'is_active' => (bool) $r->is_active,
            'status' => $status,
        ];
    }
}
