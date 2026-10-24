<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use App\Support\DocumentNumber;
use Carbon\Carbon;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Setoran kasir (Kas Kecil -> Kas Besar) dan kebijakan endapan.
 *  - setiap setoran menyisakan ENDAPAN yang menjadi saldo awal shift berikutnya
 *  - endapan dari kebijakan aktif (float_policies, berversi): fixed, atau percent dari basis (penjualan tunai shift / kas terhitung),
 *    dijepit ke min/maks; setoran = kas terhitung - endapan, DIBULATKAN KE BAWAH ke rounding_unit (sisa pembulatan tinggal di laci)
 *  - kas terhitung < min -> setoran 0 (tanda below_minimum); kas <= endapan -> setoran 0
 *  - TANPA kebijakan aktif -> setoran 0 dan seluruh kas tetap sebagai endapan (tanda no_policy) [perilaku sementara lama]
 *  - status: draft -> submitted (kasir menyerahkan) -> received (Finance menghitung ulang, ledger Kas Kecil (-) dan Kas Besar (+))
 *            atau discrepancy (hitung ulang berbeda; wajib catatan) -> corrected (alasan; ledger tidak diubah)
 *  - setoran parsial (tengah shift) mengurangi kas diharapkan sejak diserahkan
 */
class CashDepositService
{
    /** Status yang berarti uang sudah meninggalkan laci. */
    public const HANDED_OVER = ['submitted', 'received', 'discrepancy', 'corrected'];

    public function __construct(private AuditLogger $audit, private NumberSequence $sequences)
    {
    }

    // ------------------------------------------------------------------ kebijakan

    /** @return array<string, array<string, mixed>|null> */
    public function policies(int $storeId): array
    {
        $out = [];
        foreach (['petty_cash', 'main_cash'] as $scope) {
            $row = $this->activePolicy($storeId, $scope);
            $out[$scope] = $row === null ? null : $this->presentPolicy($row);
        }

        return $out;
    }

    /**
     * Tetapkan kebijakan baru (versi baru; versi lama dinonaktifkan).
     *
     * @param  array<string, mixed>  $data  mode, fixed_amount?, percent?, percent_base?, min_amount?, max_amount?, rounding_unit?, reason?
     * @return array<string, mixed>
     */
    public function setPolicy(User $actor, int $storeId, string $scope, array $data): array
    {
        $errors = [];
        if ($data['mode'] === 'fixed' && ! isset($data['fixed_amount'])) {
            $errors['fixed_amount'] = ['Nominal endapan wajib diisi untuk mode tetap.'];
        }
        if ($data['mode'] === 'percent' && (! isset($data['percent']) || empty($data['percent_base']))) {
            $errors['percent'] = ['Persentase dan basis wajib diisi untuk mode persen.'];
        }
        if (isset($data['min_amount'], $data['max_amount']) && Decimal::money($data['min_amount']) > Decimal::money($data['max_amount'])) {
            $errors['min_amount'] = ['Batas minimum tidak boleh melebihi maksimum.'];
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $id = DB::transaction(function () use ($actor, $storeId, $scope, $data) {
            $previous = DB::table('float_policies')->where('store_id', $storeId)->where('scope', $scope)->where('is_active', 1)->lockForUpdate()->get();
            DB::table('float_policies')->where('store_id', $storeId)->where('scope', $scope)->where('is_active', 1)->update(['is_active' => 0]);

            $isFixed = $data['mode'] === 'fixed';
            $id = DB::table('float_policies')->insertGetId([
                'store_id' => $storeId,
                'scope' => $scope,
                'mode' => $data['mode'],
                'fixed_amount' => $isFixed ? Decimal::moneyString(Decimal::money($data['fixed_amount'])) : null,
                'percent' => $isFixed ? null : Decimal::moneyString(Decimal::money($data['percent'])),
                'percent_base' => $isFixed ? null : $data['percent_base'],
                'min_amount' => isset($data['min_amount']) ? Decimal::moneyString(Decimal::money($data['min_amount'])) : null,
                'max_amount' => isset($data['max_amount']) ? Decimal::moneyString(Decimal::money($data['max_amount'])) : null,
                'rounding_unit' => (int) ($data['rounding_unit'] ?? 1000),
                'is_active' => 1,
                'effective_from' => $this->now(),
                'set_by' => $actor->id,
            ]);

            $old = $previous->first();
            $this->audit->log('float.policy_set', 'float_policy', $id,
                before: $old === null ? null : $this->presentPolicy($old),
                after: $this->presentPolicy(DB::table('float_policies')->where('id', $id)->first()),
                reason: $data['reason'] ?? null, storeId: $storeId, actorId: $actor->id);

            return $id;
        });

        return $this->presentPolicy(DB::table('float_policies')->where('id', $id)->first());
    }

    // ------------------------------------------------------------------ rencana setoran

    /**
     * Hitung endapan dan setoran untuk kas terhitung tertentu (satuan sen).
     *
     * @return array{policy: object|null, float: int, deposit: int, flags: list<string>}
     */
    public function plan(int $storeId, int $shiftId, int $counted): array
    {
        $policy = $this->activePolicy($storeId, 'petty_cash');

        if ($policy === null) {
            return ['policy' => null, 'float' => $counted, 'deposit' => 0, 'flags' => ['no_policy']];
        }

        $base = $counted;
        if ($policy->mode === 'percent' && $policy->percent_base === 'cash_sales_shift') {
            $base = Decimal::money((string) DB::table('sales')->where('shift_id', $shiftId)->where('payment_mode', 'cash')->where('status', 'posted')->sum('total'));
        }

        $float = $policy->mode === 'fixed'
            ? Decimal::money($policy->fixed_amount)
            : intdiv($base * Decimal::money($policy->percent) + 5000, 10000);

        $min = $policy->min_amount === null ? null : Decimal::money($policy->min_amount);
        $max = $policy->max_amount === null ? null : Decimal::money($policy->max_amount);
        if ($min !== null) {
            $float = max($float, $min);
        }
        if ($max !== null) {
            $float = min($float, $max);
        }

        if ($min !== null && $counted < $min) {
            return ['policy' => $policy, 'float' => $counted, 'deposit' => 0, 'flags' => ['below_minimum']];
        }
        if ($counted <= $float) {
            return ['policy' => $policy, 'float' => $counted, 'deposit' => 0, 'flags' => ['nothing_to_deposit']];
        }

        $unit = max(1, (int) $policy->rounding_unit) * 100;
        $deposit = intdiv($counted - $float, $unit) * $unit;

        return [
            'policy' => $policy,
            'float' => $counted - $deposit,
            'deposit' => $deposit,
            'flags' => $deposit === 0 ? ['nothing_to_deposit'] : [],
        ];
    }

    /**
     * Buat dokumen setoran Draft dari rencana. Mengembalikan null bila tidak ada yang disetor.
     *
     * @param  array{policy: object|null, float: int, deposit: int, flags: list<string>}  $plan
     */
    public function createDraft(User $actor, int $storeId, object $shift, int $counted, array $plan, string $kind, ?string $note): ?int
    {
        if ($plan['deposit'] <= 0) {
            return null;
        }

        $petty = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'petty_cash')
            ->where('register_id', $shift->register_id)->where('is_active', 1)->value('id');
        $main = DB::table('fund_accounts')->where('store_id', $storeId)->where('type', 'main_cash')->where('is_active', 1)->orderBy('id')->value('id');
        abort_if($petty === null || $main === null, 422, 'Akun Kas Kecil atau Kas Besar belum tersedia.');

        $period = Carbon::now('Asia/Jakarta')->format('Ym');
        $docNo = DocumentNumber::format('DEP', $this->sequences->next($storeId, 'DEP', $period), $period);

        $id = DB::table('cash_deposits')->insertGetId([
            'store_id' => $storeId,
            'doc_number' => $docNo,
            'kind' => $kind,
            'shift_id' => $shift->id,
            'source_fund_id' => $petty,
            'destination_fund_id' => $main,
            'counted_amount' => Decimal::moneyString($counted),
            'float_kept' => Decimal::moneyString($plan['float']),
            'deposit_amount' => Decimal::moneyString($plan['deposit']),
            'policy_id' => $plan['policy']?->id,
            'status' => 'draft',
            'note' => $note,
            'created_by' => $actor->id,
        ]);

        $this->audit->log('cash_deposit.create', 'cash_deposit', $id, after: [
            'doc_number' => $docNo, 'kind' => $kind, 'counted' => Decimal::moneyString($counted),
            'float_kept' => Decimal::moneyString($plan['float']), 'deposit' => Decimal::moneyString($plan['deposit']),
        ], storeId: $storeId, actorId: $actor->id);

        return $id;
    }

    /**
     * Setoran parsial di tengah shift: kasir menghitung uang di laci, sistem menghitung bagian yang boleh disetor.
     *
     * @return array<string, mixed>
     */
    public function createPartial(User $actor, int $storeId, int $shiftId, string $countedAmount, ?string $note, bool $canManage): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $shiftId, $countedAmount, $note, $canManage) {
            $shift = DB::table('cash_shifts')->where('store_id', $storeId)->where('id', $shiftId)->lockForUpdate()->first();
            abort_if($shift === null, 404, 'Shift tidak ditemukan.');
            abort_if(! $canManage && (int) $shift->cashier_id !== $actor->id, 403, 'Anda hanya dapat menyetor dari shift sendiri.');

            if (! in_array($shift->status, ['open', 'counting'], true)) {
                throw ValidationException::withMessages(['shift' => ['Setoran parsial hanya untuk shift yang sedang berjalan.']]);
            }
            if (DB::table('cash_deposits')->where('shift_id', $shiftId)->where('status', 'draft')->exists()) {
                throw ValidationException::withMessages(['shift' => ['Masih ada setoran Draft pada shift ini. Serahkan atau batalkan dulu.']]);
            }

            $counted = Decimal::money($countedAmount);
            $plan = $this->plan($storeId, $shiftId, $counted);

            if ($plan['deposit'] <= 0) {
                throw ValidationException::withMessages(['counted_amount' => [$this->nothingMessage($plan['flags'])]]);
            }

            return $this->createDraft($actor, $storeId, $shift, $counted, $plan, 'partial', $note);
        });

        return $this->find($actor, $storeId, $id, true);
    }

    // ------------------------------------------------------------------ alur status

    /** Kasir menyerahkan uang ke Finance. @return array<string, mixed> */
    public function submit(User $actor, int $storeId, int $id, bool $canManage): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $canManage) {
            $deposit = $this->lock($storeId, $id);
            $this->assertCashier($actor, $deposit, $canManage);

            if ($deposit->status !== 'draft') {
                throw ValidationException::withMessages(['status' => ['Hanya setoran Draft yang dapat diserahkan.']]);
            }

            DB::table('cash_deposits')->where('id', $id)->update(['status' => 'submitted']);
            $this->audit->log('cash_deposit.submit', 'cash_deposit', $id, before: ['status' => 'draft'], after: ['status' => 'submitted', 'deposit_amount' => $deposit->deposit_amount], storeId: $storeId, actorId: $actor->id);
        });

        return $this->find($actor, $storeId, $id, true);
    }

    /** @return array<string, mixed> */
    public function cancel(User $actor, int $storeId, int $id, ?string $reason, bool $canManage): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason, $canManage) {
            $deposit = $this->lock($storeId, $id);
            $this->assertCashier($actor, $deposit, $canManage);

            if ($deposit->status !== 'draft') {
                throw ValidationException::withMessages(['status' => ['Hanya setoran Draft yang dapat dibatalkan.']]);
            }
            if ($deposit->kind === 'final') {
                throw ValidationException::withMessages(['status' => ['Setoran akhir shift tidak dapat dibatalkan; serahkan setoran tersebut.']]);
            }

            // dokumen draft parsial belum mengubah apa pun; hapus agar tidak mengganjal penutupan shift
            DB::table('cash_deposits')->where('id', $id)->delete();
            $this->audit->log('cash_deposit.cancel', 'cash_deposit', $id, before: ['status' => 'draft', 'doc_number' => $deposit->doc_number], reason: $reason, storeId: $storeId, actorId: $actor->id);
        });

        return ['id' => $id, 'cancelled' => true];
    }

    /**
     * Finance menghitung ulang dan menerima. Selisih -> status discrepancy (catatan wajib).
     * Ledger: Kas Kecil dikurangi sebesar yang diserahkan, Kas Besar ditambah sebesar yang diterima.
     *
     * @return array<string, mixed>
     */
    public function receive(User $actor, int $storeId, int $id, string $receivedAmount, ?string $note): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $receivedAmount, $note) {
            $deposit = $this->lock($storeId, $id);

            if ($deposit->status !== 'submitted') {
                throw ValidationException::withMessages(['status' => ['Hanya setoran yang sudah diserahkan yang dapat diterima.']]);
            }

            $received = Decimal::money($receivedAmount);
            $expected = Decimal::money($deposit->deposit_amount);
            $matches = $received === $expected;

            if (! $matches && ($note === null || trim($note) === '')) {
                throw ValidationException::withMessages(['note' => ['Jumlah diterima berbeda dari yang diserahkan; catatan wajib diisi.']]);
            }

            $now = $this->now();
            DB::table('fund_ledger_entries')->insert([
                ['fund_account_id' => $deposit->source_fund_id, 'entry_type' => 'deposit_out', 'amount' => Decimal::moneyString(-$expected),
                    'ref_type' => 'cash_deposit', 'ref_id' => $id, 'occurred_at' => $now, 'created_by' => $actor->id, 'note' => $deposit->doc_number],
                ['fund_account_id' => $deposit->destination_fund_id, 'entry_type' => 'deposit_in', 'amount' => Decimal::moneyString($received),
                    'ref_type' => 'cash_deposit', 'ref_id' => $id, 'occurred_at' => $now, 'created_by' => $actor->id, 'note' => $deposit->doc_number],
            ]);

            $to = $matches ? 'received' : 'discrepancy';
            DB::table('cash_deposits')->where('id', $id)->update([
                'status' => $to, 'received_amount' => Decimal::moneyString($received),
                'received_by' => $actor->id, 'received_at' => $now,
                'note' => $note ?? $deposit->note,
            ]);

            $this->audit->log('cash_deposit.receive', 'cash_deposit', $id,
                before: ['status' => 'submitted'],
                after: ['status' => $to, 'deposit_amount' => $deposit->deposit_amount, 'received_amount' => Decimal::moneyString($received), 'difference' => Decimal::moneyString($received - $expected)],
                reason: $note, selfApproval: (int) $deposit->created_by === $actor->id, storeId: $storeId, actorId: $actor->id);
        });

        return $this->find($actor, $storeId, $id, true);
    }

    /** Tutup selisih setoran dengan alasan; dokumen asal dan ledger tidak diubah. @return array<string, mixed> */
    public function correct(User $actor, int $storeId, int $id, string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $deposit = $this->lock($storeId, $id);

            if ($deposit->status !== 'discrepancy') {
                throw ValidationException::withMessages(['status' => ['Hanya setoran berselisih yang dapat dikoreksi.']]);
            }

            DB::table('cash_deposits')->where('id', $id)->update(['status' => 'corrected']);
            $this->audit->log('cash_deposit.correct', 'cash_deposit', $id, before: ['status' => 'discrepancy'], after: ['status' => 'corrected'], reason: $reason, storeId: $storeId, actorId: $actor->id);
        });

        return $this->find($actor, $storeId, $id, true);
    }

    // ------------------------------------------------------------------ baca

    /** @return array<string, mixed>|null */
    public function find(User $actor, int $storeId, int $id, bool $canSeeAll): ?array
    {
        $row = $this->query($storeId)->where('d.id', $id)->first();

        if ($row === null || (! $canSeeAll && (int) $row->shift_cashier_id !== $actor->id)) {
            return null;
        }

        return $this->present($row);
    }

    /** @param array<string, mixed> $filters */
    public function search(User $actor, int $storeId, array $filters, int $perPage, bool $canSeeAll): LengthAwarePaginator
    {
        $query = $this->query($storeId)->orderByDesc('d.id');

        if (! $canSeeAll) {
            $query->where('s.cashier_id', $actor->id);
        }
        foreach (['status', 'kind'] as $field) {
            if (! empty($filters[$field])) {
                $query->where("d.{$field}", $filters[$field]);
            }
        }
        if (! empty($filters['shift_id'])) {
            $query->where('d.shift_id', (int) $filters['shift_id']);
        }

        return $query->paginate($perPage)->through(fn ($row) => $this->present($row));
    }

    /** Saldo akun dana dari ledger. @return list<array<string, mixed>> */
    public function balances(int $storeId): array
    {
        return DB::table('fund_accounts as f')
            ->leftJoin('fund_ledger_entries as e', 'e.fund_account_id', '=', 'f.id')
            ->where('f.store_id', $storeId)->where('f.is_active', 1)
            ->groupBy('f.id', 'f.type', 'f.name', 'f.register_id')
            ->orderBy('f.id')
            ->selectRaw('f.id, f.type, f.name, f.register_id, coalesce(sum(e.amount), 0) as balance')
            ->get()
            ->map(fn ($row) => [
                'id' => (int) $row->id, 'type' => $row->type, 'name' => $row->name,
                'register_id' => $row->register_id === null ? null : (int) $row->register_id,
                'balance' => Decimal::moneyString(Decimal::money((string) $row->balance)),
            ])->all();
    }

    /** Setoran akhir shift (untuk ditampilkan di data shift). @return array<string, mixed>|null */
    public function finalForShift(int $shiftId): ?array
    {
        $row = DB::table('cash_deposits')->where('shift_id', $shiftId)->where('kind', 'final')->first(['id', 'doc_number', 'status', 'deposit_amount', 'float_kept']);

        return $row === null ? null : [
            'id' => (int) $row->id, 'doc_number' => $row->doc_number, 'status' => $row->status,
            'deposit_amount' => $row->deposit_amount, 'float_kept' => $row->float_kept,
        ];
    }

    // ------------------------------------------------------------------ internal

    private function activePolicy(int $storeId, string $scope): ?object
    {
        return DB::table('float_policies')->where('store_id', $storeId)->where('scope', $scope)->where('is_active', 1)
            ->orderByDesc('id')->first();
    }

    /** @param list<string> $flags */
    private function nothingMessage(array $flags): string
    {
        return match (true) {
            in_array('no_policy', $flags, true) => 'Kebijakan endapan belum ditetapkan Admin; setoran belum dapat dihitung.',
            in_array('below_minimum', $flags, true) => 'Kas di bawah endapan minimum; tidak ada yang dapat disetor.',
            default => 'Kas di laci tidak melebihi endapan; tidak ada yang dapat disetor.',
        };
    }

    private function assertCashier(User $actor, object $deposit, bool $canManage): void
    {
        abort_if(! $canManage && (int) $deposit->created_by !== $actor->id, 403, 'Anda hanya dapat mengelola setoran milik sendiri.');
    }

    private function lock(int $storeId, int $id): object
    {
        $deposit = DB::table('cash_deposits')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();
        abort_if($deposit === null, 404, 'Setoran tidak ditemukan.');

        return $deposit;
    }

    private function query(int $storeId)
    {
        return DB::table('cash_deposits as d')
            ->join('cash_shifts as s', 's.id', '=', 'd.shift_id')
            ->join('users as c', 'c.id', '=', 'd.created_by')
            ->leftJoin('users as r', 'r.id', '=', 'd.received_by')
            ->where('d.store_id', $storeId)
            ->select(['d.*', 's.doc_number as shift_doc_number', 's.cashier_id as shift_cashier_id', 'c.name as created_by_name', 'r.name as received_by_name']);
    }

    /** @return array<string, mixed> */
    private function present(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'kind' => $row->kind,
            'shift_id' => (int) $row->shift_id,
            'shift_doc_number' => $row->shift_doc_number,
            'status' => $row->status,
            'counted_amount' => $row->counted_amount,
            'float_kept' => $row->float_kept,
            'deposit_amount' => $row->deposit_amount,
            'received_amount' => $row->received_amount,
            'difference' => $row->received_amount === null ? null : Decimal::moneyString(Decimal::money($row->received_amount) - Decimal::money($row->deposit_amount)),
            'received_by_name' => $row->received_by_name,
            'received_at' => $row->received_at,
            'note' => $row->note,
            'created_by' => (int) $row->created_by,
            'created_by_name' => $row->created_by_name,
            'created_at' => $row->created_at,
        ];
    }

    /** @return array<string, mixed> */
    private function presentPolicy(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'scope' => $row->scope,
            'mode' => $row->mode,
            'fixed_amount' => $row->fixed_amount,
            'percent' => $row->percent,
            'percent_base' => $row->percent_base,
            'min_amount' => $row->min_amount,
            'max_amount' => $row->max_amount,
            'rounding_unit' => (int) $row->rounding_unit,
            'effective_from' => $row->effective_from,
            'set_by' => (int) $row->set_by,
        ];
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
