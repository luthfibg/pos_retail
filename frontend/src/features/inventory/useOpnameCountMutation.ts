import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OpnameCountResult, OpnameItem, OpnameProgressNode, OpnameProgressTree, Paginated } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { countSyncQueue, toOfflineIndexItem } from './opnameOfflineStore';

export type OpnameCountMutationInput =
  | { action: 'count'; item_id: number; mode: 'set' | 'add'; quantity: number; client_request_id: string; item: OpnameItem }
  | { action: 'clear'; item_id: number; client_request_id: string; item: OpnameItem };

function updateNode(node: OpnameProgressNode, changes: OpnameCountResult['nodes']): OpnameProgressNode {
  const updated = changes.find((change) => String(change.id) === String(node.id));
  return {
    ...node,
    ...(updated ?? {}),
    children: node.children.map((child) => updateNode(child, changes)),
  };
}

export function applyOpnameCountResult(queryClient: ReturnType<typeof useQueryClient>, sessionId: number, result: OpnameCountResult, invalidate = true) {
  const countedKey = ['opname', 'stack-counted', sessionId] as const;
  queryClient.setQueryData<Paginated<OpnameItem>>(countedKey, (current) => {
    if (!current) return current;
    const data = current.data.filter((item) => item.id !== result.item.id);
    if (result.item.counted_qty !== null) data.push(result.item);
    data.sort((left, right) => (right.counted_at ?? '').localeCompare(left.counted_at ?? ''));
    return { ...current, data: data.slice(0, 2) };
  });
  queryClient.setQueryData<OpnameProgressTree>(['opname', 'tree', sessionId], (current) => current ? {
    ...current,
    summary: result.summary,
    nodes: current.nodes.map((node) => updateNode(node, result.nodes)),
  } : current);
  if (invalidate) {
    void queryClient.invalidateQueries({ queryKey: ['opname', 'items', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['opname', 'counts', sessionId] });
    void queryClient.invalidateQueries({ queryKey: countedKey });
    void queryClient.invalidateQueries({ queryKey: ['opname', 'sessions'] });
  }
}

export function useOpnameCountMutation(sessionId: number) {
  const queryClient = useQueryClient();
  const { me } = useAuth();
  return useMutation({
    mutationFn: async (input: OpnameCountMutationInput): Promise<OpnameCountResult> => {
      if (!me?.user.id) throw new Error('Akun tidak tersedia untuk menyimpan antrean opname lokal.');
      const previous = await countSyncQueue.list(me.user.id, sessionId);
      let before: number | null = input.item.counted_qty === null ? null : Number(input.item.counted_qty);
      for (const operation of previous) {
        if (operation.item.item_id !== input.item_id) continue;
        if (operation.input.action === 'clear') before = null;
        else before = operation.input.mode === 'add'
          ? (before ?? 0) + operation.input.quantity
          : operation.input.quantity;
      }

      const clientCreatedAt = new Date().toISOString();
      const queuedInput = { ...input, client_created_at: clientCreatedAt };
      await countSyncQueue.enqueue(me.user.id, sessionId, queuedInput, toOfflineIndexItem(input.item));

      let after: number | null = before;
      if (input.action === 'clear') after = null;
      else after = input.mode === 'add' ? (before ?? 0) + input.quantity : input.quantity;
      const { system_qty: _systemQty, ...itemWithoutStock } = input.item;
      void _systemQty;
      const item: OpnameItem = {
        ...itemWithoutStock,
        counted_qty: after === null ? null : String(after),
        counted_at: clientCreatedAt,
        status: after === null ? 'uncounted' : 'counted',
      };
      const tree = queryClient.getQueryData<OpnameProgressTree>(['opname', 'tree', sessionId]);
      const previousCounted = before !== null;
      const nextCounted = after !== null;
      const summary = tree?.summary ?? { total_products: 0, counted_products: 0 };
      const optimistic: OpnameCountResult = {
        item,
        summary: {
          ...summary,
          counted_products: Math.max(0, summary.counted_products + Number(nextCounted) - Number(previousCounted)),
        },
        nodes: [],
      };
      applyOpnameCountResult(queryClient, sessionId, optimistic, false);
      return optimistic;
    },
  });
}
