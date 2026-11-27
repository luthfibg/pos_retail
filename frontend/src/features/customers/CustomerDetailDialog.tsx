import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Customer } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { formatDate, formatDateTime, formatRupiah } from '@/lib/format';
import { CreditStateBadge } from './CustomerBadges';
import { CREDIT_HINT } from './creditState';
import { CustomerFormDialog } from './CustomerFormDialog';
import { validateMoney } from './customerForm';
import { normalizeDecimal } from '@/features/products/productForm';

type Props = {
  customerId: number;
  onClose: () => void;
  onPrint: (customer: Customer) => void;
};

export function CustomerDetailDialog({ customerId, onClose, onPrint }: Props) {
  const { can, me } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showLimitForm, setShowLimitForm] = useState(false);
  const query = useQuery({ queryKey: ['customers', customerId], queryFn: () => customerApi.get(customerId) });
  const customer = query.data;
  const isAdmin = me?.roles.includes('Admin') === true;
  const isArchived = Boolean(customer?.archived_at);
  const history = useQuery({
    queryKey: ['customers', customerId, 'limits'],
    queryFn: () => customerApi.limitHistory(customerId),
    enabled: can('customer.set_limit'),
  });

  const archiveMutation = useMutation({
    mutationFn: () => customerApi.archive(customerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
  });
  const restoreMutation = useMutation({
    mutationFn: () => customerApi.restore(customerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['customers', customerId] });
      onClose();
    },
  });

  if (editing && customer) {
    return <CustomerFormDialog customer={customer} onClose={() => setEditing(false)} onPrint={onPrint} />;
  }

  return (
    <Modal title={customer ? `${customer.name} — ${customer.customer_no}` : 'Detail debitur'} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <ErrorNotice error={query.error} />
        <ErrorNotice error={archiveMutation.error} />
        <ErrorNotice error={restoreMutation.error} />
        {query.isLoading && <p className="text-slate-500">Memuat…</p>}
        {customer && (
          <>
            {isArchived && <p className="rounded-md bg-slate-100 p-3 font-medium text-slate-700">Debitur diarsipkan pada {formatDateTime(customer.archived_at)}.</p>}
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
              <dt className="text-slate-500">Nomor Induk Karyawan</dt><dd>{customer.customer_no}</dd>
              <dt className="text-slate-500">Nama</dt><dd>{customer.name}</dd>
              <dt className="text-slate-500">Departemen/Divisi</dt><dd>{customer.department ?? '—'}</dd>
              {isAdmin && (
                <>
                  <dt className="text-slate-500">Nomor KTP</dt><dd>{customer.ktp_no || '—'}</dd>
                  <dt className="text-slate-500">Nomor Telepon/HP</dt><dd>{customer.phone || '—'}</dd>
                  <dt className="text-slate-500">Alamat sesuai KTP</dt><dd>{customer.address || '—'}</dd>
                  <dt className="text-slate-500">Domisili sekarang</dt><dd>{customer.domicile || '—'}</dd>
                  <dt className="text-slate-500">Perusahaan</dt><dd>{customer.company_name || '—'}</dd>
                  <dt className="text-slate-500">Jabatan</dt><dd>{customer.position || '—'}</dd>
                  <dt className="text-slate-500">Status karyawan</dt><dd>{customer.employment_type === 'contract' ? 'Kontrak' : customer.employment_type === 'permanent' ? 'Tetap' : '—'}</dd>
                  <dt className="text-slate-500">Mulai bekerja</dt><dd>{customer.employment_start_date ? formatDate(customer.employment_start_date) : '—'}</dd>
                  <dt className="text-slate-500">Nama HRD</dt><dd>{customer.hrd_name || '—'}</dd>
                  <dt className="text-slate-500">Telepon/HP HRD</dt><dd>{customer.hrd_phone || '—'}</dd>
                  <dt className="text-slate-500">Atasan langsung</dt><dd>{customer.supervisor_name || '—'}</dd>
                  <dt className="text-slate-500">Telepon/HP atasan</dt><dd>{customer.supervisor_phone || '—'}</dd>
                </>
              )}
              <dt className="text-slate-500">Kredit</dt>
              <dd><CreditStateBadge state={customer.credit_state} /><p className="mt-1 text-slate-600">{CREDIT_HINT[customer.credit_state]}</p></dd>
              {customer.credit_remaining !== null && (
                <><dt className="text-slate-500">Sisa batas</dt><dd className="font-medium tabular-nums">{formatRupiah(customer.credit_remaining)}</dd></>
              )}
              {can('customer.set_limit') && (
                <>
                  <dt className="text-slate-500">Batas bulanan</dt><dd className="tabular-nums">{customer.credit_limit != null ? formatRupiah(customer.credit_limit) : 'Belum diisi'}</dd>
                  <dt className="text-slate-500">Terpakai</dt><dd className="tabular-nums">{formatRupiah(customer.credit_used ?? '0')}</dd>
                </>
              )}
            </dl>

            {showLimitForm && <LimitForm customer={customer} onDone={() => setShowLimitForm(false)} onCancel={() => setShowLimitForm(false)} />}
            {confirmArchive && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                <p>Arsipkan debitur ini? Riwayat transaksi dan tagihan tetap tersimpan, tetapi debitur tidak dapat dipilih untuk transaksi baru.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmArchive(false)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Batal</button>
                  <button type="button" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate()} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                    {archiveMutation.isPending ? 'Mengarsipkan…' : 'Konfirmasi arsip'}
                  </button>
                </div>
              </div>
            )}

            {!showLimitForm && !confirmArchive && (
              <div className="flex flex-wrap gap-2">
                {isAdmin && (
                  <>
                    <button type="button" onClick={() => onPrint(customer)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cetak bukti pendaftaran</button>
                    {!isArchived && <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Ubah data</button>}
                    {isArchived
                      ? <button type="button" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate()} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Pulihkan dari arsip</button>
                      : <button type="button" onClick={() => setConfirmArchive(true)} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Arsipkan debitur</button>}
                  </>
                )}
                {!isArchived && can('customer.set_limit') && (
                  <button type="button" onClick={() => setShowLimitForm(true)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                    {customer.credit_state === 'limit_not_set' ? 'Isi batas kredit' : 'Ubah batas kredit'}
                  </button>
                )}
              </div>
            )}

            {can('customer.set_limit') && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Riwayat batas kredit</h3>
                {history.isLoading && <p className="text-slate-500">Memuat…</p>}
                {history.data?.length === 0 && <p className="text-slate-500">Belum ada batas yang ditetapkan.</p>}
                {history.data && history.data.length > 0 && (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr><th className="px-3 py-2">Berlaku sejak</th><th className="px-3 py-2 text-right">Batas</th><th className="px-3 py-2">Oleh</th><th className="px-3 py-2">Catatan</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {history.data.map((item) => (
                          <tr key={item.id}>
                            <td className="whitespace-nowrap px-3 py-2">{formatDateTime(item.effective_from)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(item.limit_amount)}</td>
                            <td className="px-3 py-2">{item.set_by_name ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{item.note ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
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

function LimitForm({ customer, onDone, onCancel }: { customer: Customer; onDone: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(customer.credit_limit ?? '');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const mutation = useMutation({
    mutationFn: () => customerApi.setLimit(customer.id, { limit_amount: normalizeDecimal(amount), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      onDone();
    },
  });
  const serverErrors = mutation.error instanceof ApiError && mutation.error.status === 422 ? mutation.error.errors ?? {} : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const error = validateMoney(amount, true);
    setAmountError(error);
    if (!error) mutation.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-medium">Batas kredit bulanan</h3>
      <ErrorNotice error={mutation.error} />
      <Field label="Batas (Rp)" error={amountError ?? serverErrors.limit_amount?.[0]}>
        <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <Field label="Catatan (opsional)" error={serverErrors.note?.[0]}>
        <input className={inputCls} value={note} maxLength={255} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={mutation.isPending} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Batal</button>
        <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Simpan</button>
      </div>
    </form>
  );
}
