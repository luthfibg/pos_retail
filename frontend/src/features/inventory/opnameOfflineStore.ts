import type { OpnameBatchCountResult, OpnameItem } from '@/lib/api/types';

const DATABASE_NAME = 'pos-retail-opname-offline';
const DATABASE_VERSION = 1;
const OPERATIONS_STORE = 'operations';
const SESSIONS_STORE = 'sessions';
const META_STORE = 'meta';
const LEASE_MS = 30_000;

export interface OfflineIndexItem {
  item_id: number;
  product_id: number;
  name: string;
  barcode: string;
  category_id: number | null;
  counted_qty: number | null;
}

export interface OfflineSessionIndex {
  session: { id: number; number: string; status: 'in_progress' };
  version: string;
  categories: Array<{ id: number; name: string; parent_id: number | null }>;
  items: OfflineIndexItem[];
  pageEtags: Record<number, string>;
  updatedAt: string;
}

export type QueuedCountInput =
  | { action: 'count'; item_id: number; mode: 'set' | 'add'; quantity: number; client_request_id: string; client_created_at: string }
  | { action: 'clear'; item_id: number; client_request_id: string; client_created_at: string };

export interface QueuedCountOperation {
  sequence?: number;
  userId: number;
  sessionId: number;
  input: QueuedCountInput;
  item: OfflineIndexItem;
  status: 'pending' | 'failed';
  failure?: { code: string; message: string };
}

export interface CountQueueStorage {
  add(operation: QueuedCountOperation): Promise<QueuedCountOperation>;
  list(userId: number, sessionId: number): Promise<QueuedCountOperation[]>;
  listAll(): Promise<QueuedCountOperation[]>;
  remove(sequence: number): Promise<void>;
  update(operation: QueuedCountOperation): Promise<void>;
  acquireLease(scopeKey: string, owner: string): Promise<boolean>;
  releaseLease(scopeKey: string, owner: string): Promise<void>;
}

function scopeKey(userId: number, sessionId: number): string {
  return `${userId}:${sessionId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Penyimpanan IndexedDB tidak tersedia di perangkat ini.'));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
        const operations = database.createObjectStore(OPERATIONS_STORE, { keyPath: 'sequence', autoIncrement: true });
        operations.createIndex('scope', ['userId', 'sessionId'], { unique: false });
      }
      if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
        database.createObjectStore(SESSIONS_STORE, { keyPath: 'scopeKey' });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Tidak dapat membuka penyimpanan lokal opname.'));
    request.onblocked = () => reject(new Error('Tutup tab opname lain untuk memperbarui penyimpanan lokal.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Operasi penyimpanan lokal gagal.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Penyimpanan lokal dibatalkan.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Operasi penyimpanan lokal gagal.'));
  });
}

export class IndexedDbCountQueueStorage implements CountQueueStorage {
  async add(operation: QueuedCountOperation): Promise<QueuedCountOperation> {
    const database = await openDatabase();
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    const copy = { ...operation };
    copy.sequence = await requestResult(transaction.objectStore(OPERATIONS_STORE).add(copy) as IDBRequest<number>);
    await transactionDone(transaction);
    database.close();
    return copy;
  }

  async list(userId: number, sessionId: number): Promise<QueuedCountOperation[]> {
    const database = await openDatabase();
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    const index = transaction.objectStore(OPERATIONS_STORE).index('scope');
    const records = await requestResult(index.getAll(IDBKeyRange.only([userId, sessionId]))) as QueuedCountOperation[];
    await transactionDone(transaction);
    database.close();
    return records.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  }

  async listAll(): Promise<QueuedCountOperation[]> {
    const database = await openDatabase();
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    const records = await requestResult(transaction.objectStore(OPERATIONS_STORE).getAll()) as QueuedCountOperation[];
    await transactionDone(transaction);
    database.close();
    return records.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  }

  async remove(sequence: number): Promise<void> {
    await this.runOperation((store) => store.delete(sequence));
  }

  async update(operation: QueuedCountOperation): Promise<void> {
    if (operation.sequence === undefined) throw new Error('Operasi antrean tidak memiliki nomor urut.');
    await this.runOperation((store) => store.put(operation));
  }

  async acquireLease(key: string, owner: string): Promise<boolean> {
    const database = await openDatabase();
    const transaction = database.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);
    const metaKey = `sender-lease:${key}`;
    const existing = await requestResult(store.get(metaKey)) as { owner: string; expiresAt: number } | undefined;
    const acquired = !existing || existing.expiresAt <= Date.now() || existing.owner === owner;
    if (acquired) store.put({ key: metaKey, owner, expiresAt: Date.now() + LEASE_MS });
    await transactionDone(transaction);
    database.close();
    return acquired;
  }

  async releaseLease(key: string, owner: string): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);
    const metaKey = `sender-lease:${key}`;
    const existing = await requestResult(store.get(metaKey)) as { owner: string } | undefined;
    if (existing?.owner === owner) store.delete(metaKey);
    await transactionDone(transaction);
    database.close();
  }

  private async runOperation(operation: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    operation(transaction.objectStore(OPERATIONS_STORE));
    await transactionDone(transaction);
    database.close();
  }
}

export class CountSyncQueue {
  constructor(private readonly storage: CountQueueStorage = new IndexedDbCountQueueStorage()) {}

  async enqueue(userId: number, sessionId: number, input: QueuedCountInput, item: OfflineIndexItem): Promise<QueuedCountOperation> {
    const existing = (await this.storage.list(userId, sessionId))
      .find((operation) => operation.input.client_request_id === input.client_request_id);
    if (existing) return existing;
    const record = await this.storage.add({ userId, sessionId, input, item, status: 'pending' });
    notifyQueueChanged();
    return record;
  }

  async list(userId: number, sessionId: number): Promise<QueuedCountOperation[]> {
    return this.storage.list(userId, sessionId);
  }

  async forUser(userId: number): Promise<QueuedCountOperation[]> {
    return (await this.storage.listAll()).filter((operation) => operation.userId === userId);
  }

  async pending(userId: number, sessionId: number): Promise<QueuedCountOperation[]> {
    const operations = await this.list(userId, sessionId);
    const failedIndex = operations.findIndex((operation) => operation.status === 'failed');
    return operations.slice(0, failedIndex < 0 ? operations.length : failedIndex)
      .filter((operation) => operation.status === 'pending');
  }

  async failed(userId: number, sessionId: number): Promise<QueuedCountOperation[]> {
    return (await this.list(userId, sessionId)).filter((operation) => operation.status === 'failed');
  }

  async markFailed(operation: QueuedCountOperation, failure: { code: string; message: string }): Promise<void> {
    await this.storage.update({ ...operation, status: 'failed', failure });
    notifyQueueChanged();
  }

  async retry(operation: QueuedCountOperation): Promise<void> {
    await this.storage.update({ ...operation, status: 'pending', failure: undefined });
    notifyQueueChanged();
  }

  async remove(operation: QueuedCountOperation): Promise<void> {
    if (operation.sequence === undefined) throw new Error('Operasi antrean tidak memiliki nomor urut.');
    await this.storage.remove(operation.sequence);
    notifyQueueChanged();
  }

  acquireLease(userId: number, sessionId: number, owner: string): Promise<boolean> {
    return this.storage.acquireLease(scopeKey(userId, sessionId), owner);
  }

  releaseLease(userId: number, sessionId: number, owner: string): Promise<void> {
    return this.storage.releaseLease(scopeKey(userId, sessionId), owner);
  }
}

export class IndexedDbOfflineSessionIndex {
  async get(userId: number, sessionId: number): Promise<OfflineSessionIndex | null> {
    const database = await openDatabase();
    const transaction = database.transaction(SESSIONS_STORE, 'readonly');
    const result = await requestResult(transaction.objectStore(SESSIONS_STORE).get(scopeKey(userId, sessionId))) as OfflineSessionIndex | undefined;
    await transactionDone(transaction);
    database.close();
    return result ?? null;
  }

  async save(userId: number, sessionId: number, index: OfflineSessionIndex): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(SESSIONS_STORE, 'readwrite');
    transaction.objectStore(SESSIONS_STORE).put({ ...index, scopeKey: scopeKey(userId, sessionId) });
    await transactionDone(transaction);
    database.close();
    notifyQueueChanged();
  }

  async remove(userId: number, sessionId: number): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(SESSIONS_STORE, 'readwrite');
    transaction.objectStore(SESSIONS_STORE).delete(scopeKey(userId, sessionId));
    await transactionDone(transaction);
    database.close();
  }

  async removeForUser(userId: number): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(SESSIONS_STORE, 'readwrite');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(`${userId}:`)) cursor.delete();
      cursor.continue();
    };
    await transactionDone(transaction);
    database.close();
  }
}

const queueListeners = new Set<() => void>();
let broadcast: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  broadcast = new BroadcastChannel('pos-opname-count-queue');
  broadcast.onmessage = () => queueListeners.forEach((listener) => listener());
}

export function notifyQueueChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('opname-count-queue-changed'));
  broadcast?.postMessage({ changed: true });
}

export function subscribeCountQueue(listener: () => void): () => void {
  queueListeners.add(listener);
  const onChange = () => listener();
  window.addEventListener('opname-count-queue-changed', onChange);
  return () => {
    queueListeners.delete(listener);
    window.removeEventListener('opname-count-queue-changed', onChange);
  };
}

export async function settleCountBatch(
  queue: CountSyncQueue,
  operations: QueuedCountOperation[],
  results: OpnameBatchCountResult['results'],
): Promise<void> {
  const byId = new Map(results.map((result) => [result.client_request_id, result]));
  for (const operation of operations) {
    const result = byId.get(operation.input.client_request_id);
    if (!result) {
      await queue.markFailed(operation, { code: 'missing_batch_result', message: 'Server tidak mengembalikan hasil operasi ini.' });
    } else if (result.status === 'rejected') {
      await queue.markFailed(operation, result.error ?? { code: 'rejected', message: 'Server menolak hitungan.' });
    } else {
      await queue.remove(operation);
    }
  }
}

export function toOfflineIndexItem(item: OpnameItem): OfflineIndexItem {
  return {
    item_id: item.id,
    product_id: item.product_id,
    name: item.name,
    barcode: item.barcode,
    category_id: item.category_id,
    counted_qty: item.counted_qty === null ? null : Number(item.counted_qty),
  };
}

export const countSyncQueue = new CountSyncQueue();
export const offlineSessionIndex = new IndexedDbOfflineSessionIndex();
