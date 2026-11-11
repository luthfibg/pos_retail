import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ApiError } from '@/lib/api/client';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameHistoryPeriod, OpnameItem, OpnamePeriodGroup, OpnameProgressNode, OpnameProgressTree, OpnameReport, OpnameReportNode, OpnameSession, OpnameSessionStatus, OpnameSessionSummary } from '@/lib/api/types';
import { parseApiTime } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthProvider';
import { StartOpnameForm } from './StartOpnameForm';
import { OpnameWorkspaceProvider, useOpnameWorkspace } from './OpnameWorkspaceContext';
import { findNode as findProgressNode, resolveWorkingNode } from './opnameWorkingNode';
import { CountingStack } from './CountingStack';
import { ScannerTestSheet } from './ScannerTestSheet';
import { PendingBadge, SyncFailedSheet, SyncStatusChip } from './SyncStatus';
import { buildOfflineProgressTree, findOfflineItems, getPendingOfflineItems, toOfflineOpnameItem, useCountSync, useOfflineSessionIndex } from './useOpnameOffline';
import { useScreenWakeLock } from './useScreenWakeLock';

const PER_PAGE = 20;
type HistoryGroup = OpnamePeriodGroup | 'all';
type CsvDelimiter = 'comma' | 'semicolon';

function storedChoice<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return values.includes(stored as T) ? stored as T : fallback;
  } catch {
    return fallback;
  }
}

function saveCsv(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sixPeriodRange(group: OpnamePeriodGroup, timezone: string): { date_from: string; date_to: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const today = new Date(Date.UTC(year, month - 1, day));
  const periodsBack = group === 'year' ? 5 : group === 'quarter' ? 15 : 5;
  const startMonth = group === 'year' ? 0 : group === 'quarter' ? Math.floor((month - 1) / 3) * 3 : month - 1;
  const start = group === 'year'
    ? new Date(Date.UTC(year - 5, 0, 1))
    : new Date(Date.UTC(year, startMonth - periodsBack, 1));
  const format = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

  return { date_from: format(start), date_to: format(today) };
}
const STATUS_FILTERS: Array<{ value: OpnameSessionStatus | ''; label: string }> = [
  { value: '', label: 'Semua' },
  { value: 'in_progress', label: 'Berjalan' },
  { value: 'cancelled', label: 'Dibatalkan' },
  { value: 'pending_approval', label: 'Menunggu persetujuan' },
  { value: 'posted', label: 'Selesai' },
];

function statusLabel(status: OpnameSessionStatus): string {
  return ({
    in_progress: 'Berjalan',
    pending_approval: 'Menunggu persetujuan',
    posted: 'Selesai',
    cancelled: 'Dibatalkan',
  })[status];
}

function formatSessionTime(value: string, timezone: string): string {
  const date = parseApiTime(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}

function StatusBadge({ status }: { status: OpnameSessionStatus }) {
  const tone = status === 'in_progress' ? 'bg-blue-100 text-blue-900'
    : status === 'cancelled' ? 'bg-slate-100 text-slate-800'
      : status === 'posted' ? 'bg-emerald-100 text-emerald-900'
        : 'bg-amber-100 text-amber-900';
  return <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-medium ${tone}`}>{statusLabel(status)}</span>;
}

function SessionLink({ session, children }: { session: OpnameSessionSummary; children: ReactNode }) {
  return (
    <Link
      to={`/inventory/adjustments/opname/${session.id}`}
      className="font-semibold text-slate-900 underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  );
}

export function OpnameSessionsPage() {
  const { can, me } = useAuth();
  const timezone = me?.store?.timezone || 'Asia/Jakarta';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<OpnameSessionStatus | ''>('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [mobileItems, setMobileItems] = useState<OpnameSessionSummary[]>([]);
  const [startOpen, setStartOpen] = useState(false);
  const [group, setGroup] = useState<HistoryGroup>(() => storedChoice('pos.opname.history-group', ['month', 'quarter', 'year', 'all'], 'month'));
  const [result, setResult] = useState<'clean' | 'variance' | ''>('');
  const [scopeType, setScopeType] = useState<'' | 'all' | 'categories'>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(() => storedChoice('pos.opname.csv-delimiter', ['comma', 'semicolon'], 'comma'));
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [exportingPeriods, setExportingPeriods] = useState(false);
  const [exportError, setExportError] = useState<Error | null>(null);
  const appendNextPage = useRef(false);
  const recentRange = sixPeriodRange(group === 'all' ? 'month' : group, timezone);
  const list = useQuery({
    queryKey: ['opname', 'sessions', { status, search, page, result, scopeType, dateFrom, dateTo }],
    queryFn: () => opnameApi.list({
      status, q: search, page, per_page: PER_PAGE, sort: 'newest',
      result: result || undefined, scope_type: scopeType || undefined,
      date_from: dateFrom || undefined, date_to: dateTo || undefined,
    }),
    enabled: group === 'all',
  });
  const periods = useInfiniteQuery({
    queryKey: ['opname', 'periods', { group, status, result, scopeType, dateFrom, dateTo }],
    initialPageParam: '',
    queryFn: ({ pageParam }) => opnameApi.periods({
      group: group === 'all' ? 'month' : group,
      status: status || undefined,
      result: result || undefined,
      scope_type: scopeType || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: 12,
      cursor: pageParam || undefined,
    }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    enabled: group !== 'all',
  });
  const frequent = useQuery({
    queryKey: ['opname', 'frequent-variance', { dateFrom, dateTo, scopeType, status, result, group }],
    queryFn: () => opnameApi.frequentVariance({
      date_from: dateFrom || recentRange.date_from,
      date_to: dateTo || recentRange.date_to,
      scope_type: scopeType || undefined,
      status: status || undefined,
      result: result || undefined,
      limit: 10,
    }),
    enabled: group !== 'all',
  });
  const lastStatus = useQuery({
    queryKey: ['opname', 'last-status'],
    queryFn: opnameApi.lastStatus,
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('pos.opname.history-group', group);
    } catch {
      return;
    }
  }, [group]);

  useEffect(() => {
    try {
      window.localStorage.setItem('pos.opname.csv-delimiter', delimiter);
    } catch {
      return;
    }
  }, [delimiter]);

  useEffect(() => {
    if (!list.data) return;
    setMobileItems((current) => appendNextPage.current
      ? [...current, ...list.data.data]
      : list.data.data);
    appendNextPage.current = false;
  }, [list.data]);

  function applySearch(event: FormEvent) {
    event.preventDefault();
    appendNextPage.current = false;
    setMobileItems([]);
    setSearch(searchDraft.trim());
    setPage(1);
  }

  function changeStatus(value: OpnameSessionStatus | '') {
    appendNextPage.current = false;
    setMobileItems([]);
    setStatus(value);
    setPage(1);
  }

  function loadMore() {
    if (!list.data || list.isFetching || list.data.current_page >= list.data.last_page) return;
    appendNextPage.current = true;
    setPage(list.data.current_page + 1);
  }

  async function exportPeriodSummary() {
    setExportError(null);
    setExportingPeriods(true);
    try {
      const blob = await opnameApi.exportPeriods(group === 'all' ? 'month' : group, delimiter, dateFrom || undefined, dateTo || undefined);
      saveCsv(blob, `opname-rekap-${group}.csv`);
    } catch (error) {
      setExportError(error instanceof Error ? error : new Error('Gagal mengunduh rekap periode.'));
    } finally {
      setExportingPeriods(false);
    }
  }

  async function handleStarted(session: OpnameSessionSummary) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['opname', 'sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['opname', 'scope-options'] }),
    ]);
    setStartOpen(false);
    navigate(`/inventory/adjustments/opname/${session.id}`);
  }

  const hasCreate = can('opname.create');
  const listData = list.data?.data ?? [];
  const periodRows = periods.data?.pages.flatMap((pageData) => pageData.periods) ?? [];

  return (
    <div className="opname-history-page min-w-0 space-y-4 pb-20 md:pb-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sesi opname</h2>
          <p className="mt-1 text-sm text-slate-600">Buat dan pantau sesi penghitungan stok.</p>
        </div>
        {hasCreate && (
          <button type="button" onClick={() => setStartOpen(true)} className="hidden min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 md:inline-flex md:items-center">
            Mulai Opname
          </button>
        )}
      </header>

      <section aria-label="Opname terakhir" className="rounded-lg border border-slate-200 bg-white p-3">
        {lastStatus.isLoading ? <p role="status" className="text-sm text-slate-600">Memuat status opname terakhir…</p> : lastStatus.error ? (
          <div className="flex flex-wrap items-center justify-between gap-2"><ErrorNotice error={lastStatus.error} /><button type="button" onClick={() => void lastStatus.refetch()} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm">Coba lagi</button></div>
        ) : lastStatus.data?.last_posted ? (
          <Link to={`/inventory/adjustments/opname/${lastStatus.data.last_posted.id}`} className="block min-h-11 text-sm font-medium underline-offset-2 hover:underline">
            Opname terakhir: {lastStatus.data.last_posted.number} · {lastStatus.data.days_since} hari lalu · {lastStatus.data.last_posted.clean ? '✓ Bersih' : `${lastStatus.data.last_posted.variance_products} selisih`}
          </Link>
        ) : <p className="min-h-11 content-center text-sm text-slate-700">Belum pernah opname</p>}
      </section>

      {lastStatus.data?.reminder.due && !reminderDismissed && (
        <aside className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <span>Sudah {lastStatus.data.days_since} hari sejak opname terakhir.</span>
          <div className="flex gap-2">
            {hasCreate && <button type="button" onClick={() => setStartOpen(true)} className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white">Mulai Opname</button>}
            <button type="button" onClick={() => setReminderDismissed(true)} aria-label="Tutup pengingat" className="min-h-11 rounded-md border border-amber-400 px-3">Tutup</button>
          </div>
        </aside>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-40 flex-1 space-y-1 text-sm font-medium">
            <span>Kelompokkan</span>
            <select value={group} onChange={(event) => setGroup(event.target.value as HistoryGroup)} className="min-h-11 w-full rounded-md border border-slate-300 px-3">
              <option value="month">Bulan</option>
              <option value="quarter">Kuartal</option>
              <option value="year">Tahun</option>
              <option value="all">Semua</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>Format CSV</span>
            <select value={delimiter} onChange={(event) => setDelimiter(event.target.value as CsvDelimiter)} className="min-h-11 rounded-md border border-slate-300 px-3">
              <option value="comma">Koma</option>
              <option value="semicolon">Excel Indonesia (titik koma)</option>
            </select>
          </label>
          <button type="button" onClick={() => void exportPeriodSummary()} disabled={exportingPeriods} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium disabled:opacity-50">
            {exportingPeriods ? 'Menyiapkan CSV…' : 'Unduh rekap periode'}
          </button>
          {group !== 'all' && <button type="button" onClick={() => window.print()} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium print:hidden">Cetak rekap</button>}
        </div>
        {exportError && <ErrorNotice error={exportError} />}

        <form onSubmit={applySearch} className="flex gap-2">
          <label className="sr-only" htmlFor="opname-search">Cari nomor atau nama sesi</label>
          <input
            id="opname-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Cari nomor atau nama sesi"
            className="min-h-11 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm"
          />
          <button type="submit" className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium">Cari</button>
        </form>

        <div aria-label="Filter status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              type="button"
              key={filter.value || 'all'}
              aria-pressed={status === filter.value}
              onClick={() => changeStatus(filter.value)}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${status === filter.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <details className="opname-history-filter rounded-lg border border-slate-200 bg-white p-3">
          <summary className="min-h-8 cursor-pointer font-medium">Filter hasil, cakupan, dan tanggal</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-sm"><span className="block">Hasil</span><select value={result} onChange={(event) => setResult(event.target.value as '' | 'clean' | 'variance')} className="min-h-11 w-full rounded-md border border-slate-300 px-3"><option value="">Semua hasil</option><option value="clean">Bersih</option><option value="variance">Berselisih</option></select></label>
            <label className="space-y-1 text-sm"><span className="block">Cakupan</span><select value={scopeType} onChange={(event) => setScopeType(event.target.value as '' | 'all' | 'categories')} className="min-h-11 w-full rounded-md border border-slate-300 px-3"><option value="">Semua cakupan</option><option value="all">Seluruh toko</option><option value="categories">Kategori</option></select></label>
            <label className="space-y-1 text-sm"><span className="block">Dari tanggal</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" /></label>
            <label className="space-y-1 text-sm"><span className="block">Sampai tanggal</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" /></label>
          </div>
          {(status || result || scopeType || dateFrom || dateTo) && <button type="button" onClick={() => { setStatus(''); setResult(''); setScopeType(''); setDateFrom(''); setDateTo(''); }} className="mt-3 min-h-11 rounded-md border border-slate-300 px-3 text-sm">Hapus semua filter</button>}
        </details>

        {group !== 'all' && (
          <>
            {periods.error && <div className="space-y-2"><ErrorNotice error={periods.error} /><button type="button" onClick={() => void periods.refetch()} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm">Coba lagi</button></div>}
            {periods.isLoading && <p role="status" className="text-sm text-slate-600">Memuat riwayat opname…</p>}
            {!periods.isLoading && !periods.error && periods.data && (
              <>
                <div className="opname-history-printable">
                  <h2 className="hidden pb-4 text-xl font-bold print:block">Rekap riwayat opname</h2>
                  <PeriodTrend periods={periodRows.slice(0, 12)} />
                  {periodRows.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Tidak ada sesi pada filter ini.</p> : (
                    <div className="space-y-2">
                      {periodRows.map((period) => <PeriodSection
                        key={period.period_key}
                        period={period}
                        timezone={timezone}
                        filters={{ status, result, scopeType, dateFrom, dateTo, search }}
                      />)}
                    </div>
                  )}
                </div>
                {periods.hasNextPage && <button type="button" disabled={periods.isFetchingNextPage} onClick={() => void periods.fetchNextPage()} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm disabled:opacity-50">{periods.isFetchingNextPage ? 'Memuat…' : 'Muat periode sebelumnya'}</button>}
              </>
            )}
            <div className="print:hidden"><FrequentVarianceCard items={frequent.data?.items ?? []} loading={frequent.isLoading} error={frequent.error} /></div>
          </>
        )}

        {group === 'all' && list.error && (
          <div className="space-y-2">
            <ErrorNotice error={list.error} />
            <button type="button" onClick={() => void list.refetch()} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium">Coba lagi</button>
          </div>
        )}

        {group === 'all' && list.isLoading && (
          <div role="status" aria-label="Memuat sesi opname" className="space-y-3">
            {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />)}
          </div>
        )}

        {group === 'all' && !list.isLoading && !list.error && listData.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
            <h3 className="font-semibold">Belum ada sesi opname</h3>
            <p className="mt-1 text-sm text-slate-600">Mulai sesi untuk mencatat penghitungan produk.</p>
            {hasCreate && <button type="button" onClick={() => setStartOpen(true)} className="mt-4 hidden min-h-11 rounded-md bg-slate-900 px-5 text-sm font-medium text-white md:inline-flex md:items-center">Mulai Opname</button>}
          </div>
        )}

        {group === 'all' && listData.length > 0 && (
          <>
            <div className="space-y-3 md:hidden">
              {mobileItems.map((session) => <SessionCard key={session.id} session={session} timezone={timezone} />)}
            </div>
            <div className="hidden overflow-hidden rounded-lg border border-slate-200 md:block">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="w-[18%] px-3 py-3">Nomor / nama</th>
                    <th className="w-[20%] px-3 py-3">Cakupan</th>
                    <th className="w-[15%] px-3 py-3">Status</th>
                    <th className="w-[15%] px-3 py-3">Progres</th>
                    <th className="w-[18%] px-3 py-3">Mulai</th>
                    <th className="w-[14%] px-3 py-3">Pembuat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {listData.map((session) => (
                    <tr key={session.id}>
                      <td className="break-words px-3 py-3">
                        <SessionLink session={session}>{session.number}</SessionLink>
                        {session.name && <span className="mt-1 block text-xs text-slate-600">{session.name}</span>}
                      </td>
                      <td className="break-words px-3 py-3">{session.scope_summary}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={session.status} />
                        {session.status === 'posted' && (
                          <span className="mt-1 block text-xs text-slate-600">
                            {session.variance_products === 0 ? '✓ Bersih' : `${session.variance_products ?? 0} selisih`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">{session.counted_products}/{session.total_products} produk</td>
                      <td className="px-3 py-3">{formatSessionTime(session.started_at, timezone)}</td>
                      <td className="break-words px-3 py-3">{session.created_by.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.data && list.data.last_page > 1 && (
              <>
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    disabled={page <= 1 || list.isFetching}
                    onClick={() => { appendNextPage.current = false; setMobileItems([]); setPage((current) => Math.max(1, current - 1)); }}
                    className="hidden min-h-11 rounded-md border border-slate-300 px-4 text-sm disabled:opacity-50 md:inline-flex md:items-center"
                  >
                    Sebelumnya
                  </button>
                  <span className="hidden text-sm text-slate-600 md:block">Halaman {list.data.current_page} dari {list.data.last_page}</span>
                  <button
                    type="button"
                    disabled={list.data.current_page >= list.data.last_page || list.isFetching}
                    onClick={() => { appendNextPage.current = false; setMobileItems([]); setPage((current) => current + 1); }}
                    className="hidden min-h-11 rounded-md border border-slate-300 px-4 text-sm disabled:opacity-50 md:inline-flex md:items-center"
                  >
                    Berikutnya
                  </button>
                </div>
                {list.data.current_page < list.data.last_page && (
                  <button type="button" onClick={loadMore} disabled={list.isFetching} className="min-h-11 w-full rounded-md border border-slate-300 text-sm font-medium disabled:opacity-50 md:hidden">
                    {list.isFetching ? 'Memuat…' : 'Muat lagi'}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </section>

      {hasCreate && (
        <button type="button" onClick={() => setStartOpen(true)} className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 min-h-12 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-lg md:hidden">
          Mulai Opname
        </button>
      )}
      {startOpen && <StartOpnameForm onClose={() => setStartOpen(false)} onSuccess={handleStarted} />}
    </div>
  );
}

function PeriodTrend({ periods }: { periods: OpnameHistoryPeriod[] }) {
  const maximum = Math.max(1, ...periods.map((period) => period.variance_products));

  return (
    <section aria-label="Tren produk berselisih per periode" className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-3 text-sm font-semibold">Tren produk berselisih</h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {periods.map((period) => (
          <button
            type="button"
            key={period.period_key}
            onClick={() => document.getElementById(`opname-period-${period.period_key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            aria-label={`${period.label}: ${period.variance_products} produk berselisih`}
            className="flex min-w-20 flex-col items-center gap-1 text-xs"
          >
            <span className="font-semibold">{period.variance_products}</span>
            <span className="flex h-20 w-8 items-end overflow-hidden rounded bg-slate-100">
              <span className="w-full rounded bg-indigo-600" style={{ height: `${Math.max(4, period.variance_products / maximum * 100)}%` }} />
            </span>
            <span className="max-w-24 text-center">{period.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PeriodSection({
  period,
  timezone,
  filters,
}: {
  period: OpnameHistoryPeriod;
  timezone: string;
  filters: {
    status: OpnameSessionStatus | '';
    result: 'clean' | 'variance' | '';
    scopeType: '' | 'all' | 'categories';
    dateFrom: string;
    dateTo: string;
    search: string;
  };
}) {
  const [open, setOpen] = useState(false);

  return (
    <section id={`opname-period-${period.period_key}`} className="scroll-mt-24 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-h-16 w-full flex-wrap items-center justify-between gap-2 p-3 text-left sm:p-4">
        <span>
          <span className="block font-semibold">{period.label}</span>
          <span className="mt-1 block text-xs text-slate-600">{period.sessions_total} sesi · {period.sessions_clean} bersih · {period.variance_products} produk berselisih</span>
        </span>
        <span className="text-right text-xs text-slate-600">
          Kurang {period.short_qty} · Lebih {period.over_qty}
          {period.abs_value !== undefined && <span className="mt-1 block">Nilai mutlak {period.abs_value}</span>}
        </span>
      </button>
      {open && <PeriodSessions period={period} timezone={timezone} filters={filters} />}
    </section>
  );
}

function PeriodSessions({
  period,
  timezone,
  filters,
}: {
  period: OpnameHistoryPeriod;
  timezone: string;
  filters: {
    status: OpnameSessionStatus | '';
    result: 'clean' | 'variance' | '';
    scopeType: '' | 'all' | 'categories';
    dateFrom: string;
    dateTo: string;
    search: string;
  };
}) {
  const query = useQuery({
    queryKey: ['opname', 'period-sessions', period.period_key, filters],
    queryFn: () => opnameApi.list({
      period: period.period_key,
      status: filters.status || undefined,
      result: filters.result || undefined,
      scope_type: filters.scopeType || undefined,
      date_from: filters.dateFrom || undefined,
      date_to: filters.dateTo || undefined,
      q: filters.search || undefined,
      per_page: 100,
      sort: 'newest',
    }),
  });

  if (query.isLoading) return <p role="status" className="p-4 text-sm text-slate-600">Memuat sesi periode…</p>;
  if (query.error) return <div className="p-4"><ErrorNotice error={query.error} /></div>;
  if (!query.data || query.data.data.length === 0) return <p className="p-4 text-sm text-slate-600">Tidak ada sesi yang cocok dengan filter.</p>;

  return (
    <div className="space-y-2 border-t border-slate-100 p-3">
      {query.data.data.map((session) => <SessionCard key={session.id} session={session} timezone={timezone} />)}
      {query.data.last_page > 1 && <p className="text-xs text-slate-500">Tampilkan lebih banyak sesi dengan pengelompokan Semua.</p>}
    </div>
  );
}

function FrequentVarianceCard({
  items,
  loading,
  error,
}: {
  items: Array<{ product_id: number; name: string; barcode: string; sessions_with_variance: number; short_qty: string; over_qty: string; value?: string }>;
  loading: boolean;
  error: Error | null;
}) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="min-h-8 cursor-pointer font-semibold">Produk sering berselisih</summary>
      {loading && <p role="status" className="mt-3 text-sm text-slate-600">Memuat produk…</p>}
      {error && <div className="mt-3"><ErrorNotice error={error} /></div>}
      {!loading && !error && items.length === 0 && <p className="mt-3 text-sm text-slate-600">Belum ada produk berselisih pada rentang ini.</p>}
      <ol className="mt-3 divide-y divide-slate-100">
        {items.map((item, index) => (
          <li key={item.product_id} className="grid gap-1 py-3 text-sm sm:grid-cols-[2rem_1fr_auto]">
            <span className="font-semibold">{index + 1}.</span>
            <span className="min-w-0 break-words"><strong>{item.name}</strong><span className="ml-2 text-xs text-slate-500">{item.barcode}</span><span className="mt-1 block text-xs text-slate-600">{item.sessions_with_variance} sesi berselisih · Kurang {item.short_qty} · Lebih {item.over_qty}</span></span>
            {item.value !== undefined && <span className="text-xs text-slate-600">Nilai {item.value}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function SessionCard({ session, timezone }: { session: OpnameSessionSummary; timezone: string }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <SessionLink session={session}>{session.number}</SessionLink>
          {session.name && <p className="mt-1 break-words text-sm text-slate-700">{session.name}</p>}
          {session.status === 'posted' && (
            <p className="mt-1 text-xs text-slate-600">
              {session.variance_products === 0 ? '✓ Bersih' : `${session.variance_products ?? 0} selisih`}
            </p>
          )}
        </div>
        <StatusBadge status={session.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div className="col-span-2 min-w-0"><dt className="text-xs text-slate-500">Cakupan</dt><dd className="break-words">{session.scope_summary}</dd></div>
        <div><dt className="text-xs text-slate-500">Progres</dt><dd>{session.counted_products}/{session.total_products} dihitung</dd></div>
        <div><dt className="text-xs text-slate-500">Pembuat</dt><dd className="break-words">{session.created_by.name}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-slate-500">Waktu mulai</dt><dd>{formatSessionTime(session.started_at, timezone)}</dd></div>
      </dl>
    </article>
  );
}

export function OpnameSessionDetailPage() {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  const mobile = useMobileViewport();
  const { can, me } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [csvDelimiter, setCsvDelimiter] = useState<CsvDelimiter>(() => storedChoice('pos.opname.csv-delimiter', ['comma', 'semicolon'], 'comma'));
  const [csvPending, setCsvPending] = useState<'summary' | 'detail' | null>(null);
  const [csvError, setCsvError] = useState<Error | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [openNodeIds, setOpenNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedItem, setSelectedItem] = useState<OpnameItem | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [workflowDialog, setWorkflowDialog] = useState<'submit' | 'approve' | 'reject' | null>(null);
  const [scannerTestOpen, setScannerTestOpen] = useState(false);
  const [syncSheetOpen, setSyncSheetOpen] = useState(false);
  const [showScannerTip, setShowScannerTip] = useState(() => localStorage.getItem('pos.opname.scanner-tip-dismissed') !== 'true');
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [ownerPassword, setOwnerPassword] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const workflowRequestId = useRef(window.crypto.randomUUID());
  const searchTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
  }, []);
  useEffect(() => {
    const currentView = searchParams.get('view');
    if (currentView === 'input' || currentView === 'daftar' || currentView === 'ringkasan') return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', 'input');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);
  const detail = useQuery({
    queryKey: ['opname', 'session', id],
    queryFn: () => opnameApi.get(id),
    enabled: Number.isInteger(id) && id > 0,
  });
  const countSync = useCountSync(me?.user.id, id, Boolean(detail.data));
  const offlineIndex = useOfflineSessionIndex(
    me?.user.id,
    id,
    Boolean(detail.data?.status === 'in_progress' && can('opname.count')),
  );
  const offlineTree = useMemo(
    () => buildOfflineProgressTree(offlineIndex.index, countSync.pending),
    [countSync.pending, offlineIndex.index],
  );
  useScreenWakeLock(detail.data?.status === 'in_progress');
  const sessionIsComplete = detail.data
    ? detail.data.counted_products === detail.data.total_products
    : false;
  const reportQuery = useQuery({
    queryKey: ['opname', 'report', id],
    queryFn: () => opnameApi.report(id),
    enabled: Boolean(countSync.isOnline && detail.data && detail.data.status !== 'cancelled'
      && (detail.data.status !== 'in_progress' || (can('opname.review') && sessionIsComplete))),
  });
  const treeQuery = useQuery({
    queryKey: ['opname', 'tree', id],
    queryFn: () => opnameApi.tree(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: () => countSync.isOnline && document.visibilityState === 'visible' ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const productSearch = useInfiniteQuery({
    queryKey: ['opname', 'items', id, 'search', search, onlyUncounted],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => opnameApi.items(id, {
      q: search,
      only_uncounted: onlyUncounted ? true : undefined,
      page: pageParam,
      per_page: 100,
    }),
    getNextPageParam: (lastPage) => lastPage.current_page < lastPage.last_page ? lastPage.current_page + 1 : undefined,
    enabled: search.trim().length >= 2 && countSync.isOnline,
    refetchInterval: () => countSync.isOnline && document.visibilityState === 'visible' ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    const pendingCount = countSync.pending.length + countSync.failed.length;
    if (pendingCount === 0) return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const warnBeforeNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname && link.search === window.location.search) return;
      if (!window.confirm(`${pendingCount} operasi opname belum tersinkron. Tetap pindah halaman? Antrean tersimpan di perangkat ini.`)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    document.addEventListener('click', warnBeforeNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeClose);
      document.removeEventListener('click', warnBeforeNavigation, true);
    };
  }, [countSync.failed.length, countSync.pending.length]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      detail.data?.status === 'in_progress'
      && countSync.isOnline
      && countSync.pending.length === 0
      && countSync.failed.length === 0
    ) void offlineIndex.refresh();
  }, [countSync.failed.length, countSync.isOnline, countSync.pending.length, detail.data?.status, offlineIndex.refresh]);
  const cancel = useMutation({
    mutationFn: () => opnameApi.cancel(id, reason.trim()),
    onSuccess: async (session) => {
      queryClient.setQueryData(['opname', 'session', id], session);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['opname', 'sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['opname', 'scope-options'] }),
        queryClient.invalidateQueries({ queryKey: ['opname', 'tree', id] }),
      ]);
      setReason('');
      setCancelOpen(false);
    },
  });
  const invalidateWorkflowQueries = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['opname', 'session', id] }),
    queryClient.invalidateQueries({ queryKey: ['opname', 'report', id] }),
    queryClient.invalidateQueries({ queryKey: ['opname', 'sessions'] }),
    queryClient.invalidateQueries({ queryKey: ['opname', 'tree', id] }),
    queryClient.invalidateQueries({ queryKey: ['opname', 'lock-status'] }),
  ]);
  async function downloadSessionCsv(part: 'summary' | 'detail') {
    setCsvError(null);
    setCsvPending(part);
    try {
      const blob = await opnameApi.exportSession(id, part, csvDelimiter);
      saveCsv(blob, `opname-${detail.data?.number ?? id}-${part}.csv`);
    } catch (error) {
      setCsvError(error instanceof Error ? error : new Error('Gagal mengunduh CSV.'));
    } finally {
      setCsvPending(null);
    }
  }
  useEffect(() => {
    try {
      window.localStorage.setItem('pos.opname.csv-delimiter', csvDelimiter);
    } catch {
      return;
    }
  }, [csvDelimiter]);
  const submitWorkflow = useMutation({
    mutationFn: () => opnameApi.submit(id, {
      client_request_id: workflowRequestId.current,
      ...(me?.roles.includes('Owner') ? { owner_password: ownerPassword } : {}),
    }),
    onSuccess: async () => {
      workflowRequestId.current = window.crypto.randomUUID();
      setWorkflowDialog(null);
      setOwnerPassword('');
      await invalidateWorkflowQueries();
    },
  });
  const approveWorkflow = useMutation({
    mutationFn: () => opnameApi.approve(id, { client_request_id: workflowRequestId.current, owner_password: ownerPassword }),
    onSuccess: async () => {
      workflowRequestId.current = window.crypto.randomUUID();
      setWorkflowDialog(null);
      setOwnerPassword('');
      await invalidateWorkflowQueries();
    },
  });
  const rejectWorkflow = useMutation({
    mutationFn: () => opnameApi.reject(id, {
      client_request_id: workflowRequestId.current,
      owner_password: ownerPassword,
      reason: rejectReason.trim(),
    }),
    onSuccess: async () => {
      workflowRequestId.current = window.crypto.randomUUID();
      setWorkflowDialog(null);
      setOwnerPassword('');
      setRejectReason('');
      await invalidateWorkflowQueries();
    },
  });

  if (!Number.isInteger(id) || id < 1) return <ErrorNotice error={new Error('Sesi opname tidak ditemukan.')} />;
  if (detail.isLoading) return <div role="status" className="space-y-3"><div className="h-32 animate-pulse rounded-lg bg-slate-100" /><div className="h-20 animate-pulse rounded-lg bg-slate-100" /></div>;
  if (detail.error) {
    return <div className="space-y-3"><ErrorNotice error={detail.error} /><button type="button" onClick={() => void detail.refetch()} className="min-h-11 rounded-md border border-slate-300 px-4">Coba lagi</button><Link to="/inventory/adjustments/opname" className="ml-3 min-h-11 underline">Kembali ke daftar</Link></div>;
  }
  const session = detail.data;
  if (!session) return null;
  const timezone = me?.store?.timezone || 'Asia/Jakarta';
  const tree = countSync.isOnline ? treeQuery.data : offlineTree ?? treeQuery.data;
  const view = workspaceView(searchParams.get('view'));
  const activeNode = tree ? findNode(tree.nodes, activeNodeId) : null;
  const activeParent = tree && activeNode ? findNodeById(tree.nodes, activeNode.parent_id) : null;
  const workingNode = tree ? resolveWorkingNode(tree, activeNodeId) : null;

  function changeView(next: WorkspaceView) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', next);
    setSearchParams(nextParams, { replace: true });
  }

  function loadItem(item: OpnameItem) {
    setSelectedItem(item);
    const categoryNode = item.category_id === null ? null : tree ? findProgressNode(tree.nodes, String(item.category_id)) : null;
    const expanded: string[] = [];
    let node = categoryNode;
    while (node) {
      expanded.push(String(node.id));
      node = node.parent_id === null ? null : tree ? findProgressNode(tree.nodes, String(node.parent_id)) : null;
    }
    const selectedId = categoryNode ? String(categoryNode.id) : 'other';
    setActiveNodeId(selectedId);
    setOpenNodeIds((current) => new Set([...current, ...expanded]));
    changeView('input');
  }

  function startNode(nodeId: string) {
    setActiveNodeId(nodeId);
    changeView('input');
  }

  function updateSearch(value: string) {
    setSearchDraft(value);
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setSearch(value.trim()), 250);
  }

  async function refreshWorkspace() {
    if (!countSync.isOnline) return;
    await Promise.all([
      detail.refetch(),
      treeQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['opname', 'items', id] }),
    ]);
  }

  return (
    <div className="opname-workspace-page min-w-0 space-y-4 pb-20 md:pb-0">
      {session.status !== 'in_progress' && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Sesi ini berstatus <strong>{statusLabel(session.status)}</strong>. Tampilan hanya baca.
        </div>
      )}
      <header className="sticky top-0 z-20 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/inventory/adjustments/opname" className="inline-flex min-h-9 items-center text-xs font-medium underline">← Daftar sesi</Link>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={session.status} />
          <SyncStatusChip
            isOnline={countSync.isOnline}
            pendingCount={countSync.pending.length}
            failedCount={countSync.failed.length}
            syncing={countSync.syncing}
            onClick={() => setSyncSheetOpen(true)}
          />
          <button type="button" onClick={() => void refreshWorkspace()} disabled={treeQuery.isFetching || !countSync.isOnline} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium disabled:opacity-50" aria-label="Muat ulang progres">
            {treeQuery.isFetching ? '…' : 'Muat ulang'}
          </button>
          <button type="button" onClick={() => setSummaryOpen(true)} className="hidden min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium md:inline-flex md:items-center">Ringkasan</button>
          {session.status === 'in_progress' && (
            <details className="relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-slate-300 px-3 text-lg font-medium" aria-label="Menu lainnya">⋯</summary>
              <div className="absolute right-0 z-30 mt-1 min-w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                <button type="button" onClick={() => setScannerTestOpen(true)} className="min-h-11 w-full rounded px-3 text-left text-sm hover:bg-slate-50">Uji scanner</button>
                {can('opname.cancel') && <button type="button" onClick={() => setCancelOpen(true)} className="min-h-11 w-full rounded px-3 text-left text-sm text-rose-800 hover:bg-rose-50">Batalkan sesi</button>}
              </div>
            </details>
          )}
        </div>
        </div>
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Progres penghitungan" aria-valuemin={0} aria-valuemax={tree?.summary.total_products ?? session.total_products} aria-valuenow={tree?.summary.counted_products ?? session.counted_products}>
            <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: progressWidth(tree?.summary.counted_products ?? session.counted_products, tree?.summary.total_products ?? session.total_products) }} />
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {activeNode
              ? `${activeNode.name} ${activeNode.counted_count}/${activeNode.product_count}${activeParent ? ` · ${activeParent.name} ${activeParent.counted_count}/${activeParent.product_count}` : ''}`
              : `Progres total ${tree?.summary.counted_products ?? session.counted_products}/${tree?.summary.total_products ?? session.total_products}`}
          </p>
        </div>
        {lastScanAt === null ? (
          <p className="text-xs text-slate-500">Belum ada scan</p>
        ) : (
          <p className={`text-xs ${clock - lastScanAt > 180_000 ? 'text-slate-400' : 'text-slate-600'}`}>
            Scan terakhir: {Math.max(0, Math.floor((clock - lastScanAt) / 1000))} dtk lalu
          </p>
        )}
        {countSync.queueError && <p role="status" className="text-xs text-amber-900">{countSync.queueError}</p>}
      </header>
      {session.status === 'in_progress' && showScannerTip && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
          <span>Uji scanner dulu agar akurat.</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setScannerTestOpen(true)} className="min-h-10 rounded-md border border-blue-300 px-3 font-medium">Uji scanner</button>
            <button type="button" onClick={() => { localStorage.setItem('pos.opname.scanner-tip-dismissed', 'true'); setShowScannerTip(false); }} className="min-h-10 px-2 underline">Tutup</button>
          </div>
        </div>
      )}

      {session.status !== 'cancelled' && (
        <OpnameWorkflowPanel
          session={session}
          report={countSync.isOnline ? reportQuery.data : undefined}
          reportLoading={countSync.isOnline && reportQuery.isLoading}
          reportError={countSync.isOnline ? reportQuery.error : null}
          csvDelimiter={csvDelimiter}
          csvPending={csvPending}
          csvError={csvError}
          onCsvDelimiterChange={setCsvDelimiter}
          onDownloadCsv={downloadSessionCsv}
          canPost={can('opname.post')}
          postingAllowed={countSync.isOnline && countSync.pending.length === 0 && countSync.failed.length === 0}
          postBlockedReason={!countSync.isOnline || countSync.pending.length > 0 || countSync.failed.length > 0 ? 'Sinkronkan semua hitungan dulu.' : ''}
          isOnline={countSync.isOnline}
          canApprove={can('opname.approve')}
          canReview={can('opname.review')}
          isOwner={me?.roles.includes('Owner') ?? false}
          onSubmit={() => { setWorkflowDialog('submit'); setOwnerPassword(''); }}
          onApprove={() => { setWorkflowDialog('approve'); setOwnerPassword(''); }}
          onReject={() => { setWorkflowDialog('reject'); setOwnerPassword(''); setRejectReason(''); }}
          onRetry={() => { if (countSync.isOnline) void reportQuery.refetch(); }}
        />
      )}

      <OpnameWorkspaceProvider value={{
        activeNodeId,
        setActiveNodeId,
        tree: tree ?? EMPTY_TREE,
        selectedItem,
        setSelectedItem,
        highlightedItemId,
        setHighlightedItemId,
        pendingOperations: countSync.pending,
        failedOperations: countSync.failed,
        isOnline: countSync.isOnline,
        markOffline: countSync.markOffline,
        isSyncing: countSync.syncing,
        queueError: countSync.queueError,
        syncNow: countSync.syncNow,
        retryFailed: countSync.retryFailed,
        removeFailed: countSync.removeFailed,
        offlineIndex: offlineIndex.index,
        offlineIndexReady: offlineIndex.ready,
        offlineIndexRefreshing: offlineIndex.refreshing,
        offlineIndexError: offlineIndex.error,
        lastScanAt,
        setLastScanAt,
        loadItem,
        selectItem: loadItem,
        startNode,
        workingNodeId: workingNode ? String(workingNode.id) : null,
      }}>
        {view === 'ringkasan' && mobile && <WorkspaceSummary session={session} tree={tree} timezone={timezone} />}
        {summaryOpen && (
          <div className="fixed inset-0 z-40 flex items-stretch justify-center overflow-y-auto bg-slate-900/50 md:items-center md:p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="opname-summary-title" className="my-auto w-full bg-white p-4 md:max-w-4xl md:rounded-xl md:shadow-xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 id="opname-summary-title" className="text-lg font-semibold">Ringkasan sesi</h3>
                <button type="button" autoFocus onClick={() => setSummaryOpen(false)} className="min-h-11 rounded-md border border-slate-300 px-4">Tutup</button>
              </div>
              <WorkspaceSummary session={session} tree={tree} timezone={timezone} />
            </div>
          </div>
        )}
        <WorkspacePanels
          id={id}
          tree={tree ?? EMPTY_TREE}
          treeLoading={treeQuery.isLoading && !offlineTree}
          treeError={countSync.isOnline ? treeQuery.error : null}
          retryTree={() => { if (countSync.isOnline) void treeQuery.refetch(); }}
          search={search}
          searchDraft={searchDraft}
          updateSearch={updateSearch}
          searchResults={!countSync.isOnline && search.trim().length >= 2
            ? findOfflineItems(offlineIndex.index, search, 'search', countSync.pending)
            : productSearch.data?.pages.flatMap((page) => page.data) ?? []}
          searchLoading={countSync.isOnline && productSearch.isFetching}
          productSearchHasNext={productSearch.hasNextPage}
          loadMoreSearch={() => void productSearch.fetchNextPage()}
          searchError={countSync.isOnline ? productSearch.error : null}
          retrySearch={() => { if (countSync.isOnline) void productSearch.refetch(); }}
          onlyUncounted={onlyUncounted}
          setOnlyUncounted={setOnlyUncounted}
          openNodeIds={openNodeIds}
          setOpenNodeIds={setOpenNodeIds}
          view={view}
          onViewChange={changeView}
          active={session.status === 'in_progress'}
          scannerTestOpen={scannerTestOpen}
          canCount={can('opname.count')}
          revealsSystemQty={countSync.isOnline && (tree?.display.reveals_system_qty ?? false)}
          workingNode={workingNode}
        />
      </OpnameWorkspaceProvider>

      {cancelOpen && (
        <CancelSessionDialog
          reason={reason}
          error={cancel.error}
          pending={cancel.isPending}
          onReasonChange={setReason}
          onCancel={() => { setCancelOpen(false); setReason(''); cancel.reset(); }}
          onSubmit={() => cancel.mutate()}
        />
      )}
      {scannerTestOpen && <ScannerTestSheet onClose={() => setScannerTestOpen(false)} onScan={() => setLastScanAt(Date.now())} />}
      {syncSheetOpen && (
        <SyncFailedSheet
          pending={countSync.pending}
          failed={countSync.failed}
          syncing={countSync.syncing}
          queueError={countSync.queueError}
          onClose={() => setSyncSheetOpen(false)}
          onSync={() => void countSync.syncNow()}
          onRetry={(operation) => { void countSync.retryFailed(operation); }}
          onRemove={(operation) => { void countSync.removeFailed(operation); }}
        />
      )}
      {workflowDialog && (
        <OpnameWorkflowDialog
          action={workflowDialog}
          ownerRequired={workflowDialog !== 'submit' || (me?.roles.includes('Owner') ?? false)}
          ownerPassword={ownerPassword}
          reason={rejectReason}
          error={submitWorkflow.error || approveWorkflow.error || rejectWorkflow.error}
          pending={submitWorkflow.isPending || approveWorkflow.isPending || rejectWorkflow.isPending}
          onPasswordChange={setOwnerPassword}
          onReasonChange={setRejectReason}
          onClose={() => {
            setWorkflowDialog(null);
            setOwnerPassword('');
            setRejectReason('');
            submitWorkflow.reset();
            approveWorkflow.reset();
            rejectWorkflow.reset();
          }}
          onConfirm={() => {
            if (workflowDialog === 'submit') submitWorkflow.mutate();
            if (workflowDialog === 'approve') approveWorkflow.mutate();
            if (workflowDialog === 'reject') rejectWorkflow.mutate();
          }}
        />
      )}
    </div>
  );
}

type WorkspaceView = 'input' | 'daftar' | 'ringkasan';

function workspaceView(value: string | null): WorkspaceView {
  return value === 'daftar' || value === 'ringkasan' ? value : 'input';
}

function progressWidth(counted: number, total: number): string {
  return total > 0 ? `${Math.min(100, (counted / total) * 100)}%` : '0%';
}

function useMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isMobile;
}

function findNode(nodes: OpnameProgressNode[], nodeId: string | null): OpnameProgressNode | null {
  if (nodeId === null) return null;
  for (const node of nodes) {
    if (String(node.id) === nodeId) return node;
    const child = findNode(node.children, nodeId);
    if (child) return child;
  }
  return null;
}

function findNodeById(nodes: OpnameProgressNode[], nodeId: number | null): OpnameProgressNode | null {
  return nodeId === null ? null : findNode(nodes, String(nodeId));
}

function flattenNodes(nodes: OpnameProgressNode[]): OpnameProgressNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

const EMPTY_TREE: OpnameProgressTree = {
  session: { id: 0, number: '', status: 'in_progress' },
  display: { reveals_system_qty: false },
  summary: { total_products: 0, counted_products: 0 },
  nodes: [],
};

function WorkspaceSummary({
  session,
  tree,
  timezone,
}: {
  session: OpnameSession;
  tree: OpnameProgressTree | undefined;
  timezone: string;
}) {
  const nodes = tree ? flattenNodes(tree.nodes) : [];
  const counted = tree?.summary.counted_products ?? session.counted_products;
  const total = tree?.summary.total_products ?? session.total_products;
  return (
    <section aria-label="Ringkasan sesi opname" className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
      <Info label="Status"><StatusBadge status={session.status} /></Info>
      <Info label="Cakupan">{session.scope_type === 'all' ? 'Seluruh toko' : session.scope_categories.map((category) => category.name).join(', ') || session.scope_summary}</Info>
      <Info label="Jumlah produk">{new Intl.NumberFormat('id-ID').format(total)} jenis produk</Info>
      <Info label="Sudah dihitung">{new Intl.NumberFormat('id-ID').format(counted)} produk</Info>
      <Info label="Belum dihitung">{new Intl.NumberFormat('id-ID').format(Math.max(0, total - counted))} produk</Info>
      <Info label="Kategori">{nodes.filter((node) => node.status === 'done').length} selesai · {nodes.filter((node) => node.status === 'partial').length} sebagian · {nodes.filter((node) => node.status === 'not_started').length} belum</Info>
      <Info label="Waktu mulai">{formatSessionTime(session.started_at, timezone)}</Info>
      <Info label="Pembuat">{session.created_by.name}</Info>
      {session.notes && <Info label="Catatan">{session.notes}</Info>}
      {session.status === 'cancelled' && (
        <>
          <Info label="Waktu dibatalkan">{session.cancelled_at ? formatSessionTime(session.cancelled_at, timezone) : '—'}</Info>
          <Info label="Pembatal">{session.cancelled_by?.name ?? '—'}</Info>
          <Info label="Alasan pembatalan">{session.cancel_reason}</Info>
        </>
      )}
      <div className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
        Produk baru yang muncul setelah sesi dimulai tidak ikut dihitung dan baru masuk pada opname berikutnya.
      </div>
      <div className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
        Ringkasan selisih tersedia pada tahap berikutnya.
      </div>
    </section>
  );
}

function formatReportQty(value: string | number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(Number(value));
}

function formatReportMoney(value: string | number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function approvalReasonLabel(reason: { type: string; product_name?: string }): string {
  const labels: Record<string, string> = {
    per_product_threshold: 'Nilai selisih produk memerlukan persetujuan Owner',
    per_session_threshold: 'Total nilai selisih memerlukan persetujuan Owner',
    first_opname: 'Opname pertama di toko',
    cost_missing: 'Harga pokok produk tidak tersedia',
  };
  const label = labels[reason.type] ?? 'Memerlukan persetujuan Owner';
  return reason.product_name ? `${label}: ${reason.product_name}` : label;
}

function ReportCategory({ node, depth = 0 }: { node: OpnameReportNode; depth?: number }) {
  return (
    <section className={`rounded-md border p-3 ${node.variance_count > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/40'}`} style={{ marginLeft: depth ? `${Math.min(depth, 3) * 0.5}rem` : undefined }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold">{node.name}</h4>
          <p className="text-sm text-slate-600">{node.products_counted} produk dihitung · {node.variance_count === 0 ? '✓ 0 selisih' : `${node.variance_count} produk berselisih`}</p>
        </div>
        {node.variance_count > 0 && <span className="text-sm tabular-nums">−{formatReportQty(node.short_qty)} / +{formatReportQty(node.over_qty)}</span>}
      </div>
      {node.lines.length > 0 && (
        <div className="mt-3 space-y-2">
          {node.lines.map((line) => (
            <article key={line.item_id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <div className="font-medium">{line.name}{line.revised && <span className="ml-2 text-xs font-normal text-indigo-700">↻ dihitung ulang</span>}</div>
                <span className={line.direction === 'short' ? 'font-semibold text-rose-700' : 'font-semibold text-emerald-700'}>
                  {line.direction === 'short' ? 'Kurang' : 'Lebih'} {formatReportQty(Math.abs(Number(line.diff_qty)))}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{line.barcode} · Sistem {formatReportQty(line.system_qty)} · Hitung {formatReportQty(line.counted_qty)}</p>
              {line.value !== undefined && (
                <p className="mt-1 text-xs text-slate-600">{line.cost_missing ? 'Harga pokok tidak tersedia' : `Nilai selisih ${formatReportMoney(line.value ?? 0)}`}</p>
              )}
            </article>
          ))}
        </div>
      )}
      {node.children.map((child) => <div key={child.id} className="mt-2"><ReportCategory node={child} depth={depth + 1} /></div>)}
    </section>
  );
}

function OpnameWorkflowPanel({
  session,
  report,
  reportLoading,
  reportError,
  csvDelimiter,
  csvPending,
  csvError,
  onCsvDelimiterChange,
  onDownloadCsv,
  canPost,
  postingAllowed,
  postBlockedReason,
  isOnline,
  canApprove,
  canReview,
  isOwner,
  onSubmit,
  onApprove,
  onReject,
  onRetry,
}: {
  session: OpnameSession;
  report?: OpnameReport;
  reportLoading: boolean;
  reportError: Error | null;
  csvDelimiter: CsvDelimiter;
  csvPending: 'summary' | 'detail' | null;
  csvError: Error | null;
  onCsvDelimiterChange: (delimiter: CsvDelimiter) => void;
  onDownloadCsv: (part: 'summary' | 'detail') => Promise<void>;
  canPost: boolean;
  postingAllowed: boolean;
  postBlockedReason: string;
  isOnline: boolean;
  canApprove: boolean;
  canReview: boolean;
  isOwner: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
}) {
  const complete = session.counted_products === session.total_products;
  const totals = report?.totals;
  return (
    <section aria-label="Laporan dan posting opname" className="opname-report space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {session.status === 'in_progress' && !isOnline && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Laporan dan posting hanya tersedia online. Tampilan hitungan offline selalu buta.</p>
      )}
      {session.status === 'in_progress' && !canReview && complete && (
        <p className="text-sm text-slate-600">Laporan selisih belum tersedia untuk akun ini.</p>
      )}
      {session.status === 'in_progress' && session.reject_reason && (
        <div role="status" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          Pengajuan sebelumnya ditolak: {session.reject_reason}
        </div>
      )}
      {reportLoading && <p role="status" className="text-sm text-slate-500">Memuat laporan opname…</p>}
      {reportError && <div className="space-y-2"><ErrorNotice error={reportError} /><button type="button" onClick={onRetry} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm">Coba lagi</button></div>}
      {session.status === 'in_progress' && canPost && complete && !report?.complete && (
        <div className="space-y-2">
          <button type="button" disabled className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white opacity-50 print:hidden">Posting Opname</button>
          <p className="text-sm text-amber-900">{!isOnline ? 'Posting hanya dapat dilakukan saat online.' : postBlockedReason || 'Laporan belum tersedia.'}</p>
        </div>
      )}
      {report?.complete && totals && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Laporan opname</h3>
              <p className="text-sm text-slate-600">{session.number} · {statusLabel(session.status)}</p>
              {report.provisional && <p className="text-xs text-slate-500">Pratinjau sementara — nilai akan dibekukan saat diajukan atau diposting.</p>}
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm">Cetak</button>
              <label className="sr-only" htmlFor="opname-csv-delimiter">Pemisah kolom CSV</label>
              <select id="opname-csv-delimiter" value={csvDelimiter} onChange={(event) => onCsvDelimiterChange(event.target.value as CsvDelimiter)} className="min-h-10 rounded-md border border-slate-300 px-2 text-sm">
                <option value="comma">Koma</option>
                <option value="semicolon">Excel Indonesia (titik koma)</option>
              </select>
              {(session.status === 'posted' || session.status === 'pending_approval') && (
                <>
                  <button type="button" onClick={() => void onDownloadCsv('summary')} disabled={csvPending !== null} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-50">
                    {csvPending === 'summary' ? 'Menyiapkan…' : 'Unduh ringkasan CSV'}
                  </button>
                  <button type="button" onClick={() => void onDownloadCsv('detail')} disabled={csvPending !== null} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-50">
                    {csvPending === 'detail' ? 'Menyiapkan…' : 'Unduh detail CSV'}
                  </button>
                </>
              )}
            </div>
          </div>
          {csvError && <ErrorNotice error={csvError} />}
          {report.clean && <div role="status" className="rounded-md bg-emerald-50 p-3 font-medium text-emerald-900">✓ Tidak ada selisih</div>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Produk dihitung">{totals.products_counted}/{totals.products_total}</Info>
            <Info label="Produk berselisih">{totals.variance_products}</Info>
            <Info label="Kurang / lebih">{totals.short_count} / {totals.over_count}</Info>
            <Info label="Jumlah bersih">{formatReportQty(totals.net_qty)}</Info>
            {totals.abs_value !== undefined && <Info label="Total nilai selisih">{formatReportMoney(totals.abs_value)}</Info>}
          </div>
          {report.approval?.required && (
            <div role="status" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <strong>Memerlukan persetujuan Owner</strong>
              {report.approval.reasons.map((reason, index) => <p key={`${reason.type}-${reason.product_id ?? index}`}>• {approvalReasonLabel(reason)}</p>)}
              {report.approval.thresholds && (
                <p className="pt-1 text-xs">Ambang per produk {formatReportMoney(report.approval.thresholds.per_product)} · per sesi {formatReportMoney(report.approval.thresholds.per_session)}</p>
              )}
            </div>
          )}
          {session.status === 'pending_approval' && !canApprove && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Sesi menunggu persetujuan Owner. Stok masih terkunci.</p>
          )}
          {session.status === 'pending_approval' && canApprove && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <button type="button" onClick={onApprove} className="min-h-11 rounded-md bg-emerald-700 px-4 font-medium text-white">Setujui dan posting</button>
              <button type="button" onClick={onReject} className="min-h-11 rounded-md border border-rose-300 px-4 font-medium text-rose-800">Tolak</button>
            </div>
          )}
          {session.status === 'in_progress' && canPost && complete && (
            <>
              <button type="button" disabled={!postingAllowed} onClick={onSubmit} className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white print:hidden disabled:opacity-50">
                {isOwner ? 'Posting Opname' : report.approval?.required ? 'Ajukan ke Owner' : 'Posting Opname'}
              </button>
              {!postingAllowed && <p className="text-sm text-amber-900">{postBlockedReason}</p>}
            </>
          )}
          {session.status === 'posted' && (
            <p className="text-sm text-emerald-800">Opname diposting pada {session.posted_at ? formatSessionTime(session.posted_at, 'Asia/Jakarta') : '—'}.</p>
          )}
          <div className="space-y-2">
            {report.categories?.map((node) => <ReportCategory key={node.id} node={node} />)}
          </div>
        </>
      )}
    </section>
  );
}

function OpnameWorkflowDialog({
  action,
  ownerRequired,
  ownerPassword,
  reason,
  error,
  pending,
  onPasswordChange,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  action: 'submit' | 'approve' | 'reject';
  ownerRequired: boolean;
  ownerPassword: string;
  reason: string;
  error: Error | null;
  pending: boolean;
  onPasswordChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const title = action === 'submit' ? 'Konfirmasi posting opname'
    : action === 'approve' ? 'Setujui dan posting opname'
      : 'Tolak pengajuan opname';
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-slate-900/50 md:items-center md:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="opname-workflow-title" className="my-auto w-full space-y-4 bg-white p-4 md:max-w-lg md:rounded-xl md:shadow-xl">
        <h3 id="opname-workflow-title" className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-slate-600">
          {action === 'reject' ? 'Alasan penolakan wajib diisi. Sesi akan kembali ke tahap penghitungan.' : 'Perubahan stok akan diproses dalam satu transaksi dan tidak dapat diulang.'}
        </p>
        {action !== 'reject' && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">Pastikan semua perangkat yang ikut menghitung sudah tersinkron.</p>}
        {action === 'reject' && (
          <label className="block space-y-1 text-sm font-medium">
            <span>Alasan penolakan</span>
            <textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} rows={3} className="w-full rounded-md border border-slate-300 p-3" />
          </label>
        )}
        {ownerRequired && (
          <label className="block space-y-1 text-sm font-medium">
            <span>Password Owner</span>
            <input type="password" autoComplete="current-password" value={ownerPassword} onChange={(event) => onPasswordChange(event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" />
          </label>
        )}
        {error && <ErrorNotice error={error} />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={pending} onClick={onClose} className="min-h-11 rounded-md border border-slate-300 px-4">Kembali</button>
          <button
            type="button"
            disabled={pending || (ownerRequired && !ownerPassword) || (action === 'reject' && reason.trim().length < 3)}
            onClick={onConfirm}
            className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Memproses…' : action === 'reject' ? 'Tolak' : action === 'approve' ? 'Setujui dan posting' : 'Konfirmasi'}
          </button>
        </div>
      </section>
    </div>
  );
}

function WorkspacePanels({
  id,
  tree,
  treeLoading,
  treeError,
  retryTree,
  search,
  searchDraft,
  updateSearch,
  searchResults,
  searchLoading,
  productSearchHasNext,
  loadMoreSearch,
  searchError,
  retrySearch,
  onlyUncounted,
  setOnlyUncounted,
  openNodeIds,
  setOpenNodeIds,
  view,
  onViewChange,
  active,
  scannerTestOpen,
  canCount,
  revealsSystemQty,
  workingNode,
}: {
  id: number;
  tree: OpnameProgressTree;
  treeLoading: boolean;
  treeError: Error | null;
  retryTree: () => void;
  search: string;
  searchDraft: string;
  updateSearch: (value: string) => void;
  searchResults: OpnameItem[];
  searchLoading: boolean;
  productSearchHasNext: boolean;
  loadMoreSearch: () => void;
  searchError: Error | null;
  retrySearch: () => void;
  onlyUncounted: boolean;
  setOnlyUncounted: (value: boolean) => void;
  openNodeIds: Set<string>;
  setOpenNodeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  active: boolean;
  scannerTestOpen: boolean;
  canCount: boolean;
  revealsSystemQty: boolean;
  workingNode: OpnameProgressNode | null;
}) {
  const {
    activeNodeId, setActiveNodeId, loadItem, highlightedItemId, selectedItem, startNode,
    isOnline, offlineIndex, offlineIndexReady, pendingOperations,
  } = useOpnameWorkspace();
  const [listCollapsed, setListCollapsed] = useState(false);
  const searching = search.trim().length >= 2;
  const mobile = useMobileViewport();
  const showList = (!mobile || view === 'daftar') && !listCollapsed;
  const showInput = !mobile || view === 'input';
  const visibleNodes = tree?.nodes ?? [];
  const pendingItems = useMemo(() => getPendingOfflineItems(offlineIndex, pendingOperations), [offlineIndex, pendingOperations]);
  const pendingMap = new Map(pendingItems.map((item) => [item.id, item]));
  const offlineItems = useMemo(() => offlineIndex
    ? offlineIndex.items.map((item) => pendingMap.get(item.item_id) ?? toOfflineOpnameItem(offlineIndex, item))
    : [], [offlineIndex, pendingItems]);
  return (
    <>
      <nav aria-label="Tampilan sesi opname" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {([
          ['input', 'Input'],
          ['daftar', 'Daftar'],
          ['ringkasan', 'Ringkasan'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => onViewChange(key)} className={`min-h-14 text-sm font-medium ${view === key ? 'border-t-2 border-slate-900 text-slate-900' : 'text-slate-600'}`}>
            {label}
          </button>
        ))}
      </nav>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label="Peta progres opname" className={`${showList ? '' : 'hidden'} max-h-[calc(100dvh-14rem)] min-w-0 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 sm:p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Daftar produk</h3>
            <button type="button" onClick={() => setListCollapsed((value) => !value)} className="hidden min-h-11 rounded-md border border-slate-300 px-3 text-sm md:inline-flex md:items-center lg:hidden">
              Lipat daftar
            </button>
          </div>
          <label className="mt-3 block">
            <span className="sr-only">Cari kategori, produk, atau barcode</span>
            <input type="search" value={searchDraft} onChange={(event) => updateSearch(event.target.value)} placeholder="Cari kategori, produk, barcode" className="min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" />
          </label>
          <div aria-label="Filter progres" className="mt-3 flex gap-2">
            {[['all', 'Semua'], ['uncounted', 'Belum dihitung']].map(([key, label]) => {
              const active = key === 'uncounted' ? onlyUncounted : !onlyUncounted;
              return (
                <button key={key} type="button" aria-pressed={active} onClick={() => setOnlyUncounted(key === 'uncounted')} className={`min-h-11 rounded-full border px-4 text-sm ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                  {label}
                </button>
              );
            })}
          </div>
          {treeLoading && <div role="status" className="mt-3 space-y-2">{[1, 2, 3].map((n) => <div key={n} className="h-12 animate-pulse rounded bg-slate-100" />)}</div>}
          {treeError && <div className="mt-3 space-y-2"><ErrorNotice error={treeError} /><button type="button" onClick={retryTree} className="min-h-11 rounded-md border px-3 text-sm">Coba lagi</button></div>}
          {!treeLoading && !treeError && tree && (
            <>
              {searching && searchError && <div className="mt-3 space-y-2"><ErrorNotice error={searchError} /><button type="button" onClick={retrySearch} className="min-h-11 rounded-md border px-3 text-sm">Coba lagi</button></div>}
              {searching && (
                <section aria-label="Hasil pencarian produk" className="mt-3 space-y-2">
                  <h4 className="text-sm font-semibold">Hasil produk</h4>
                  {searchLoading && <p role="status" className="text-sm text-slate-500">Mencari produk…</p>}
                  {!searchLoading && searchResults.length === 0 && !searchError && <p className="text-sm text-slate-500">Tidak ada produk yang cocok.</p>}
                  {searchResults.map((item) => (
                    <button key={item.id} type="button" onClick={() => loadItem(item)} className="w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50">
                      <span className="block font-medium">{item.name}</span>
                      <span className="block break-words text-xs text-slate-500">{item.barcode || 'Tanpa barcode'} · {item.category_path.join(' › ') || 'Lainnya'}</span>
                      {revealsSystemQty && <span className="mt-1 block"><ItemStatus status={item.status} /></span>}
                    </button>
                  ))}
                  {productSearchHasNext && (
                    <button type="button" disabled={searchLoading} onClick={loadMoreSearch} className="min-h-11 w-full rounded-md border border-slate-300 text-sm disabled:opacity-50">
                      {searchLoading ? 'Memuat…' : 'Muat lagi hasil'}
                    </button>
                  )}
                </section>
              )}
              <div role="tree" aria-label="Kategori opname" className="mt-3 space-y-1">
                {visibleNodes.filter((node) => (!onlyUncounted || node.status !== 'done') && (!search.trim() || nodeMatchesSearch(node, search))).map((node) => (
                  <CategoryNode
                    key={node.id}
                    sessionId={id}
                    node={node}
                    onlyUncounted={onlyUncounted}
                    query={search}
                    depth={0}
                    activeNodeId={activeNodeId}
                    setActiveNodeId={setActiveNodeId}
                    openNodeIds={openNodeIds}
                    setOpenNodeIds={setOpenNodeIds}
                    loadItem={loadItem}
                    startNode={startNode}
                    canStart={active && canCount}
                    revealsSystemQty={revealsSystemQty}
                    highlightedItemId={highlightedItemId}
                    selectedItemId={selectedItem?.id ?? null}
                    isOnline={isOnline}
                    offlineIndexReady={offlineIndexReady}
                    offlineItems={offlineItems}
                    pendingItemIds={new Set(pendingOperations.map((operation) => operation.item.item_id))}
                  />
                ))}
                {visibleNodes.length === 0 && <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">Belum ada produk dalam cakupan sesi.</p>}
                {visibleNodes.length > 0 && visibleNodes.every((node) => onlyUncounted && node.status === 'done') && <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">Semua produk sudah dihitung.</p>}
              </div>
            </>
          )}
        </section>
        {listCollapsed && <button type="button" onClick={() => setListCollapsed(false)} className="hidden min-h-11 rounded-md border border-slate-300 px-3 text-sm md:inline-flex md:items-center lg:hidden">Buka daftar progres</button>}
        <section aria-label="Panel input" className={`${showInput ? '' : 'hidden'} min-w-0 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 pb-16 md:max-h-[calc(100dvh-14rem)]`}>
          <CountingStack
            sessionId={id}
            active={active && !scannerTestOpen}
            canCount={canCount}
            revealsSystemQty={revealsSystemQty}
            tree={tree}
            workingNode={workingNode}
          />
        </section>
      </div>
    </>
  );
}

function nodeMatchesSearch(node: OpnameProgressNode, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('id-ID');
  return node.name.toLocaleLowerCase('id-ID').includes(normalized) || node.children.some((child) => nodeMatchesSearch(child, query));
}

function CategoryNode({
  sessionId,
  node,
  onlyUncounted,
  query,
  depth,
  activeNodeId,
  setActiveNodeId,
  openNodeIds,
  setOpenNodeIds,
  loadItem,
  startNode,
  canStart,
  revealsSystemQty,
  highlightedItemId,
  selectedItemId,
  isOnline,
  offlineIndexReady,
  offlineItems,
  pendingItemIds,
}: {
  sessionId: number;
  node: OpnameProgressNode;
  onlyUncounted: boolean;
  query: string;
  depth: number;
  activeNodeId: string | null;
  setActiveNodeId: (id: string) => void;
  openNodeIds: Set<string>;
  setOpenNodeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  loadItem: (item: OpnameItem) => void;
  startNode: (id: string) => void;
  canStart: boolean;
  revealsSystemQty: boolean;
  highlightedItemId: number | null;
  selectedItemId: number | null;
  isOnline: boolean;
  offlineIndexReady: boolean;
  offlineItems: OpnameItem[];
  pendingItemIds: Set<number>;
}) {
  const nodeId = String(node.id);
  const opened = openNodeIds.has(nodeId);
  const selected = activeNodeId === nodeId;
  const directProductCount = onlyUncounted
    ? Math.max(0, node.direct_product_count - node.direct_counted_count)
    : node.direct_product_count;
  const directItems = useInfiniteQuery({
    queryKey: ['opname', 'items', sessionId, nodeId, onlyUncounted, query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => opnameApi.items(sessionId, {
      category_id: node.id === 'other' ? 0 : Number(node.id),
      scope: 'direct',
      only_uncounted: onlyUncounted ? true : undefined,
      page: pageParam,
      per_page: 100,
    }),
    getNextPageParam: (lastPage) => lastPage.current_page < lastPage.last_page ? lastPage.current_page + 1 : undefined,
    enabled: isOnline && opened && directProductCount > 0,
    refetchInterval: () => document.visibilityState === 'visible' ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const offlineRows = offlineItems.filter((item) => {
    const categoryMatches = node.id === 'other'
      ? item.category_id === null || item.category_path.length === 0
      : item.category_id === Number(node.id);
    const countMatches = !onlyUncounted || item.counted_qty === null;
    const queryMatches = !query.trim()
      || `${item.name} ${item.barcode}`.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID'));
    return categoryMatches && countMatches && queryMatches;
  }).slice(0, 100);
  const items = isOnline ? directItems.data?.pages.flatMap((page) => page.data) ?? [] : offlineRows;

  function toggle() {
    setActiveNodeId(nodeId);
    setOpenNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function loadMore() {
    if (directItems.hasNextPage && !directItems.isFetchingNextPage) void directItems.fetchNextPage();
  }

  const childNodes = node.children.filter((child) => (!onlyUncounted || child.status !== 'done') && (!query.trim() || nodeMatchesSearch(child, query)));
  return (
    <div role="treeitem" aria-expanded={opened} id={`opname-node-${nodeId}`}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={opened}
          onClick={toggle}
          style={{ paddingInlineStart: `${12 + depth * 16}px` }}
          className={`flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left ${selected ? 'border-blue-700 bg-blue-50 ring-1 ring-blue-700' : 'border-transparent hover:bg-slate-50'}`}
        >
          <span aria-hidden="true" className="w-5 shrink-0 text-lg">{opened ? '⌄' : '›'}</span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-medium">{node.name} <span className="font-normal text-slate-500">({node.product_count})</span></span>
            <span className="mt-1 flex items-center gap-2">
              <span className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-slate-200">
                <span className="block h-full bg-emerald-600" style={{ width: progressWidth(node.counted_count, node.product_count) }} />
              </span>
              <span className="shrink-0 text-xs text-slate-600">{node.counted_count}/{node.product_count}</span>
            </span>
          </span>
          <NodeStatus status={node.status} />
          {revealsSystemQty && node.variance_count !== undefined && node.variance_count > 0 && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">{node.variance_count} selisih</span>}
        </button>
        {canStart && node.status !== 'done' && <button type="button" onClick={() => startNode(nodeId)} className="min-h-11 shrink-0 rounded-md border border-slate-300 px-2 text-xs font-medium">Mulai</button>}
      </div>
      {opened && (
        <div role="group" className="space-y-1">
          {childNodes.map((child) => (
            <CategoryNode
              key={child.id}
              sessionId={sessionId}
              node={child}
              onlyUncounted={onlyUncounted}
              query={query}
              depth={depth + 1}
              activeNodeId={activeNodeId}
              setActiveNodeId={setActiveNodeId}
              openNodeIds={openNodeIds}
              setOpenNodeIds={setOpenNodeIds}
              loadItem={loadItem}
              startNode={startNode}
              canStart={canStart}
              revealsSystemQty={revealsSystemQty}
              highlightedItemId={highlightedItemId}
              selectedItemId={selectedItemId}
              isOnline={isOnline}
              offlineIndexReady={offlineIndexReady}
              offlineItems={offlineItems}
              pendingItemIds={pendingItemIds}
            />
          ))}
          {directProductCount > 0 && <p className="pl-10 pt-2 text-xs font-medium text-slate-500">Tanpa sub-kategori ({directProductCount})</p>}
          {opened && directProductCount > 0 && directItems.isLoading && <div role="status" className="space-y-2 px-4 py-2">{[1, 2].map((n) => <div key={n} className="h-14 animate-pulse rounded bg-slate-100" />)}</div>}
          {isOnline && directItems.error && <div className="px-4 py-2"><ErrorNotice error={directItems.error} /><button type="button" onClick={() => void directItems.refetch()} className="mt-2 min-h-11 rounded-md border px-3 text-sm">Coba lagi</button></div>}
          {items.map((item) => (
            <ProductRow
              key={item.id}
              item={item}
              selected={selectedItemId === item.id}
              highlighted={highlightedItemId === item.id}
              revealsSystemQty={revealsSystemQty}
              pending={pendingItemIds.has(item.id)}
              onSelect={() => loadItem(item)}
            />
          ))}
          {!isOnline && !offlineIndexReady && directProductCount > 0 && <p className="py-2 pl-10 text-sm text-amber-900">Indeks offline belum tersedia. Sambungkan jaringan sebelum mencari produk.</p>}
          {(isOnline ? directItems.data !== undefined && !directItems.error : offlineIndexReady) && directProductCount > 0 && !directItems.isLoading && !directItems.error && items.length === 0 && <p className="py-2 pl-10 text-sm text-slate-500">Tidak ada produk pada kategori ini untuk filter yang dipilih.</p>}
          {isOnline && directItems.hasNextPage && (
            <button type="button" disabled={directItems.isFetchingNextPage} onClick={loadMore} className="ml-10 min-h-11 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-50">{directItems.isFetchingNextPage ? 'Memuat…' : 'Muat lagi'}</button>
          )}
          {node.direct_product_count === 0 && childNodes.length === 0 && <p className="py-2 pl-10 text-sm text-slate-500">Tidak ada produk pada kategori ini.</p>}
        </div>
      )}
    </div>
  );
}

function ProductRow({
  item,
  selected,
  highlighted,
  revealsSystemQty,
  pending = false,
  onSelect,
}: {
  item: OpnameItem;
  selected: boolean;
  highlighted: boolean;
  revealsSystemQty: boolean;
  pending?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`ml-8 flex min-h-14 w-[calc(100%-2rem)] items-center gap-2 border-b border-slate-100 px-2 py-2 text-left sm:ml-10 sm:w-[calc(100%-2.5rem)] ${highlighted ? 'bg-emerald-50' : selected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
    >
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{item.name}</p>
        <p className="break-all text-xs text-slate-500">{item.barcode || 'Tanpa barcode'}</p>
        {item.counted_qty !== null && <p className="text-xs text-slate-600">Hitungan: {item.counted_qty}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {pending && <PendingBadge />}
        {revealsSystemQty && <ItemStatus status={item.status} />}
        {revealsSystemQty && item.system_qty !== undefined && <span className="text-xs text-slate-500">Stok: {item.system_qty}</span>}
      </div>
    </button>
  );
}

function NodeStatus({ status }: { status: OpnameProgressNode['status'] }) {
  const values = {
    not_started: ['○', 'Belum'],
    partial: ['◐', 'Sebagian'],
    done: ['✓', 'Selesai'],
  } as const;
  const [icon, label] = values[status];
  const tone = status === 'done' ? 'text-emerald-800' : status === 'partial' ? 'text-orange-800' : 'text-slate-700';
  return <span className={`shrink-0 text-xs ${tone}`} aria-label={label}>{icon} <span className="hidden sm:inline">{label}</span></span>;
}

function ItemStatus({ status }: { status: OpnameItem['status'] }) {
  const values = {
    uncounted: ['○', 'Belum'],
    counted: ['✓', 'Sudah dihitung'],
    matched: ['✓', 'Cocok'],
    variance: ['±', 'Selisih'],
  } as const;
  const [icon, label] = values[status];
  const tone = status === 'variance' ? 'bg-amber-100 text-amber-950'
    : status === 'counted' || status === 'matched' ? 'bg-emerald-100 text-emerald-950'
      : 'bg-slate-100 text-slate-800';
  return <span className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-xs ${tone}`}><span aria-hidden="true">{icon}</span>{label}</span>;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm">{children}</dd></div>;
}

function CancelSessionDialog({
  reason,
  error,
  pending,
  onReasonChange,
  onCancel,
  onSubmit,
}: {
  reason: string;
  error: Error | null;
  pending: boolean;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-slate-900/50 md:items-center md:p-4">
      <form onSubmit={submit} className="my-auto w-full bg-white p-5 md:max-w-lg md:rounded-xl md:shadow-xl" role="dialog" aria-modal="true" aria-labelledby="cancel-opname-title">
        <h3 id="cancel-opname-title" className="text-lg font-semibold">Batalkan sesi opname?</h3>
        <p className="mt-1 text-sm text-slate-600">Sertakan alasan pembatalan sesi.</p>
        <label className="mt-4 block text-sm font-medium">
          Alasan <span className="text-rose-700">*</span>
          <textarea
            autoFocus
            required
            maxLength={5000}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            disabled={pending}
            rows={4}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        {error && <p role="alert" className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error instanceof ApiError ? error.firstError('reason') : error.message}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={pending} className="min-h-11 rounded-md border border-slate-300 px-4">Kembali</button>
          <button type="submit" disabled={pending || reason.trim() === ''} className="min-h-11 rounded-md bg-rose-700 px-4 font-medium text-white disabled:opacity-50">
            {pending ? 'Membatalkan…' : 'Batalkan sesi'}
          </button>
        </div>
      </form>
    </div>
  );
}
