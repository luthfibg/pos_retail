import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supplierApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { PaymentTerms, Supplier } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import {
  TERMS_LABEL, buildSupplierCreate, buildSupplierUpdate, emptySupplier, validateSupplier, valuesFromSupplier,
  type SupplierErrors, type SupplierFormValues, type SupplierUpdate,
} from './supplierForm';

type Job =
  | { kind: 'create'; input: ReturnType<typeof buildSupplierCreate> }
  | { kind: 'update'; id: number; input: SupplierUpdate };

interface Props {
  supplier?: Supplier;
  onClose: () => void;
}

export function SupplierFormDialog({ supplier, onClose }: Props) {
  const mode = supplier ? 'edit' : 'create';
  const qc = useQueryClient();
  const [values, setValues] = useState<SupplierFormValues>(() => (supplier ? valuesFromSupplier(supplier) : emptySupplier()));
  const [errors, setErrors] = useState<SupplierErrors>({});

  const mutation = useMutation({
    mutationFn: (job: Job) =>
      job.kind === 'create' ? supplierApi.create(job.input) : supplierApi.update(job.id, job.input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    },
  });

  const set = <K extends keyof SupplierFormValues>(key: K, value: SupplierFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const serverErrors: SupplierErrors = {};
  const is422 = mutation.error instanceof ApiError && mutation.error.status === 422;
  if (mutation.error instanceof ApiError && is422) {
    for (const [k, msgs] of Object.entries(mutation.error.errors ?? {})) {
      (serverErrors as Record<string, string>)[k] = msgs[0] ?? '';
    }
  }
  const err = (k: keyof SupplierErrors) => errors[k] ?? serverErrors[k];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();

    const found = validateSupplier(values, mode);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    if (supplier) {
      const input = buildSupplierUpdate(values, supplier);
      if (Object.keys(input).length === 0) { onClose(); return; }
      mutation.mutate({ kind: 'update', id: supplier.id, input });
    } else {
      mutation.mutate({ kind: 'create', input: buildSupplierCreate(values) });
    }
  }

  return (
    <Modal title={supplier ? `Ubah supplier — ${supplier.code}` : 'Supplier baru'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <div className="space-y-4 p-5">
          {!is422 && <ErrorNotice error={mutation.error} />}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Kode" error={err('code')} hint={mode === 'edit' ? 'Tidak dapat diubah.' : undefined}>
              <input
                className={`${inputCls} font-mono`}
                value={values.code}
                disabled={mode === 'edit'}
                onChange={(e) => set('code', e.target.value)}
                autoFocus={mode === 'create'}
              />
            </Field>
            <div className="col-span-2">
              <Field label="Nama supplier" error={err('name')}>
                <input className={inputCls} value={values.name} onChange={(e) => set('name', e.target.value)} autoFocus={mode === 'edit'} />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Nama kontak" error={err('contact_name')}>
              <input className={inputCls} value={values.contactName} onChange={(e) => set('contactName', e.target.value)} />
            </Field>
            <Field label="Telepon" error={err('phone')}>
              <input className={inputCls} inputMode="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
          </div>

          <Field label="Alamat" error={err('address')}>
            <input className={inputCls} value={values.address} onChange={(e) => set('address', e.target.value)} />
          </Field>

          <Field label="Termin pembayaran bawaan" error={err('default_payment_terms')}>
            <select className={inputCls} value={values.terms} onChange={(e) => set('terms', e.target.value as PaymentTerms)}>
              {(Object.keys(TERMS_LABEL) as PaymentTerms[]).map((t) => <option key={t} value={t}>{TERMS_LABEL[t]}</option>)}
            </select>
          </Field>

          {mode === 'edit' && (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} />
                Supplier aktif
              </label>
              {err('is_active') && <p role="alert" className="mt-1 text-xs text-red-700">{err('is_active')}</p>}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
          <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
