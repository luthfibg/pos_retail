import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customerApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Customer, CustomerInput } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import {
  buildCustomerCreate, buildCustomerUpdate, emptyCustomer, PAYMENT_STATUS, validateCustomer, valuesFromCustomer,
  type CustomerErrors, type CustomerFormValues,
} from './customerForm';

type Props = {
  customer?: Customer;
  onClose: () => void;
  onPrint: (customer: Customer) => void;
};

type TextFieldKey = Exclude<keyof CustomerInput, 'employment_type'>;
type CustomerJob =
  | { kind: 'create'; input: CustomerInput }
  | { kind: 'update'; id: number; input: Partial<CustomerInput> };

const textFields: Array<{ key: TextFieldKey; label: string; type?: string }> = [
  { key: 'ktp_no', label: 'Nomor KTP' },
  { key: 'customer_no', label: 'Nomor Induk Karyawan' },
  { key: 'name', label: 'Nama Lengkap Sesuai KTP' },
  { key: 'phone', label: 'Nomor Telepon/HP', type: 'tel' },
  { key: 'address', label: 'Alamat Lengkap Sesuai KTP' },
  { key: 'domicile', label: 'Domisili Sekarang' },
  { key: 'company_name', label: 'Nama Perusahaan Bekerja Saat Ini' },
  { key: 'position', label: 'Jabatan' },
  { key: 'department', label: 'Departemen/Divisi' },
  { key: 'employment_start_date', label: 'Mulai Bekerja', type: 'date' },
  { key: 'hrd_name', label: 'Nama HRD' },
  { key: 'hrd_phone', label: 'Nomor Telepon/HP HRD', type: 'tel' },
  { key: 'supervisor_name', label: 'Nama Atasan Langsung' },
  { key: 'supervisor_phone', label: 'Nomor Telepon/HP Atasan Langsung', type: 'tel' },
];

export function CustomerFormDialog({ customer, onClose, onPrint }: Props) {
  const isEditing = customer !== undefined;
  const queryClient = useQueryClient();
  const [values, setValues] = useState<CustomerFormValues>(() => customer ? valuesFromCustomer(customer) : emptyCustomer());
  const [errors, setErrors] = useState<CustomerErrors>({});
  const [created, setCreated] = useState<Customer | null>(null);

  const mutation = useMutation({
    mutationFn: (job: CustomerJob) => job.kind === 'create'
      ? customerApi.create(job.input)
      : customerApi.update(job.id, job.input),
    onSuccess: (saved, job) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (job.kind === 'update') onClose();
      else setCreated(saved);
    },
  });

  const set = <K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const is422 = mutation.error instanceof ApiError && mutation.error.status === 422;
  const serverErrors: Record<string, string> = {};
  if (is422 && mutation.error instanceof ApiError) {
    for (const [field, messages] of Object.entries(mutation.error.errors ?? {})) {
      serverErrors[field] = messages[0] ?? '';
    }
  }
  const errorFor = (key: keyof CustomerInput) => errors[key] ?? serverErrors[key];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const found = validateCustomer(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (customer) mutation.mutate({ kind: 'update', id: customer.id, input: buildCustomerUpdate(values, customer) });
    else {
      const input = buildCustomerCreate(values);
      if (!input) {
        setErrors((current) => ({ ...current, employment_type: 'Wajib diisi.' }));
        return;
      }
      mutation.mutate({ kind: 'create', input });
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
      <Modal title="Pendaftaran debitur berhasil" onClose={onClose}>
        <div className="space-y-3 p-5 text-sm">
          <p><strong>{created.name}</strong> berhasil didaftarkan sebagai debitur.</p>
          <p className="rounded-md bg-slate-50 p-3 text-slate-700">
            Bukti pendaftaran dapat dicetak untuk ditandatangani pemohon, atasan langsung, HRD, dan perusahaan.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={addAnother} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Daftarkan debitur lain</button>
          <button type="button" onClick={() => onPrint(created)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cetak bukti</button>
          <button type="button" onClick={onClose} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Selesai</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={isEditing ? 'Ubah data debitur' : 'Pendaftaran debitur baru'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          {!is422 && <ErrorNotice error={mutation.error} />}
          <section className="grid gap-4 sm:grid-cols-2">
            {textFields.map(({ key, label, type }) => (
              <div key={key} className={key === 'address' || key === 'domicile' ? 'sm:col-span-2' : undefined}>
                <Field label={label} error={errorFor(key)}>
                  {key === 'address' || key === 'domicile' ? (
                    <textarea className={inputCls} rows={2} value={values[key]} onChange={(event) => set(key, event.target.value)} />
                  ) : (
                    <input
                      className={inputCls}
                      type={type ?? 'text'}
                      inputMode={key === 'ktp_no' ? 'numeric' : undefined}
                      maxLength={key === 'ktp_no' ? 16 : undefined}
                      value={values[key]}
                      onChange={(event) => set(key, event.target.value)}
                      autoFocus={key === 'ktp_no' && !isEditing}
                    />
                  )}
                </Field>
              </div>
            ))}
            <Field label="Status Karyawan" error={errorFor('employment_type')}>
              <select className={inputCls} value={values.employment_type} onChange={(event) => set('employment_type', event.target.value as CustomerFormValues['employment_type'])}>
                <option value="">Pilih status karyawan</option>
                <option value="permanent">Tetap</option>
                <option value="contract">Kontrak</option>
              </select>
            </Field>
            <Field label="Status Pembayaran">
              <input className={`${inputCls} bg-slate-100 text-slate-600`} value={PAYMENT_STATUS} disabled readOnly />
            </Field>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
          <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {mutation.isPending ? 'Menyimpan…' : isEditing ? 'Simpan perubahan' : 'Daftarkan debitur'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
