import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cashDepositApi, shiftApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { CashDeposit, DepositStatus, Shift, ShiftDeposit } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { validateMoney } from '@/features/customers/customerForm';
import { normalizeDecimal } from '@/features/products/productForm';
import { ShiftFigures, ShiftStatusBadge } from './ShiftParts';
import { formatRupiah } from '@/lib/format';
import { canOpenNextShift } from './shiftLogic';
import { CashMovementsPanel } from './CashMovementsPanel';
import { PartialDepositsPanel } from './PartialDepositsPanel';

const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  draft: 'Draft — belum diserahkan',
  submitted: 'Diserahkan — menunggu Finance',
  received: 'Diterima Finance',
  discrepancy: 'Ada selisih — menunggu koreksi',
  corrected: 'Selisih dikoreksi',
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

  if (current.isLoading) return <div className="p-6 text-slate-500">Memuat kasir jaga…</div>;

  const shift = current.data ?? null;
  const drafts = pendingDeposits.data?.data ?? [];

  return (
    <div className="max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Kasir Jaga</h1>
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
          <OpenShiftCard onOpened={() => { void refresh(); void qc.invalidateQueries({ queryKey: ['cash-deposits', 'final-drafts'] }); }} />
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
  const registers = useQuery({ queryKey: ['registers', 'available'], queryFn: shiftApi.availableRegisters });
  const [selectedRegisterId, setSelectedRegisterId] = useState('');
  const [counted, setCounted] = useState('');
  const [error, setError] = useState<string | undefined>();
  const selectedRegister = selectedRegisterId || String(registers.data?.find((register) => register.is_available)?.id ?? '');

  const mutation = useMutation({
    mutationFn: () => {
      const v = normalizeDecimal(counted);
      return shiftApi.open({
        register_id: Number(selectedRegister),
        ...(v ? { counted_opening_cash: v } : {}),
      });
    },
    onSuccess: async () => {
      await onOpened();
      await registers.refetch();
    },
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
        <h2 className="font-semibold">Belum ada kasir jaga berjalan</h2>
      </div>

      {/* galat "shift" (mis. laci masih dipakai kasir lain) ditampilkan utuh */}
      <ErrorNotice error={mutation.error} />
      <ErrorNotice error={registers.error} />

      <Field label="Mesin kasir">
        <select
          className={inputCls}
          required
          value={selectedRegister}
          onChange={(event) => setSelectedRegisterId(event.target.value)}
          disabled={registers.isLoading || !registers.data?.length}
        >
          <option value="">{registers.isLoading ? 'Memuat mesin kasir…' : 'Pilih mesin kasir'}</option>
          {registers.data?.map((register) => (
            <option key={register.id} value={register.id} disabled={!register.is_available}>
              {register.name}{register.is_available ? '' : ` — ${register.unavailable_reason}`}
            </option>
          ))}
        </select>
      </Field>
      {registers.data?.length === 0 && <p className="text-sm text-amber-800">Belum ada mesin kasir aktif.</p>}

      <Field
        label="Uang di laci saat ini (opsional)"
        error={error ?? server.counted_opening_cash?.[0]}
      >
        <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Rp" autoFocus />
      </Field>

      <button type="submit" disabled={mutation.isPending || !selectedRegister || registers.data?.find((register) => String(register.id) === selectedRegister)?.is_available !== true} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {mutation.isPending ? 'Membuka…' : 'Buka kasir jaga'}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ shift berjalan

function ActiveShiftCard({ shift, onChanged, onClosed }: { shift: Shift; onChanged: () => void; onClosed: (s: Shift) => void }) {
  const partialDrafts = useQuery({
    queryKey: ['cash-deposits', 'shift-drafts', shift.id],
    queryFn: () => cashDepositApi.list({ shift_id: shift.id, kind: 'partial', status: 'draft', per_page: 100 }),
  });
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
            <div className="text-sm font-medium">{shift.register_name}</div>
            <ShiftStatusBadge status={shift.status} />
          </div>
        </div>
        <ShiftFigures shift={shift} />
      </div>

      <CashMovementsPanel shift={shift} />

      {(shift.status === 'open' || shift.status === 'counting') && (
        <PartialDepositsPanel
          shift={shift}
          hasDraft={Boolean(partialDrafts.data?.data.length)}
          checkingDraft={partialDrafts.isLoading || Boolean(partialDrafts.error)}
        />
      )}

      <ErrorNotice error={startCount.error} />

      {shift.status === 'open' && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Tutup kasir jaga</h2>
          <ErrorNotice error={partialDrafts.error} />
          <button type="button" disabled={partialDrafts.isLoading} onClick={() => setConfirming(true)} className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            Mulai hitung kas
          </button>
        </div>
      )}

      {shift.status === 'counting' && (
        partialDrafts.isLoading ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">Memeriksa Draft setoran sebelum penutupan…</p>
        ) : partialDrafts.error ? (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-900">
            <ErrorNotice error={partialDrafts.error} />
          </div>
        ) : partialDrafts.data?.data.length ? (
          null
        ) : (
          <CloseShiftForm shift={shift} onClosed={onClosed} />
        )
      )}

      {confirming && (
        <Modal title="Mulai hitung kas?" onClose={() => !startCount.isPending && setConfirming(false)}>
          <div className="p-5"><ErrorNotice error={startCount.error} /></div>
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
        Tutup kasir jaga
      </button>

      {confirming && (
        <Modal title="Tutup kasir jaga?" onClose={() => !mutation.isPending && setConfirming(false)}>
          <div className="p-5"><ErrorNotice error={mutation.error} /></div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Hitung ulang</button>
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {mutation.isPending ? 'Menutup…' : 'Tutup kasir jaga'}
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
        <h2 className="font-semibold text-emerald-900">Kasir jaga ditutup</h2>
        <div className="font-mono text-sm text-slate-600">{shift.doc_number}</div>
        <ShiftFigures shift={shift} />
        {shift.float_kept !== null && (
          <p className="text-sm">Endapan: <strong>{formatRupiah(shift.float_kept)}</strong></p>
        )}
        {shift.deposit ? (
          <FinalDepositHandover
            deposit={shift.deposit}
            shiftDocNumber={shift.doc_number}
            onSubmitted={onDepositSubmitted}
          />
        ) : (
          <div className="space-y-1 text-sm text-slate-700">
            {!shift.float_flags?.length && <p>Tidak ada setoran akhir yang perlu diserahkan.</p>}
          </div>
        )}
      </div>
      {canOpenNext && (
        <button type="button" onClick={onNew} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Buka kasir jaga baru
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
          <p className="text-xs text-slate-500">Kasir jaga {shiftDocNumber} · {DEPOSIT_STATUS_LABEL[deposit.status]}</p>
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
        null
      )}
      {confirming && (
        <Modal title="Serahkan setoran?" onClose={() => !submit.isPending && setConfirming(false)}>
          <div className="space-y-2 p-5 text-sm">
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
