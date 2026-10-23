import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { categoryApi, productApi } from '@/lib/api/endpoints';
import type { ProductStatus } from '@/lib/api/types';
import { formatQty, formatRupiah } from '@/lib/format';
import { useDebounce } from '@/hooks/useDebounce';
import { StockBadge } from '@/components/ui/StockBadge';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { useAuth } from '@/features/auth/AuthProvider';
import type { Product } from '@/lib/api/types';
import { ProductFormDialog } from './ProductFormDialog';
import { ProductStockDialog } from '@/features/inventory/ProductStockDialog';

const STATUS_LABEL: Record<ProductStatus, string> = {
  active: 'Aktif',
  pending_price: 'Menunggu harga',
  inactive: 'Nonaktif',
};

export function ProductsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ProductStatus | ''>('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounce(q);
  const { can } = useAuth();
  const [dialog, setDialog] = useState<{ product?: Product } | null>(null);
  const canEdit = can('product.update');
  const [stockOf, setStockOf] = useState<Product | null>(null);

  const categories = useQuery({ queryKey: ['categories', 'all'], queryFn: () => categoryApi.list() });

  const products = useQuery({
    queryKey: ['products', { q: debouncedQ, status, categoryId, page }],
    queryFn: () =>
      productApi.list({
        q: debouncedQ || undefined,
        status: status || undefined,
        category_id: categoryId || undefined,
        page,
      }),
    placeholderData: keepPreviousData,
  });

  const rows = products.data?.data ?? [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Produk</h1>
        {can('product.create') && (
          <button
            type="button"
            onClick={() => setDialog({})}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Produk baru
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Cari nama, SKU, atau barcode"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={categoryId}
          onChange={(e) => { setCategoryId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
        >
          <option value="">Semua kategori</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={status}
          onChange={(e) => { setStatus(e.target.value as ProductStatus | ''); setPage(1); }}
        >
          <option value="">Semua status</option>
          {(Object.keys(STATUS_LABEL) as ProductStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <ErrorNotice error={products.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Kategori</th>
              <th className="px-3 py-2 text-right">Harga jual</th>
              <th className="px-3 py-2 text-right">Stok</th>
              <th className="px-3 py-2">Kondisi stok</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-mono text-xs">
                  {p.sku}
                  <div className="text-slate-400">{p.barcode}</div>
                </td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2 text-slate-600">{p.category_name ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(p.sell_price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(p.stock_sellable)} {p.unit_name}</td>
                <td className="px-3 py-2"><StockBadge status={p.stock_status} /></td>
                <td className="px-3 py-2 text-slate-600">{STATUS_LABEL[p.status]}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button type="button" onClick={() => setStockOf(p)} className="text-sm text-slate-700 underline">Stok</button>
                  {canEdit && (
                    <button type="button" onClick={() => setDialog({ product: p })} className="ml-3 text-sm text-slate-700 underline">Ubah</button>
                  )}
                </td>
              </tr>
            ))}
            {!products.isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Tidak ada produk.</td></tr>
            )}
            {products.isLoading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Memuat…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {products.data && products.data.last_page > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            {products.data.from}–{products.data.to} dari {products.data.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= products.data.last_page}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
            >
              Berikutnya
            </button>
          </div>
        </div>
      )}

      {stockOf && <ProductStockDialog product={stockOf} onClose={() => setStockOf(null)} />}
      {dialog && <ProductFormDialog product={dialog.product} onClose={() => setDialog(null)} />}
    </div>
  );
}
