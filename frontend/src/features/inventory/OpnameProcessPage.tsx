import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthProvider';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameItem, OpnameReport } from '@/lib/api/types';
import { canFinish, formatCount, formatDiff, newRequestId, parseCount, shortMessage, varianceRows } from './opnameProcess';

const PER_PAGE = 50;
const LIST_HREF = '/inventory/adjustments/opname';
const HISTORY_HREF = '/inventory/adjustments/adjustment';

type Dialog = 'finish' | 'cancel' | 'review';
const fieldCls = 'min-h-11 w-full rounded-md border border-slate-300 px-3';

export function OpnameProcessPage() {
  const id = Number(useParams().sessionId);
  const { can, me } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isOwner = me?.roles.includes('Owner') ?? false;

  const [filter, setFilter] = useState<'todo' | 'done'>('todo');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [printRequested, setPrintRequested] = useState(false);
  const [printJob, setPrintJob] = useState<{ report: OpnameReport; items: OpnameItem[] } | null>(null);
  const requestId = useRef('');

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim().length >= 2 ? search.trim() : ''), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setPage(1); }, [filter, term]);

  const session = useQuery({ queryKey: ['opname', id, 'session'], queryFn: () => opnameApi.get(id), enabled: Number.isFinite(id) });
  const data = session.data;
  const counting = data?.status === 'in_progress';

  const items = useQuery({
    queryKey: ['opname', id, 'items', filter, term, page],
    queryFn: () => opnameApi.items(id, {
      only_uncounted: filter === 'todo' ? true : undefined,
      only_counted: filter === 'done' ? true : undefined,
      q: term || undefined,
      page,
      per_page: PER_PAGE,
    }),
    enabled: counting,
    placeholderData: keepPreviousData,
  });

  const report = useQuery({
    queryKey: ['opname', id, 'report'],
    queryFn: () => opnameApi.report(id),
    enabled: data?.status === 'pending_approval',
    retry: false,
  });
  const printItems = useQuery({
    queryKey: ['opname', id, 'print-items'],
    queryFn: async () => {
      const firstPage = await opnameApi.items(id, { only_counted: true, page: 1, per_page: 200 });
      const remainingPages = await Promise.all(
        Array.from({ length: firstPage.last_page - 1 }, (_, index) =>
          opnameApi.items(id, { only_counted: true, page: index + 2, per_page: 200 }),
        ),
      );
      return [firstPage, ...remainingPages].flatMap((page) => page.data);
    },
    enabled: printRequested,
    retry: false,
  });

  useEffect(() => {
    if (printRequested && printItems.data && report.data) {
      setPrintJob({ report: report.data, items: printItems.data });
      setPrintRequested(false);
    } else if (printRequested && printItems.isError && !printItems.isFetching) {
      setPrintRequested(false);
    }
  }, [printRequested, printItems.data, printItems.isError, report.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['opname'] });

  const save = useMutation({
    mutationFn: (input: { item: OpnameItem; quantity: number }) => opnameApi.storeCount(id, {
      item_id: input.item.id, mode: 'set', quantity: input.quantity, client_request_id: newRequestId(),
    }),
    onSuccess: (_result, input) => {
      setDrafts((current) => { const next = { ...current }; delete next[input.item.id]; return next; });
      setRowErrors((current) => { const next = { ...current }; delete next[input.item.id]; return next; });
      void refresh();
    },
    onError: (error, input) => setRowErrors((current) => ({ ...current, [input.item.id]: shortMessage(error, 'Gagal') })),
  });

  function open(next: Dialog) {
    requestId.current = newRequestId();
    setPassword('');
    setReason('');
    finish.reset();
    cancel.reset();
    approve.reset();
    setDialog(next);
  }

  const finish = useMutation({
    mutationFn: () => opnameApi.submit(id, { client_request_id: requestId.current, ...(isOwner ? { owner_password: password } : {}) }),
    onSuccess: (result) => {
      setDialog(null);
      void refresh();
      if (result.status === 'posted') navigate(HISTORY_HREF);
    },
  });
  const cancel = useMutation({
    mutationFn: () => opnameApi.cancel(id, reason.trim()),
    onSuccess: () => { void refresh(); navigate(LIST_HREF); },
  });
  const approve = useMutation({
    mutationFn: () => opnameApi.approve(id, { client_request_id: requestId.current, owner_password: password }),
    onSuccess: () => { setDialog(null); void refresh(); navigate(HISTORY_HREF); },
  });

  if (session.isLoading || !data) {
    return (
      <div className="space-y-3">
        <Link to={LIST_HREF} className="text-sm font-medium text-blue-700">‹ Opname</Link>
        {session.isError ? <p role="alert" className="text-sm text-red-700">{shortMessage(session.error, 'Gagal memuat')}</p> : <p className="text-slate-500">Memuat…</p>}
      </div>
    );
  }

  const total = data.total_products;
  const counted = data.counted_products;
  const percent = total === 0 ? 0 : Math.round((counted / total) * 100);
  const rows = items.data?.data ?? [];
  const lastPage = items.data?.last_page ?? 1;
  const variances = varianceRows(report.data);

  function submit(item: OpnameItem) {
    const quantity = parseCount(drafts[item.id] ?? formatCount(item.counted_qty));
    if (quantity !== null) save.mutate({ item, quantity });
  }

  const pending = finish.isPending || cancel.isPending || approve.isPending;
  const dialogError = finish.error ?? cancel.error ?? approve.error;
  const needsPassword = dialog === 'review' || (dialog === 'finish' && isOwner);
  const reasonOk = reason.trim().length >= 3;
  const confirmDisabled = pending
    || (needsPassword && password === '')
    || (dialog === 'cancel' && !reasonOk);

  function confirm() {
    if (dialog === 'finish') finish.mutate();
    else if (dialog === 'cancel') cancel.mutate();
    else if (dialog === 'review') approve.mutate();
  }

  return (
    <>
    <div className="no-print space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to={LIST_HREF} className="text-sm font-medium text-blue-700">‹ Opname</Link>
          <h2 className="text-lg font-semibold">{data.number}</h2>
        </div>
        {counting && (
          <div className="flex gap-2">
            {can('opname.cancel') && <button type="button" onClick={() => open('cancel')} className="min-h-11 rounded-md border border-slate-300 px-4">Batal</button>}
            {can('opname.post') && (
              <button type="button" disabled={!canFinish(counted, total)} onClick={() => open('finish')} className="min-h-11 rounded-md bg-slate-900 px-5 font-medium text-white disabled:opacity-40">Lanjutkan</button>
            )}
          </div>
        )}
      </div>

      {counting && (
        <>
          <div>
            <div className="flex justify-between text-sm tabular-nums"><span>{counted}/{total}</span><span>{percent}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-slate-900" style={{ width: `${percent}%` }} />
            </div>
          </div>
          {data.reject_reason && <p role="status" className="text-sm text-red-700">Ditolak: {data.reject_reason}</p>}

          <input
            type="search"
            aria-label="Cari produk"
            placeholder="Cari"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={fieldCls}
          />
          <div role="tablist" className="flex gap-2">
            {([['todo', `Belum ${total - counted}`], ['done', `Sudah ${counted}`]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`min-h-10 rounded-full border px-4 text-sm ${filter === key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {items.isError && <p role="alert" className="text-sm text-red-700">{shortMessage(items.error, 'Gagal memuat')}</p>}
          <ul>
            {rows.map((item) => {
              const value = drafts[item.id] ?? formatCount(item.counted_qty);
              const unchanged = item.counted_qty !== null && value === formatCount(item.counted_qty);
              return (
                <li key={item.id} className="border-b border-slate-100 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.name}</div>
                      {item.barcode && <div className="truncate text-xs text-slate-500">{item.barcode}</div>}
                    </div>
                    <input
                      inputMode="decimal"
                      aria-label={`Hitungan ${item.name}`}
                      value={value}
                      onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                      onKeyDown={(event) => { if (event.key === 'Enter') submit(item); }}
                      className="min-h-11 w-24 rounded-md border border-slate-300 px-3 text-right tabular-nums"
                    />
                    <button
                      type="button"
                      disabled={unchanged || parseCount(value) === null || (save.isPending && save.variables?.item.id === item.id)}
                      onClick={() => submit(item)}
                      className="min-h-11 w-14 rounded-md bg-slate-900 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {item.counted_qty !== null && unchanged ? '✓' : 'OK'}
                    </button>
                  </div>
                  {rowErrors[item.id] && <p role="alert" className="mt-1 text-xs text-red-700">{rowErrors[item.id]}</p>}
                </li>
              );
            })}
          </ul>
          {!items.isFetching && rows.length === 0 && <p className="py-6 text-center text-slate-500">—</p>}
          {lastPage > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-10 rounded-md border border-slate-300 px-4 disabled:opacity-40" aria-label="Sebelumnya">‹</button>
              <span className="text-sm tabular-nums">{page}/{lastPage}</span>
              <button type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)} className="min-h-10 rounded-md border border-slate-300 px-4 disabled:opacity-40" aria-label="Berikutnya">›</button>
            </div>
          )}
        </>
      )}

      {data.status === 'pending_approval' && (
        <div className="space-y-3">
          <p className="font-medium">Menunggu persetujuan</p>
          {report.isPending && <p className="text-sm text-slate-500">Memuat hasil opname…</p>}
          {report.isError && <p role="alert" className="text-sm text-red-700">{shortMessage(report.error, 'Gagal memuat hasil opname')}</p>}
          {can('opname.approve') && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!report.data || printItems.isFetching}
                onClick={() => setPrintRequested(true)}
                className="min-h-11 rounded-md border border-slate-300 px-5 disabled:opacity-50"
              >
                {printItems.isFetching ? 'Menyiapkan…' : 'Cetak'}
              </button>
              <button
                type="button"
                disabled={!report.data}
                onClick={() => open('review')}
                className="min-h-11 rounded-md bg-slate-900 px-5 font-medium text-white disabled:opacity-50"
              >
                Periksa
              </button>
            </div>
          )}
          {printItems.isError && !printItems.isFetching && (
            <p role="alert" className="text-sm text-red-700">{shortMessage(printItems.error, 'Gagal memuat hasil untuk dicetak')}</p>
          )}
        </div>
      )}

      {data.status === 'posted' && <p className="font-medium">Selesai</p>}
      {data.status === 'cancelled' && <p className="font-medium">Dibatalkan</p>}

      {dialog && (
        <Modal
          title={dialog === 'finish' ? 'Lanjutkan stok opname?' : dialog === 'cancel' ? 'Batalkan stok opname?' : 'Periksa Hasil Opname'}
          onClose={() => { if (!pending) setDialog(null); }}
        >
          <div className="max-h-[65dvh] space-y-4 overflow-y-auto p-5">
            {dialog === 'review' && report.data && (
              <>
                <dl className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm">
                  <div><dt className="text-slate-500">Produk dihitung</dt><dd className="font-medium">{report.data.totals?.products_counted ?? data.counted_products}/{report.data.totals?.products_total ?? data.total_products}</dd></div>
                  <div><dt className="text-slate-500">Produk berselisih</dt><dd className="font-medium">{report.data.totals?.variance_products ?? variances.length}</dd></div>
                  <div><dt className="text-slate-500">Total kurang</dt><dd className="font-medium">{formatCount(report.data.totals?.short_qty)}</dd></div>
                  <div><dt className="text-slate-500">Total lebih</dt><dd className="font-medium">{formatCount(report.data.totals?.over_qty)}</dd></div>
                </dl>
                {variances.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-600">
                        <tr><th className="px-3 py-2">Produk</th><th className="px-3 py-2">Stok sistem</th><th className="px-3 py-2">Hasil hitung</th><th className="px-3 py-2">Selisih</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {variances.map((row) => (
                          <tr key={row.id}>
                            <td className="px-3 py-2">
                              <div className="font-medium">{row.name}</div>
                              <div className="text-xs text-slate-500">{row.category}{row.barcode ? ` · ${row.barcode}` : ''}</div>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{formatCount(row.systemQty)}</td>
                            <td className="px-3 py-2 tabular-nums">{formatCount(row.countedQty)}</td>
                            <td className={`px-3 py-2 font-medium tabular-nums ${row.diff < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatDiff(row.diff)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">Tidak ada selisih stok.</p>}
              </>
            )}
            {dialog === 'cancel' && (
              <input aria-label="Alasan" placeholder="Alasan" value={reason} onChange={(event) => setReason(event.target.value)} className={fieldCls} />
            )}
            {needsPassword && (
              <input type="password" autoComplete="current-password" aria-label="Password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className={fieldCls} />
            )}
            {dialogError && <p role="alert" className="text-sm text-red-700">{shortMessage(dialogError, 'Gagal')}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={pending} onClick={() => setDialog(null)} className="min-h-11 rounded-md border border-slate-300 px-4">Kembali</button>
            <button type="button" disabled={confirmDisabled} onClick={confirm} className="min-h-11 rounded-md bg-slate-900 px-5 font-medium text-white disabled:opacity-50">
              {pending ? '…' : dialog === 'finish' ? 'Selesai' : dialog === 'cancel' ? 'Batalkan' : 'Lanjutkan'}
            </button>
          </div>
        </Modal>
      )}
    </div>
    {printJob && <OpnamePrintSheet report={printJob.report} items={printJob.items} storeName={me?.store?.name ?? ''} onDone={() => setPrintJob(null)} />}
    </>
  );
}

function OpnamePrintSheet({ report, items, storeName, onDone }: { report: OpnameReport; items: OpnameItem[]; storeName: string; onDone: () => void }) {
  const variances = new Map(varianceRows(report).map((row) => [row.id, row]));
  const rows = items.map((item) => {
    const variance = variances.get(item.id);
    return {
      id: item.id,
      name: item.name,
      barcode: item.barcode,
      category: item.category_path.join(' / ') || variance?.category || '—',
      systemQty: item.system_qty ?? variance?.systemQty ?? null,
      countedQty: item.counted_qty,
      diff: variance ? formatDiff(variance.diff) : '0',
    };
  });

  useEffect(() => {
    window.addEventListener('afterprint', onDone, { once: true });
    const timer = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', onDone);
    };
  }, [onDone]);

  return (
    <div className="print-only print-doc">
      <article>
        <header className="mb-4 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div>
            <div className="text-base font-bold">{storeName}</div>
            <h1 className="text-xl font-bold tracking-wide">HASIL STOK OPNAME</h1>
          </div>
          <div className="text-right text-sm font-bold">{report.session.number}</div>
        </header>
        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="font-semibold">Produk dihitung</dt><dd>{report.totals?.products_counted ?? 0}/{report.totals?.products_total ?? 0}</dd></div>
          <div><dt className="font-semibold">Produk berselisih</dt><dd>{report.totals?.variance_products ?? rows.length}</dd></div>
          <div><dt className="font-semibold">Total kurang</dt><dd>{formatCount(report.totals?.short_qty)}</dd></div>
          <div><dt className="font-semibold">Total lebih</dt><dd>{formatCount(report.totals?.over_qty)}</dd></div>
        </dl>
        {rows.length > 0 ? (
          <table>
            <thead>
              <tr><th>No</th><th>Produk</th><th>Kategori</th><th>Barcode</th><th>Stok sistem</th><th>Hasil hitung</th><th>Selisih</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td>{index + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.category}</td>
                  <td>{row.barcode || '—'}</td>
                  <td className="text-right">{formatCount(row.systemQty)}</td>
                  <td className="text-right">{formatCount(row.countedQty)}</td>
                  <td className="text-right">{row.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>Tidak ada selisih stok.</p>}
      </article>
    </div>
  );
}
