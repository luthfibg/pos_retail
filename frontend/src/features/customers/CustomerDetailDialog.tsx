import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Customer } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { CreditStateBadge, CustomerStatusBadge } from './CustomerBadges';
import { CREDIT_HINT } from './creditState';
import { CustomerFormDialog } from './CustomerFormDialog';
import { buildVerifyPayload, validateMoney } from './customerForm';
import { normalizeDecimal } from '@/features/products/productForm';

type Panel = 'none' | 'verify' | 'limit';

export function CustomerDetailDialog({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const { can } = useAuth();
  const [panel, setPanel] = useState<Panel>('none');
  const [editing, setEditing] = useState(false);

  const query = useQuery({ queryKey: ['customers', customerId], queryFn: () => customerApi.get(customerId) });
  const c = query.data;

  const isAdminView = can('customer.set_limit'); // pemilik izin ini menerima nilai batas
  const history = useQuery({
    queryKey: ['customers', customerId, 'limits'],
    queryFn: () => customerApi.limitHistory(customerId),
    enabled: isAdminView,
  });

  if (editing && c) return <CustomerFormDialog customer={c} onClose={() => setEditing(false)} />;

  return (
    <Modal title={c ? `${c.name} — ${c.customer_no}` : 'Detail karyawan'} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <ErrorNotice error={query.error} />
        {query.isLoading && <p className="text-slate-500">Memuat…</p>}

        {c && (
          <>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
              <dt className="text-slate-500">Departemen</dt><dd>{c.department ?? '—'}</dd>
              <dt className="text-slate-500">Status</dt><dd><CustomerStatusBadge status={c.status} /></dd>
              <dt className="text-slate-500">Diverifikasi</dt><dd>{formatDateTime(c.verified_at)}</dd>
              <dt className="text-slate-500">Kredit</dt>
              <dd>
                <CreditStateBadge state={c.credit_state} />
                <p className="mt-1 text-slate-600">{CREDIT_HINT[c.credit_state]}</p>
              </dd>
              {c.credit_remaining !== null && (
                <>
                  <dt className="text-slate-500">Sisa batas</dt>
                  <dd className="font-medium tabular-nums">{formatRupiah(c.credit_remaining)}</dd>
                </>
              )}
              {isAdminView && (
                <>
                  <dt className="text-slate-500">Batas bulanan</dt>
                  <dd className="tabular-nums">{c.credit_limit != null ? formatRupiah(c.credit_limit) : 'Belum diisi'}</dd>
                  <dt className="text-slate-500">Terpakai</dt>
                  <dd className="tabular-nums">{formatRupiah(c.credit_used ?? '0')}</dd>
                </>
              )}
            </dl>

            {panel === 'verify' && <VerifyForm customer={c} onDone={() => setPanel('none')} onCancel={() => setPanel('none')} />}
            {panel === 'limit' && <LimitForm customer={c} onDone={() => setPanel('none')} onCancel={() => setPanel('none')} />}

            {panel === 'none' && (
              <div className="flex flex-wrap gap-2">
                {c.status === 'pending_verification' && can('customer.verify') && (
                  <button type="button" onClick={() => setPanel('verify')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Verifikasi</button>
                )}
                {c.status === 'active' && can('customer.set_limit') && (
                  <button
                    type="button"
                    onClick={() => setPanel('limit')}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${c.credit_state === 'limit_not_set' ? 'bg-slate-900 text-white' : 'border border-slate-300 hover:bg-slate-50'}`}
                  >
                    {c.credit_state === 'limit_not_set' ? 'Isi batas kredit' : 'Ubah batas kredit'}
                  </button>
                )}
                {can('customer.update') && (
                  <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Ubah data</button>
                )}
              </div>
            )}

            {isAdminView && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Riwayat batas kredit</h3>
                {history.isLoading && <p className="text-slate-500">Memuat…</p>}
                {history.data && history.data.length === 0 && <p className="text-slate-500">Belum ada batas yang ditetapkan.</p>}
                {history.data && history.data.length > 0 && (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Berlaku sejak</th>
                          <th className="px-3 py-2 text-right">Batas</th>
                          <th className="px-3 py-2">Oleh</th>
                          <th className="px-3 py-2">Catatan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {history.data.map((h) => (
                          <tr key={h.id}>
                            <td className="whitespace-nowrap px-3 py-2">{formatDateTime(h.effective_from)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(h.limit_amount)}</td>
                            <td className="px-3 py-2">{h.set_by_name ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{h.note ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex justify-end border-t border-slate-200 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Tutup</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- verifikasi

function VerifyForm({ customer, onDone, onCancel }: { customer: Customer; onDone: () => void; onCancel: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canSetLimit = can('customer.set_limit');
  const [limit, setLimit] = useState('');
  const [note, setNote] = useState('');
  const [limitError, setLimitError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () => customerApi.verify(customer.id, buildVerifyPayload(limit, note, canSetLimit)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      onDone();
    },
  });

  const server = mutation.error instanceof ApiError && mutation.error.status === 422 ? mutation.error.errors ?? {} : {};

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const msg = canSetLimit ? validateMoney(limit, false) : undefined;
    setLimitError(msg);
    if (msg) return;
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-medium">Verifikasi karyawan</h3>
      {!(mutation.error instanceof ApiError && mutation.error.status === 422) && <ErrorNotice error={mutation.error} />}
      {canSetLimit && (
        <Field
          label="Batas kredit bulanan (Rp, opsional)"
          error={limitError ?? server.credit_limit?.[0]}
          hint="Kosongkan bila batas belum ditetapkan; kredit tetap ditahan sampai batas diisi."
        >
          <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} autoFocus />
        </Field>
      )}
      <Field label="Catatan (opsional)" error={server.note?.[0]}>
        <input className={inputCls} value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="mis. 60% gaji sesuai HRD" />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={mutation.isPending} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
        <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
          {mutation.isPending ? 'Memproses…' : 'Verifikasi'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- batas kredit

function LimitForm({ customer, onDone, onCancel }: { customer: Customer; onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(customer.credit_limit ?? '');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () =>
      customerApi.setLimit(customer.id, { limit_amount: normalizeDecimal(amount), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      // backend menandai notifikasi "perlu batas" terbaca saat batas diisi
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      onDone();
    },
  });

  const server = mutation.error instanceof ApiError && mutation.error.status === 422 ? mutation.error.errors ?? {} : {};

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const msg = validateMoney(amount, true);
    setAmountError(msg);
    if (msg) return;
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-medium">Batas kredit bulanan</h3>
      {!(mutation.error instanceof ApiError && mutation.error.status === 422) && <ErrorNotice error={mutation.error} />}
      <Field label="Batas (Rp)" error={amountError ?? server.limit_amount?.[0]} hint="Perubahan dicatat di riwayat dan berlaku sejak disimpan.">
        <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <Field label="Catatan (opsional)" error={server.note?.[0]}>
        <input className={inputCls} value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={mutation.isPending} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
        <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
          {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </form>
  );
}
