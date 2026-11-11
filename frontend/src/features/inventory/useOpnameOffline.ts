import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { opnameApi, opnameLockApi } from '@/lib/api/endpoints';
import type { OpnameItem, OpnameProgressNode, OpnameProgressTree } from '@/lib/api/types';
import {
  countSyncQueue,
  offlineSessionIndex,
  settleCountBatch,
  subscribeCountQueue,
  type OfflineSessionIndex,
  type QueuedCountOperation,
} from './opnameOfflineStore';

const RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000];
const SYNC_BATCH_SIZE = 100;

export function getCountSyncRetryDelay(attempt: number): number {
  return RETRY_DELAYS[Math.min(Math.max(0, attempt), RETRY_DELAYS.length - 1)] ?? 30_000;
}

export function useConnectionStatus(): { isOnline: boolean; markOffline: () => void; markOnline: () => void } {
  const [reachable, setReachable] = useState(() => navigator.onLine);
  const markOffline = useCallback(() => setReachable(false), []);
  const markOnline = useCallback(() => setReachable(true), []);
  useEffect(() => {
    const online = () => markOnline();
    const offline = () => markOffline();
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [markOffline, markOnline]);
  return useMemo(() => ({
    isOnline: reachable,
    markOffline,
    markOnline,
  }), [markOffline, markOnline, reachable]);
}

export interface OfflineIndexState {
  index: OfflineSessionIndex | null;
  ready: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOfflineSessionIndex(userId: number | undefined, sessionId: number, active: boolean): OfflineIndexState {
  const [index, setIndex] = useState<OfflineSessionIndex | null>(null);
  const [indexScope, setIndexScope] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const scope = userId ? `${userId}:${sessionId}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const indexRef = useRef(index);
  const currentIndex = indexScope === scope ? index : null;
  indexRef.current = currentIndex;

  const refresh = useCallback(async () => {
    if (!active || !userId || !navigator.onLine || running.current) return;
    running.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const cached = indexRef.current ?? await offlineSessionIndex.get(userId, sessionId);
      const pageEtags: Record<number, string> = {};
      const firstResponseEtag: { value: string | null } = { value: null };
      const first = await opnameApi.offlineIndex(sessionId, 1, 5000, cached?.pageEtags[1], (etag) => {
        firstResponseEtag.value = etag;
      });
      if (first === null) {
        if (cached) {
          setIndex(cached);
          setIndexScope(scope);
          setReady(true);
        }
        return;
      }

      const items = [...first.items];
      if (firstResponseEtag.value) pageEtags[1] = firstResponseEtag.value;
      for (let page = 2; page <= first.total_pages; page += 1) {
        const pageEtag: { value: string | null } = { value: null };
        const response = await opnameApi.offlineIndex(sessionId, page, 5000, cached?.pageEtags[page], (etag) => {
          pageEtag.value = etag;
        });
        if (!response) {
          const cachedPage = cached?.items.slice((page - 1) * 5000, page * 5000) ?? [];
          items.push(...cachedPage);
        } else {
          items.push(...response.items);
        }
        if (pageEtag.value) pageEtags[page] = pageEtag.value;
      }
      const next: OfflineSessionIndex = {
        session: first.session,
        version: first.version,
        categories: first.categories,
        items,
        pageEtags,
        updatedAt: new Date().toISOString(),
      };
      if (scopeRef.current !== scope) return;
      await offlineSessionIndex.save(userId, sessionId, next);
      setIndex(next);
      setIndexScope(scope);
      setReady(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Indeks offline tidak dapat diperbarui.');
      if (!indexRef.current && userId) {
        try {
          const cached = await offlineSessionIndex.get(userId, sessionId);
          if (scopeRef.current !== scope) return;
          setIndex(cached);
          setIndexScope(scope);
          setReady(cached !== null);
        } catch (storageError) {
          setError(storageError instanceof Error ? storageError.message : 'Penyimpanan lokal tidak tersedia.');
        }
      }
    } finally {
      running.current = false;
      setRefreshing(false);
    }
  }, [active, scope, sessionId, userId]);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setError(null);
    if (!userId || !active) {
      setIndexScope(null);
      return;
    }
    void offlineSessionIndex.get(userId, sessionId).then((cached) => {
      if (alive && cached) {
        setIndex(cached);
        setIndexScope(scope);
        setReady(true);
      }
    }).catch((caught: unknown) => {
      if (alive) setError(caught instanceof Error ? caught.message : 'Penyimpanan lokal tidak tersedia.');
    });
    return () => { alive = false; };
  }, [active, scope, sessionId, userId]);

  useEffect(() => {
    if (active && navigator.onLine) void refresh();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh();
    };
    const timer = window.setInterval(refreshVisible, 180_000);
    window.addEventListener('online', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [active, refresh]);

  useEffect(() => {
    if (!active && userId) {
      void countSyncQueue.list(userId, sessionId).then(async (operations) => {
        if (operations.length === 0) await offlineSessionIndex.remove(userId, sessionId);
      }).catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Data indeks offline tidak dapat dibersihkan.');
      });
    }
  }, [active, sessionId, userId]);

  return { index: currentIndex, ready: indexScope === scope && ready, refreshing, error, refresh };
}

export function useCountSync(userId: number | undefined, sessionId: number, active: boolean) {
  const queryClient = useQueryClient();
  const connection = useConnectionStatus();
  const [pending, setPending] = useState<QueuedCountOperation[]>([]);
  const [failed, setFailed] = useState<QueuedCountOperation[]>([]);
  const [queueScope, setQueueScope] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const owner = useRef(window.crypto.randomUUID());
  const running = useRef(false);
  const retryIndex = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const scope = `${userId ?? 'anonymous'}:${sessionId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const currentPending = queueScope === scope ? pending : [];
  const currentFailed = queueScope === scope ? failed : [];

  const reload = useCallback(async () => {
    if (scopeRef.current !== scope) return;
    if (!userId) {
      setPending([]);
      setFailed([]);
      setQueueScope(scope);
      return;
    }
    try {
      const operations = await countSyncQueue.list(userId, sessionId);
      if (scopeRef.current !== scope) return;
      setPending(operations.filter((operation) => operation.status === 'pending'));
      setFailed(operations.filter((operation) => operation.status === 'failed'));
      setQueueScope(scope);
    } catch (caught) {
      setQueueError(caught instanceof Error ? caught.message : 'Antrean lokal tidak dapat dibaca.');
    }
  }, [scope, sessionId, userId]);

  const syncNow = useCallback(async () => {
    if (!active || !userId || running.current) return;
    running.current = true;
    setQueueError(null);
    let leaseError: string | null = null;
    const acquired = await countSyncQueue.acquireLease(userId, sessionId, owner.current).catch((caught: unknown) => {
      leaseError = caught instanceof Error ? caught.message : 'Tidak dapat mengunci antrean lokal.';
      setQueueError(leaseError);
      return false;
    });
    if (!acquired) {
      running.current = false;
      if (!leaseError) setQueueError('Antrean sedang diproses di tab lain. Tunggu sebentar lalu coba lagi.');
      return;
    }
    setSyncing(true);
    const heartbeat = window.setInterval(() => {
      void countSyncQueue.acquireLease(userId, sessionId, owner.current).catch((caught: unknown) => {
        setQueueError(caught instanceof Error ? caught.message : 'Tidak dapat memperbarui kunci antrean lokal.');
      });
    }, 10_000);
    try {
      while (true) {
        const operations = await countSyncQueue.pending(userId, sessionId);
        if (operations.length === 0) break;
        const batch = operations.slice(0, SYNC_BATCH_SIZE);
        const response = await opnameApi.batchCounts(sessionId, batch.map(({ input }) => ({
          client_request_id: input.client_request_id,
          action: input.action,
          item_id: input.item_id,
          ...(input.action === 'count' ? { mode: input.mode, quantity: input.quantity } : {}),
          client_created_at: input.client_created_at,
        })));
        await settleCountBatch(countSyncQueue, batch, response.results);
        await queryClient.invalidateQueries({ queryKey: ['opname', 'tree', sessionId] });
        await queryClient.invalidateQueries({ queryKey: ['opname', 'items', sessionId] });
        await queryClient.invalidateQueries({ queryKey: ['opname', 'counts', sessionId] });
        await queryClient.invalidateQueries({ queryKey: ['opname', 'stack-counted', sessionId] });
        await queryClient.invalidateQueries({ queryKey: ['opname', 'session', sessionId] });
        retryIndex.current = 0;
        connection.markOnline();
        setQueueError(null);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status > 0 && caught.status < 500 && caught.status !== 429) {
        const batch = await countSyncQueue.pending(userId, sessionId);
        for (const operation of batch) {
          await countSyncQueue.markFailed(operation, {
            code: `http_${caught.status}`,
            message: caught.message || 'Operasi ditolak oleh server.',
          });
        }
        connection.markOnline();
        setQueueError(caught.message || 'Server menolak hitungan. Periksa alasan pada daftar gagal tersinkron.');
      } else if (caught instanceof ApiError && caught.status > 0) {
        connection.markOnline();
        setQueueError(caught.message || 'Server belum dapat memproses antrean. Hitungan tetap tersimpan dan akan dicoba lagi.');
      } else if (caught instanceof ApiError) {
        connection.markOffline();
        setQueueError(caught.message || 'Tidak dapat terhubung ke server. Hitungan tetap tersimpan di antrean lokal.');
      } else {
        setQueueError(caught instanceof Error ? caught.message : 'Sinkronisasi gagal. Hitungan tetap tersimpan di antrean lokal.');
        connection.markOffline();
      }
      const delay = getCountSyncRetryDelay(retryIndex.current);
      retryIndex.current += 1;
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(() => void syncNow(), delay);
    } finally {
      window.clearInterval(heartbeat);
      await countSyncQueue.releaseLease(userId, sessionId, owner.current);
      running.current = false;
      setSyncing(false);
      await reload();
    }
  }, [active, connection, queryClient, reload, sessionId, userId]);

  useEffect(() => {
    void reload();
    const onChanged = () => {
      void reload().then(() => {
        if (navigator.onLine) void syncNow();
      });
    };
    const unsubscribe = subscribeCountQueue(onChanged);
    const online = () => {
      connection.markOnline();
      void syncNow();
    };
    const reachability = window.setInterval(() => {
      if (!active || document.visibilityState !== 'visible' || (connection.isOnline && currentPending.length === 0)) return;
      void opnameLockApi.status().then(() => {
        connection.markOnline();
        void syncNow();
      }).catch((caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 0) connection.markOffline();
        else connection.markOnline();
      });
    }, 15_000);
    window.addEventListener('online', online);
    return () => {
      unsubscribe();
      window.clearInterval(reachability);
      window.removeEventListener('online', online);
    };
  }, [active, connection, currentPending.length, reload, syncNow]);

  useEffect(() => () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }, []);

  useEffect(() => {
    if (currentPending.length > 200) setQueueError('Antrean melebihi 200 operasi. Segera sambungkan jaringan untuk sinkron.');
  }, [currentPending.length]);

  const retryFailed = useCallback(async (operation: QueuedCountOperation) => {
    await countSyncQueue.retry(operation);
  }, []);
  const removeFailed = useCallback(async (operation: QueuedCountOperation) => {
    await countSyncQueue.remove(operation);
  }, []);

  return {
    pending: currentPending,
    failed: currentFailed,
    syncing,
    isOnline: connection.isOnline,
    markOffline: connection.markOffline,
    queueError,
    syncNow,
    retryFailed,
    removeFailed,
    reload,
  };
}

export function findOfflineItems(
  index: OfflineSessionIndex | null,
  query: string,
  mode: 'auto' | 'search',
  operations: QueuedCountOperation[] = [],
): OpnameItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  const pendingMap = new Map(getPendingOfflineItems(index, operations).map((item) => [item.id, item]));
  const source = index?.items.map((item) => pendingMap.get(item.item_id) ?? toOfflineOpnameItem(index, item))
    ?? getPendingOfflineItems(null, operations);
  return mode === 'auto'
    ? source.filter((item) => item.barcode.toLocaleLowerCase() === normalized).slice(0, 1)
    : source.filter((item) => item.name.toLocaleLowerCase().includes(normalized)).slice(0, 10);
}

export function toOfflineOpnameItem(index: OfflineSessionIndex, item: OfflineSessionIndex['items'][number]): OpnameItem {
  const categories = new Map(index.categories.map((category) => [category.id, category]));
  const path: string[] = [];
  let categoryId = item.category_id;
  while (categoryId !== null) {
    const category = categories.get(categoryId);
    if (!category) break;
    path.unshift(category.name);
    categoryId = category.parent_id;
  }
  return {
    id: item.item_id,
    product_id: item.product_id,
    category_id: item.category_id,
    name: item.name,
    barcode: item.barcode,
    category_path: path,
    status: item.counted_qty === null ? 'uncounted' : 'counted',
    counted_qty: item.counted_qty === null ? null : String(item.counted_qty),
    counted_at: null,
  };
}

function pendingCounts(index: OfflineSessionIndex, operations: QueuedCountOperation[]): Map<number, number | null> {
  const counts = new Map(index.items.map((item) => [item.item_id, item.counted_qty]));
  for (const operation of [...operations].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))) {
    const previous = counts.get(operation.item.item_id) ?? null;
    if (operation.input.action === 'clear') counts.set(operation.item.item_id, null);
    else counts.set(operation.item.item_id, operation.input.mode === 'add'
      ? (previous ?? 0) + operation.input.quantity
      : operation.input.quantity);
  }
  return counts;
}

export function getPendingOfflineItems(index: OfflineSessionIndex | null, operations: QueuedCountOperation[]): OpnameItem[] {
  if (!index) {
    const items = new Map<number, { item: QueuedCountOperation['item']; count: number | null }>();
    for (const operation of [...operations].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))) {
      const current = items.get(operation.item.item_id);
      const previous = current?.count ?? operation.item.counted_qty;
      const count = operation.input.action === 'clear' ? null
        : operation.input.mode === 'add' ? (previous ?? 0) + operation.input.quantity
          : operation.input.quantity;
      items.set(operation.item.item_id, { item: operation.item, count });
    }
    return [...items.values()].map(({ item, count }) => ({
      id: item.item_id,
      product_id: item.product_id,
      category_id: item.category_id,
      name: item.name,
      barcode: item.barcode,
      category_path: [],
      status: count === null ? 'uncounted' : 'counted',
      counted_qty: count === null ? null : String(count),
      counted_at: null,
    }));
  }
  const affected = new Set(operations.map((operation) => operation.item.item_id));
  const counts = pendingCounts(index, operations);
  const offlineItems = index.items.filter((item) => affected.has(item.item_id)).map((item) => toOfflineOpnameItem(index, {
    ...item,
    counted_qty: counts.get(item.item_id) ?? null,
  }));
  const indexedIds = new Set(offlineItems.map((item) => item.id));
  const extras = operations.filter((operation) => !indexedIds.has(operation.item.item_id));
  return [...offlineItems, ...getPendingOfflineItems(null, extras)];
}

export function buildOfflineProgressTree(index: OfflineSessionIndex | null, operations: QueuedCountOperation[]): OpnameProgressTree | null {
  if (!index) return null;
  const counts = pendingCounts(index, operations);
  const direct = new Map<number, { total: number; counted: number }>();
  let otherTotal = 0;
  let otherCounted = 0;
  for (const item of index.items) {
    const counted = counts.get(item.item_id) !== null;
    if (item.category_id === null || !index.categories.some((category) => category.id === item.category_id)) {
      otherTotal += 1;
      if (counted) otherCounted += 1;
      continue;
    }
    const value = direct.get(item.category_id) ?? { total: 0, counted: 0 };
    value.total += 1;
    if (counted) value.counted += 1;
    direct.set(item.category_id, value);
  }
  const categories = new Map(index.categories.map((category) => [category.id, category]));
  const children = new Map<number | null, number[]>();
  for (const category of index.categories) {
    const siblingList = children.get(category.parent_id) ?? [];
    siblingList.push(category.id);
    children.set(category.parent_id, siblingList);
  }
  const build = (parentId: number | null, depth: number): OpnameProgressNode[] => (children.get(parentId) ?? [])
    .map((id): OpnameProgressNode | null => {
      const category = categories.get(id);
      if (!category) return null;
      const nested = build(id, depth + 1);
      const own = direct.get(id) ?? { total: 0, counted: 0 };
      const total = own.total + nested.reduce((sum, node) => sum + node.product_count, 0);
      const counted = own.counted + nested.reduce((sum, node) => sum + node.counted_count, 0);
      if (total === 0) return null;
      return {
        id,
        name: category.name,
        parent_id: category.parent_id,
        depth,
        product_count: total,
        counted_count: counted,
        status: counted === 0 ? 'not_started' : counted === total ? 'done' : 'partial',
        direct_product_count: own.total,
        direct_counted_count: own.counted,
        children: nested,
      };
    })
    .filter((node): node is OpnameProgressNode => node !== null);
  const nodes = build(null, 0);
  if (otherTotal > 0) {
    nodes.push({
      id: 'other',
      name: 'Lainnya',
      parent_id: null,
      depth: 0,
      product_count: otherTotal,
      counted_count: otherCounted,
      status: otherCounted === 0 ? 'not_started' : otherCounted === otherTotal ? 'done' : 'partial',
      direct_product_count: otherTotal,
      direct_counted_count: otherCounted,
      children: [],
    });
  }
  const countedProducts = [...counts.values()].filter((quantity) => quantity !== null).length;
  return {
    session: index.session,
    display: { reveals_system_qty: false },
    summary: { total_products: index.items.length, counted_products: countedProducts },
    nodes,
  };
}
