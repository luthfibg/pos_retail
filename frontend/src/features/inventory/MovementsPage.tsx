import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { inventoryApi, productApi } from '@/lib/api/endpoints';
import type { MovementType } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Pagination } from '@/components/ui/Pagination';
import { inputCls } from '@/components/ui/Field';
import { ProductPicker } from '@/features/products/ProductPicker';
import { formatDate, formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { MOVEMENT_LABEL, bucketLabel, directionOf } from './movementLabels';

const DIRECTION_TEXT = { in: 'Masuk', out: 'Keluar', move: 'Pindah' } as const;
const DIRECTION_CLS = {
  in: 'text-emerald-700',
  out: 'text-red-700',
  move: 'text-slate-700',
} as const;

export function MovementsPage() {
  const { can } = useAuth();
  const showCost = can('inventory.adjust.approve');
  const [params, setParams] = useSearchParams();

  const productIdParam = Number(params.get('product_id'));
  const productId = Number.isInteger(productIdParam) && productIdParam > 0 ? productIdParam : undefined;

  const [type, setType] = useState<MovementType | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const selected = useQuery({
    queryKey: ['products', productId],
    queryFn: () => productApi.get(productId as number),
    enabled: productId !== undefined,
  });

  const rangeInvalid = Boolean(dateFrom && dateTo && dateTo < dateFrom);

  const query = useQuery({
    queryKey: ['inventory', 'movements', { productId, type, dateFrom, dateTo, page }],
    queryFn: () =>
      inventoryApi.movements({
        product_id: productId,
        movement_type: type || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
      }),
    enabled: !rangeInvalid,
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];
  const cols = showCost ? 8 : 7;

  function setProduct(id: number | undefined) {
    const next = new URLSearchParams(params);
    if (id === undefined) next.delete('product_id');
    else next.set('product_id', String(id));
    setParams(next, { replace: true });
    setPage(1);
  }

  const pickerValue = selected.data
    ? { id: selected.data.id, sku: selected.data.sku, name: selected.data.name, unit_name: selected.data.unit_name, track_expiry: selected.data.track_expiry }
    : null;

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">Riwayat Stok</h1>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <span className="mb-1 block text-xs font-medium text-slate-600">Produk</span>
          {productId !== undefined && !pickerValue ? (
            <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">Memuat produk…</div>
          ) : (
            <ProductPicker value={pickerValue} onChange={(p) => setProduct(p?.id)} includeInactive placeholder="Semua produk" />
          )}
        </div>
        <label className="text-xs font-medium text-slate-600">
          <span className="mb-1 block">Jenis</span>
          <select className={`${inputCls} w-56`} value={type} onChange={(e) => { setType(e.target.value as MovementType | ''); setPage(1); }}>
            <option value="">Semua jenis</option>
            {(Object.keys(MOVEMENT_LABEL) as MovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          <span className="mb-1 block">Dari tanggal</span>
          <input type="date" className={inputCls} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          <span className="mb-1 block">Sampai tanggal</span>
          <input type="date" className={inputCls} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </label>
      </div>

      {rangeInvalid && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Tanggal akhir tidak boleh sebelum tanggal awal.
        </div>
      )}
      <ErrorNotice error={query.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Waktu (WIB)</th>
              <th className="px-3 py-2">Jenis</th>
              <th className="px-3 py-2">Produk</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Arah</th>
              <th className="px-3 py-2 text-right">Qty</th>
              {showCost && <th className="px-3 py-2 text-right">HPP</th>}
              <th className="px-3 py-2">Oleh</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => {
              const dir = directionOf(m);
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(m.occurred_at)}</td>
                  <td className="px-3 py-2">
                    {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}
                    {m.ref_type && m.ref_id !== null && <div className="text-xs text-slate-400">{m.ref_type} #{m.ref_id}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {m.product_name}
                    <div className="font-mono text-xs text-slate-400">{m.sku}</div>
                  </td>
                  <td className="px-3 py-2">
                    {m.batch_code ?? '—'}
                    {m.expiry_date && <div className="text-xs text-slate-400">Exp {formatDate(m.expiry_date)}</div>}
                  </td>
                  <td className={`px-3 py-2 ${DIRECTION_CLS[dir]}`}>
                    <span className="font-medium">{DIRECTION_TEXT[dir]}</span>
                    <div className="text-xs">
                      {dir === 'in' && bucketLabel(m.to_bucket)}
                      {dir === 'out' && bucketLabel(m.from_bucket)}
                      {dir === 'move' && `${bucketLabel(m.from_bucket)} → ${bucketLabel(m.to_bucket)}`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQty(m.qty)}</td>
                  {showCost && <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(m.unit_cost)}</td>}
                  <td className="px-3 py-2 text-slate-600">{m.created_by_name ?? '—'}</td>
                </tr>
              );
            })}
            {query.isLoading && <tr><td colSpan={cols} className="px-3 py-8 text-center text-slate-500">Memuat…</td></tr>}
            {!query.isLoading && rows.length === 0 && !rangeInvalid && (
              <tr><td colSpan={cols} className="px-3 py-8 text-center text-slate-500">Belum ada pergerakan untuk filter ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {query.data && (
        <Pagination page={page} lastPage={query.data.last_page} from={query.data.from} to={query.data.to} total={query.data.total} onPage={setPage} />
      )}
    </div>
  );
}
