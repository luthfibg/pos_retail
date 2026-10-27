import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { ProductPicker } from '@/features/products/ProductPicker';
import { goodsReceiptApi, inventoryApi } from '@/lib/api/endpoints';
import type { StockTransfer, StockTransferStatus } from '@/lib/api/types';
import { formatDate, formatDateTime, formatQty } from '@/lib/format';
import type { ProductOption } from './openingForm';
import {
  availableTransferBatches,
  buildTransferInput,
  validateTransfer,
  type TransferRow,
} from './transferForm';

const STATUS_LABEL: Record<StockTransferStatus, string> = {
  draft: 'Draft',
  posted: 'Sudah diposting',
  cancelled: 'Dibatalkan',
};

const STATUSES = Object.keys(STATUS_LABEL) as StockTransferStatus[];
let rowSequence = 0;

export function TransfersPage() {
  const [queryInput, setQueryInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState<StockTransferStatus | ''>('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const transfers = useQuery({
    queryKey: ['inventory', 'transfers', { queryText, status, page }],
    queryFn: () => inventoryApi.transfers({ q: queryText || undefined, status: status || undefined, page, per_page: 25 }),
  });

  function search(event: FormEvent) {
    event.preventDefault();
    setQueryText(queryInput.trim());
    setPage(1);
  }

  return (
    <div className="space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Transfer Stok</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Pindahkan saldo sellable antar lokasi. Draft belum mengubah stok; perubahan terjadi setelah diposting.
          </p>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Buat transfer
        </button>
      </header>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <Field label="Nomor dokumen">
            <input className={`${inputCls} w-52`} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="TRF-…" />
          </Field>
          <Field label="Status">
            <select className={`${inputCls} w-48`} value={status} onChange={(event) => { setStatus(event.target.value as StockTransferStatus | ''); setPage(1); }}>
              <option value="">Semua status</option>
              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
            </select>
          </Field>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Terapkan</button>
        </form>

        <ErrorNotice error={transfers.error} />
        {transfers.isLoading && <p className="text-sm text-slate-500">Memuat transfer…</p>}
        {transfers.data?.data.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada dokumen yang cocok.</p>}
        {transfers.data && transfers.data.data.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nomor dokumen</th>
                    <th className="px-3 py-2">Lokasi asal</th>
                    <th className="px-3 py-2">Lokasi tujuan</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Dibuat</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transfers.data.data.map((transfer) => (
                    <tr key={transfer.id}>
                      <td className="px-3 py-2 font-mono font-medium">{transfer.doc_number}</td>
                      <td className="px-3 py-2">{transfer.from_location_name}</td>
                      <td className="px-3 py-2">{transfer.to_location_name}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[transfer.status]}</td>
                      <td className="px-3 py-2">{formatDateTime(transfer.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setSelectedId(transfer.id)} className="font-medium text-blue-700 hover:underline">Detail</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={transfers.data.current_page}
              lastPage={transfers.data.last_page}
              from={transfers.data.from}
              to={transfers.data.to}
              total={transfers.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>

      {createOpen && (
        <TransferCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(transfer) => {
            setCreateOpen(false);
            setSelectedId(transfer.id);
            void transfers.refetch();
          }}
        />
      )}
      {selectedId !== null && (
        <TransferDetailDialog
          transferId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => { void transfers.refetch(); }}
        />
      )}
    </div>
  );
}

function TransferCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (transfer: StockTransfer) => void }) {
  const queryClient = useQueryClient();
  const [fromLocationId, setFromLocationId] = useState<number | null>(null);
  const [toLocationId, setToLocationId] = useState<number | null>(null);
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [selectedBalanceId, setSelectedBalanceId] = useState<number | null>(null);
  const [qty, setQty] = useState('');
  const [toPositionId, setToPositionId] = useState('');
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [errors, setErrors] = useState<{ general?: string; rows: Record<number, string> }>({ rows: {} });
  const [confirming, setConfirming] = useState(false);

  const locations = useQuery({
    queryKey: ['goods-receipts', 'receiving-locations'],
    queryFn: () => goodsReceiptApi.receivingLocations(),
  });
  const stock = useQuery({
    queryKey: ['inventory', 'product-stock', product?.id],
    queryFn: () => inventoryApi.productStock(product!.id),
    enabled: product !== null && fromLocationId !== null,
  });
  const sourceBalances = stock.data && fromLocationId !== null
    ? availableTransferBatches(stock.data, fromLocationId)
    : [];
  const selectedBalance = sourceBalances.find((batch) => batch.balance_id === selectedBalanceId) ?? null;

  const create = useMutation({
    mutationFn: () => {
      if (fromLocationId === null || toLocationId === null) throw new Error('Lokasi asal dan tujuan belum dipilih.');
      return inventoryApi.createTransfer(buildTransferInput(fromLocationId, toLocationId, rows));
    },
    onSuccess: async (transfer) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
      onCreated(transfer);
    },
  });

  function addLine() {
    if (!product || !selectedBalance || !qty.trim()) return;
    const row: TransferRow = {
      key: `${product.id}:${selectedBalance.balance_id}:${++rowSequence}`,
      product,
      batch: selectedBalance,
      qty: qty.trim(),
      toPositionId,
    };
    const validation = validateTransfer(fromLocationId, toLocationId, [...rows, row]);
    if (validation.rows[rows.length]) {
      setErrors(validation);
      return;
    }
    setRows((current) => [...current, row]);
    setErrors({ rows: {} });
    setProduct(null);
    setSelectedBalanceId(null);
    setQty('');
    setToPositionId('');
  }

  function validateAndReview(event: FormEvent) {
    event.preventDefault();
    const validation = validateTransfer(fromLocationId, toLocationId, rows);
    setErrors(validation);
    if (!validation.general && Object.keys(validation.rows).length === 0) setConfirming(true);
  }

  const availableDestinations = locations.data ?? [];

  return (
    <Modal title="Buat Draft Transfer Stok" onClose={() => !create.isPending && onClose()}>
      <form onSubmit={validateAndReview} className="space-y-4 p-5">
        <ErrorNotice error={locations.error ?? stock.error ?? create.error} />
        {locations.isLoading ? <p className="text-sm text-slate-500">Memuat lokasi…</p> : locations.data && locations.data.length === 0 ? (
          <p className="text-sm text-amber-800">Tidak ada lokasi aktif untuk toko ini.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lokasi asal">
              <select
                className={inputCls}
                value={fromLocationId ?? ''}
                onChange={(event) => {
                  const id = event.target.value ? Number(event.target.value) : null;
                  setFromLocationId(id);
                  setToLocationId((current) => current === id ? null : current);
                  setRows([]);
                  setProduct(null);
                  setSelectedBalanceId(null);
                }}
              >
                <option value="">Pilih lokasi asal</option>
                {(locations.data ?? []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </Field>
            <Field label="Lokasi tujuan">
              <select className={inputCls} value={toLocationId ?? ''} onChange={(event) => setToLocationId(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Pilih lokasi tujuan</option>
                {availableDestinations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </Field>
          </div>
        )}

        {fromLocationId !== null && toLocationId !== null && (
          <div className="space-y-3 rounded-md border border-slate-200 p-3">
            <Field label="Produk">
              <ProductPicker
                value={product}
                onChange={(value) => { setProduct(value); setSelectedBalanceId(null); }}
                placeholder="Cari produk dengan saldo"
              />
            </Field>
            {product && (
              stock.isLoading ? <p className="text-sm text-slate-500">Memuat saldo produk…</p> :
                stock.data && sourceBalances.length === 0 ? (
                  <p className="text-sm text-amber-800">Produk ini tidak memiliki saldo sellable di lokasi asal.</p>
                ) : sourceBalances.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Batch / posisi asal">
                      <select className={inputCls} value={selectedBalanceId ?? ''} onChange={(event) => setSelectedBalanceId(event.target.value ? Number(event.target.value) : null)}>
                        <option value="">Pilih saldo</option>
                        {sourceBalances.map((batch) => (
                          <option key={batch.balance_id} value={batch.balance_id}>
                            {batch.batch_code ? `Batch ${batch.batch_code}` : 'Tanpa batch'} · {batch.shelf_position_id ? `Posisi #${batch.shelf_position_id}` : 'Tanpa posisi'} · tersedia {formatQty(batch.qty_sellable)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Qty transfer" hint={selectedBalance ? `Tersedia ${formatQty(selectedBalance.qty_sellable)} ${product.unit_name}` : undefined}>
                      <input className={inputCls} inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} placeholder="Contoh: 5.000" />
                    </Field>
                    <Field label="ID posisi tujuan (opsional)" hint="Isi ID posisi rak aktif bila sudah diketahui. Tanpa ID, stok dipindah ke lokasi tujuan tanpa posisi rak.">
                      <input className={inputCls} inputMode="numeric" value={toPositionId} onChange={(event) => setToPositionId(event.target.value)} placeholder="Contoh: 12" />
                    </Field>
                    <div className="flex items-end">
                      <button type="button" onClick={addLine} disabled={!selectedBalance || !qty.trim()} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">
                        Tambah baris
                      </button>
                    </div>
                  </div>
                )
            )}
          </div>
        )}

        {rows.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Rincian transfer ({rows.length})</h3>
            <div className="max-h-64 space-y-2 overflow-auto">
              {rows.map((row, index) => (
                <div key={row.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.product.name} <span className="font-mono text-xs text-slate-500">{row.product.sku}</span></div>
                    <div className="text-xs text-slate-500">
                      {row.batch.batch_code ? `Batch ${row.batch.batch_code}` : 'Tanpa batch'}
                      {row.batch.expiry_date ? ` · Exp ${formatDate(row.batch.expiry_date)}` : ''}
                      {' · '}Asal {row.batch.shelf_position_id ? `posisi #${row.batch.shelf_position_id}` : 'tanpa posisi'}
                      {row.toPositionId.trim() ? ` · Tujuan posisi #${row.toPositionId}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums">{formatQty(row.qty)} {row.product.unit_name}</span>
                    <button type="button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} className="text-xs text-red-700 underline">Hapus</button>
                  </div>
                  {errors.rows[index] && <p role="alert" className="w-full text-xs text-red-700">{errors.rows[index]}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {errors.general && <p role="alert" className="text-sm text-red-700">{errors.general}</p>}
        {!confirming ? (
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" disabled={create.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
            <button type="submit" disabled={create.isPending || locations.isLoading} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Tinjau dan simpan Draft</button>
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>Draft tidak mengubah atau mereservasi stok. Saat posting, saldo asal diperiksa kembali; jika stok sudah berubah, posting akan ditolak.</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={create.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2">Kembali</button>
              <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">
                {create.isPending ? 'Menyimpan…' : 'Simpan Draft'}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

function TransferDetailDialog({ transferId, onClose, onChanged }: { transferId: number; onClose: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'post' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const detail = useQuery({
    queryKey: ['inventory', 'transfer', transferId],
    queryFn: () => inventoryApi.transfer(transferId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfer', transferId] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
    ]);
    setAction(null);
    setReason('');
    onChanged();
  };
  const post = useMutation({ mutationFn: () => inventoryApi.postTransfer(transferId), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => inventoryApi.cancelTransfer(transferId, reason.trim() || undefined), onSuccess: refresh });
  const saving = post.isPending || cancel.isPending;
  const transfer = detail.data;

  return (
    <Modal title={transfer ? `Transfer ${transfer.doc_number}` : 'Detail transfer'} onClose={() => !saving && onClose()}>
      {detail.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat dokumen…</p> : detail.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={detail.error} /></div>
      ) : transfer ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={post.error ?? cancel.error} />
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Status" value={STATUS_LABEL[transfer.status]} />
            <Detail label="Dibuat" value={`${transfer.created_by_name} · ${formatDateTime(transfer.created_at)}`} />
            <Detail label="Lokasi asal" value={transfer.from_location_name} />
            <Detail label="Lokasi tujuan" value={transfer.to_location_name} />
            {transfer.posted_at && <Detail label="Diposting oleh" value={`${transfer.posted_by_name ?? '—'} · ${formatDateTime(transfer.posted_at)}`} />}
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Produk / batch</th>
                  <th className="px-3 py-2">Posisi asal</th>
                  <th className="px-3 py-2">Posisi tujuan</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfer.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      {item.product_name}
                      <div className="font-mono text-xs text-slate-500">{item.sku}{item.batch_code ? ` · ${item.batch_code}` : ' · tanpa batch'}{item.expiry_date ? ` · Exp ${formatDate(item.expiry_date)}` : ''}</div>
                    </td>
                    <td className="px-3 py-2">{item.from_position ?? 'Tanpa posisi'}</td>
                    <td className="px-3 py-2">{item.to_position ?? 'Tanpa posisi'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQty(item.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {transfer.status === 'draft' && !action && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setAction('cancel')} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Batalkan Draft</button>
              <button type="button" onClick={() => setAction('post')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Posting transfer</button>
            </div>
          )}
          {action === 'post' && (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p>Posting akan memindahkan saldo stok secara permanen ke lokasi tujuan. Pastikan rincian dan qty sudah benar.</p>
              <div className="flex justify-end gap-2">
                <button type="button" disabled={saving} onClick={() => setAction(null)} className="rounded-md border border-slate-300 px-3 py-2">Kembali</button>
                <button type="button" disabled={saving} onClick={() => post.mutate()} className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">{saving ? 'Memposting…' : 'Konfirmasi posting'}</button>
              </div>
            </div>
          )}
          {action === 'cancel' && (
            <div className="space-y-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
              <Field label="Alasan pembatalan (opsional)">
                <textarea className={inputCls} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" disabled={saving} onClick={() => setAction(null)} className="rounded-md border border-slate-300 px-3 py-2">Kembali</button>
                <button type="button" disabled={saving} onClick={() => cancel.mutate()} className="rounded-md bg-red-700 px-3 py-2 font-medium text-white disabled:opacity-60">{saving ? 'Membatalkan…' : 'Konfirmasi pembatalan'}</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-slate-500">{label}</div><div className="font-medium">{value}</div></div>;
}
