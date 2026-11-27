import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { customerApi } from '@/lib/api/endpoints';
import type { Customer } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDebounce } from '@/hooks/useDebounce';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Pagination } from '@/components/ui/Pagination';
import { formatRupiah } from '@/lib/format';
import { CreditStateBadge } from './CustomerBadges';
import { CustomerFormDialog } from './CustomerFormDialog';
import { CustomerDetailDialog } from './CustomerDetailDialog';
import { CustomerRegistrationPrint } from './CustomerRegistrationPrint';

export function CustomersPage() {
  const { can, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [printCustomer, setPrintCustomer] = useState<Customer | null>(null);
  const debouncedQ = useDebounce(q);
  const isAdmin = me?.roles.includes('Admin') === true;
  const archived = isAdmin && params.get('archived') === '1';

  // ?open=ID membuka detail (dipakai tautan dari notifikasi)
  const openParam = Number(params.get('open'));
  const openId = Number.isInteger(openParam) && openParam > 0 ? openParam : null;

  const showLimits = can('customer.set_limit');
  const canRegisterDebtor = isAdmin && can('customer.create');

  const query = useQuery({
    queryKey: ['customers', 'list', { q: debouncedQ, archived, page }],
    queryFn: () => customerApi.list({ q: debouncedQ || undefined, archived, page }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];

  function setArchived(value: boolean) {
    const next = new URLSearchParams(params);
    if (value) next.set('archived', '1'); else next.delete('archived');
    setParams(next, { replace: true });
    setPage(1);
  }

  function openDetail(id: number | null) {
    const next = new URLSearchParams(params);
    if (id === null) next.delete('open'); else next.set('open', String(id));
    setParams(next, { replace: true });
  }

  function printRegistration(customer: Customer) {
    setPrintCustomer(customer);
    document.body.classList.add('customer-registration-printing');
    window.setTimeout(() => {
      try {
        window.print();
      } finally {
        document.body.classList.remove('customer-registration-printing');
      }
    }, 80);
  }

  const cols = showLimits ? 6 : 5;

  return (
    <>
      <div className="no-print space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Data Debitur</h1>
        {canRegisterDebtor && (
          <button type="button" onClick={() => setCreating(true)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            Debitur baru
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Cari nama atau nomor induk"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        {isAdmin && (
          <div role="tablist" className="flex flex-wrap gap-1">
            {[{ value: false, label: 'Debitur aktif' }, { value: true, label: 'Arsip' }].map((tab) => (
              <button
                key={String(tab.value)}
                type="button"
                role="tab"
                aria-selected={archived === tab.value}
                onClick={() => setArchived(tab.value)}
                className={`rounded-md px-3 py-1.5 text-sm ${archived === tab.value ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white hover:bg-slate-50'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <ErrorNotice error={query.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">No. Induk</th>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Departemen</th>
              <th className="px-3 py-2">Status Kredit</th>
              {showLimits && <th className="px-3 py-2 text-right">Batas</th>}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id} className={archived ? 'text-slate-500' : ''}>
                <td className="px-3 py-2 font-mono text-xs">{c.customer_no}</td>
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 text-slate-600">{c.department ?? '—'}</td>
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
              <tr><td colSpan={cols} className="px-3 py-8 text-center text-slate-500">Tidak ada debitur.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {query.data && (
        <Pagination page={page} lastPage={query.data.last_page} from={query.data.from} to={query.data.to} total={query.data.total} onPage={setPage} />
      )}

      {creating && <CustomerFormDialog onClose={() => setCreating(false)} onPrint={printRegistration} />}
      {openId !== null && <CustomerDetailDialog customerId={openId} onClose={() => openDetail(null)} onPrint={printRegistration} />}
      </div>
      {printCustomer && <CustomerRegistrationPrint customer={printCustomer} />}
    </>
  );
}
