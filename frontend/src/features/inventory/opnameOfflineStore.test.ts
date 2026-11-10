import { describe, expect, it } from 'vitest';
import {
  CountSyncQueue,
  settleCountBatch,
  type CountQueueStorage,
  type QueuedCountOperation,
  type QueuedCountInput,
  type OfflineIndexItem,
} from './opnameOfflineStore';
import { syncUserCountQueue } from './opnameOfflineSync';
import { getCountSyncRetryDelay } from './useOpnameOffline';

class MemoryCountQueueStorage implements CountQueueStorage {
  private nextSequence = 1;
  private operations: QueuedCountOperation[] = [];
  private leases = new Map<string, string>();

  async add(operation: QueuedCountOperation): Promise<QueuedCountOperation> {
    const saved = { ...operation, sequence: this.nextSequence++ };
    this.operations.push(saved);
    return saved;
  }

  async list(userId: number, sessionId: number): Promise<QueuedCountOperation[]> {
    return this.operations.filter((operation) => operation.userId === userId && operation.sessionId === sessionId);
  }

  async listAll(): Promise<QueuedCountOperation[]> {
    return [...this.operations];
  }

  async remove(sequence: number): Promise<void> {
    this.operations = this.operations.filter((operation) => operation.sequence !== sequence);
  }

  async update(operation: QueuedCountOperation): Promise<void> {
    this.operations = this.operations.map((existing) => existing.sequence === operation.sequence ? operation : existing);
  }

  async acquireLease(key: string, owner: string): Promise<boolean> {
    if (this.leases.has(key) && this.leases.get(key) !== owner) return false;
    this.leases.set(key, owner);
    return true;
  }

  async releaseLease(key: string, owner: string): Promise<void> {
    if (this.leases.get(key) === owner) this.leases.delete(key);
  }
}

const item: OfflineIndexItem = {
  item_id: 7,
  product_id: 13,
  name: 'Produk Uji',
  barcode: 'ABC-123',
  category_id: null,
  counted_qty: null,
};

function countInput(id: string, mode: 'set' | 'add' = 'set'): QueuedCountInput {
  return {
    action: 'count',
    item_id: item.item_id,
    mode,
    quantity: 3,
    client_request_id: id,
    client_created_at: '2026-11-10T00:00:00.000Z',
  };
}

describe('offline opname count queue', () => {
  it('keeps FIFO order, blocks later operations behind a failed operation, and resumes after retry', async () => {
    const queue = new CountSyncQueue(new MemoryCountQueueStorage());
    const first = await queue.enqueue(1, 4, countInput('one'), item);
    const second = await queue.enqueue(1, 4, countInput('two', 'add'), item);
    await queue.enqueue(1, 4, countInput('three'), item);

    await queue.markFailed(second, { code: 'rejected', message: 'Ditolak' });
    expect((await queue.pending(1, 4)).map((operation) => operation.input.client_request_id)).toEqual(['one']);

    await queue.remove(first);
    expect(await queue.pending(1, 4)).toEqual([]);
    await queue.retry(second);
    expect((await queue.pending(1, 4)).map((operation) => operation.input.client_request_id)).toEqual(['two', 'three']);
  });

  it('deduplicates request IDs and keeps each user queue isolated', async () => {
    const queue = new CountSyncQueue(new MemoryCountQueueStorage());
    const first = await queue.enqueue(1, 4, countInput('same'), item);
    const duplicate = await queue.enqueue(1, 4, countInput('same'), item);
    await queue.enqueue(2, 4, countInput('other-user'), item);

    expect(duplicate.sequence).toBe(first.sequence);
    expect((await queue.forUser(1)).map((operation) => operation.input.client_request_id)).toEqual(['same']);
    expect((await queue.forUser(2)).map((operation) => operation.input.client_request_id)).toEqual(['other-user']);
  });

  it('removes duplicate server acknowledgements and preserves rejected operations with reasons', async () => {
    const queue = new CountSyncQueue(new MemoryCountQueueStorage());
    const duplicate = await queue.enqueue(1, 4, countInput('duplicate'), item);
    const rejected = await queue.enqueue(1, 4, countInput('rejected'), item);
    await settleCountBatch(queue, [duplicate, rejected], [
      { client_request_id: 'duplicate', status: 'duplicate' },
      { client_request_id: 'rejected', status: 'rejected', error: { code: 'session_not_in_progress', message: 'Sesi sudah ditutup.' } },
    ]);

    expect(await queue.list(1, 4)).toEqual([expect.objectContaining({
      input: expect.objectContaining({ client_request_id: 'rejected' }),
      status: 'failed',
      failure: { code: 'session_not_in_progress', message: 'Sesi sudah ditutup.' },
    })]);
  });

  it('uses capped retry backoff', () => {
    expect([0, 1, 2, 3, 4].map(getCountSyncRetryDelay)).toEqual([2_000, 5_000, 15_000, 30_000, 30_000]);
  });

  it('uses an exclusive lease for a user and session pair', async () => {
    const queue = new CountSyncQueue(new MemoryCountQueueStorage());
    expect(await queue.acquireLease(1, 4, 'tab-a')).toBe(true);
    expect(await queue.acquireLease(1, 4, 'tab-b')).toBe(false);
    await queue.releaseLease(1, 4, 'tab-a');
    expect(await queue.acquireLease(1, 4, 'tab-b')).toBe(true);
  });

  it('synchronizes all queued sessions for the requested user in FIFO order', async () => {
    const queue = new CountSyncQueue(new MemoryCountQueueStorage());
    await queue.enqueue(1, 4, countInput('one'), item);
    await queue.enqueue(1, 4, countInput('two', 'add'), item);
    await queue.enqueue(1, 5, countInput('three'), item);
    await queue.enqueue(2, 4, countInput('another-user'), item);
    const calls: Array<{ sessionId: number; requestIds: string[] }> = [];
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

    try {
      await syncUserCountQueue(1, queue, async (sessionId, operations) => {
        calls.push({ sessionId, requestIds: operations.map((operation) => operation.client_request_id) });
        return {
          results: operations.map((operation) => ({ client_request_id: operation.client_request_id, status: 'duplicate' as const })),
          summary: { total_products: 1, counted_products: 1 },
        };
      });
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }

    expect(calls).toEqual([
      { sessionId: 4, requestIds: ['one', 'two'] },
      { sessionId: 5, requestIds: ['three'] },
    ]);
    expect((await queue.forUser(1))).toEqual([]);
    expect((await queue.forUser(2)).map((operation) => operation.input.client_request_id)).toEqual(['another-user']);
  });

  it('does not send later work past a failed queue operation during logout sync', async () => {
    const queue = new CountSyncQueue(new MemoryCountQueueStorage());
    const first = await queue.enqueue(1, 4, countInput('failed'), item);
    await queue.enqueue(1, 4, countInput('later'), item);
    await queue.markFailed(first, { code: 'rejected', message: 'Ditolak' });
    let sendCount = 0;
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

    try {
      await syncUserCountQueue(1, queue, async () => {
        sendCount += 1;
        return { results: [], summary: { total_products: 0, counted_products: 0 } };
      });
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }

    expect(sendCount).toBe(0);
    expect((await queue.list(1, 4)).map((operation) => operation.status)).toEqual(['failed', 'pending']);
  });
});
