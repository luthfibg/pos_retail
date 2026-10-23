import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { customerApi } from '@/lib/api/endpoints';
import type { CustomerStatus } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDebounce } from '@/hooks/useDebounce';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Pagination } from '@/components/ui/Pagination';
import { formatRupiah } from '@/lib/format';
import { CreditStateBadge, CustomerStatusBadge } from './CustomerBadges';
import { CustomerFormDialog } from './CustomerFormDialog';
import { CustomerDetailDialog } from './CustomerDetailDialog';

const TABS: { value: CustomerStatus | ''; label: string }[] = [
  { value: '', label: 'Semua' },
  { value: 'pending_verification', label: 'Menunggu verifikasi' },
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Nonaktif' },
];

const isStatus = (v: string | null): v is CustomerStatus =>
  v === 'pending_verification' || v === 'active' || v === 'inactive';

export function CustomersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debouncedQ = useDebounce(q);

  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : '';

  // ?open=ID membuka detail (dipakai tautan dari notifikasi)
  const openParam = Number(params.get('open'));
  const openId = Number.isInteger(openParam) && openParam > 0 ? openParam : null;

  const showLimits = can('customer.set_limit');

  const query = useQuery({
    queryKey: ['customers', 'list', { q: debouncedQ, status, page }],
    queryFn: () => customerApi.list({ q: debouncedQ || undefined, status: status || undefined, page }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];

  function setStatus(s: CustomerStatus | '') {
    const next = new URLSearchParams(params);
    if (s) next.set('status', s); else next.delete('status');
    setParams(next, { replace: true });
    setPage(1);
  }
  function openDetail(id: number | null) {
    const next = new URLSearchParams(params);
    if (id === null) next.delete('open'); else next.set('open', String(id));
    setParams(next, { replace: true });
  }

  const cols = showLimits ? 7 : 6;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Karyawan</h1>
        {can('customer.create') && (
          <button type="button" onClick={() => setCreating(true)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            Karyawan baru
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Cari nama atau NIK"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <div role="tablist" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.value || 'all'}
              type="button"
              role="tab"
              aria-selected={status === t.value}
              onClick={() => setStatus(t.value)}
              className={`rounded-md px-3 py-1.5 text-sm ${status === t.value ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white hover:bg-slate-50'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorNotice error={query.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">NIK</th>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Departemen</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Kredit</th>
              {showLimits && <th className="px-3 py-2 text-right">Batas</th>}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id} className={c.status === 'inactive' ? 'text-slate-400' : ''}>
                <td className="px-3 py-2 font-mono text-xs">{c.customer_no}</td>
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 text-slate-600">{c.department ?? '—'}</td>
                <td className="px-3 py-2"><CustomerStatusBadge status={c.status} /></td>
                <td className="px-3 py-2">
                  <CreditStateBadge state={c.credit_state} />
                  {c.credit_remaining !== null && (
                    <div className="mt-0.5 text-xs tabular-nums text-slate-500">Sisa {formatRupiah(c.credit_remaining)}</div>
                  )}
                </td>
                {showLimits && (
                  <td className="px-3 py-2 text-right tabular-nums">{c.credit_limit != null ? formatRupiah(c.credit_limit) : '—'}</td>
                )}
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => openDetail(c.id)} className="text-sm text-slate-700 underline">Detail</button>
                </td>
              </tr>
            ))}
            {query.isLoading && <tr><td colSpan={cols} className="px-3 py-8 text-center text-slate-500">Memuat…</td></tr>}
            {!query.isLoading && rows.length === 0 && (
              <tr><td colSpan={cols} className="px-3 py-8 text-center text-slate-500">Tidak ada karyawan.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {query.data && (
        <Pagination page={page} lastPage={query.data.last_page} from={query.data.from} to={query.data.to} total={query.data.total} onPage={setPage} />
      )}

      {creating && <CustomerFormDialog onClose={() => setCreating(false)} />}
      {openId !== null && <CustomerDetailDialog customerId={openId} onClose={() => openDetail(null)} />}
    </div>
  );
}
