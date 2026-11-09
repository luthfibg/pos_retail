import { useMutation, useQueryClient } from '@tanstack/react-query';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameCountResult, OpnameItem, OpnameProgressNode, OpnameProgressTree, Paginated } from '@/lib/api/types';

export type OpnameCountMutationInput =
  | { action: 'count'; item_id: number; mode: 'set' | 'add'; quantity: number; client_request_id: string }
  | { action: 'clear'; item_id: number; client_request_id: string };

function updateNode(node: OpnameProgressNode, changes: OpnameCountResult['nodes']): OpnameProgressNode {
  const updated = changes.find((change) => String(change.id) === String(node.id));
  return {
    ...node,
    ...(updated ?? {}),
    children: node.children.map((child) => updateNode(child, changes)),
  };
}

export function applyOpnameCountResult(queryClient: ReturnType<typeof useQueryClient>, sessionId: number, result: OpnameCountResult) {
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
  void queryClient.invalidateQueries({ queryKey: ['opname', 'items', sessionId] });
  void queryClient.invalidateQueries({ queryKey: ['opname', 'counts', sessionId] });
  void queryClient.invalidateQueries({ queryKey: countedKey });
  void queryClient.invalidateQueries({ queryKey: ['opname', 'sessions'] });
}

export function useOpnameCountMutation(sessionId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OpnameCountMutationInput) => input.action === 'clear'
      ? opnameApi.clearCount(sessionId, input.item_id, input.client_request_id)
      : opnameApi.storeCount(sessionId, input),
    onSuccess: (result) => applyOpnameCountResult(queryClient, sessionId, result),
  });
}
