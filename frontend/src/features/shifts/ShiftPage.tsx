import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shiftApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Shift } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { validateMoney } from '@/features/customers/customerForm';
import { normalizeDecimal } from '@/features/products/productForm';
import { ShiftFigures, ShiftStatusBadge } from './ShiftParts';

export function ShiftPage() {
  const qc = useQueryClient();
  const [justClosed, setJustClosed] = useState<Shift | null>(null);

  const current = useQuery({ queryKey: ['shifts', 'current'], queryFn: shiftApi.current });
  const refresh = () => qc.invalidateQueries({ queryKey: ['shifts'] });

  if (current.isLoading) return <div className="p-6 text-slate-500">Memuat shift…</div>;

  const shift = current.data ?? null;

  return (
    <div className="max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Shift Saya</h1>
      <ErrorNotice error={current.error} />

      {justClosed && !shift && (
        <ClosedResult shift={justClosed} onNew={() => setJustClosed(null)} />
      )}

      {!shift && !justClosed && !current.error && (
        <OpenShiftCard onOpened={() => { void refresh(); }} />
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

function ClosedResult({ shift, onNew }: { shift: Shift; onNew: () => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-semibold text-emerald-900">Shift ditutup</h2>
        <div className="font-mono text-sm text-slate-600">{shift.doc_number}</div>
        <ShiftFigures shift={shift} />
        <p className="text-xs text-slate-600">Admin akan meninjau shift ini, terutama bila ada selisih.</p>
      </div>
      <button type="button" onClick={onNew} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
        Buka shift baru
      </button>
    </div>
  );
}
