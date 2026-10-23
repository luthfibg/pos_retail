import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { shiftApi } from '@/lib/api/endpoints';
import type { Shift, ShiftStatus } from '@/lib/api/types';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Pagination } from '@/components/ui/Pagination';
import { inputCls } from '@/components/ui/Field';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { ShiftStatusBadge, VarianceText } from './ShiftParts';
import { ShiftReviewDialog } from './ShiftReviewDialog';
import { SHIFT_STATUS_LABEL } from './shiftLogic';

export function ShiftsAdminPage() {
  const [status, setStatus] = useState<ShiftStatus | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Shift | null>(null);

  const rangeInvalid = Boolean(dateFrom && dateTo && dateTo < dateFrom);

  const query = useQuery({
    queryKey: ['shifts', 'list', { status, dateFrom, dateTo, page }],
    queryFn: () => shiftApi.list({ status: status || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, page }),
    enabled: !rangeInvalid,
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Tinjau Shift</h1>
        <p className="mt-1 text-sm text-slate-600">Shift yang sudah ditutup menunggu tinjauan Admin. Selisih kas ditampilkan sebagai teks dan nominal.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">
          <span className="mb-1 block">Status</span>
          <select className={`${inputCls} w-64`} value={status} onChange={(e) => { setStatus(e.target.value as ShiftStatus | ''); setPage(1); }}>
            <option value="">Semua status</option>
            {(Object.keys(SHIFT_STATUS_LABEL) as ShiftStatus[]).map((s) => <option key={s} value={s}>{SHIFT_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          <span className="mb-1 block">Dibuka dari</span>
          <input type="date" className={inputCls} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          <span className="mb-1 block">Sampai</span>
          <input type="date" className={inputCls} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </label>
      </div>

      {rangeInvalid && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Tanggal akhir tidak boleh sebelum tanggal awal.</div>
      )}
      <ErrorNotice error={query.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Shift</th>
              <th className="px-3 py-2">Kasir</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Dibuka</th>
              <th className="px-3 py-2 text-right">Diharapkan</th>
              <th className="px-3 py-2 text-right">Terhitung</th>
              <th className="px-3 py-2">Selisih</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 font-mono text-xs">{s.doc_number}</td>
                <td className="px-3 py-2">{s.cashier_name}</td>
                <td className="px-3 py-2"><ShiftStatusBadge status={s.status} /></td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(s.opened_at)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.expected_cash !== null ? formatRupiah(s.expected_cash) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.counted_cash !== null ? formatRupiah(s.counted_cash) : '—'}</td>
                <td className="px-3 py-2"><VarianceText value={s.variance} /></td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => setSelected(s)} className="text-sm text-slate-700 underline">
                    {s.status === 'closed' ? 'Tinjau' : 'Detail'}
                  </button>
                </td>
              </tr>
            ))}
            {query.isLoading && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Memuat…</td></tr>}
            {!query.isLoading && rows.length === 0 && !rangeInvalid && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Belum ada shift.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {query.data && (
        <Pagination page={page} lastPage={query.data.last_page} from={query.data.from} to={query.data.to} total={query.data.total} onPage={setPage} />
      )}

      {selected && <ShiftReviewDialog shift={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
