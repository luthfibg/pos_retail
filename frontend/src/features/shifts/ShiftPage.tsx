import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cashDepositApi, shiftApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { CashDeposit, DepositStatus, FloatFlag, Shift, ShiftDeposit } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { validateMoney } from '@/features/customers/customerForm';
import { normalizeDecimal } from '@/features/products/productForm';
import { ShiftFigures, ShiftStatusBadge } from './ShiftParts';
import { formatRupiah } from '@/lib/format';
import { canOpenNextShift } from './shiftLogic';

const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  draft: 'Draft — belum diserahkan',
  submitted: 'Diserahkan — menunggu Finance',
  received: 'Diterima Finance',
  discrepancy: 'Ada selisih — menunggu koreksi',
  corrected: 'Selisih dikoreksi',
};

const FLOAT_FLAG_LABEL: Record<FloatFlag, string> = {
  no_policy: 'Admin belum menetapkan kebijakan endapan; tidak ada setoran yang dapat diserahkan.',
  below_minimum: 'Kas terhitung di bawah endapan minimum; tidak ada setoran yang dapat diserahkan.',
  nothing_to_deposit: 'Kas di laci tidak melebihi endapan; tidak ada setoran yang dapat diserahkan.',
};

export function ShiftPage() {
  const qc = useQueryClient();
  const [justClosed, setJustClosed] = useState<Shift | null>(null);

  const current = useQuery({ queryKey: ['shifts', 'current'], queryFn: shiftApi.current });
  const pendingDeposits = useQuery({
    queryKey: ['cash-deposits', 'final-drafts'],
    queryFn: () => cashDepositApi.list({ status: 'draft', kind: 'final', per_page: 100 }),
    enabled: current.isSuccess && current.data === null && !justClosed,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['shifts'] });

  if (current.isLoading) return <div className="p-6 text-slate-500">Memuat shift…</div>;

  const shift = current.data ?? null;
  const drafts = pendingDeposits.data?.data ?? [];

  return (
    <div className="max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Shift Saya</h1>
      <ErrorNotice error={current.error} />

      {justClosed && !shift && (
        <ClosedResult
          shift={justClosed}
          onNew={() => setJustClosed(null)}
          onDepositSubmitted={(deposit) => {
            setJustClosed((closed) => closed ? {
              ...closed,
              deposit: {
                id: deposit.id,
                doc_number: deposit.doc_number,
                status: deposit.status,
                deposit_amount: deposit.deposit_amount,
                float_kept: deposit.float_kept,
              },
            } : closed);
          }}
        />
      )}

      {!shift && !justClosed && !current.error && (
        <>
          <ErrorNotice error={pendingDeposits.error} />
          {drafts.length > 0 && (
            <PendingFinalDeposits
              deposits={drafts}
              onSubmitted={() => {
                void qc.invalidateQueries({ queryKey: ['cash-deposits', 'final-drafts'] });
                void refresh();
              }}
            />
          )}
          {!pendingDeposits.isLoading && !pendingDeposits.error && drafts.length === 0 && (
            <OpenShiftCard onOpened={() => { void refresh(); }} />
          )}
        </>
      )}

      {shift && (
        <ActiveShiftCard
          shift={shift}
          onChanged={() => { void refresh(); }}
          onClosed={(s) => { setJustClosed(s); void refresh(); }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ buka shift

function OpenShiftCard({ onOpened }: { onOpened: () => void }) {
  const [counted, setCounted] = useState('');
  const [error, setError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () => {
      const v = normalizeDecimal(counted);
      return shiftApi.open(v ? { counted_opening_cash: v } : {});
    },
    onSuccess: onOpened,
  });

  const server = mutation.error instanceof ApiError && mutation.error.status === 422 ? mutation.error.errors ?? {} : {};

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const msg = validateMoney(counted, false);
    setError(msg);
    if (msg) return;
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-semibold">Belum ada shift berjalan</h2>
        <p className="mt-1 text-sm text-slate-600">
          Buka shift untuk mulai berjualan. Saldo awal otomatis mengikuti sisa uang di laci dari shift sebelumnya.
        </p>
      </div>

      {/* galat "shift" (mis. laci masih dipakai kasir lain) ditampilkan utuh */}
      <ErrorNotice error={mutation.error} />

      <Field
        label="Uang di laci saat ini (opsional)"
        error={error ?? server.counted_opening_cash?.[0]}
        hint="Hitung uang fisik di laci. Bila berbeda dari saldo awal, selisihnya dicatat di audit."
      >
        <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Rp" autoFocus />
      </Field>

      <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {mutation.isPending ? 'Membuka…' : 'Buka shift'}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ shift berjalan

function ActiveShiftCard({ shift, onChanged, onClosed }: { shift: Shift; onChanged: () => void; onClosed: (s: Shift) => void }) {
  const [confirming, setConfirming] = useState(false);

  const startCount = useMutation({
    mutationFn: () => shiftApi.startCount(shift.id),
    onSuccess: () => { setConfirming(false); onChanged(); },
    onError: () => setConfirming(false),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-sm text-slate-500">{shift.doc_number}</div>
            <ShiftStatusBadge status={shift.status} />
          </div>
        </div>
        <ShiftFigures shift={shift} />
        {shift.expected_cash === null && (
          <p className="text-xs text-slate-500">Kas yang diharapkan disembunyikan selama shift berjalan (hitung buta) dan tampil setelah shift ditutup.</p>
        )}
      </div>

      <ErrorNotice error={startCount.error} />

      {shift.status === 'open' && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Tutup shift</h2>
          <p className="mt-1 text-sm text-slate-600">
            Mulai dengan menghitung uang fisik di laci. Setelah penghitungan dimulai, penjualan baru tidak dapat dibuat pada shift ini.
          </p>
          <button type="button" onClick={() => setConfirming(true)} className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
            Mulai hitung kas
          </button>
        </div>
      )}

      {shift.status === 'counting' && <CloseShiftForm shift={shift} onClosed={onClosed} />}

      {confirming && (
        <Modal title="Mulai hitung kas?" onClose={() => !startCount.isPending && setConfirming(false)}>
          <div className="space-y-2 p-5 text-sm">
            <p>Penjualan baru akan diblokir sampai shift ditutup.</p>
            <p className="text-slate-600">Pastikan tidak ada pelanggan yang sedang dilayani.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={startCount.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
            <button type="button" disabled={startCount.isPending} onClick={() => startCount.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {startCount.isPending ? 'Memproses…' : 'Mulai hitung'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CloseShiftForm({ shift, onClosed }: { shift: Shift; onClosed: (s: Shift) => void }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      const input: { counted_cash: string; variance_note?: string } = { counted_cash: normalizeDecimal(counted) };
      if (note.trim()) input.variance_note = note.trim();
      return shiftApi.close(shift.id, input);
    },
    onSuccess: onClosed,
    onSettled: () => setConfirming(false),
  });

  const is422 = mutation.error instanceof ApiError && mutation.error.status === 422;
  const server = is422 && mutation.error instanceof ApiError ? mutation.error.errors ?? {} : {};
  const needsNote = Boolean(server.variance_note);

  function review(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const msg = validateMoney(counted, true);
    setError(msg);
    if (msg) return;
    setConfirming(true);
  }

  return (
    <form onSubmit={review} noValidate className="space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <div>
        <h2 className="font-semibold">Hitung uang di laci</h2>
        <p className="mt-1 text-sm text-slate-700">Masukkan total uang tunai fisik yang ada di laci saat ini, termasuk saldo awal.</p>
      </div>

      {!is422 && <ErrorNotice error={mutation.error} />}

      <Field label="Total uang tunai terhitung (Rp)" error={error ?? server.counted_cash?.[0]}>
        <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
      </Field>

      <Field
        label={needsNote ? 'Keterangan selisih (wajib)' : 'Keterangan (isi bila ada selisih)'}
        error={server.variance_note?.[0]}
      >
        <textarea
          className={`${inputCls} ${needsNote ? 'border-red-400' : ''}`}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        Tutup shift
      </button>

      {confirming && (
        <Modal title="Tutup shift?" onClose={() => !mutation.isPending && setConfirming(false)}>
          <div className="space-y-2 p-5 text-sm">
            <p>Uang terhitung: <span className="font-semibold">{counted.trim()}</span></p>
            <p className="text-slate-600">Setelah ditutup, shift tidak dapat diubah. Koreksi dilakukan Admin lewat catatan terpisah.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Hitung ulang</button>
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {mutation.isPending ? 'Menutup…' : 'Tutup shift'}
            </button>
          </div>
        </Modal>
      )}
    </form>
  );
}

// ------------------------------------------------------------------ hasil tutup

function ClosedResult({
  shift,
  onNew,
  onDepositSubmitted,
}: {
  shift: Shift;
  onNew: () => void;
  onDepositSubmitted: (deposit: CashDeposit) => void;
}) {
  const canOpenNext = canOpenNextShift(shift.deposit?.status);

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-semibold text-emerald-900">Shift ditutup</h2>
        <div className="font-mono text-sm text-slate-600">{shift.doc_number}</div>
        <ShiftFigures shift={shift} />
        {shift.float_kept !== null && (
          <p className="text-sm">Endapan untuk saldo awal shift berikutnya: <strong>{formatRupiah(shift.float_kept)}</strong></p>
        )}
        {shift.deposit ? (
          <FinalDepositHandover
            deposit={shift.deposit}
            shiftDocNumber={shift.doc_number}
            onSubmitted={onDepositSubmitted}
          />
        ) : (
          <div className="space-y-1 text-sm text-slate-700">
            {(shift.float_flags ?? []).map((flag) => <p key={flag}>{FLOAT_FLAG_LABEL[flag]}</p>)}
            {!shift.float_flags?.length && <p>Tidak ada setoran akhir yang perlu diserahkan.</p>}
          </div>
        )}
        <p className="text-xs text-slate-600">Admin akan meninjau shift ini, terutama bila ada selisih.</p>
      </div>
      {canOpenNext && (
        <button type="button" onClick={onNew} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Buka shift baru
        </button>
      )}
    </div>
  );
}

function PendingFinalDeposits({ deposits, onSubmitted }: { deposits: CashDeposit[]; onSubmitted: () => void }) {
  return (
    <section className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-5">
      <div>
        <h2 className="font-semibold text-amber-950">Setoran akhir belum diserahkan</h2>
        <p className="mt-1 text-sm text-amber-900">
          Serahkan setoran sebelum membuka shift baru. Setoran yang masih Draft akan menghalangi pembukaan shift.
        </p>
      </div>
      {deposits.map((deposit) => (
        <FinalDepositHandover
          key={deposit.id}
          deposit={deposit}
          shiftDocNumber={deposit.shift_doc_number}
          onSubmitted={onSubmitted}
        />
      ))}
    </section>
  );
}

function FinalDepositHandover({
  deposit,
  shiftDocNumber,
  onSubmitted,
}: {
  deposit: Pick<ShiftDeposit, 'id' | 'doc_number' | 'status' | 'deposit_amount' | 'float_kept'>;
  shiftDocNumber: string;
  onSubmitted: (deposit: CashDeposit) => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const submit = useMutation({
    mutationFn: () => cashDepositApi.submit(deposit.id),
    onSuccess: (updated) => {
      onSubmitted(updated);
      void qc.invalidateQueries({ queryKey: ['cash-deposits'] });
      void qc.invalidateQueries({ queryKey: ['shifts'] });
    },
    onSettled: () => setConfirming(false),
  });
  const refreshStatus = useMutation({
    mutationFn: () => cashDepositApi.get(deposit.id),
    onSuccess: (updated) => {
      onSubmitted(updated);
      submit.reset();
    },
  });

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm">{deposit.doc_number}</div>
          <p className="text-xs text-slate-500">Shift {shiftDocNumber} · {DEPOSIT_STATUS_LABEL[deposit.status]}</p>
        </div>
        <div className="text-right text-sm">
          <p>Setoran: <strong className="tabular-nums">{formatRupiah(deposit.deposit_amount)}</strong></p>
          <p className="text-slate-600">Endapan: {formatRupiah(deposit.float_kept)}</p>
        </div>
      </div>
      {deposit.status === 'draft' ? (
        <>
          <ErrorNotice error={submit.error} />
          <ErrorNotice error={refreshStatus.error} />
          {submit.error && (
            <button
              type="button"
              disabled={refreshStatus.isPending}
              onClick={() => refreshStatus.mutate()}
              className="text-sm font-medium text-slate-700 underline disabled:opacity-60"
            >
              {refreshStatus.isPending ? 'Memuat status…' : 'Perbarui status setoran'}
            </button>
          )}
          <button
            type="button"
            disabled={submit.isPending}
            onClick={() => { submit.reset(); refreshStatus.reset(); setConfirming(true); }}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submit.isPending ? 'Menyerahkan…' : 'Serahkan setoran'}
          </button>
        </>
      ) : (
        <p className="text-sm text-emerald-800" role="status">
          Setoran sudah diserahkan dan menunggu Finance menerima uang.
        </p>
      )}
      {confirming && (
        <Modal title="Serahkan setoran?" onClose={() => !submit.isPending && setConfirming(false)}>
          <div className="space-y-2 p-5 text-sm">
            <p>Pastikan uang fisik sebesar <strong>{formatRupiah(deposit.deposit_amount)}</strong> diserahkan kepada Finance.</p>
            <p className="text-slate-600">Setelah diserahkan, setoran akhir tidak dapat dibatalkan. Shift baru dapat dibuka setelah penyerahan tercatat.</p>
            <ErrorNotice error={submit.error} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={submit.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
            <button type="button" disabled={submit.isPending} onClick={() => submit.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {submit.isPending ? 'Menyerahkan…' : 'Konfirmasi penyerahan'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
