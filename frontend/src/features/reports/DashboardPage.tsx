import { useState, type FormEvent } from 'react';
import { formatDate } from '@/lib/format';
import { Field, inputCls } from '@/components/ui/Field';
import { validateDashboardFilters } from './dashboardFilters';
import { DashboardMenuSummaries } from './DashboardMenuSummaries';

function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());
}

export function DashboardPage() {
  const today = todayWib();
  const [filters, setFilters] = useState({ dateFrom: today, dateTo: today });
  const [applied, setApplied] = useState({ dateFrom: today, dateTo: today });
  const [filterError, setFilterError] = useState<string | null>(null);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateDashboardFilters({ ...filters, cashierId: '' });
    setFilterError(error);
    if (error) return;
    setApplied({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ringkasan barang masuk dan keluar, laporan Kasir Jaga, tagihan, serta retur.
        </p>
      </header>

      <form onSubmit={applyFilters} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <Field label="Tanggal awal">
          <input
            className={inputCls}
            type="date"
            value={filters.dateFrom}
            onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
          />
        </Field>
        <Field label="Tanggal akhir">
          <input
            className={inputCls}
            type="date"
            value={filters.dateTo}
            onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
          />
        </Field>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Terapkan
        </button>
        {filterError && <p role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-full">{filterError}</p>}
      </form>

      <p className="text-sm text-slate-500">
        Periode barang dan Kasir Jaga: {formatDate(applied.dateFrom)} – {formatDate(applied.dateTo)}.
        Tagihan memakai bulan dan tahun berjalan; retur menampilkan jumlah seluruh retur supplier.
      </p>
      <DashboardMenuSummaries applied={applied} />
    </div>
  );
}
