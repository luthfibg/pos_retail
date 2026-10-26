<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CashMovementService
{
    public function __construct(private AuditLogger $audit) {}

    /** @param array{type: string, amount: string|int|float, reason: string} $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, int $shiftId, array $data, bool $canManageAll): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $shiftId, $data, $canManageAll) {
            $shift = DB::table('cash_shifts')->where('store_id', $storeId)->where('id', $shiftId)
                ->lockForUpdate()->first();
            abort_if($shift === null, 404, 'Shift tidak ditemukan.');
            abort_if(! $canManageAll && (int) $shift->cashier_id !== $actor->id, 403, 'Anda hanya dapat mencatat kas pada shift sendiri.');

            if ($shift->status !== 'open') {
                throw ValidationException::withMessages(['status' => ['Kas masuk/keluar hanya dapat dicatat selama shift berstatus open.']]);
            }

            $fund = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'petty_cash')
                ->where('register_id', $shift->register_id)->where('is_active', 1)->lockForUpdate()->first(['id']);
            abort_if($fund === null, 422, 'Akun Kas Kecil untuk kasir ini belum tersedia.');

            $amount = Decimal::money((string) $data['amount']);
            $reason = trim($data['reason']);
            $now = Carbon::now('UTC')->format('Y-m-d H:i:s.v');

            $movementId = DB::table('cash_movements')->insertGetId([
                'shift_id' => $shiftId,
                'type' => $data['type'],
                'amount' => Decimal::moneyString($amount),
                'reason' => $reason,
                'created_by' => $actor->id,
                'created_at' => $now,
            ]);

            DB::table('fund_ledger_entries')->insert([
                'fund_account_id' => $fund->id,
                'entry_type' => $data['type'] === 'in' ? 'cash_movement_in' : 'cash_movement_out',
                'amount' => Decimal::moneyString($data['type'] === 'in' ? $amount : -$amount),
                'ref_type' => 'cash_movement',
                'ref_id' => $movementId,
                'occurred_at' => $now,
                'created_by' => $actor->id,
                'note' => $reason,
                'created_at' => $now,
            ]);

            $this->audit->log(
                'cash_movement.create',
                'cash_movement',
                $movementId,
                after: ['shift_id' => $shiftId, 'type' => $data['type'], 'amount' => Decimal::moneyString($amount), 'reason' => $reason],
                reason: $reason,
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $movementId;
        });

        return $this->find($storeId, $shiftId, $id);
    }

    /** @return LengthAwarePaginator<array<string, mixed>> */
    public function search(User $actor, int $storeId, int $shiftId, int $perPage, bool $canSeeAll): LengthAwarePaginator
    {
        $shift = DB::table('cash_shifts')->where('store_id', $storeId)->where('id', $shiftId)->first(['id', 'cashier_id']);
        abort_if($shift === null || (! $canSeeAll && (int) $shift->cashier_id !== $actor->id), 404, 'Shift tidak ditemukan.');

        return DB::table('cash_movements as m')
            ->join('users as u', 'u.id', '=', 'm.created_by')
            ->where('m.shift_id', $shiftId)
            ->orderByDesc('m.id')
            ->select(['m.id', 'm.shift_id', 'm.type', 'm.amount', 'm.reason', 'm.created_by', 'u.name as created_by_name', 'm.created_at'])
            ->paginate($perPage)
            ->through(fn ($row) => $this->present($row));
    }

    /** @return array<string, mixed> */
    private function find(int $storeId, int $shiftId, int $id): array
    {
        $row = DB::table('cash_movements as m')
            ->join('cash_shifts as s', 's.id', '=', 'm.shift_id')
            ->join('users as u', 'u.id', '=', 'm.created_by')
            ->where('s.store_id', $storeId)
            ->where('m.shift_id', $shiftId)
            ->where('m.id', $id)
            ->first(['m.id', 'm.shift_id', 'm.type', 'm.amount', 'm.reason', 'm.created_by', 'u.name as created_by_name', 'm.created_at']);
        abort_if($row === null, 404, 'Pergerakan kas tidak ditemukan.');

        return $this->present($row);
    }

    /** @return array<string, mixed> */
    private function present(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'shift_id' => (int) $row->shift_id,
            'type' => $row->type,
            'amount' => $row->amount,
            'reason' => $row->reason,
            'created_by' => (int) $row->created_by,
            'created_by_name' => $row->created_by_name,
            'created_at' => $row->created_at,
        ];
    }
}
