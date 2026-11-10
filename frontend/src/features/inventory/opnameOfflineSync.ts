import { ApiError } from '@/lib/api/client';
import { opnameApi } from '@/lib/api/endpoints';
import {
  countSyncQueue,
  settleCountBatch,
  type CountSyncQueue,
  type QueuedCountOperation,
} from './opnameOfflineStore';

type CountBatchSender = typeof opnameApi.batchCounts;

function toBatchInput(operation: QueuedCountOperation) {
  const { input } = operation;
  return {
    client_request_id: input.client_request_id,
    action: input.action,
    item_id: input.item_id,
    ...(input.action === 'count' ? { mode: input.mode, quantity: input.quantity } : {}),
    client_created_at: input.client_created_at,
  };
}

export async function syncUserCountQueue(
  userId: number,
  queue: CountSyncQueue = countSyncQueue,
  sendBatch: CountBatchSender = opnameApi.batchCounts,
): Promise<void> {
  if (!navigator.onLine) throw new Error('Perangkat sedang offline; hitungan tetap tersimpan di antrean lokal.');

  const sessionIds = new Set((await queue.forUser(userId)).map((operation) => operation.sessionId));
  for (const sessionId of sessionIds) {
    const owner = globalThis.crypto.randomUUID();
    const acquired = await queue.acquireLease(userId, sessionId, owner);
    if (!acquired) continue;

    try {
      while (navigator.onLine) {
        const batch = (await queue.pending(userId, sessionId)).slice(0, 100);
        if (batch.length === 0) break;
        try {
          const response = await sendBatch(sessionId, batch.map(toBatchInput));
          await settleCountBatch(queue, batch, response.results);
        } catch (error) {
          if (error instanceof ApiError && error.status > 0 && error.status < 500) {
            for (const operation of await queue.pending(userId, sessionId)) {
              await queue.markFailed(operation, {
                code: `http_${error.status}`,
                message: error.message || 'Operasi ditolak oleh server.',
              });
            }
            break;
          }
          throw error;
        }
      }
    } finally {
      await queue.releaseLease(userId, sessionId, owner);
    }
  }
}
