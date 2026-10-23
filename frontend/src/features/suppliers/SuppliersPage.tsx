import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supplierApi } from '@/lib/api/endpoints';
import type { Supplier } from '@/lib/api/types';
import { useDebounce } from '@/hooks/useDebounce';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ActiveBadge } from '@/components/ui/ActiveBadge';
import { Pagination } from '@/components/ui/Pagination';
import { SupplierFormDialog } from './SupplierFormDialog';
import { TERMS_LABEL } from './supplierForm';

export function SuppliersPage() {
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ supplier?: Supplier } | null>(null);
  const debouncedQ = useDebounce(q);

  const query = useQuery({
    queryKey: ['suppliers', { q: debouncedQ, activeOnly, page }],
    queryFn: () => supplierApi.list({ q: debouncedQ || undefined, active_only: activeOnly, page }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Supplier</h1>
        <button type="button" onClick={() => setDialog({})} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          Supplier baru
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Cari kode atau nama"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setPage(1); }} />
          Hanya yang aktif
        </label>
      </div>

      <ErrorNotice error={query.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Kode</th>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Kontak</th>
              <th className="px-3 py-2">Termin</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => (
              <tr key={s.id} className={s.is_active ? '' : 'text-slate-400'}>
                <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                <td className="px-3 py-2">
                  {s.name}
                  {s.address && <div className="text-xs text-slate-400">{s.address}</div>}
                </td>
                <td className="px-3 py-2">
                  {s.contact_name ?? '—'}
                  {s.phone && <div className="text-xs text-slate-400">{s.phone}</div>}
                </td>
                <td className="px-3 py-2">{s.default_payment_terms ? TERMS_LABEL[s.default_payment_terms] : '—'}</td>
                <td className="px-3 py-2"><ActiveBadge active={s.is_active} /></td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => setDialog({ supplier: s })} className="text-sm text-slate-700 underline">Ubah</button>
                </td>
              </tr>
            ))}
            {query.isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Memuat…</td></tr>}
            {!query.isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Tidak ada supplier.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {query.data && (
        <Pagination
          page={page}
          lastPage={query.data.last_page}
          from={query.data.from}
          to={query.data.to}
          total={query.data.total}
          onPage={setPage}
        />
      )}

      {dialog && <SupplierFormDialog supplier={dialog.supplier} onClose={() => setDialog(null)} />}
    </div>
  );
}
