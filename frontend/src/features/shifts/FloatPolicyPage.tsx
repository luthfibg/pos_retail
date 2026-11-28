import { SettingsTitle, pageClass } from '@/features/settings/embedded';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { floatPolicyApi } from '@/lib/api/endpoints';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import {
  buildFloatPolicyInput,
  validateFloatPolicy,
  valuesFromFloatPolicy,
  type FloatPolicyErrors,
  type FloatPolicyFormValues,
} from './floatPolicyForm';

export function FloatPolicyPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['float-policies'], queryFn: floatPolicyApi.list });
  const saved = query.data?.petty_cash ?? null;
  const [values, setValues] = useState<FloatPolicyFormValues | null>(null);
  const [errors, setErrors] = useState<FloatPolicyErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (query.data) setValues(valuesFromFloatPolicy(saved));
  }, [query.data, saved]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!values) throw new Error('Form kebijakan belum siap.');
      return floatPolicyApi.update('petty_cash', buildFloatPolicyInput(values));
    },
    onSuccess: (policy) => {
      qc.setQueryData(['float-policies'], (current: Awaited<ReturnType<typeof floatPolicyApi.list>> | undefined) =>
        current ? { ...current, petty_cash: policy } : current,
      );
      setValues(valuesFromFloatPolicy(policy));
      setErrors({});
      setConfirming(false);
      setSavedNotice(true);
    },
    onError: () => setConfirming(false),
  });

  if (query.isLoading || !query.data || !values) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded={embedded}>Uang yang disisakan di laci</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-slate-500">Memuat kebijakan…</p>}
      </div>
    );
  }

  const is422 = mutation.error instanceof ApiError && mutation.error.status === 422;
  const apiErrors = mutation.error instanceof ApiError && is422 ? mutation.error.errors ?? {} : {};
  const set = <K extends keyof FloatPolicyFormValues>(key: K, value: FloatPolicyFormValues[K]) => {
    setValues((current) => current ? { ...current, [key]: value } : current);
    setSavedNotice(false);
  };

  function review(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const found = validateFloatPolicy(values!);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setConfirming(true);
  }

  const serverError = (field: string) => apiErrors[field]?.[0];

  return (
    <div className={pageClass(embedded, 'max-w-2xl')}>
      <div>
        <SettingsTitle embedded={embedded}>Uang yang disisakan di laci</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">
          Atur jumlah uang yang ditinggalkan di laci saat kasir jaga ditutup. Sisa uang lainnya akan disetorkan.
        </p>
      </div>

      {!saved ? (
        <div role="note" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Aturan belum ditentukan</p>
          <p className="mt-1">
            Saat ini semua uang yang dihitung kasir tetap berada di laci dan tidak ada jumlah yang disetorkan.
            Isi aturan di bawah agar sistem dapat menghitung jumlah setoran.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-semibold">Aturan laci aktif</p>
          <p className="mt-1">
            {saved.mode === 'fixed'
              ? `Uang yang disisakan: ${formatRupiah(saved.fixed_amount)}`
              : `${formatQty(saved.percent)}% dari ${saved.percent_base === 'cash_sales_shift' ? 'penjualan tunai selama kasir jaga' : 'uang yang dihitung di laci'}`}
            {saved.min_amount !== null && ` · batas minimum ${formatRupiah(saved.min_amount)}`}
            {saved.max_amount !== null && ` · batas maksimum ${formatRupiah(saved.max_amount)}`}
            {` · pembulatan setoran per Rp${formatQty(String(saved.rounding_unit))}`}
          </p>
          <p className="mt-1 text-xs text-emerald-900">Berlaku sejak {formatDateTime(saved.effective_from)}.</p>
        </div>
      )}

      <form onSubmit={review} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        {!is422 && <ErrorNotice error={mutation.error} />}
        {savedNotice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Aturan tersimpan dan berlaku saat kasir jaga berikutnya ditutup.</p>}

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Cara menentukan uang yang disisakan</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="float-mode" checked={values.mode === 'fixed'} onChange={() => set('mode', 'fixed')} />
            Jumlah tetap
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="float-mode" checked={values.mode === 'percent'} onChange={() => set('mode', 'percent')} />
            Persentase
          </label>
        </fieldset>

        {values.mode === 'fixed' ? (
          <Field label="Jumlah yang disisakan (Rp)" error={errors.fixedAmount ?? serverError('fixed_amount')} hint="Sisa uang lainnya akan disetorkan setelah dibulatkan sesuai aturan di bawah.">
            <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.fixedAmount} onChange={(event) => set('fixedAmount', event.target.value)} />
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Persentase (%)" error={errors.percent ?? serverError('percent')}>
              <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.percent} onChange={(event) => set('percent', event.target.value)} />
            </Field>
            <Field label="Dihitung dari" error={errors.percentBase ?? serverError('percent_base')}>
              <select className={inputCls} value={values.percentBase} onChange={(event) => set('percentBase', event.target.value as FloatPolicyFormValues['percentBase'])}>
                <option value="">Pilih sumber perhitungan</option>
                <option value="cash_sales_shift">Penjualan tunai selama kasir jaga</option>
                <option value="cash_on_hand">Uang yang dihitung di laci</option>
              </select>
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Batas minimum uang di laci (opsional, Rp)" error={errors.minAmount ?? serverError('min_amount')} hint="Setoran tidak dibuat jika uang yang dihitung di laci kurang dari jumlah ini.">
            <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.minAmount} onChange={(event) => set('minAmount', event.target.value)} />
          </Field>
          <Field label="Batas maksimum uang yang disisakan (opsional, Rp)" error={errors.maxAmount ?? serverError('max_amount')}>
            <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.maxAmount} onChange={(event) => set('maxAmount', event.target.value)} />
          </Field>
        </div>

        <Field label="Kelipatan pembulatan setoran (Rp)" error={errors.roundingUnit ?? serverError('rounding_unit')} hint="Jumlah setoran dibulatkan ke bawah mengikuti kelipatan ini. Sisa uang tetap di laci. Nilai awal Rp1.000.">
          <input className={`${inputCls} w-48 tabular-nums`} inputMode="numeric" value={values.roundingUnit} onChange={(event) => set('roundingUnit', event.target.value)} />
        </Field>

        <Field label="Alasan perubahan (opsional)" error={serverError('reason')}>
          <textarea className={inputCls} rows={2} maxLength={500} value={values.reason} onChange={(event) => set('reason', event.target.value)} />
        </Field>

        <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          Simpan aturan
        </button>
      </form>

      {confirming && (
        <Modal title="Terapkan aturan uang di laci?" onClose={() => !mutation.isPending && setConfirming(false)}>
          <div className="space-y-2 p-5 text-sm">
            <p>Aturan baru akan langsung menggantikan aturan yang sedang digunakan.</p>
            <p className="text-slate-600">Sistem menghitung jumlah uang yang disisakan dan disetorkan saat kasir jaga ditutup. Kasir jaga yang sudah ditutup tidak berubah.</p>
            <ErrorNotice error={mutation.error} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Kembali</button>
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {mutation.isPending ? 'Menyimpan…' : 'Terapkan'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
