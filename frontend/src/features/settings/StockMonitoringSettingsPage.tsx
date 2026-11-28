import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { stockMonitoringApi } from '@/lib/api/endpoints';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { SettingsTitle, pageClass } from './embedded';
import { sameThreshold, validateThreshold } from './stockMonitoringForm';
import { useAuth } from '@/features/auth/AuthProvider';
import type { PurchaseOrderResetPeriod } from '@/lib/api/types';

const QUERY_KEY = ['stock-monitoring'];

export function StockMonitoringSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: stockMonitoringApi.get });
  const [threshold, setThreshold] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [resetPeriod, setResetPeriod] = useState<PurchaseOrderResetPeriod>('week');
  const [resetPreview, setResetPreview] = useState<Awaited<ReturnType<typeof stockMonitoringApi.previewPurchaseOrderReset>> | null>(null);
  const [resetResult, setResetResult] = useState<Awaited<ReturnType<typeof stockMonitoringApi.resetPurchaseOrderWorkflow>> | null>(null);
  const isAdmin = me?.roles.includes('Admin') ?? false;

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

  const previewReset = useMutation({
    mutationFn: () => stockMonitoringApi.previewPurchaseOrderReset(resetPeriod),
    onSuccess: (preview) => {
      setResetPreview(preview);
      setResetResult(null);
    },
  });

  const resetWorkflow = useMutation({
    mutationFn: () => stockMonitoringApi.resetPurchaseOrderWorkflow(resetPeriod),
    onSuccess: async (result) => {
      setResetResult(result);
      setResetPreview(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] }),
        queryClient.invalidateQueries({ queryKey: ['goods-receipts'] }),
      ]);
    },
  });

  if (query.isLoading || !query.data || threshold === null) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded>Batas stok untuk pemantauan</SettingsTitle>
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
        <SettingsTitle embedded>Batas stok untuk pemantauan</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">
          Jika jumlah stok barang aktif di seluruh lokasi sama dengan atau kurang dari batas ini, sistem akan membuat atau memperbarui draf permintaan pembelian otomatis.
        </p>
      </div>

      <form onSubmit={review} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        {!is422 && <ErrorNotice error={mutation.error} />}
        {savedNotice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Batas stok tersimpan. Draf permintaan pembelian otomatis telah diperbarui.</p>}

        <Field
          label="Batas stok rendah"
          error={error || serverError}
          hint="Barang dengan stok sama dengan atau kurang dari batas ini masuk ke permintaan pembelian otomatis. Atur jumlah stok yang ingin ditambahkan pada data barang; jumlah 0 tidak akan dimasukkan."
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
            <p>Mengubah batas ini akan memperbarui draf (permintaan yang belum diajukan). Barang yang tidak lagi memenuhi batas akan dikeluarkan dari draf.</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2">Kembali</button>
              <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">
                {mutation.isPending ? 'Menyimpan…' : 'Simpan batas'}
              </button>
            </div>
          </div>
        ) : (
          <button type="submit" disabled={mutation.isPending || sameThreshold(threshold, query.data.low_stock_threshold)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            Simpan perubahan
          </button>
        )}
      </form>

      {isAdmin && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="purchase-order-reset-title">
          <div>
            <h2 id="purchase-order-reset-title" className="font-semibold text-slate-900">Batalkan atau tutup pesanan pembelian</h2>
            <p className="mt-1 text-sm text-slate-600">
              Catatan tidak dihapus. Pesanan yang belum menerima barang akan dibatalkan; pesanan yang baru menerima sebagian barang akan ditutup dan sisa barangnya dibatalkan. Draf penerimaan barang yang belum selesai juga dibatalkan, kecuali masih ada proses pengembalian barang ke pemasok.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Rentang waktu">
              <select
                className={inputCls}
                value={resetPeriod}
                onChange={(event) => {
                  setResetPeriod(event.target.value as PurchaseOrderResetPeriod);
                  setResetPreview(null);
                  setResetResult(null);
                  previewReset.reset();
                  resetWorkflow.reset();
                }}
              >
                <option value="day">1 hari terakhir</option>
                <option value="week">1 minggu terakhir</option>
                <option value="month">1 bulan terakhir</option>
                <option value="all_time">Semua waktu</option>
              </select>
            </Field>
            <button
              type="button"
              disabled={previewReset.isPending || resetWorkflow.isPending}
              onClick={() => previewReset.mutate()}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {previewReset.isPending ? 'Memeriksa…' : 'Tinjau pesanan'}
            </button>
          </div>

          <ErrorNotice error={previewReset.error ?? resetWorkflow.error} />

          {resetPreview && (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
              <p>
                Ditemukan {resetPreview.total_po_count} pesanan pembelian: {resetPreview.cancel_count} akan dibatalkan, {resetPreview.close_partial_count} akan ditutup, dan {resetPreview.skipped_po_count} dilewati karena masih ada proses pengembalian barang ke pemasok.
              </p>
              {resetPreview.draft_receipts_to_cancel > 0 && (
                <p>{resetPreview.draft_receipts_to_cancel} draf penerimaan barang yang belum selesai akan dibatalkan.</p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={resetWorkflow.isPending || (resetPreview.cancel_count + resetPreview.close_partial_count === 0)}
                  onClick={() => resetWorkflow.mutate()}
                  className="rounded-md bg-red-700 px-3 py-2 font-medium text-white disabled:opacity-60"
                >
                  {resetWorkflow.isPending ? 'Memproses…' : 'Konfirmasi pembatalan'}
                </button>
              </div>
            </div>
          )}

          {resetResult && (
            <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
              Selesai: {resetResult.cancelled_po_count} pesanan pembelian dibatalkan, {resetResult.closed_partial_po_count} ditutup, {resetResult.cancelled_gr_count} draf penerimaan barang dibatalkan, dan {resetResult.skipped_po_count} dilewati karena pengembalian barang ke pemasok masih diproses. Daftar pemantauan stok telah diperbarui.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
