<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

class RegisterService
{
    public function __construct(private AuditLogger $audit) {}

    /** @return list<array<string, mixed>> */
    public function list(int $storeId): array
    {
        return DB::table('registers as r')
            ->leftJoin('fund_accounts as f', function ($join) {
                $join->on('f.register_id', '=', 'r.id')
                    ->where('f.type', '=', 'petty_cash');
            })
            ->where('r.store_id', $storeId)
            ->orderBy('r.id')
            ->get([
                'r.id', 'r.name', 'r.is_active', 'f.id as fund_account_id',
                'f.name as fund_account_name',
            ])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'name' => $row->name,
                'is_active' => (bool) $row->is_active,
                'fund_account_id' => $row->fund_account_id === null ? null : (int) $row->fund_account_id,
                'fund_account_name' => $row->fund_account_name,
                'active_shift' => $this->activeShift((int) $row->id),
            ])->all();
    }

    /** @return list<array<string, mixed>> */
    public function available(int $storeId): array
    {
        return DB::table('registers as r')
            ->where('r.store_id', $storeId)
            ->where('r.is_active', true)
            ->orderBy('r.id')
            ->get(['r.id', 'r.name'])
            ->map(function ($row) {
                $shift = $this->activeShift((int) $row->id);
                $pendingDeposit = DB::table('cash_deposits as d')
                    ->join('cash_shifts as s', 's.id', '=', 'd.shift_id')
                    ->where('s.register_id', $row->id)
                    ->where('d.kind', 'final')
                    ->where('d.status', 'draft')
                    ->exists();
                $reason = $shift !== null
                    ? "Sedang digunakan oleh {$shift['cashier_name']}."
                    : ($pendingDeposit ? 'Setoran akhir kasir jaga sebelumnya belum diserahkan.' : null);

                return [
                    'id' => (int) $row->id,
                    'name' => $row->name,
                    'is_available' => $reason === null,
                    'unavailable_reason' => $reason,
                ];
            })->all();
    }

    /** @return array<string, mixed>|null */
    public function find(int $storeId, int $id): ?array
    {
        foreach ($this->list($storeId) as $register) {
            if ($register['id'] === $id) {
                return $register;
            }
        }

        return null;
    }

    /** @return array<string, mixed> */
    public function create(User $actor, int $storeId, string $name): array
    {
        try {
            $id = DB::transaction(function () use ($actor, $storeId, $name) {
                $name = trim($name);
                $this->assertNameAvailable($storeId, $name);
                $id = DB::table('registers')->insertGetId([
                    'store_id' => $storeId,
                    'name' => $name,
                    'is_active' => true,
                ]);
                $fundId = $this->createPettyCashAccount($storeId, $id, $name);
                $this->audit->log('register.create', 'register', $id,
                    after: ['name' => $name, 'fund_account_id' => $fundId],
                    storeId: $storeId, actorId: $actor->id);

                return $id;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['name' => ['Nama mesin kasir sudah digunakan di toko ini.']]);
        }

        return $this->find($storeId, $id) ?? throw new LogicException('Mesin kasir yang baru dibuat tidak ditemukan.');
    }

    /** @param array{name?: string, is_active?: bool, reason?: string} $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data): array
    {
        try {
            DB::transaction(function () use ($actor, $storeId, $id, $data) {
                $register = DB::table('registers')->where('store_id', $storeId)->where('id', $id)
                    ->lockForUpdate()->first();
                abort_if($register === null, 404, 'Mesin kasir tidak ditemukan.');
                $changes = [];

                if (array_key_exists('name', $data)) {
                    $name = trim($data['name']);
                    $this->assertNameAvailable($storeId, $name, $id);
                    $changes['name'] = $name;
                    DB::table('fund_accounts')->where('store_id', $storeId)->where('register_id', $id)
                        ->where('type', 'petty_cash')->update(['name' => 'Kas Kecil - '.$name]);
                }

                if (array_key_exists('is_active', $data) && (bool) $data['is_active'] !== (bool) $register->is_active) {
                    if (! $data['is_active']) {
                        if ($this->activeShift($id) !== null) {
                            throw ValidationException::withMessages(['is_active' => ['Mesin kasir tidak dapat dinonaktifkan selama masih ada shift berjalan.']]);
                        }
                        $this->audit->log('register.deactivate', 'register', $id,
                            before: ['is_active' => true],
                            after: ['is_active' => false],
                            reason: $data['reason'] ?? null,
                            storeId: $storeId, actorId: $actor->id);
                    } else {
                        $this->audit->log('register.activate', 'register', $id,
                            before: ['is_active' => false],
                            after: ['is_active' => true],
                            reason: $data['reason'] ?? null,
                            storeId: $storeId, actorId: $actor->id);
                    }
                    $changes['is_active'] = (bool) $data['is_active'];
                }

                if ($changes !== []) {
                    DB::table('registers')->where('id', $id)->update($changes);
                    if (isset($changes['name'])) {
                        $this->audit->log('register.rename', 'register', $id,
                            before: ['name' => $register->name],
                            after: ['name' => $changes['name']],
                            storeId: $storeId, actorId: $actor->id);
                    }
                }
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['name' => ['Nama mesin kasir sudah digunakan di toko ini.']]);
        }

        return $this->find($storeId, $id) ?? throw new LogicException('Mesin kasir yang diperbarui tidak ditemukan.');
    }

    public function deactivate(User $actor, int $storeId, int $id, string $reason): array
    {
        $register = DB::table('registers')->where('store_id', $storeId)->where('id', $id)->first();
        abort_if($register === null, 404, 'Mesin kasir tidak ditemukan.');

        return $this->update($actor, $storeId, $id, [
            'is_active' => false,
            'reason' => $reason,
        ]);
    }

    /** @return array<string, mixed>|null */
    private function activeShift(int $registerId): ?array
    {
        $shift = DB::table('cash_shifts as s')
            ->join('users as u', 'u.id', '=', 's.cashier_id')
            ->where('s.register_id', $registerId)
            ->whereIn('s.status', ['open', 'counting'])
            ->first(['s.id', 's.status', 's.cashier_id', 'u.name as cashier_name', 'u.cashier_number']);

        return $shift === null ? null : [
            'id' => (int) $shift->id,
            'status' => $shift->status,
            'cashier_id' => (int) $shift->cashier_id,
            'cashier_name' => $shift->cashier_name,
            'cashier_number' => $shift->cashier_number,
        ];
    }

    private function assertNameAvailable(int $storeId, string $name, ?int $exceptId = null): void
    {
        $query = DB::table('registers')->where('store_id', $storeId)->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
        if ($exceptId !== null) {
            $query->where('id', '<>', $exceptId);
        }
        if ($query->exists()) {
            throw ValidationException::withMessages(['name' => ['Nama mesin kasir sudah digunakan di toko ini.']]);
        }
    }

    private function createPettyCashAccount(int $storeId, int $registerId, string $registerName): int
    {
        return (int) DB::table('fund_accounts')->insertGetId([
            'store_id' => $storeId,
            'type' => 'petty_cash',
            'name' => 'Kas Kecil - '.$registerName,
            'register_id' => $registerId,
            'is_active' => true,
        ]);
    }
}
