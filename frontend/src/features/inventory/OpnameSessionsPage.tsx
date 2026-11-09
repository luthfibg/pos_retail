import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ApiError } from '@/lib/api/client';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameItem, OpnameProgressNode, OpnameProgressTree, OpnameSession, OpnameSessionStatus, OpnameSessionSummary } from '@/lib/api/types';
import { parseApiTime } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthProvider';
import { StartOpnameForm } from './StartOpnameForm';
import { OpnameWorkspaceProvider, useOpnameWorkspace } from './OpnameWorkspaceContext';
import { findNode as findProgressNode, resolveWorkingNode } from './opnameWorkingNode';
import { CountingStack } from './CountingStack';

const PER_PAGE = 20;
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<OpnameSessionStatus | ''>('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [mobileItems, setMobileItems] = useState<OpnameSessionSummary[]>([]);
  const [startOpen, setStartOpen] = useState(false);
  const appendNextPage = useRef(false);
  const list = useQuery({
    queryKey: ['opname', 'sessions', { status, search, page }],
    queryFn: () => opnameApi.list({ status, q: search, page, per_page: PER_PAGE, sort: 'newest' }),
  });

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

  async function handleStarted(session: OpnameSessionSummary) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['opname', 'sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['opname', 'scope-options'] }),
    ]);
    setStartOpen(false);
    navigate(`/inventory/adjustments/opname/${session.id}`);
  }

  const hasCreate = can('opname.create');
  const timezone = me?.store?.timezone || 'Asia/Jakarta';
  const listData = list.data?.data ?? [];

  return (
    <div className="min-w-0 space-y-4 pb-20 md:pb-0">
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

      <section className="space-y-3">
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

        {list.error && (
          <div className="space-y-2">
            <ErrorNotice error={list.error} />
            <button type="button" onClick={() => void list.refetch()} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium">Coba lagi</button>
          </div>
        )}

        {list.isLoading && (
          <div role="status" aria-label="Memuat sesi opname" className="space-y-3">
            {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />)}
          </div>
        )}

        {!list.isLoading && !list.error && listData.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
            <h3 className="font-semibold">Belum ada sesi opname</h3>
            <p className="mt-1 text-sm text-slate-600">Mulai sesi untuk mencatat penghitungan produk.</p>
            {hasCreate && <button type="button" onClick={() => setStartOpen(true)} className="mt-4 hidden min-h-11 rounded-md bg-slate-900 px-5 text-sm font-medium text-white md:inline-flex md:items-center">Mulai Opname</button>}
          </div>
        )}

        {listData.length > 0 && (
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
                      <td className="px-3 py-3"><StatusBadge status={session.status} /></td>
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

function SessionCard({ session, timezone }: { session: OpnameSessionSummary; timezone: string }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <SessionLink session={session}>{session.number}</SessionLink>
          {session.name && <p className="mt-1 break-words text-sm text-slate-700">{session.name}</p>}
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
  const { can, me } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [openNodeIds, setOpenNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedItem, setSelectedItem] = useState<OpnameItem | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
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
  const treeQuery = useQuery({
    queryKey: ['opname', 'tree', id],
    queryFn: () => opnameApi.tree(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: () => document.visibilityState === 'visible' ? 15_000 : false,
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
    enabled: search.trim().length >= 2,
    refetchInterval: () => document.visibilityState === 'visible' ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
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

  if (!Number.isInteger(id) || id < 1) return <ErrorNotice error={new Error('Sesi opname tidak ditemukan.')} />;
  if (detail.isLoading) return <div role="status" className="space-y-3"><div className="h-32 animate-pulse rounded-lg bg-slate-100" /><div className="h-20 animate-pulse rounded-lg bg-slate-100" /></div>;
  if (detail.error) {
    return <div className="space-y-3"><ErrorNotice error={detail.error} /><button type="button" onClick={() => void detail.refetch()} className="min-h-11 rounded-md border border-slate-300 px-4">Coba lagi</button><Link to="/inventory/adjustments/opname" className="ml-3 min-h-11 underline">Kembali ke daftar</Link></div>;
  }
  const session = detail.data;
  if (!session) return null;
  const timezone = me?.store?.timezone || 'Asia/Jakarta';
  const tree = treeQuery.data;
  const view = workspaceView(searchParams.get('view'));
  const mobile = useMobileViewport();
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
    await Promise.all([
      detail.refetch(),
      treeQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['opname', 'items', id] }),
    ]);
  }

  return (
    <div className="min-w-0 space-y-4 pb-20 md:pb-0">
      {session.status !== 'in_progress' && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Sesi ini berstatus <strong>{statusLabel(session.status)}</strong>. Tampilan hanya baca.
        </div>
      )}
      <header className="sticky top-0 z-20 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/inventory/adjustments/opname" className="inline-flex min-h-9 items-center text-xs font-medium underline">← Daftar sesi</Link>
          <p className="break-words text-xs text-slate-600">{session.number}</p>
          <h2 className="break-words text-lg font-semibold">{session.name || 'Sesi opname'}</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={session.status} />
          <button type="button" onClick={() => void refreshWorkspace()} disabled={treeQuery.isFetching} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium disabled:opacity-50" aria-label="Muat ulang progres">
            {treeQuery.isFetching ? '…' : 'Muat ulang'}
          </button>
          <button type="button" onClick={() => setSummaryOpen(true)} className="hidden min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium md:inline-flex md:items-center">Ringkasan</button>
          {session.status === 'in_progress' && can('opname.cancel') && (
            <details className="relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-slate-300 px-3 text-lg font-medium" aria-label="Menu lainnya">⋯</summary>
              <div className="absolute right-0 z-30 mt-1 min-w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                <button type="button" onClick={() => setCancelOpen(true)} className="min-h-11 w-full rounded px-3 text-left text-sm text-rose-800 hover:bg-rose-50">Batalkan sesi</button>
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
      </header>

      <OpnameWorkspaceProvider value={{
        activeNodeId,
        setActiveNodeId,
        tree: tree ?? EMPTY_TREE,
        selectedItem,
        setSelectedItem,
        highlightedItemId,
        setHighlightedItemId,
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
          treeLoading={treeQuery.isLoading}
          treeError={treeQuery.error}
          retryTree={() => void treeQuery.refetch()}
          search={search}
          searchDraft={searchDraft}
          updateSearch={updateSearch}
          searchResults={productSearch.data?.pages.flatMap((page) => page.data) ?? []}
          searchLoading={productSearch.isFetching}
          productSearchHasNext={productSearch.hasNextPage}
          loadMoreSearch={() => void productSearch.fetchNextPage()}
          searchError={productSearch.error}
          retrySearch={() => void productSearch.refetch()}
          onlyUncounted={onlyUncounted}
          setOnlyUncounted={setOnlyUncounted}
          openNodeIds={openNodeIds}
          setOpenNodeIds={setOpenNodeIds}
          view={view}
          onViewChange={changeView}
          active={session.status === 'in_progress'}
          canCount={can('opname.count')}
          revealsSystemQty={tree?.display.reveals_system_qty ?? false}
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
  canCount: boolean;
  revealsSystemQty: boolean;
  workingNode: OpnameProgressNode | null;
}) {
  const { activeNodeId, setActiveNodeId, loadItem, highlightedItemId, selectedItem, startNode } = useOpnameWorkspace();
  const [listCollapsed, setListCollapsed] = useState(false);
  const searching = search.trim().length >= 2;
  const mobile = useMobileViewport();
  const showList = (!mobile || view === 'daftar') && !listCollapsed;
  const showInput = !mobile || view === 'input';
  const visibleNodes = tree?.nodes ?? [];
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
            active={active}
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
    enabled: opened && directProductCount > 0,
    refetchInterval: () => document.visibilityState === 'visible' ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const items = directItems.data?.pages.flatMap((page) => page.data) ?? [];

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
            />
          ))}
          {directProductCount > 0 && <p className="pl-10 pt-2 text-xs font-medium text-slate-500">Tanpa sub-kategori ({directProductCount})</p>}
          {opened && directProductCount > 0 && directItems.isLoading && <div role="status" className="space-y-2 px-4 py-2">{[1, 2].map((n) => <div key={n} className="h-14 animate-pulse rounded bg-slate-100" />)}</div>}
          {directItems.error && <div className="px-4 py-2"><ErrorNotice error={directItems.error} /><button type="button" onClick={() => void directItems.refetch()} className="mt-2 min-h-11 rounded-md border px-3 text-sm">Coba lagi</button></div>}
          {items.map((item) => (
            <ProductRow
              key={item.id}
              item={item}
              selected={selectedItemId === item.id}
              highlighted={highlightedItemId === item.id}
              revealsSystemQty={revealsSystemQty}
              onSelect={() => loadItem(item)}
            />
          ))}
          {directItems.data && directProductCount > 0 && !directItems.isLoading && !directItems.error && items.length === 0 && <p className="py-2 pl-10 text-sm text-slate-500">Tidak ada produk pada kategori ini untuk filter yang dipilih.</p>}
          {directItems.hasNextPage && (
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
  onSelect,
}: {
  item: OpnameItem;
  selected: boolean;
  highlighted: boolean;
  revealsSystemQty: boolean;
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
