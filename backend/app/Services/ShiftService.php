<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use Carbon\Carbon;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Shift kasir (satu toko, satu laci).
 *  - alur: open -> counting (penjualan baru diblokir) -> closed -> reviewed
 *  - saldo awal = endapan shift sebelumnya di laci yang sama (float_kept), 0 untuk shift pertama
 *  - kas diharapkan = saldo awal + penjualan tunai + kas masuk lain - kas keluar (- setoran parsial: modul setoran menyusul)
 *  - hitung buta: selama shift berjalan, kas diharapkan hanya terlihat pemegang shift.review
 *  - selisih != 0 wajib berketerangan
 *  - SEMENTARA (sampai modul setoran/endapan ada): saat tutup, float_kept = kas terhitung (seluruh uang tetap di laci)
 */
class ShiftService
{
    public function __construct(private AuditLogger $audit, private NumberSequence $sequences)
    {
    }

    /** @return array<string, mixed> */
    public function open(User $actor, int $storeId, ?string $countedOpeningCash): array
    {
        try {
            $id = DB::transaction(function () use ($actor, $storeId, $countedOpeningCash) {
                $register = DB::table('registers')->where('store_id', $storeId)->where('is_active', 1)->orderBy('id')->lockForUpdate()->first();
                abort_if($register === null, 422, 'Kasir (register) aktif belum tersedia.');

                $existing = DB::table('cash_shifts as s')->join('users as u', 'u.id', '=', 's.cashier_id')
                    ->where('s.store_id', $storeId)->whereIn('s.status', ['open', 'counting'])
                    ->where(function ($q) use ($actor, $register) {
                        $q->where('s.cashier_id', $actor->id)->orWhere('s.register_id', $register->id);
                    })
                    ->first(['s.cashier_id', 'u.name']);

                if ($existing !== null) {
                    $message = (int) $existing->cashier_id === $actor->id
                        ? 'Anda masih memiliki shift yang belum ditutup.'
                        : "Shift masih dibuka oleh {$existing->name}. Tutup dulu sebelum membuka shift baru.";
                    throw ValidationException::withMessages(['shift' => [$message]]);
                }

                $previous = DB::table('cash_shifts')
                    ->where('store_id', $storeId)->where('register_id', $register->id)->whereIn('status', ['closed', 'reviewed'])
                    ->orderByDesc('id')->first(['float_kept']);
                $opening = $previous?->float_kept ?? '0.00';

                $period = Carbon::now('Asia/Jakarta')->format('Ym');
                $number = DocumentNumber::format('SHIFT', $this->sequences->next($storeId, 'SHIFT', $period), $period);

                $id = DB::table('cash_shifts')->insertGetId([
                    'store_id' => $storeId,
                    'doc_number' => $number,
                    'register_id' => $register->id,
                    'cashier_id' => $actor->id,
                    'opening_balance' => $opening,
                    'status' => 'open',
                    'opened_at' => $this->now(),
                ]);

                $after = ['doc_number' => $number, 'opening_balance' => $opening];
                if ($countedOpeningCash !== null) {
                    $after['counted_opening_cash'] = Decimal::moneyString(Decimal::money($countedOpeningCash));
                    $after['opening_difference'] = Decimal::moneyString(Decimal::money($countedOpeningCash) - Decimal::money($opening));
                }
                $this->audit->log('shift.open', 'shift', $id, after: $after, storeId: $storeId, actorId: $actor->id);

                return $id;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['shift' => ['Shift pada kasir ini sudah dibuka.']]);
        }

        return $this->present($this->row($storeId, $id), $this->canSeeExpected($actor));
    }

    /** @return array<string, mixed>|null */
    public function current(User $actor, int $storeId): ?array
    {
        $row = DB::table('cash_shifts as s')
            ->join('users as u', 'u.id', '=', 's.cashier_id')
            ->where('s.store_id', $storeId)->where('s.cashier_id', $actor->id)->whereIn('s.status', ['open', 'counting'])
            ->first(['s.*', 'u.name as cashier_name']);

        return $row === null ? null : $this->present($row, $this->canSeeExpected($actor));
    }

    /** Penjualan baru diblokir; kasir menghitung uang di laci. @return array<string, mixed> */
    public function startCount(User $actor, int $storeId, int $id, bool $canReview): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $canReview) {
            $shift = $this->lockOwned($actor, $storeId, $id, $canReview);

            if ($shift->status !== 'open') {
                throw ValidationException::withMessages(['status' => ['Shift tidak sedang dibuka.']]);
            }

            DB::table('cash_shifts')->where('id', $id)->update(['status' => 'counting']);
            $this->audit->log('shift.start_count', 'shift', $id, before: ['status' => 'open'], after: ['status' => 'counting'], storeId: $storeId, actorId: $actor->id);
        });

        return $this->present($this->row($storeId, $id), $this->canSeeExpected($actor));
    }

    /**
     * Tutup shift dengan kas fisik terhitung. Dari status open maupun counting.
     *
     * @return array<string, mixed>
     */
    public function close(User $actor, int $storeId, int $id, string $countedCash, ?string $note, bool $canReview): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $countedCash, $note, $canReview) {
            $shift = $this->lockOwned($actor, $storeId, $id, $canReview);

            if (! in_array($shift->status, ['open', 'counting'], true)) {
                throw ValidationException::withMessages(['status' => ['Shift sudah ditutup.']]);
            }

            $summary = $this->summary($id, $shift->opening_balance);
            $counted = Decimal::money($countedCash);
            $variance = $counted - $summary['expected_units'];

            if ($variance !== 0 && ($note === null || trim($note) === '')) {
                throw ValidationException::withMessages(['variance_note' => ['Selisih kas wajib diberi keterangan.']]);
            }

            DB::table('cash_shifts')->where('id', $id)->update([
                'status' => 'closed',
                'expected_cash' => Decimal::moneyString($summary['expected_units']),
                'counted_cash' => Decimal::moneyString($counted),
                'variance' => Decimal::moneyString($variance),
                'variance_note' => $variance === 0 ? null : $note,
                'float_kept' => Decimal::moneyString($counted),   // sementara; lihat catatan kelas
                'closed_at' => $this->now(),
            ]);

            $this->audit->log(
                'shift.close',
                'shift',
                $id,
                before: ['status' => $shift->status],
                after: [
                    'expected_cash' => Decimal::moneyString($summary['expected_units']),
                    'counted_cash' => Decimal::moneyString($counted),
                    'variance' => Decimal::moneyString($variance),
                ],
                reason: $variance === 0 ? null : $note,
                storeId: $storeId,
                actorId: $actor->id,
            );
        });

        return $this->present($this->row($storeId, $id), $this->canSeeExpected($actor));
    }

    /** @return array<string, mixed> */
    public function review(User $actor, int $storeId, int $id, ?string $note): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $note) {
            $shift = DB::table('cash_shifts')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
            abort_if($shift === null, 404, 'Shift tidak ditemukan.');

            if ($shift->status !== 'closed') {
                throw ValidationException::withMessages(['status' => ['Hanya shift yang sudah ditutup yang dapat ditinjau.']]);
            }

            DB::table('cash_shifts')->where('id', $id)->update([
                'status' => 'reviewed', 'reviewed_by' => $actor->id, 'reviewed_at' => $this->now(),
            ]);

            $this->audit->log(
                'shift.review', 'shift', $id,
                before: ['status' => 'closed'], after: ['status' => 'reviewed', 'variance' => $shift->variance],
                reason: $note, storeId: $storeId, actorId: $actor->id,
            );
        });

        return $this->present($this->row($storeId, $id), true);
    }

    /** @return array<string, mixed>|null */
    public function find(User $actor, int $storeId, int $id, bool $canReview): ?array
    {
        $row = $this->row($storeId, $id);

        if ($row === null || (! $canReview && (int) $row->cashier_id !== $actor->id)) {
            return null;
        }

        return $this->present($row, $canReview);
    }

    /** @param array<string, mixed> $filters */
    public function search(int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $query = DB::table('cash_shifts as s')
            ->join('users as u', 'u.id', '=', 's.cashier_id')
            ->where('s.store_id', $storeId)
            ->orderByDesc('s.id')
            ->select(['s.*', 'u.name as cashier_name']);

        if (! empty($filters['status'])) {
            $query->where('s.status', $filters['status']);
        }
        if (! empty($filters['cashier_id'])) {
            $query->where('s.cashier_id', (int) $filters['cashier_id']);
        }
        if (! empty($filters['date_from'])) {
            $query->where('s.opened_at', '>=', Carbon::parse($filters['date_from'], 'Asia/Jakarta')->startOfDay()->utc());
        }
        if (! empty($filters['date_to'])) {
            $query->where('s.opened_at', '<=', Carbon::parse($filters['date_to'], 'Asia/Jakarta')->endOfDay()->utc());
        }

        return $query->paginate($perPage)->through(fn ($row) => $this->present($row, true));
    }

    /**
     * Ringkasan shift. expected_units dalam satuan sen.
     *
     * @return array{cash_sales_count: int, cash_sales_total: string, credit_sales_count: int, credit_sales_total: string, cash_in: string, cash_out: string, expected_units: int}
     */
    public function summary(int $shiftId, string $openingBalance): array
    {
        $sales = DB::table('sales')->where('shift_id', $shiftId)->where('status', 'posted')
            ->selectRaw('payment_mode, count(*) as c, coalesce(sum(total), 0) as t')->groupBy('payment_mode')->get()->keyBy('payment_mode');
        $moves = DB::table('cash_movements')->where('shift_id', $shiftId)
            ->selectRaw('type, coalesce(sum(amount), 0) as t')->groupBy('type')->pluck('t', 'type');

        $cash = Decimal::money((string) ($sales['cash']->t ?? '0'));
        $in = Decimal::money((string) ($moves['in'] ?? '0'));
        $out = Decimal::money((string) ($moves['out'] ?? '0'));

        return [
            'cash_sales_count' => (int) ($sales['cash']->c ?? 0),
            'cash_sales_total' => Decimal::moneyString($cash),
            'credit_sales_count' => (int) ($sales['payroll_credit']->c ?? 0),
            'credit_sales_total' => Decimal::moneyString(Decimal::money((string) ($sales['payroll_credit']->t ?? '0'))),
            'cash_in' => Decimal::moneyString($in),
            'cash_out' => Decimal::moneyString($out),
            'expected_units' => Decimal::money($openingBalance) + $cash + $in - $out,
        ];
    }

    // ------------------------------------------------------------------ internal

    private function lockOwned(User $actor, int $storeId, int $id, bool $canReview): object
    {
        $shift = DB::table('cash_shifts')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
        abort_if($shift === null, 404, 'Shift tidak ditemukan.');
        abort_if(! $canReview && (int) $shift->cashier_id !== $actor->id, 403, 'Anda hanya dapat mengelola shift sendiri.');

        return $shift;
    }

    private function row(int $storeId, int $id): ?object
    {
        return DB::table('cash_shifts as s')
            ->join('users as u', 'u.id', '=', 's.cashier_id')
            ->where('s.store_id', $storeId)->where('s.id', $id)
            ->first(['s.*', 'u.name as cashier_name']);
    }

    private function canSeeExpected(User $user): bool
    {
        return $user->can('shift.review');
    }

    /** @return array<string, mixed> */
    private function present(object $row, bool $seeExpected): array
    {
        $summary = $this->summary((int) $row->id, $row->opening_balance);
        $finished = in_array($row->status, ['closed', 'reviewed'], true);

        $out = [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'register_id' => (int) $row->register_id,
            'cashier_id' => (int) $row->cashier_id,
            'cashier_name' => $row->cashier_name,
            'status' => $row->status,
            'opening_balance' => $row->opening_balance,
            'opened_at' => $row->opened_at,
            'closed_at' => $row->closed_at,
            'summary' => [
                'cash_sales_count' => $summary['cash_sales_count'],
                'cash_sales_total' => $summary['cash_sales_total'],
                'credit_sales_count' => $summary['credit_sales_count'],
                'credit_sales_total' => $summary['credit_sales_total'],
                'cash_in' => $summary['cash_in'],
                'cash_out' => $summary['cash_out'],
            ],
            'counted_cash' => $row->counted_cash,
            'variance' => $finished || $seeExpected ? $row->variance : null,
            'variance_note' => $row->variance_note,
            'float_kept' => $row->float_kept,
            'reviewed_at' => $row->reviewed_at,
        ];

        // hitung buta: kas diharapkan baru terlihat Kasir setelah shift ditutup
        $out['expected_cash'] = $finished
            ? $row->expected_cash
            : ($seeExpected ? Decimal::moneyString($summary['expected_units']) : null);

        return $out;
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
