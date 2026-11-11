import { useState } from 'react';
import type { QueuedCountOperation } from './opnameOfflineStore';

export function PendingBadge() {
  return <span className="inline-flex min-h-6 items-center rounded-full bg-amber-100 px-2 text-[11px] font-medium text-amber-950">belum tersinkron</span>;
}

export function SyncStatusChip({
  isOnline,
  pendingCount,
  failedCount,
  syncing,
  onClick,
}: {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
  onClick: () => void;
}) {
  if (isOnline && pendingCount === 0 && failedCount === 0 && !syncing) return null;
  const label = failedCount > 0 ? `Gagal ${failedCount}`
    : syncing ? `Menyinkronkan ${pendingCount}…`
      : isOnline ? `${pendingCount} menunggu sinkron`
        : `Offline · ${pendingCount} menunggu`;
  const tone = failedCount > 0 ? 'border-rose-300 bg-rose-50 text-rose-900'
    : 'border-amber-300 bg-amber-50 text-amber-950';
  return (
    <button type="button" onClick={onClick} className={`min-h-10 max-w-44 truncate rounded-full border px-3 text-xs font-medium ${tone}`} aria-label={`${label}. Buka status sinkronisasi.`}>
      {failedCount > 0 ? '⚠ ' : '↻ '}{label}
    </button>
  );
}

export function SyncFailedSheet({
  pending,
  failed,
  syncing,
  queueError,
  onClose,
  onSync,
  onRetry,
  onRemove,
}: {
  pending: QueuedCountOperation[];
  failed: QueuedCountOperation[];
  syncing: boolean;
  queueError: string | null;
  onClose: () => void;
  onSync: () => void;
  onRetry: (operation: QueuedCountOperation) => void;
  onRemove: (operation: QueuedCountOperation) => void;
}) {
  const [copyMessage, setCopyMessage] = useState('');
  const [copying, setCopying] = useState(false);

  async function copyFailedList() {
    setCopying(true);
    try {
      const text = failed.map((operation) => {
        const quantity = operation.input.action === 'clear' ? 'hapus hitungan' : String(operation.input.quantity);
        return `${operation.item.name}: ${quantity} (${operation.failure?.message ?? 'Gagal tersinkron'})`;
      }).join('\n');
      await navigator.clipboard.writeText(text || 'Tidak ada hitungan yang gagal tersinkron.');
      setCopyMessage('Daftar disalin.');
    } catch (error) {
      setCopyMessage(error instanceof Error ? `Tidak dapat menyalin daftar: ${error.message}` : 'Tidak dapat menyalin daftar.');
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-stretch justify-center overflow-y-auto bg-slate-950/60 md:items-center md:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="sync-sheet-title" className="my-auto min-h-full w-full space-y-4 bg-white p-4 md:min-h-0 md:max-w-xl md:rounded-xl md:p-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="sync-sheet-title" className="text-lg font-semibold">Status sinkronisasi</h2>
            <p className="mt-1 text-sm text-slate-600">{pending.length} menunggu · {failed.length} gagal tersinkron</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-slate-300 px-3">Tutup</button>
        </header>
        {queueError && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-900">{queueError}</p>}
        <button type="button" disabled={syncing || pending.length === 0} onClick={onSync} className="min-h-11 w-full rounded-md bg-slate-900 px-4 font-medium text-white disabled:opacity-50">
          {syncing ? 'Menyinkronkan…' : 'Sinkronkan sekarang'}
        </button>
        {pending.length > 200 && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Antrean lebih dari 200 operasi. Segera sambungkan jaringan untuk sinkron.</p>}
        {failed.length > 0 && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-rose-900">Gagal tersinkron</h3>
              <button type="button" disabled={copying} onClick={() => void copyFailedList()} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm">{copying ? 'Menyalin…' : 'Salin daftar'}</button>
            </div>
            {copyMessage && <p role="status" className="text-xs text-slate-600">{copyMessage}</p>}
            <ul className="max-h-[45dvh] space-y-2 overflow-y-auto">
              {failed.map((operation) => (
                <li key={operation.sequence} className="rounded-md border border-rose-200 p-3">
                  <p className="font-medium">{operation.item.name} · {operation.input.action === 'clear' ? 'hapus hitungan' : operation.input.quantity}</p>
                  <p className="mt-1 text-sm text-rose-900">{operation.failure?.message ?? 'Operasi ditolak server.'}</p>
                  {operation.failure?.code === 'session_not_in_progress' && <p className="mt-1 text-xs text-slate-700">Sesi sudah ditutup; hitungan ini tidak berlaku di server.</p>}
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => onRetry(operation)} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm">Coba lagi</button>
                    <button type="button" onClick={() => {
                      if (window.confirm(`Hapus hitungan ${operation.item.name} dari antrean lokal? Salin daftar terlebih dahulu bila diperlukan.`)) onRemove(operation);
                    }} className="min-h-10 rounded-md border border-rose-300 px-3 text-sm text-rose-900">Hapus dari antrean</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </div>
  );
}
