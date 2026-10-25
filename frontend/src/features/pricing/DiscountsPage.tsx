import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { discountApi } from '@/lib/api/endpoints';
import type { Discount, DiscountStatus, DiscountTarget } from '@/lib/api/types';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Pagination } from '@/components/ui/Pagination';
import { formatDate, formatRupiah, toWibDate } from '@/lib/format';
import { DiscountFormDialog } from './DiscountFormDialog';
import { STATUS_CLS, STATUS_LABEL, TARGET_LABEL, describeValue } from './discountForm';

const TABS: { value: DiscountTarget | ''; label: string }[] = [
  { value: '', label: 'Semua' },
  { value: 'product', label: 'Produk' },
  { value: 'category', label: 'Kategori' },
];

function StatusBadge({ status }: { status: DiscountStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function DiscountsPage() {
  const [target, setTarget] = useState<DiscountTarget | ''>('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ discount?: Discount } | null>(null);

  const query = useQuery({
    queryKey: ['discounts', { target, activeOnly, page }],
    queryFn: () => discountApi.list({ target_type: target || undefined, active_only: activeOnly, page }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Diskon</h1>
        <button type="button" onClick={() => setDialog({})} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Diskon baru</button>
      </div>
      <p className="max-w-2xl text-sm text-slate-600">
        Hanya Admin yang mengatur diskon; kasir tidak dapat mengubah harga atau diskon. Di kasir, diskon yang sedang berlaku dan paling besar
        (produk atau kategori) dipilih otomatis.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.value || 'all'}
              type="button"
              role="tab"
              aria-selected={target === t.value}
              onClick={() => { setTarget(t.value); setPage(1); }}
              className={`rounded-md px-3 py-1.5 text-sm ${target === t.value ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white hover:bg-slate-50'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setPage(1); }} />
          Hanya yang aktif (tidak dinonaktifkan)
        </label>
      </div>

      <ErrorNotice error={query.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Berlaku untuk</th>
              <th className="px-3 py-2">Potongan</th>
              <th className="px-3 py-2">Periode (WIB)</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((d) => (
              <tr key={d.id} className={d.status === 'inactive' || d.status === 'expired' ? 'text-slate-400' : ''}>
                <td className="px-3 py-2">{d.name}</td>
                <td className="px-3 py-2">
                  {d.target_name ?? '—'}
                  <div className="text-xs text-slate-400">{TARGET_LABEL[d.target_type]}</div>
                </td>
                <td className="px-3 py-2 tabular-nums">{describeValue(d.discount_type, d.value, formatRupiah)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {formatDate(toWibDate(d.starts_at))} – {d.ends_at ? formatDate(toWibDate(d.ends_at)) : 'tanpa batas'}
                </td>
                <td className="px-3 py-2"><StatusBadge status={d.status} /></td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => setDialog({ discount: d })} className="text-sm text-slate-700 underline">Ubah</button>
                </td>
              </tr>
            ))}
            {query.isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Memuat…</td></tr>}
            {!query.isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Belum ada diskon.</td></tr>}
          </tbody>
        </table>
      </div>

      {query.data && (
        <Pagination page={page} lastPage={query.data.last_page} from={query.data.from} to={query.data.to} total={query.data.total} onPage={setPage} />
      )}

      {dialog && <DiscountFormDialog discount={dialog.discount} onClose={() => setDialog(null)} />}
    </div>
  );
}
