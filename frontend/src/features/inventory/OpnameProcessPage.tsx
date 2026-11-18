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

type Dialog = 'finish' | 'cancel' | 'review' | 'authorize_reconciliation';
type ReconciliationAction = 'write_off' | 'correction';
const fieldCls = 'min-h-11 w-full rounded-md border border-slate-300 px-3';

export function OpnameProcessPage() {
  const id = Number(useParams().sessionId);
  const { can, me } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<'todo' | 'done'>('todo');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [goodDrafts, setGoodDrafts] = useState<Record<number, string>>({});
  const [damagedDrafts, setDamagedDrafts] = useState<Record<number, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [reconciliationActions, setReconciliationActions] = useState<Record<number, ReconciliationAction | ''>>({});
  const [reconciliationReasons, setReconciliationReasons] = useState<Record<number, string>>({});
  const [approverUsername, setApproverUsername] = useState('');
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
      const firstPage = await opnameApi.items(id, { only_counted: true, include_sources: true, page: 1, per_page: 200 });
      const remainingPages = await Promise.all(
        Array.from({ length: firstPage.last_page - 1 }, (_, index) =>
          opnameApi.items(id, { only_counted: true, include_sources: true, page: index + 2, per_page: 200 }),
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
    mutationFn: (input: { item: OpnameItem; quantity?: number; good_quantity?: number; damaged_quantity?: number }) => {
      const { item, ...counts } = input;
      return opnameApi.storeCount(id, {
        item_id: item.id, mode: 'set', ...counts, client_request_id: newRequestId(),
      });
    },
    onSuccess: (_result, input) => {
      setDrafts((current) => { const next = { ...current }; delete next[input.item.id]; return next; });
      setGoodDrafts((current) => { const next = { ...current }; delete next[input.item.id]; return next; });
      setDamagedDrafts((current) => { const next = { ...current }; delete next[input.item.id]; return next; });
      setRowErrors((current) => { const next = { ...current }; delete next[input.item.id]; return next; });
      void refresh();
    },
    onError: (error, input) => setRowErrors((current) => ({ ...current, [input.item.id]: shortMessage(error, 'Gagal') })),
  });

  function open(next: Dialog) {
    requestId.current = newRequestId();
    setPassword('');
    setApproverUsername(can('opname.approve') ? me?.user.username ?? '' : '');
    setReason('');
    if (next === 'review') {
      setReconciliationActions({});
      setReconciliationReasons({});
    }
    finish.reset();
    cancel.reset();
    approve.reset();
    setDialog(next);
  }

  const finish = useMutation({
    mutationFn: () => opnameApi.submit(id, { client_request_id: requestId.current }),
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
    mutationFn: (reconciliations: Array<{ item_id: number; action: ReconciliationAction; reason: string }>) =>
      opnameApi.approve(id, {
        client_request_id: requestId.current,
        approver_username: approverUsername.trim(),
        owner_password: password,
        reconciliations,
      }),
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
    if (data?.condition_counting) {
      const good_quantity = parseCount(goodDrafts[item.id] ?? formatCount(item.counted_good_qty));
      const damaged_quantity = parseCount(damagedDrafts[item.id] ?? formatCount(item.counted_damaged_qty));
      if (good_quantity !== null && damaged_quantity !== null) save.mutate({ item, good_quantity, damaged_quantity });
      return;
    }

    const quantity = parseCount(drafts[item.id] ?? formatCount(item.counted_qty));
    if (quantity !== null) save.mutate({ item, quantity });
  }

  const pending = finish.isPending || cancel.isPending || approve.isPending;
  const dialogError = finish.error ?? cancel.error ?? approve.error;
  const needsPassword = dialog === 'authorize_reconciliation';
  const reasonOk = reason.trim().length >= 3;
  const confirmDisabled = pending
    || (needsPassword && (password === '' || approverUsername.trim() === ''))
    || (dialog === 'review' && variances.some((row) =>
      !reconciliationActions[row.id] || (reconciliationReasons[row.id] ?? '').trim().length < 3))
    || (dialog === 'cancel' && !reasonOk);

  function confirm() {
    if (dialog === 'finish') finish.mutate();
    else if (dialog === 'cancel') cancel.mutate();
    else if (dialog === 'review') {
      setPassword('');
      approve.reset();
      setDialog('authorize_reconciliation');
    } else if (dialog === 'authorize_reconciliation') {
      const reconciliations = variances.flatMap((row) => {
        const action = reconciliationActions[row.id];
        return action ? [{
          item_id: row.id,
          action,
          reason: (reconciliationReasons[row.id] ?? '').trim(),
        }] : [];
      });
      approve.mutate(reconciliations);
    }
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
              const goodValue = goodDrafts[item.id] ?? formatCount(item.counted_good_qty);
              const damagedValue = damagedDrafts[item.id] ?? formatCount(item.counted_damaged_qty);
              const unchangedConditions = item.counted_good_qty !== null
                && item.counted_damaged_qty !== null
                && goodValue === formatCount(item.counted_good_qty)
                && damagedValue === formatCount(item.counted_damaged_qty);
              const invalidConditions = parseCount(goodValue) === null || parseCount(damagedValue) === null;
              const unchangedInput = data.condition_counting ? unchangedConditions : unchanged;
              const invalidInput = data.condition_counting
                ? invalidConditions
                : parseCount(value) === null;
              return (
                <li key={item.id} className="border-b border-slate-100 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.name}</div>
                      {item.barcode && <div className="truncate text-xs text-slate-500">{item.barcode}</div>}
                    </div>
                    {data.condition_counting ? (
                      <>
                        <label className="w-24 text-xs text-slate-600">
                          Bagus
                          <input
                            inputMode="decimal"
                            aria-label={`Hitungan barang bagus ${item.name}`}
                            value={goodValue}
                            onChange={(event) => setGoodDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                            onKeyDown={(event) => { if (event.key === 'Enter') submit(item); }}
                            className="min-h-11 w-full rounded-md border border-slate-300 px-3 text-right text-base text-slate-900 tabular-nums"
                          />
                        </label>
                        <label className="w-24 text-xs text-slate-600">
                          Rusak
                          <input
                            inputMode="decimal"
                            aria-label={`Hitungan barang rusak ${item.name}`}
                            value={damagedValue}
                            onChange={(event) => setDamagedDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                            onKeyDown={(event) => { if (event.key === 'Enter') submit(item); }}
                            className="min-h-11 w-full rounded-md border border-slate-300 px-3 text-right text-base text-slate-900 tabular-nums"
                          />
                        </label>
                      </>
                    ) : (
                      <input
                        inputMode="decimal"
                        aria-label={`Hitungan ${item.name}`}
                        value={value}
                        onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                        onKeyDown={(event) => { if (event.key === 'Enter') submit(item); }}
                        className="min-h-11 w-24 rounded-md border border-slate-300 px-3 text-right tabular-nums"
                      />
                    )}
                    <button
                      type="button"
                      disabled={unchangedInput || invalidInput || (save.isPending && save.variables?.item.id === item.id)}
                      onClick={() => submit(item)}
                      className="min-h-11 w-14 rounded-md bg-slate-900 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {unchangedInput ? '✓' : 'OK'}
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
          <p className="font-medium">Draft hasil opname</p>
          <p className="text-sm text-slate-600">Cetak hasil sementara atau periksa selisih dan pilih tindakan rekonsiliasi stok.</p>
          {report.isPending && <p className="text-sm text-slate-500">Memuat hasil opname…</p>}
          {report.isError && <p role="alert" className="text-sm text-red-700">{shortMessage(report.error, 'Gagal memuat hasil opname')}</p>}
          {(can('opname.post') || can('opname.approve')) && (
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
          title={dialog === 'finish' ? 'Lanjutkan stok opname?' : dialog === 'cancel' ? 'Batalkan stok opname?' : dialog === 'authorize_reconciliation' ? 'Persetujuan Owner' : 'Periksa Hasil Opname'}
          onClose={() => { if (!pending) setDialog(null); }}
        >
          <div className="max-h-[65dvh] space-y-4 overflow-y-auto p-5">
            {dialog === 'review' && report.data && (
              <>
                <dl className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm">
                  <div><dt className="text-slate-500">Produk dihitung</dt><dd className="font-medium">{report.data.totals?.products_counted ?? data.counted_products}/{report.data.totals?.products_total ?? data.total_products}</dd></div>
                  <div><dt className="text-slate-500">Jumlah total produk yang selisih</dt><dd className="font-medium">{report.data.totals?.variance_products ?? variances.length}</dd></div>
                  <div><dt className="text-slate-500">Total kurang</dt><dd className="font-medium">{formatCount(report.data.totals?.short_qty)}</dd></div>
                  <div><dt className="text-slate-500">Total lebih</dt><dd className="font-medium">{formatCount(report.data.totals?.over_qty)}</dd></div>
                </dl>
                {variances.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-600">
                        {data.condition_counting ? (
                          <tr>
                            <th className="px-3 py-2">Produk</th>
                            <th className="px-3 py-2">Stok bagus</th><th className="px-3 py-2">Barang bagus</th><th className="px-3 py-2">Selisih bagus</th>
                            <th className="px-3 py-2">Stok rusak</th><th className="px-3 py-2">Barang rusak</th><th className="px-3 py-2">Selisih rusak</th>
                            <th className="px-3 py-2">Rekonsiliasi</th>
                          </tr>
                        ) : (
                          <tr><th className="px-3 py-2">Produk</th><th className="px-3 py-2">Stok sistem</th><th className="px-3 py-2">Hasil hitung</th><th className="px-3 py-2">Selisih</th><th className="px-3 py-2">Rekonsiliasi</th></tr>
                        )}
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {variances.map((row) => (
                          <tr key={row.id}>
                            <td className="px-3 py-2">
                              <div className="font-medium">{row.name}</div>
                              <div className="text-xs text-slate-500">{row.category}{row.barcode ? ` · ${row.barcode}` : ''}</div>
                            </td>
                            {data.condition_counting ? (
                              <>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.systemGoodQty)}</td>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.countedGoodQty)}</td>
                                <td className="px-3 py-2 font-medium tabular-nums">{formatDiff(row.diffGoodQty ?? 0)}</td>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.systemDamagedQty)}</td>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.countedDamagedQty)}</td>
                                <td className="px-3 py-2 font-medium tabular-nums">{formatDiff(row.diffDamagedQty ?? 0)}</td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.systemQty)}</td>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.countedQty)}</td>
                                <td className={`px-3 py-2 font-medium tabular-nums ${row.diff < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatDiff(row.diff)}</td>
                              </>
                            )}
                            <td className="px-3 py-2">
                              <div className="min-w-56 space-y-2">
                                <select
                                  aria-label={`Rekonsiliasi ${row.name}`}
                                  value={reconciliationActions[row.id] ?? ''}
                                  onChange={(event) => {
                                    const action = event.target.value;
                                    if (action === '' || action === 'write_off' || action === 'correction') {
                                      setReconciliationActions((current) => ({ ...current, [row.id]: action }));
                                    }
                                  }}
                                  className="min-h-10 w-full rounded-md border border-slate-300 px-2"
                                >
                                  <option value="">Pilih tindakan</option>
                                  <option value="write_off">Pemutihan</option>
                                  <option value="correction">Koreksi stok</option>
                                </select>
                                <textarea
                                  aria-label={`Alasan rekonsiliasi ${row.name}`}
                                  maxLength={500}
                                  rows={2}
                                  value={reconciliationReasons[row.id] ?? ''}
                                  onChange={(event) => setReconciliationReasons((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))}
                                  placeholder="Alasan pemutihan atau koreksi stok"
                                  className="w-full rounded-md border border-slate-300 px-2 py-1.5"
                                />
                              </div>
                            </td>
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
            {dialog === 'authorize_reconciliation' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  {variances.length > 0
                    ? 'Masukkan username dan password Owner (atau Admin pada model sederhana) untuk menyetujui rekonsiliasi stok yang dipilih.'
                    : 'Tidak ada selisih stok. Persetujuan tetap diperlukan, tanpa rekonsiliasi stok.'}
                </p>
                {variances.length > 0 && (
                  <ul className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                    {variances.map((row) => (
                      <li key={row.id}>
                        <p className="font-medium text-slate-900">
                          {row.name} · {reconciliationActions[row.id] === 'write_off' ? 'Pemutihan' : 'Koreksi stok'}
                        </p>
                        <p className="whitespace-pre-wrap text-slate-600">{reconciliationReasons[row.id]?.trim()}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="block text-sm font-medium text-slate-700">
                  Username pemberi persetujuan
                  <input
                    autoComplete="off"
                    value={approverUsername}
                    onChange={(event) => setApproverUsername(event.target.value)}
                    className={`${fieldCls} mt-1`}
                  />
                </label>
              </div>
            )}
            {needsPassword && (
              <input type="password" autoComplete="new-password" aria-label="Password persetujuan" placeholder="Password persetujuan" value={password} onChange={(event) => setPassword(event.target.value)} className={fieldCls} />
            )}
            {dialogError && <p role="alert" className="text-sm text-red-700">{shortMessage(dialogError, 'Gagal')}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={pending} onClick={() => setDialog(null)} className="min-h-11 rounded-md border border-slate-300 px-4">Kembali</button>
            <button type="button" disabled={confirmDisabled} onClick={confirm} className="min-h-11 rounded-md bg-slate-900 px-5 font-medium text-white disabled:opacity-50">
              {pending ? '…' : dialog === 'finish' ? 'Selesai' : dialog === 'cancel' ? 'Batalkan' : dialog === 'authorize_reconciliation' ? 'Setujui' : 'Lanjutkan'}
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
  const conditionCounting = report.session.condition_counting ?? items.some((item) => item.counted_good_qty != null);
  const rows = items.flatMap((item) => {
    const sources = item.source_receipts?.length ? item.source_receipts : [null];
    return sources.map((source, index) => {
      const variance = variances.get(item.id);
      return {
        id: item.id,
        key: `${item.id}-${index}`,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        category: item.category_path.join(' / ') || variance?.category || '—',
        systemQty: item.system_qty ?? variance?.systemQty ?? null,
        countedQty: item.counted_qty,
        diff: variance?.diff ?? 0,
        systemGood: item.system_good_qty,
        systemDamaged: item.system_damaged_qty,
        countedGood: item.counted_good_qty,
        countedDamaged: item.counted_damaged_qty,
        diffGood: item.diff_good_qty ?? variance?.diffGoodQty,
        diffDamaged: item.diff_damaged_qty ?? variance?.diffDamagedQty,
        source,
      };
    });
  });

  // onDone dibuat ulang pada setiap render induk; lewat ref agar efek cetak hanya berjalan sekali
  // dan dialog cetak tidak terpicu ulang saat data di-refetch.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    const handleAfterPrint = () => onDoneRef.current();
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    const timer = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  return (
    <div className="print-only print-doc print-doc--landscape">
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
          <div><dt className="font-semibold">Jumlah total produk yang selisih</dt><dd>{report.totals?.variance_products ?? rows.length}</dd></div>
          <div><dt className="font-semibold">Total kurang</dt><dd>{formatCount(report.totals?.short_qty)}</dd></div>
          <div><dt className="font-semibold">Total lebih</dt><dd>{formatCount(report.totals?.over_qty)}</dd></div>
        </dl>
        {rows.length > 0 ? (
          <table className="text-[9px]">
            <thead>
              {conditionCounting ? (
                <tr>
                  <th>No</th><th>Produk</th><th>SKU</th><th>Barcode</th>
                  <th>Stok bagus</th><th>Stok rusak</th><th>Barang bagus</th><th>Barang rusak</th>
                  <th>Selisih bagus</th><th>Selisih rusak</th>
                  <th>No. PO</th><th>Tgl. PO</th><th>No. penerimaan</th><th>Tgl. penerimaan</th>
                  <th>Sisa bagus</th><th>Sisa rusak</th>
                </tr>
              ) : (
                <tr>
                  <th>No</th><th>Produk</th><th>SKU</th><th>Barcode</th>
                  <th>Stok sistem</th><th>Hasil hitung</th><th>Selisih</th>
                  <th>No. PO</th><th>Tgl. PO</th><th>No. penerimaan</th><th>Tgl. penerimaan</th>
                  <th>Sisa bagus</th><th>Sisa rusak</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key}>
                  <td>{index + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.sku || '—'}</td>
                  <td>{row.barcode || '—'}</td>
                  {conditionCounting ? (
                    <>
                      <td className="text-right">{formatCount(row.systemGood)}</td>
                      <td className="text-right">{formatCount(row.systemDamaged)}</td>
                      <td className="text-right">{formatCount(row.countedGood)}</td>
                      <td className="text-right">{formatCount(row.countedDamaged)}</td>
                      <td className="text-right">{formatDiff(Number(row.diffGood ?? 0))}</td>
                      <td className="text-right">{formatDiff(Number(row.diffDamaged ?? 0))}</td>
                    </>
                  ) : (
                    <>
                      <td className="text-right">{formatCount(row.systemQty)}</td>
                      <td className="text-right">{formatCount(row.countedQty)}</td>
                      <td className="text-right">{formatDiff(row.diff)}</td>
                    </>
                  )}
                  <td>{row.source?.po_number || '—'}</td>
                  <td>{row.source?.po_date?.slice(0, 10) || '—'}</td>
                  <td>{row.source?.receipt_number || '—'}</td>
                  <td>{row.source?.receipt_date?.slice(0, 10) || '—'}</td>
                  <td className="text-right">{formatCount(row.source?.good_qty)}</td>
                  <td className="text-right">{formatCount(row.source?.damaged_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>Tidak ada selisih stok.</p>}
      </article>
    </div>
  );
}