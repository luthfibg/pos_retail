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
 * Data karyawan (customers) untuk penjualan kredit potong gaji.
 *  - Kasir menginput: status pending_verification (hanya tunai) + notifikasi ke pemegang customer.set_limit
 *  - Admin memverifikasi (customer.verify) dan menetapkan batas kredit bulanan (customer.set_limit)
 *  - kredit ditahan selama batas belum diisi (R-09, ASUMSI); batas disimpan sebagai riwayat, yang berlaku = terbaru
 *  - nilai batas hanya terlihat oleh pemegang customer.set_limit; Kasir hanya melihat credit_state dan sisa batas
 *  - pemakaian = total struk payroll_credit berstatus posted yang belum ditagih (PPN diestimasi nanti, R-04)
 */
class CustomerService
{
    public const NOTIFICATION_LIMIT_NEEDED = 'customer.limit_needed';

    public function __construct(private AuditLogger $audit, private NotificationService $notifications)
    {
    }

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage, bool $seeLimit): LengthAwarePaginator
    {
        $query = $this->baseQuery($storeId);

        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where(function ($q) use ($term) {
                $q->where('customers.name', 'like', "%{$term}%")->orWhere('customers.customer_no', 'like', "{$term}%");
            });
        }

        if (! empty($filters['status'])) {
            $query->where('customers.status', $filters['status']);
        }

        return $query->orderBy('customers.name')->paginate($perPage)
            ->through(fn ($row) => $this->present($row, $seeLimit));
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId, int $id, bool $seeLimit): ?array
    {
        $row = $this->baseQuery($storeId)->where('customers.id', $id)->first();

        return $row === null ? null : $this->present($row, $seeLimit);
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
                    'name' => $data['name'],
                    'department' => $data['department'] ?? null,
                    'status' => 'pending_verification',
                    'created_by' => $actor->id,
                ]);

                $this->audit->log(
                    'customer.create',
                    'customer',
                    $id,
                    after: ['customer_no' => $data['customer_no'], 'name' => $data['name'], 'department' => $data['department'] ?? null, 'status' => 'pending_verification'],
                    storeId: $storeId,
                    actorId: $actor->id,
                );

                $this->notifications->notifyPermission(
                    $storeId,
                    'customer.set_limit',
                    self::NOTIFICATION_LIMIT_NEEDED,
                    "Karyawan baru {$data['name']} ({$data['customer_no']}) perlu diverifikasi dan diberi batas kredit.",
                    'customer',
                    $id,
                    exceptUserId: $actor->id,
                );

                return $id;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['customer_no' => ['Nomor induk karyawan sudah terdaftar.']]);
        }

        return $this->find($storeId, $id, $seeLimit);
    }

    /**
     * @param  array<string, mixed>  $data  customer_no, name, department, status (active|inactive), reason
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data, bool $seeLimit): array
    {
        try {
            DB::transaction(function () use ($actor, $storeId, $id, $data) {
                $current = DB::table('customers')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
                abort_if($current === null, 404, 'Karyawan tidak ditemukan.');

                $changes = [];
                foreach (['customer_no', 'name', 'department'] as $field) {
                    if (array_key_exists($field, $data) && $data[$field] !== $current->{$field}) {
                        $changes[$field] = $data[$field];
                    }
                }

                $statusChanged = array_key_exists('status', $data) && $data['status'] !== $current->status;
                if ($statusChanged && $current->status === 'pending_verification') {
                    throw ValidationException::withMessages(['status' => ['Karyawan yang belum diverifikasi harus melalui verifikasi.']]);
                }

                if ($changes === [] && ! $statusChanged) {
                    return;
                }

                $columns = $changes + ($statusChanged ? ['status' => $data['status']] : []);
                DB::table('customers')->where('id', $id)->update($columns);

                if ($changes !== []) {
                    $before = [];
                    foreach (array_keys($changes) as $field) {
                        $before[$field] = $current->{$field};
                    }
                    $this->audit->log('customer.update', 'customer', $id, before: $before, after: $changes, storeId: $storeId, actorId: $actor->id);
                }

                if ($statusChanged) {
                    $this->audit->log(
                        'customer.status_change',
                        'customer',
                        $id,
                        before: ['status' => $current->status],
                        after: ['status' => $data['status']],
                        reason: $data['reason'] ?? null,
                        storeId: $storeId,
                        actorId: $actor->id,
                    );
                }
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['customer_no' => ['Nomor induk karyawan sudah terdaftar.']]);
        }

        return $this->find($storeId, $id, $seeLimit);
    }

    /**
     * Verifikasi karyawan (opsional sekaligus menetapkan batas).
     *
     * @return array<string, mixed>
     */
    public function verify(User $actor, int $storeId, int $id, ?string $limitAmount, ?string $note, bool $canSetLimit): array
    {
        abort_if($limitAmount !== null && ! $canSetLimit, 403, 'Anda tidak berwenang menetapkan batas kredit.');

        DB::transaction(function () use ($actor, $storeId, $id, $limitAmount, $note) {
            $current = DB::table('customers')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($current === null, 404, 'Karyawan tidak ditemukan.');

            if ($current->status !== 'pending_verification') {
                throw ValidationException::withMessages(['status' => ['Karyawan ini sudah diverifikasi.']]);
            }

            DB::table('customers')->where('id', $id)->update([
                'status' => 'active',
                'verified_by' => $actor->id,
                'verified_at' => $this->now(),
            ]);

            $this->audit->log(
                'customer.verify',
                'customer',
                $id,
                before: ['status' => 'pending_verification'],
                after: ['status' => 'active'],
                storeId: $storeId,
                actorId: $actor->id,
            );

            if ($limitAmount !== null) {
                $this->writeLimit($actor, $storeId, $id, $limitAmount, $note, previous: null);
            }
        });

        return $this->find($storeId, $id, true);
    }

    /**
     * Menetapkan batas kredit bulanan. Hanya untuk karyawan aktif (terverifikasi). Nilai sama = tidak ada catatan baru.
     *
     * @return array<string, mixed>
     */
    public function setLimit(User $actor, int $storeId, int $id, string $limitAmount, ?string $note): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $limitAmount, $note) {
            $current = DB::table('customers')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($current === null, 404, 'Karyawan tidak ditemukan.');

            if ($current->status !== 'active') {
                throw ValidationException::withMessages([
                    'limit_amount' => ['Batas kredit hanya dapat ditetapkan untuk karyawan aktif dan terverifikasi.'],
                ]);
            }

            $previous = $this->currentLimit($id);

            if ($previous !== null && Decimal::money($previous) === Decimal::money($limitAmount)) {
                return;
            }

            $this->writeLimit($actor, $storeId, $id, $limitAmount, $note, $previous);
        });

        return $this->find($storeId, $id, true);
    }

    /** @return list<array<string, mixed>> */
    public function limitHistory(int $storeId, int $id): array
    {
        abort_if(! DB::table('customers')->where('store_id', $storeId)->where('id', $id)->exists(), 404, 'Karyawan tidak ditemukan.');

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

        $this->notifications->resolveForEntity($storeId, self::NOTIFICATION_LIMIT_NEEDED, 'customer', $customerId);
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
                "and s.payment_mode = 'payroll_credit' and s.status = 'posted' and s.billing_period_id is null) as credit_used"
            );
    }

    /** @return array<string, mixed> */
    private function present(object $row, bool $seeLimit): array
    {
        $state = match (true) {
            $row->status === 'pending_verification' => 'not_verified',
            $row->status === 'inactive' => 'inactive',
            $row->credit_limit === null => 'limit_not_set',
            default => 'available',
        };

        $remaining = null;
        if ($row->credit_limit !== null && $row->status === 'active') {
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
            'status' => $row->status,
            'credit_state' => $state,
            'credit_remaining' => $remaining,
            'verified_at' => $row->verified_at,
        ];

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
