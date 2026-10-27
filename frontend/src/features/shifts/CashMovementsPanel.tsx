import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { cashMovementApi } from '@/lib/api/endpoints';
import type { CashMovementType, Shift } from '@/lib/api/types';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { normalizeDecimal } from '@/features/products/productForm';
import { buildCashMovementInput, validateCashMovement, type CashMovementErrors, type CashMovementFormValues } from './cashMovementForm';

const EMPTY_FORM: CashMovementFormValues = { type: 'in', amount: '', reason: '' };
const TYPE_LABEL: Record<CashMovementType, string> = { in: 'Kas masuk', out: 'Kas keluar' };

export function CashMovementsPanel({ shift }: { shift: Shift }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManageCashMovements = can('cash_movement.create');
  const [page, setPage] = useState(1);
  const [values, setValues] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<CashMovementErrors>({});
  const [confirming, setConfirming] = useState(false);

  const query = useQuery({
    queryKey: ['cash-movements', shift.id, page],
    queryFn: () => cashMovementApi.list(shift.id, page),
    enabled: canManageCashMovements,
  });
  const mutation = useMutation({
    mutationFn: () => cashMovementApi.create(shift.id, buildCashMovementInput(values)),
    onSuccess: () => {
      setValues(EMPTY_FORM);
      setErrors({});
      setConfirming(false);
      setPage(1);
      void qc.invalidateQueries({ queryKey: ['cash-movements', shift.id] });
      void qc.invalidateQueries({ queryKey: ['shifts', 'current'] });
      void qc.invalidateQueries({ queryKey: ['shifts', shift.id] });
    },
    onError: () => setConfirming(false),
  });

  const serverErrors = mutation.error instanceof ApiError && mutation.error.status === 422 ? mutation.error.errors ?? {} : {};
  const update = <K extends keyof CashMovementFormValues>(key: K, value: CashMovementFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    mutation.reset();
  };

  function review(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const found = validateCashMovement(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setConfirming(true);
  }

  const movements = query.data?.data ?? [];

  if (!canManageCashMovements) return null;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-semibold">Kas masuk/keluar nonpenjualan</h2>
        <p className="mt-1 text-sm text-slate-600">
          Catat perubahan kas selain transaksi penjualan. Catatan yang sudah disimpan tidak dapat dihapus; koreksi dengan pergerakan berlawanan dan keterangan yang jelas.
        </p>
      </div>

      {shift.status === 'open' ? (
        <form onSubmit={review} noValidate className="grid gap-3 rounded-md bg-slate-50 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><ErrorNotice error={mutation.error} /></div>
          <Field label="Jenis" error={errors.type ?? serverErrors.type?.[0]}>
            <select className={inputCls} value={values.type} onChange={(event) => update('type', event.target.value as CashMovementType)}>
              <option value="in">Kas masuk</option>
              <option value="out">Kas keluar</option>
            </select>
          </Field>
          <Field label="Nominal (Rp)" error={errors.amount ?? serverErrors.amount?.[0]} hint="Tanpa pemisah ribuan, mis. 50000 atau 50000,50.">
            <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.amount} onChange={(event) => update('amount', event.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Keterangan" error={errors.reason ?? serverErrors.reason?.[0]} hint="Wajib, maksimal 255 karakter.">
              <input className={inputCls} maxLength={255} value={values.reason} onChange={(event) => update('reason', event.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              Catat {values.type === 'in' ? 'kas masuk' : 'kas keluar'}
            </button>
          </div>
        </form>
      ) : (
        <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Pencatatan kas hanya tersedia selama shift berstatus Berjalan. Riwayat di bawah tetap dapat dilihat.
        </p>
      )}

      <ErrorNotice error={query.error} />
      {query.isLoading ? (
        <p className="text-sm text-slate-500">Memuat riwayat kas…</p>
      ) : query.error && !query.data ? null : movements.length === 0 ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada kas masuk/keluar nonpenjualan pada shift ini.</p>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-slate-100">
            {movements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium">{TYPE_LABEL[movement.type]} · {movement.created_by_name}</p>
                  <p className="text-slate-600">{movement.reason}</p>
                  <time className="text-xs text-slate-500">{formatDateTime(movement.created_at)}</time>
                </div>
                <span className={`font-semibold tabular-nums ${movement.type === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>
                  {movement.type === 'in' ? '+' : '−'}{formatRupiah(movement.amount)}
                </span>
              </li>
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

      {confirming && (
        <Modal title={`Konfirmasi ${TYPE_LABEL[values.type].toLowerCase()}`} onClose={() => !mutation.isPending && setConfirming(false)}>
          <div className="space-y-2 p-5 text-sm">
            <p>{TYPE_LABEL[values.type]} sebesar <strong>{formatRupiah(normalizeDecimal(values.amount))}</strong>.</p>
            <p>Keterangan: <span className="whitespace-pre-wrap">{values.reason.trim()}</span></p>
            <p className="text-amber-800">Pencatatan tidak dapat dihapus atau diedit. Jika salah, catat pergerakan berlawanan sebagai koreksi.</p>
            <ErrorNotice error={mutation.error} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Periksa lagi</button>
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {mutation.isPending ? 'Mencatat…' : 'Konfirmasi'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
