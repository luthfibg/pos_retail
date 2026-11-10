import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameItem, OpnameProgressNode, OpnameProgressTree } from '@/lib/api/types';
import { formatQty } from '@/lib/format';
import { useOpnameWorkspace } from './OpnameWorkspaceContext';
import { CountEntryForm } from './CountEntryForm';
import { nextIncompleteNode } from './opnameWorkingNode';
import { useScanFeedback } from './useScanFeedback';
import { getPendingOfflineItems, toOfflineOpnameItem } from './useOpnameOffline';
import { PendingBadge } from './SyncStatus';

interface Props {
  sessionId: number;
  active: boolean;
  canCount: boolean;
  revealsSystemQty: boolean;
  tree: OpnameProgressTree;
  workingNode: OpnameProgressNode | null;
}

function useVisiblePolling(enabled: boolean, isOnline: boolean) {
  return () => enabled && isOnline && document.visibilityState === 'visible' ? 15_000 : false;
}

function Status({ item }: { item: OpnameItem }) {
  if (item.status === 'matched') return <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">Cocok</span>;
  if (item.status === 'variance') return <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">Selisih</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">Sudah dihitung</span>;
}

function ItemCard({
  item,
  kind,
  revealsSystemQty,
  onSelect,
  pending = false,
}: {
  item: OpnameItem;
  kind: 'counted' | 'recommendation';
  revealsSystemQty: boolean;
  onSelect: () => void;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="opname-short-card min-h-14 w-full touch-manipulation select-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-transform duration-200 motion-reduce:transition-none hover:bg-slate-50"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
        {pending ? <PendingBadge /> : kind === 'counted' && revealsSystemQty ? <Status item={item} /> : null}
      </span>
      {kind === 'counted' ? (
        <span className="mt-1 block text-xs text-slate-600">Hitungan: {item.counted_qty ?? '—'}</span>
      ) : (
        <span className="mt-1 flex justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">{item.barcode || 'Tanpa barcode'}</span>
          {revealsSystemQty && item.system_qty !== undefined && <span className="shrink-0">Stok: {formatQty(item.system_qty)}</span>}
        </span>
      )}
    </button>
  );
}

export function CountingStack({ sessionId, active, canCount, revealsSystemQty, tree, workingNode }: Props) {
  const {
    selectedItem, activeNodeId, selectItem, startNode, pendingOperations, failedOperations,
    isOnline, offlineIndex, isSyncing,
  } = useOpnameWorkspace();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySelectionError, setHistorySelectionError] = useState('');
  const feedback = useScanFeedback();
  const recentCounts = useQuery({
    queryKey: ['opname', 'stack-counted', sessionId],
    queryFn: () => opnameApi.items(sessionId, { only_counted: true, sort: '-counted_at', per_page: 2 }),
    enabled: active && canCount && isOnline,
    refetchInterval: useVisiblePolling(active && canCount, isOnline),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const recommendations = useQuery({
    queryKey: ['opname', 'items', sessionId, 'stack-recommendations', workingNode?.id ?? null, selectedItem?.id ?? null],
    queryFn: () => opnameApi.items(sessionId, {
      category_id: workingNode?.id === 'other' ? 0 : Number(workingNode?.id),
      scope: 'direct',
      only_uncounted: true,
      per_page: 2,
      ...(selectedItem ? { exclude_item_ids: [selectedItem.id] } : {}),
    }),
    enabled: active && canCount && isOnline && workingNode !== null,
    refetchInterval: useVisiblePolling(active && canCount, isOnline),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const history = useQuery({
    queryKey: ['opname', 'counts', sessionId],
    queryFn: () => opnameApi.counts(sessionId, 10),
    enabled: historyOpen && active && canCount && isOnline,
  });
  const allCounted = tree.summary.total_products > 0 && tree.summary.counted_products >= tree.summary.total_products;
  const selectedNode = findNodeById(tree.nodes, activeNodeId);
  const nextNode = nextIncompleteNode(tree, activeNodeId);
  const pendingItems = getPendingOfflineItems(offlineIndex, pendingOperations);
  const pendingMap = new Map(pendingItems.map((item) => [item.id, item]));
  const pendingCountedItems = pendingItems.filter((item) => item.counted_qty !== null);
  const recentItems = [
    ...pendingCountedItems,
    ...(recentCounts.data?.data ?? []).filter((item) => !pendingMap.has(item.id)),
  ].slice(0, 2);
  const pendingCountedIds = new Set(pendingCountedItems.map((item) => item.id));
  const offlineRecommendations = offlineIndex?.items
    .map((item) => pendingMap.get(item.item_id) ?? toOfflineOpnameItem(offlineIndex, item))
    .filter((item) => item.counted_qty === null
      && item.id !== selectedItem?.id
      && (workingNode?.id === 'other' ? item.category_id === null : item.category_id === Number(workingNode?.id)))
    .slice(0, 2) ?? [];
  const recommendationItems = !isOnline ? offlineRecommendations
    : (recommendations.data?.data ?? []).filter((item) => !pendingCountedIds.has(item.id));

  return (
    <div className="opname-count-stack space-y-2" aria-label="Rangkaian hitung">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Sudah dihitung</h3>
        {active && canCount && (
          <div className="flex items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <input type="checkbox" checked={feedback.enabled} onChange={(event) => feedback.setEnabled(event.target.checked)} />
              Suara dan getar
            </label>
            <button type="button" onClick={() => setHistoryOpen(true)} className="min-h-11 px-2 text-sm underline">Riwayat</button>
          </div>
        )}
      </div>
      <ErrorNotice error={isOnline ? recentCounts.error ?? recommendations.error : null} />
      {recentItems.length ? (
        <div className="opname-counted-items space-y-1">
          {[...recentItems].reverse().map((item) => (
            <ItemCard key={item.id} item={item} kind="counted" pending={pendingMap.has(item.id)} revealsSystemQty={isOnline && revealsSystemQty} onSelect={() => selectItem(item)} />
          ))}
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">Belum ada produk yang dihitung.</p>
      )}

      <section aria-label="Sedang dihitung" className="opname-active-count-card rounded-lg border border-slate-300 bg-white p-3 sm:p-4">
        {workingNode && <p className="mb-2 text-xs font-medium text-slate-600">Sedang di: {workingNode.name}</p>}
        <CountEntryForm
          sessionId={sessionId}
          active={active}
          canCount={canCount}
          revealsSystemQty={isOnline && revealsSystemQty}
          onScanSuccess={feedback.success}
          onScanError={feedback.error}
        />
      </section>

      <h3 className="pt-1 text-sm font-semibold">Rekomendasi berikutnya</h3>
      {!active || !canCount ? null : allCounted ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Semua produk sudah dihitung. <Link to="?view=ringkasan" className="font-medium underline">Buka Ringkasan</Link>
        </div>
      ) : workingNode ? isOnline && recommendations.isLoading ? (
        <p role="status" className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">Memuat rekomendasi…</p>
      ) : recommendationItems.length ? (
        <div className="opname-recommendation-items space-y-1">
          {recommendationItems.map((item) => (
            <ItemCard key={item.id} item={item} kind="recommendation" revealsSystemQty={isOnline && revealsSystemQty} pending={pendingMap.has(item.id)} onSelect={() => selectItem(item)} />
          ))}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>✓ {selectedNode?.name ?? workingNode.name} selesai ({selectedNode?.counted_count ?? workingNode.counted_count}/{selectedNode?.product_count ?? workingNode.product_count}){revealsSystemQty && selectedNode?.variance_count !== undefined ? ` · ${selectedNode.variance_count} selisih` : ''}</p>
          {nextNode && <button type="button" onClick={() => startNode(String(nextNode.id))} className="min-h-11 font-medium underline">Lanjut ke {nextNode.name}</button>}
        </div>
      ) : selectedNode ? (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>✓ {selectedNode.name} selesai ({selectedNode.counted_count}/{selectedNode.product_count}){revealsSystemQty && selectedNode.variance_count !== undefined ? ` · ${selectedNode.variance_count} selisih` : ''}</p>
          {nextNode && <button type="button" onClick={() => startNode(String(nextNode.id))} className="min-h-11 font-medium underline">Lanjut ke {nextNode.name}</button>}
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-600">Scan produk atau ketuk Mulai pada sub-kategori di Daftar.</p>
      )}
      {(pendingOperations.length > 0 || failedOperations.length > 0 || isSyncing) && (
        <p className="text-xs text-slate-600">{pendingOperations.length} operasi menunggu · {failedOperations.length} gagal tersinkron</p>
      )}

      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 md:items-center md:p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="opname-history-title" className="max-h-[85dvh] w-full overflow-y-auto rounded-t-xl bg-white p-4 md:max-w-xl md:rounded-xl">
            <div className="flex items-center justify-between gap-2">
              <h3 id="opname-history-title" className="font-semibold">Riwayat hitungan</h3>
              <button type="button" onClick={() => setHistoryOpen(false)} className="min-h-11 px-3 underline">Tutup</button>
            </div>
            <ErrorNotice error={history.error} />
            {history.error && <button type="button" onClick={() => void history.refetch()} className="min-h-11 px-3 text-sm underline">Coba lagi</button>}
            {history.data?.length === 0 && <p className="py-4 text-sm text-slate-500">Belum ada hitungan yang disimpan.</p>}
            <div className="mt-2 space-y-2">
              {pendingOperations.map((operation) => {
                const offlineItem = offlineIndex?.items.find((candidate) => candidate.item_id === operation.item.item_id);
                const selected = pendingMap.get(operation.item.item_id)
                  ?? (offlineItem && offlineIndex ? toOfflineOpnameItem(offlineIndex, offlineItem) : null);
                return (
                  <div key={operation.sequence} className="flex items-center justify-between gap-2 rounded-md border border-amber-200 p-3 text-sm">
                    <button type="button" onClick={() => { if (selected) selectItem(selected); setHistoryOpen(false); }} className="min-h-11 min-w-0 flex-1 text-left">
                      <span className="block truncate font-medium">{operation.item.name}</span>
                      <span className="block text-xs text-slate-600">{operation.input.action === 'clear' ? 'Hapus hitungan' : `Hitungan ${operation.input.quantity}`}</span>
                    </button>
                    <PendingBadge />
                  </div>
                );
              })}
              {history.data?.map((log) => (
                <button key={log.log_id} type="button" onClick={async () => {
                  setHistorySelectionError('');
                  try {
                    const query = log.item.barcode || log.item.name;
                    const results = await opnameApi.lookup(sessionId, query, log.item.barcode ? 'auto' : 'search');
                    const item = results.find((candidate) => candidate.id === log.item.id);
                    if (!item) {
                      setHistorySelectionError('Produk dari riwayat tidak ditemukan dalam sesi ini.');
                      return;
                    }
                    selectItem(item);
                    setHistoryOpen(false);
                  } catch (error) {
                    setHistorySelectionError(error instanceof Error ? error.message : 'Produk dari riwayat tidak dapat dimuat.');
                  }
                }} className="min-h-12 w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="block font-medium">{log.item.name}</span>
                  <span className="block text-xs text-slate-600">{log.action === 'clear' ? 'Hitungan dihapus' : `Hitungan: ${log.counted_after ?? '—'}`}</span>
                </button>
              ))}
            </div>
            {history.isLoading && <p role="status" className="py-4 text-sm text-slate-500">Memuat riwayat…</p>}
            {historySelectionError && <p role="alert" className="mt-2 text-sm text-red-700">{historySelectionError}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function findNodeById(nodes: OpnameProgressNode[], id: number | string | null): OpnameProgressNode | null {
  if (id === null) return null;
  for (const node of nodes) {
    if (String(node.id) === String(id)) return node;
    const child = findNodeById(node.children, id);
    if (child) return child;
  }
  return null;
}
