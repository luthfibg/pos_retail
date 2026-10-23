import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customerApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Customer, CustomerStatus } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import {
  buildCustomerCreate, buildCustomerUpdate, emptyCustomer, validateCustomer, valuesFromCustomer,
  type CustomerErrors, type CustomerFormValues, type CustomerUpdate,
} from './customerForm';
import { STATUS_LABEL } from './creditState';

type Job =
  | { kind: 'create'; input: ReturnType<typeof buildCustomerCreate> }
  | { kind: 'update'; id: number; input: CustomerUpdate };

interface Props {
  /** undefined = karyawan baru */
  customer?: Customer;
  onClose: () => void;
}

export function CustomerFormDialog({ customer, onClose }: Props) {
  const mode = customer ? 'edit' : 'create';
  const qc = useQueryClient();
  const [values, setValues] = useState<CustomerFormValues>(() => (customer ? valuesFromCustomer(customer) : emptyCustomer()));
  const [errors, setErrors] = useState<CustomerErrors>({});
  const [created, setCreated] = useState<Customer | null>(null);

  const mutation = useMutation({
    mutationFn: (job: Job) =>
      job.kind === 'create' ? customerApi.create(job.input) : customerApi.update(job.id, job.input),
    onSuccess: (saved, job) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      if (job.kind === 'create') setCreated(saved);
      else onClose();
    },
  });

  const set = <K extends keyof CustomerFormValues>(k: K, v: CustomerFormValues[K]) => setValues((s) => ({ ...s, [k]: v }));

  const is422 = mutation.error instanceof ApiError && mutation.error.status === 422;
  const serverErrors: CustomerErrors = {};
  if (mutation.error instanceof ApiError && is422) {
    for (const [k, msgs] of Object.entries(mutation.error.errors ?? {})) (serverErrors as Record<string, string>)[k] = msgs[0] ?? '';
  }
  const err = (k: keyof CustomerErrors) => errors[k] ?? serverErrors[k];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const found = validateCustomer(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    if (customer) {
      const input = buildCustomerUpdate(values, customer);
      if (Object.keys(input).length === 0) { onClose(); return; }
      mutation.mutate({ kind: 'update', id: customer.id, input });
    } else {
      mutation.mutate({ kind: 'create', input: buildCustomerCreate(values) });
    }
  }

  function addAnother() {
    setCreated(null);
    setValues(emptyCustomer());
    setErrors({});
    mutation.reset();
  }

  if (created) {
    return (
      <Modal title="Karyawan ditambahkan" onClose={onClose}>
        <div className="space-y-3 p-5 text-sm">
          <p><span className="font-medium">{created.name}</span> ({created.customer_no}) tersimpan.</p>
          <p className="rounded-md bg-amber-50 p-3 text-amber-900">
            Status: {STATUS_LABEL[created.status]}. Admin perlu memverifikasi dan menetapkan batas kredit; sebelum itu hanya bisa transaksi tunai.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={addAnother} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Tambah lagi</button>
          <button type="button" onClick={onClose} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Selesai</button>
        </div>
      </Modal>
    );
  }

  const canChangeStatus = mode === 'edit' && customer?.status !== 'pending_verification';

  return (
    <Modal title={customer ? 'Ubah data karyawan' : 'Karyawan baru'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <div className="space-y-4 p-5">
          {!is422 && <ErrorNotice error={mutation.error} />}

          <Field label="Nomor karyawan (NIK)" error={err('customer_no')}>
            <input className={`${inputCls} font-mono`} value={values.customerNo} onChange={(e) => set('customerNo', e.target.value)} autoFocus />
          </Field>
          <Field label="Nama" error={err('name')}>
            <input className={inputCls} value={values.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Departemen (opsional)" error={err('department')}>
            <input className={inputCls} value={values.department} onChange={(e) => set('department', e.target.value)} />
          </Field>

          {canChangeStatus && (
            <Field label="Status" error={err('status')}>
              <select className={inputCls} value={values.status} onChange={(e) => set('status', e.target.value as CustomerStatus)}>
                <option value="active">{STATUS_LABEL.active}</option>
                <option value="inactive">{STATUS_LABEL.inactive}</option>
              </select>
            </Field>
          )}

          {mode === 'edit' && (
            <Field label="Alasan perubahan (opsional)" hint="Tercatat di audit log.">
              <input className={inputCls} value={values.reason} maxLength={500} onChange={(e) => set('reason', e.target.value)} />
            </Field>
          )}

          {mode === 'create' && (
            <p className="text-xs text-slate-500">Karyawan baru berstatus “Menunggu verifikasi” dan hanya bisa transaksi tunai sampai Admin memverifikasi.</p>
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
