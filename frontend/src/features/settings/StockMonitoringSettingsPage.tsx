import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { stockMonitoringApi } from '@/lib/api/endpoints';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { SettingsTitle, pageClass } from './embedded';
import { sameThreshold, validateThreshold } from './stockMonitoringForm';

const QUERY_KEY = ['stock-monitoring'];

export function StockMonitoringSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: stockMonitoringApi.get });
  const [threshold, setThreshold] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (query.data) setThreshold(query.data.low_stock_threshold);
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: () => {
      if (threshold === null) throw new Error('Pengaturan pemantauan stok belum dimuat.');
      return stockMonitoringApi.update(threshold);
    },
    onSuccess: async (setting) => {
      queryClient.setQueryData(QUERY_KEY, setting);
      setThreshold(setting.low_stock_threshold);
      setError('');
      setConfirming(false);
      setSavedNotice(true);
      await queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] });
    },
    onError: () => setConfirming(false),
  });

  if (query.isLoading || !query.data || threshold === null) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded>Ambang pemantauan stok</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-sm text-slate-500">Memuat pengaturan pemantauan stok…</p>}
      </div>
    );
  }

  const mutationError = mutation.error;
  const is422 = mutationError instanceof ApiError && mutationError.status === 422;
  const serverError = mutationError instanceof ApiError && is422
    ? mutationError.errors?.low_stock_threshold?.[0]
    : undefined;

  function review(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    setSavedNotice(false);
    const errors = validateThreshold(threshold ?? '');
    setError(errors.low_stock_threshold ?? '');
    if (!errors.low_stock_threshold) setConfirming(true);
  }

  return (
    <div className={pageClass(embedded, 'max-w-2xl')}>
      <div>
        <SettingsTitle embedded>Ambang pemantauan stok</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">
          Sistem membuat dan memperbarui satu draft Permintaan saat stok jual produk aktif di seluruh lokasi toko mencapai ambang ini.
        </p>
      </div>

      <form onSubmit={review} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        {!is422 && <ErrorNotice error={mutation.error} />}
        {savedNotice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Ambang stok tersimpan. Draft Permintaan otomatis telah disinkronkan.</p>}

        <Field
          label="Ambang stok menipis"
          error={error || serverError}
          hint="Produk dengan stok ≤ ambang ini dipertimbangkan untuk Permintaan. Isi jumlah isi ulang di master produk; nilai 0 tidak dimasukkan."
        >
          <LocalDecimalInput
            className={`${inputCls} w-48 tabular-nums`}
            kind="quantity"
            value={threshold}
            onChange={(value) => {
              setThreshold(value);
              setError('');
              setSavedNotice(false);
            }}
          />
        </Field>

        {confirming ? (
          <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>Mengubah ambang akan menyinkronkan ulang draft Permintaan otomatis. Produk yang tidak lagi memenuhi kriteria dapat dikeluarkan dari draft.</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2">Periksa lagi</button>
              <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">
                {mutation.isPending ? 'Menyimpan…' : 'Simpan ambang'}
              </button>
            </div>
          </div>
        ) : (
          <button type="submit" disabled={mutation.isPending || sameThreshold(threshold, query.data.low_stock_threshold)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            Simpan perubahan
          </button>
        )}
      </form>
    </div>
  );
}
