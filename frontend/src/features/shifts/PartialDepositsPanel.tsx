import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cashDepositApi } from '@/lib/api/endpoints';
import type { CashDeposit, Shift } from '@/lib/api/types';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { buildPartialDepositInput, validatePartialDeposit, type DepositErrors, type DepositFormValues } from './depositForm';

const EMPTY_FORM: DepositFormValues = { amount: '', note: '' };
const STATUS_LABEL: Record<CashDeposit['status'], string> = {
  draft: 'Draft — belum diserahkan',
  submitted: 'Diserahkan — menunggu Finance',
  received: 'Diterima Finance',
  discrepancy: 'Ada selisih — menunggu koreksi',
  corrected: 'Selisih dikoreksi',
};

function refreshDeposits(qc: ReturnType<typeof useQueryClient>, shiftId: number) {
  void qc.invalidateQueries({ queryKey: ['cash-deposits', 'shift', shiftId] });
  void qc.invalidateQueries({ queryKey: ['cash-deposits', 'shift-drafts', shiftId] });
  void qc.invalidateQueries({ queryKey: ['shifts', 'current'] });
  void qc.invalidateQueries({ queryKey: ['shifts', shiftId] });
}

export function PartialDepositsPanel({ shift, hasDraft, checkingDraft }: { shift: Shift; hasDraft: boolean; checkingDraft: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [values, setValues] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<DepositErrors>({});
  const [confirmCreate, setConfirmCreate] = useState(false);

  const query = useQuery({
    queryKey: ['cash-deposits', 'shift', shift.id, page],
    queryFn: () => cashDepositApi.list({ shift_id: shift.id, kind: 'partial', page, per_page: 25 }),
  });
  const create = useMutation({
    mutationFn: () => cashDepositApi.createPartial(shift.id, buildPartialDepositInput(values)),
    onSuccess: () => {
      setValues(EMPTY_FORM);
      setErrors({});
      setConfirmCreate(false);
      setPage(1);
      refreshDeposits(qc, shift.id);
    },
    onError: () => setConfirmCreate(false),
  });

  function review(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    create.reset();
    const found = validatePartialDeposit(values);
    setErrors(found);
    if (!Object.keys(found).length) setConfirmCreate(true);
  }

  const update = (key: keyof DepositFormValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    create.reset();
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-semibold">Setoran parsial</h2>
        <p className="mt-1 text-sm text-slate-600">
          Buat saat shift berjalan untuk menyetor sebagian kas. Sistem menghitung jumlah setoran sesuai kebijakan endapan aktif.
        </p>
      </div>

      <form onSubmit={review} noValidate className="grid gap-3 rounded-md bg-slate-50 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorNotice error={create.error} /></div>
        <Field label="Uang terhitung di laci (Rp)" error={errors.amount} hint="Masukkan hasil hitung kas saat ini, tanpa pemisah ribuan.">
          <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.amount} onChange={(event) => update('amount', event.target.value)} />
        </Field>
        <Field label="Catatan (opsional)" error={errors.note} hint="Maksimal 500 karakter.">
          <input className={inputCls} maxLength={500} value={values.note} onChange={(event) => update('note', event.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <button type="submit" disabled={create.isPending || hasDraft || checkingDraft} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            Buat Draft setoran parsial
          </button>
          {hasDraft && <p className="text-xs text-amber-800 sm:col-span-2">Selesaikan Draft parsial yang ada dengan menyerahkan atau membatalkannya sebelum membuat setoran baru.</p>}
        </div>
      </form>

      <ErrorNotice error={query.error} />
      {query.isLoading ? (
        <p className="text-sm text-slate-500">Memuat setoran shift…</p>
      ) : query.error && !query.data ? null : query.data?.data.length === 0 ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada setoran parsial untuk shift ini.</p>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-slate-100">
            {query.data?.data.map((deposit) => (
              <PartialDepositRow key={deposit.id} deposit={deposit} shift={shift} />
            ))}
          </ul>
          {query.data && (
            <Pagination
              page={query.data.current_page}
              lastPage={query.data.last_page}
              from={query.data.from}
              to={query.data.to}
              total={query.data.total}
              onPage={setPage}
            />
          )}
        </div>
      )}

      {confirmCreate && (
        <Modal title="Buat Draft setoran parsial?" onClose={() => !create.isPending && setConfirmCreate(false)}>
          <div className="space-y-2 p-5 text-sm">
            <p>Hitungan kas yang akan dipakai untuk menghitung setoran: <strong>{formatRupiah(values.amount.replace(',', '.'))}</strong>.</p>
            <p>Draft belum memindahkan saldo. Serahkan uang dan catat penyerahan agar kas yang diharapkan pada shift diperbarui.</p>
            <p className="text-amber-800">Satu Draft setoran parsial sekaligus. Shift tidak dapat ditutup sebelum Draft diserahkan atau dibatalkan.</p>
            <ErrorNotice error={create.error} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={create.isPending} onClick={() => setConfirmCreate(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Periksa lagi</button>
            <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {create.isPending ? 'Membuat…' : 'Buat Draft'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function PartialDepositRow({ deposit, shift }: { deposit: CashDeposit; shift: Shift }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<'submit' | 'cancel' | null>(null);
  const mutation = useMutation<CashDeposit | null>({
    mutationFn: async () => {
      if (action === 'submit') return cashDepositApi.submit(deposit.id);
      await cashDepositApi.cancel(deposit.id, 'Draft setoran parsial dibatalkan oleh Kasir.');
      return null;
    },
    onSuccess: () => {
      setAction(null);
      refreshDeposits(qc, shift.id);
    },
    onError: () => setAction(null),
  });

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div>
        <p className="font-mono text-sm font-medium">{deposit.doc_number}</p>
        <p className="text-xs text-slate-500">{STATUS_LABEL[deposit.status]} · {formatDateTime(deposit.created_at)}</p>
        {deposit.note && <p className="mt-1 text-sm text-slate-600">{deposit.note}</p>}
      </div>
      <div className="text-right">
        <p className="text-sm">Setoran <strong className="tabular-nums">{formatRupiah(deposit.deposit_amount)}</strong></p>
        <p className="text-xs text-slate-500">Endapan tersisa: {formatRupiah(deposit.float_kept)}</p>
        {deposit.status === 'draft' && (
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" disabled={mutation.isPending} onClick={() => setAction('cancel')} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-60">Batalkan Draft</button>
            <button type="button" disabled={mutation.isPending} onClick={() => setAction('submit')} className="rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {mutation.isPending ? 'Memproses…' : 'Serahkan'}
            </button>
          </div>
        )}
      </div>
      {mutation.error && <div className="w-full"><ErrorNotice error={mutation.error} /></div>}
      {action && (
        <Modal title={action === 'submit' ? 'Serahkan setoran parsial?' : 'Batalkan Draft setoran?'} onClose={() => !mutation.isPending && setAction(null)}>
          <div className="space-y-2 p-5 text-sm">
            {action === 'submit' ? (
              <>
                <p>Pastikan uang sebesar <strong>{formatRupiah(deposit.deposit_amount)}</strong> diserahkan kepada Finance.</p>
                <p>Setelah diserahkan, setoran mengurangi kas yang diharapkan di shift dan tidak dapat dibatalkan.</p>
              </>
            ) : (
              <p>Draft ini belum mengubah saldo. Pembatalan menghapus Draft dan membuka kemungkinan membuat setoran baru.</p>
            )}
            <ErrorNotice error={mutation.error} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setAction(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Kembali</button>
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {mutation.isPending ? 'Memproses…' : action === 'submit' ? 'Konfirmasi penyerahan' : 'Konfirmasi pembatalan'}
            </button>
          </div>
        </Modal>
      )}
    </li>
  );
}
