import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { formatDate, formatQty } from '@/lib/format';
import { buildVatInput, isVatDirty, validateVat, valuesFromVat, type VatErrors, type VatFormValues } from './vatForm';

export function VatSettingsPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings', 'vat'], queryFn: settingsApi.vat });
  const saved = query.data;

  const [values, setValues] = useState<VatFormValues | null>(null);
  const [errors, setErrors] = useState<VatErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // isi form dari pengaturan tersimpan (sekali per versi data yang dimuat)
  useEffect(() => { if (saved) setValues(valuesFromVat(saved)); }, [saved]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!values) throw new Error('Form belum siap.');
      return settingsApi.saveVat(buildVatInput(values));
    },
    onSuccess: (data) => {
      qc.setQueryData(['settings', 'vat'], data);
      setValues(valuesFromVat(data));
      setConfirming(false);
      setSavedNotice(true);
    },
    onError: () => setConfirming(false),
  });

  const is422 = mutation.error instanceof ApiError && mutation.error.status === 422;
  const serverErrors: VatErrors = {};
  if (mutation.error instanceof ApiError && is422) {
    const e = mutation.error.errors ?? {};
    if (e.rate?.[0]) serverErrors.rate = e.rate[0];
    if (e.price_includes_tax?.[0]) serverErrors.price_includes_tax = e.price_includes_tax[0];
  }

  if (query.isLoading || !saved || !values) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">Pengaturan PPN</h1>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-slate-500">Memuat…</p>}
      </div>
    );
  }

  const dirty = isVatDirty(values, saved);
  const set = <K extends keyof VatFormValues>(k: K, v: VatFormValues[K]) => { setValues((s) => (s ? { ...s, [k]: v } : s)); setSavedNotice(false); };

  function review(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending || !values) return;
    mutation.reset();
    const found = validateVat(values);
    setErrors(found);
    if (Object.keys(found).length > 0 || !dirty) return;
    setConfirming(true);
  }

  return (
    <div className="max-w-2xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Pengaturan PPN</h1>
        <p className="mt-1 text-sm text-slate-600">
          Mengatur PPN untuk penjualan tunai dan invoice HRD. Penjualan kredit karyawan tidak dikenai PPN di struk; PPN kredit dihitung saat invoice.
        </p>
      </div>

      <div role="note" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Tarif, status “harga sudah termasuk PPN”, dan status PKP masih menunggu konfirmasi klien (R-04). Ubah hanya setelah nilainya pasti.
        PPN aktif tetapi belum lengkap membuat penjualan tunai dan pembuatan invoice ditolak.
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div className="font-medium">Pengaturan saat ini</div>
        {saved.enabled ? (
          <p className="mt-1 text-slate-700">
            PPN <span className="font-semibold">aktif</span>, tarif {saved.rate ? `${formatQty(saved.rate)}%` : '—'},{' '}
            {saved.price_includes_tax === null ? 'status harga belum diisi' : saved.price_includes_tax ? 'harga jual sudah termasuk PPN' : 'PPN ditambahkan di atas harga jual'}
            {saved.effective_from ? `, berlaku sejak ${formatDate(saved.effective_from)}` : ''}.
          </p>
        ) : (
          <p className="mt-1 text-slate-700">PPN <span className="font-semibold">nonaktif</span>. Total penjualan tunai = harga setelah diskon.</p>
        )}
      </div>

      <form onSubmit={review} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        {!is422 && <ErrorNotice error={mutation.error} />}
        {savedNotice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Pengaturan PPN tersimpan.</p>}

        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={values.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Aktifkan PPN
        </label>

        {values.enabled && (
          <>
            <Field label="Tarif PPN (%)" error={errors.rate ?? serverErrors.rate} hint="mis. 11">
              <input className={`${inputCls} w-40 tabular-nums`} inputMode="decimal" value={values.rate} onChange={(e) => set('rate', e.target.value)} />
            </Field>

            <fieldset>
              <legend className="mb-1 text-sm font-medium">Harga jual di sistem</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="includes" checked={values.includes === true} onChange={() => set('includes', true)} />
                Sudah termasuk PPN (PPN dihitung dari dalam harga)
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input type="radio" name="includes" checked={values.includes === false} onChange={() => set('includes', false)} />
                Belum termasuk PPN (PPN ditambahkan di atas harga)
              </label>
              {(errors.price_includes_tax ?? serverErrors.price_includes_tax) && (
                <p role="alert" className="mt-1 text-xs text-red-700">{errors.price_includes_tax ?? serverErrors.price_includes_tax}</p>
              )}
            </fieldset>
          </>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={mutation.isPending || !dirty} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Simpan
          </button>
          {!dirty && <span className="text-sm text-slate-500">Tidak ada perubahan.</span>}
        </div>
      </form>

      {confirming && (
        <Modal title="Simpan pengaturan PPN?" onClose={() => { if (!mutation.isPending) setConfirming(false); }}>
          <div className="space-y-2 p-5 text-sm">
            <p>
              {values.enabled
                ? `PPN akan diaktifkan dengan tarif ${values.rate.trim()}% (${values.includes ? 'harga sudah termasuk PPN' : 'ditambahkan di atas harga'}).`
                : 'PPN akan dinonaktifkan. Riwayat tarif tetap tersimpan.'}
            </p>
            <p className="text-slate-600">Berlaku mulai hari ini untuk penjualan tunai berikutnya dan invoice yang dibuat setelahnya. Struk yang sudah terposting tidak berubah.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Periksa lagi</button>
            <button type="button" disabled={mutation.isPending} onClick={() => { if (!mutation.isPending) mutation.mutate(); }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
