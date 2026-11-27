<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use Carbon\Carbon;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Data debitur (customers) untuk pendaftaran resmi dan penjualan kredit potong gaji.
 *  - Pendaftaran dan arsip hanya dilakukan Admin; pengarsipan tidak menghapus riwayat transaksi.
 *  - Kredit ditahan selama batas belum diisi; batas disimpan sebagai riwayat, yang berlaku = terbaru
 *  - Nilai batas hanya terlihat oleh pemegang customer.set_limit; Kasir hanya melihat credit_state dan sisa batas
 *  - pemakaian = total struk payroll_credit yang belum ditagih (PPN diestimasi nanti, R-04)
 */
class CustomerService
{
    public function __construct(private AuditLogger $audit)
    {
    }

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage, bool $seeLimit, bool $seeProfile, bool $seeArchived): LengthAwarePaginator
    {
        $query = $this->baseQuery($storeId);

        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where(function ($q) use ($term) {
                $q->where('customers.name', 'like', "%{$term}%")->orWhere('customers.customer_no', 'like', "{$term}%");
            });
        }

        if ($seeArchived && ! empty($filters['archived'])) {
            $query->whereNotNull('customers.archived_at');
        } else {
            $query->whereNull('customers.archived_at');
        }

        return $query->orderBy('customers.name')->paginate($perPage)
            ->through(fn ($row) => $this->present($row, $seeLimit, $seeProfile));
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId, int $id, bool $seeLimit, bool $seeProfile, bool $includeArchived = false): ?array
    {
        $query = $this->baseQuery($storeId)->where('customers.id', $id);
        if (! $includeArchived) {
            $query->whereNull('customers.archived_at');
        }
        $row = $query->first();

        return $row === null ? null : $this->present($row, $seeLimit, $seeProfile);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data, bool $seeLimit): array
    {
        try {
            $id = DB::transaction(function () use ($actor, $storeId, $data) {
                $id = DB::table('customers')->insertGetId([
                    'store_id' => $storeId,
                    'customer_no' => $data['customer_no'],
                    'ktp_no' => $data['ktp_no'],
                    'name' => $data['name'],
                    'phone' => $data['phone'],
                    'address' => $data['address'],
                    'domicile' => $data['domicile'],
                    'company_name' => $data['company_name'],
                    'position' => $data['position'],
                    'department' => $data['department'],
                    'employment_type' => $data['employment_type'],
                    'employment_start_date' => $data['employment_start_date'],
                    'hrd_name' => $data['hrd_name'],
                    'hrd_phone' => $data['hrd_phone'],
                    'supervisor_name' => $data['supervisor_name'],
                    'supervisor_phone' => $data['supervisor_phone'],
                    'created_by' => $actor->id,
                ]);

                $this->audit->log(
                    'customer.create',
                    'customer',
                    $id,
                    after: ['customer_no' => $data['customer_no'], 'name' => $data['name'], 'department' => $data['department']],
                    storeId: $storeId,
                    actorId: $actor->id,
                );

                return $id;
            });
        } catch (UniqueConstraintViolationException) {
            $field = DB::table('customers')->where('store_id', $storeId)->where('ktp_no', $data['ktp_no'])->exists()
                ? 'ktp_no'
                : 'customer_no';
            $message = $field === 'ktp_no' ? 'Nomor KTP sudah terdaftar.' : 'Nomor induk karyawan sudah terdaftar.';
            throw ValidationException::withMessages([$field => [$message]]);
        }

        return $this->find($storeId, $id, $seeLimit, true)
            ?? throw new \LogicException('Debitur yang baru dibuat tidak ditemukan.');
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data, bool $seeLimit): array
    {
        try {
            DB::transaction(function () use ($actor, $storeId, $id, $data) {
                $current = DB::table('customers')->where('store_id', $storeId)->where('id', $id)
                    ->whereNull('archived_at')->lockForUpdate()->first();
                abort_if($current === null, 404, 'Debitur tidak ditemukan.');

                $changes = [];
                foreach ([
                    'customer_no', 'ktp_no', 'name', 'phone', 'address', 'domicile', 'company_name',
                    'position', 'department', 'employment_type', 'employment_start_date',
                    'hrd_name', 'hrd_phone', 'supervisor_name', 'supervisor_phone',
                ] as $field) {
                    if (array_key_exists($field, $data) && $data[$field] !== $current->{$field}) {
                        $changes[$field] = $data[$field];
                    }
                }
                if ($changes === []) {
                    return;
                }

                DB::table('customers')->where('id', $id)->update($changes);

                if ($changes !== []) {
                    $changedFields = array_keys($changes);
                    $this->audit->log(
                        'customer.update',
                        'customer',
                        $id,
                        before: ['updated_fields' => $changedFields],
                        after: ['updated_fields' => $changedFields],
                        storeId: $storeId,
                        actorId: $actor->id,
                    );
                }
            });
        } catch (UniqueConstraintViolationException) {
            $field = DB::table('customers')->where('store_id', $storeId)->where('ktp_no', $data['ktp_no'] ?? null)
                ->where('id', '!=', $id)->exists() ? 'ktp_no' : 'customer_no';
            $message = $field === 'ktp_no' ? 'Nomor KTP sudah terdaftar.' : 'Nomor induk karyawan sudah terdaftar.';
            throw ValidationException::withMessages([$field => [$message]]);
        }

        return $this->find($storeId, $id, $seeLimit, true)
            ?? throw new \LogicException('Debitur yang diperbarui tidak ditemukan.');
    }

    public function archive(User $actor, int $storeId, int $id): void
    {
        DB::transaction(function () use ($actor, $storeId, $id) {
            $current = DB::table('customers')->where('store_id', $storeId)->where('id', $id)
                ->whereNull('archived_at')->lockForUpdate()->first();
            abort_if($current === null, 404, 'Debitur tidak ditemukan.');

            $archivedAt = $this->now();
            DB::table('customers')->where('id', $id)->update([
                'archived_at' => $archivedAt,
                'archived_by' => $actor->id,
            ]);
            $this->audit->log('customer.archive', 'customer', $id, after: ['archived_at' => $archivedAt], storeId: $storeId, actorId: $actor->id);
        });
    }

    public function restore(User $actor, int $storeId, int $id): void
    {
        DB::transaction(function () use ($actor, $storeId, $id) {
            $current = DB::table('customers')->where('store_id', $storeId)->where('id', $id)
                ->whereNotNull('archived_at')->lockForUpdate()->first();
            abort_if($current === null, 404, 'Debitur arsip tidak ditemukan.');

            DB::table('customers')->where('id', $id)->update(['archived_at' => null, 'archived_by' => null]);
            $this->audit->log(
                'customer.restore',
                'customer',
                $id,
                before: ['archived_at' => $current->archived_at],
                after: ['archived_at' => null],
                storeId: $storeId,
                actorId: $actor->id,
            );
        });
    }

    /**
     * Menetapkan batas kredit bulanan. Nilai sama = tidak ada catatan baru.
     *
     * @return array<string, mixed>
     */
    public function setLimit(User $actor, int $storeId, int $id, string $limitAmount, ?string $note, bool $seeProfile): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $limitAmount, $note) {
            $current = DB::table('customers')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($current === null, 404, 'Debitur tidak ditemukan.');

            if ($current->archived_at !== null) {
                throw ValidationException::withMessages([
                    'limit_amount' => ['Batas kredit tidak dapat diubah untuk debitur yang diarsipkan.'],
                ]);
            }

            $previous = $this->currentLimit($id);

            if ($previous !== null && Decimal::money($previous) === Decimal::money($limitAmount)) {
                return;
            }

            $this->writeLimit($actor, $storeId, $id, $limitAmount, $note, $previous);
        });

        return $this->find($storeId, $id, true, $seeProfile)
            ?? throw new \LogicException('Debitur tidak ditemukan setelah batas kredit diperbarui.');
    }

    /** @return list<array<string, mixed>> */
    public function limitHistory(int $storeId, int $id): array
    {
        abort_if(! DB::table('customers')->where('store_id', $storeId)->where('id', $id)->exists(), 404, 'Debitur tidak ditemukan.');

        return DB::table('customer_credit_limits as l')
            ->leftJoin('users as u', 'u.id', '=', 'l.set_by')
            ->where('l.customer_id', $id)
            ->orderByDesc('l.effective_from')->orderByDesc('l.id')
            ->get(['l.id', 'l.limit_amount', 'l.effective_from', 'l.set_by', 'u.name as set_by_name', 'l.note'])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'limit_amount' => $row->limit_amount,
                'effective_from' => $row->effective_from,
                'set_by' => (int) $row->set_by,
                'set_by_name' => $row->set_by_name,
                'note' => $row->note,
            ])->all();
    }

    // ------------------------------------------------------------------ internal

    private function writeLimit(User $actor, int $storeId, int $customerId, string $limitAmount, ?string $note, ?string $previous): void
    {
        DB::table('customer_credit_limits')->insert([
            'customer_id' => $customerId,
            'limit_amount' => $limitAmount,
            'effective_from' => $this->now(),
            'set_by' => $actor->id,
            'note' => $note,
        ]);

        $this->audit->log(
            'customer.set_limit',
            'customer',
            $customerId,
            before: ['limit_amount' => $previous],
            after: ['limit_amount' => Decimal::moneyString(Decimal::money($limitAmount))],
            reason: $note,
            storeId: $storeId,
            actorId: $actor->id,
        );
    }

    private function currentLimit(int $customerId): ?string
    {
        $value = DB::table('customer_credit_limits')
            ->where('customer_id', $customerId)
            ->orderByDesc('effective_from')->orderByDesc('id')
            ->value('limit_amount');

        return $value === null ? null : (string) $value;
    }

    private function baseQuery(int $storeId)
    {
        return DB::table('customers')
            ->where('customers.store_id', $storeId)
            ->selectRaw(
                'customers.*, '.
                '(select l.limit_amount from customer_credit_limits l where l.customer_id = customers.id '.
                'order by l.effective_from desc, l.id desc limit 1) as credit_limit, '.
                "(select coalesce(sum(s.total), 0) from sales s where s.customer_id = customers.id ".
                "and s.payment_mode = 'payroll_credit' and s.billing_period_id is null) as credit_used"
            );
    }

    /** @return array<string, mixed> */
    private function present(object $row, bool $seeLimit, bool $seeProfile): array
    {
        $state = $row->archived_at !== null
            ? 'archived'
            : ($row->credit_limit === null ? 'limit_not_set' : 'available');

        $remaining = null;
        if ($row->credit_limit !== null && $row->archived_at === null) {
            $units = Decimal::money((string) $row->credit_limit) - Decimal::money((string) $row->credit_used);
            $remaining = Decimal::moneyString(max(0, $units));
            if ($units <= 0) {
                $state = 'exhausted';
            }
        }

        $out = [
            'id' => (int) $row->id,
            'customer_no' => $row->customer_no,
            'name' => $row->name,
            'department' => $row->department,
            'credit_state' => $state,
            'credit_remaining' => $remaining,
        ];

        if ($seeProfile) {
            $out += [
                'ktp_no' => $row->ktp_no,
                'phone' => $row->phone,
                'address' => $row->address,
                'domicile' => $row->domicile,
                'company_name' => $row->company_name,
                'position' => $row->position,
                'employment_type' => $row->employment_type,
                'employment_start_date' => $row->employment_start_date,
                'hrd_name' => $row->hrd_name,
                'hrd_phone' => $row->hrd_phone,
                'supervisor_name' => $row->supervisor_name,
                'supervisor_phone' => $row->supervisor_phone,
                'archived_at' => $row->archived_at,
            ];
        }

        if ($seeLimit) {
            $out['credit_limit'] = $row->credit_limit;
            $out['credit_used'] = Decimal::moneyString(Decimal::money((string) $row->credit_used));
        }

        return $out;
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
