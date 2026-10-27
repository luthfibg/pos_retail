import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { ProductPicker } from '@/features/products/ProductPicker';
import { useAuth } from '@/features/auth/AuthProvider';
import { inventoryApi } from '@/lib/api/endpoints';
import type {
  ProductStock,
  StockAdjustment,
  StockAdjustmentReason,
  StockAdjustmentStatus,
} from '@/lib/api/types';
import { formatDate, formatDateTime, formatQty } from '@/lib/format';
import { milliToQty, qtyToMilli } from '@/lib/money';
import type { ProductOption } from './openingForm';
import {
  buildAdjustmentInput,
  rowsFromStock,
  validateAdjustment,
  type AdjustmentRow,
} from './adjustmentForm';

const REASON_LABEL: Record<StockAdjustmentReason, string> = {
  opname: 'Opname',
  loss: 'Kehilangan',
  damage: 'Barang rusak',
  expired: 'Kedaluwarsa',
  other: 'Lainnya',
};

const STATUS_LABEL: Record<StockAdjustmentStatus, string> = {
  draft: 'Draft',
  requested: 'Menunggu persetujuan',
  posted: 'Sudah diposting',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
};

const REASONS = Object.keys(REASON_LABEL) as StockAdjustmentReason[];
const STATUSES = Object.keys(STATUS_LABEL) as StockAdjustmentStatus[];

export function AdjustmentsPage() {
  const { can, me } = useAuth();
  const canRequest = can('inventory.adjust.request');
  const canApprove = can('inventory.adjust.approve');
  const [queryInput, setQueryInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState<StockAdjustmentStatus | ''>('');
  const [reason, setReason] = useState<StockAdjustmentReason | ''>('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ['inventory', 'adjustments', { queryText, status, reason, page }],
    queryFn: () => inventoryApi.adjustments({
      q: queryText || undefined,
      status: status || undefined,
      reason: reason || undefined,
      page,
      per_page: 25,
    }),
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
          <h1 className="text-xl font-semibold">Adjustment &amp; Opname Stok</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Catat hasil hitung fisik terhadap saldo sellable. Adjustment tersimpan sebagai Draft; saldo baru berubah setelah disetujui dan diposting.
          </p>
        </div>
        {canRequest && <button type="button" onClick={() => setCreateOpen(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Buat adjustment</button>}
      </header>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <Field label="Nomor dokumen">
            <input className={`${inputCls} w-52`} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="ADJ-…" />
          </Field>
          <Field label="Status">
            <select className={`${inputCls} w-52`} value={status} onChange={(event) => { setStatus(event.target.value as StockAdjustmentStatus | ''); setPage(1); }}>
              <option value="">Semua status</option>
              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
            </select>
          </Field>
          <Field label="Alasan">
            <select className={`${inputCls} w-48`} value={reason} onChange={(event) => { setReason(event.target.value as StockAdjustmentReason | ''); setPage(1); }}>
              <option value="">Semua alasan</option>
              {REASONS.map((value) => <option key={value} value={value}>{REASON_LABEL[value]}</option>)}
            </select>
          </Field>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Terapkan</button>
        </form>

        <ErrorNotice error={list.error} />
        {list.isLoading && <p className="text-sm text-slate-500">Memuat adjustment…</p>}
        {list.data?.data.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada dokumen yang cocok.</p>}
        {list.data && list.data.data.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nomor dokumen</th>
                    {canApprove && <th className="px-3 py-2">Pemohon</th>}
                    <th className="px-3 py-2">Alasan</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Dibuat</th>
                    <th className="px-3 py-2">Disetujui oleh</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.data.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-mono font-medium">{item.doc_number}</td>
                      {canApprove && <td className="px-3 py-2">{item.requested_by_name}</td>}
                      <td className="px-3 py-2">{REASON_LABEL[item.reason]}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[item.status]}</td>
                      <td className="px-3 py-2">{formatDateTime(item.created_at)}</td>
                      <td className="px-3 py-2">{item.approved_by_name ?? '—'}</td>
                      <td className="px-3 py-2 text-right"><button type="button" onClick={() => setSelectedId(item.id)} className="font-medium text-blue-700 hover:underline">Detail</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={list.data.current_page}
              lastPage={list.data.last_page}
              from={list.data.from}
              to={list.data.to}
              total={list.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>

      {createOpen && <AdjustmentCreateDialog
        onClose={() => setCreateOpen(false)}
        onCreated={(adjustment) => {
          setCreateOpen(false);
          setSelectedId(adjustment.id);
          void list.refetch();
        }}
      />}
      {selectedId !== null && <AdjustmentDetailDialog
        adjustmentId={selectedId}
        canRequest={canRequest}
        canApprove={canApprove}
        username={me?.user.username ?? ''}
        onClose={() => setSelectedId(null)}
        onChanged={() => { void list.refetch(); }}
      />}
    </div>
  );
}

function AdjustmentCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (adjustment: StockAdjustment) => void;
}) {
  const qc = useQueryClient();
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [reason, setReason] = useState<StockAdjustmentReason>('opname');
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ general?: string; rows: Record<number, string> }>({ rows: {} });
  const [confirming, setConfirming] = useState(false);
  const stock = useQuery({
    queryKey: ['inventory', 'product-stock', product?.id],
    queryFn: () => inventoryApi.productStock(product!.id),
    enabled: product !== null,
  });
  const create = useMutation({
    mutationFn: () => inventoryApi.createAdjustment(buildAdjustmentInput(reason, rows, note)),
    onSuccess: async (adjustment) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inventory', 'adjustments'] }),
        qc.invalidateQueries({ queryKey: ['inventory'] }),
        qc.invalidateQueries({ queryKey: ['products'] }),
      ]);
      onCreated(adjustment);
    },
  });

  function addProductStock(stockData: ProductStock) {
    if (!product) return;
    const newRows = rowsFromStock(product, stockData);
    setRows((current) => {
      const known = new Set(current.map((row) => row.key));
      const additions = newRows.filter((row) => !known.has(row.key));
      return [...current, ...additions].slice(0, 200);
    });
    setErrors({ rows: {} });
  }

  function review(event: FormEvent) {
    event.preventDefault();
    create.reset();
    const result = validateAdjustment(rows, note);
    setErrors(result);
    if (result.general || Object.keys(result.rows).length > 0) return;
    setConfirming(true);
  }

  function submit() {
    if (create.isPending) return;
    create.mutate();
  }

  return (
    <Modal title="Buat adjustment stok" onClose={() => !create.isPending && onClose()}>
      <form className="space-y-4 p-5" onSubmit={review}>
        <p className="text-sm text-slate-600">
          Pilih produk untuk memuat saldo tercatat per lokasi dan batch. Jumlah hitung awal terisi dari saldo sellable saat ini dan dapat diubah.
        </p>
        <ErrorNotice error={create.error} />
        {errors.general && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errors.general}</div>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Alasan">
            <select className={inputCls} value={reason} onChange={(event) => setReason(event.target.value as StockAdjustmentReason)}>
              {REASONS.map((value) => <option key={value} value={value}>{REASON_LABEL[value]}</option>)}
            </select>
          </Field>
          <Field label="Produk">
            <ProductPicker value={product} onChange={setProduct} placeholder="Cari produk untuk dihitung" />
          </Field>
        </div>

        {product && (
          <section className="space-y-2 rounded-md border border-slate-200 p-3">
            {stock.isLoading ? <p className="text-sm text-slate-500">Memuat saldo produk…</p> : stock.error ? <ErrorNotice error={stock.error} /> :
              stock.data && stock.data.batches.length > 0 ? (
                <>
                  <p className="text-sm font-medium">{product.name} · saldo sellable total {formatQty(stock.data.totals.qty_sellable)} {product.unit_name}</p>
                  <p className="text-xs text-slate-500">Lokasi dan posisi ditampilkan sebagai ID saldo yang dikembalikan server.</p>
                  <button type="button" onClick={() => addProductStock(stock.data!)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                    Tambahkan semua batch/lokasi
                  </button>
                </>
              ) : stock.data ? (
                <p className="text-sm text-amber-800">Belum ada saldo stok tercatat untuk produk ini. Form ini hanya dapat membuat hitungan untuk saldo/lokasi yang sudah tercatat.</p>
              ) : null}
          </section>
        )}

        {rows.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Saldo yang dihitung ({rows.length})</h3>
            <div className="max-h-72 space-y-2 overflow-auto">
              {rows.map((row, index) => {
                const error = errors.rows[index];
                const before = qtyToMilli(row.qtyBefore);
                const counted = qtyToMilli(row.qtyCounted);
                const difference = before !== null && counted !== null ? milliToQty(counted - before) : '—';
                return (
                  <div key={row.key} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_auto_8rem_auto] sm:items-center">
                    <div className="min-w-0 text-sm">
                      <div className="truncate font-medium">{row.product.name}</div>
                      <div className="font-mono text-xs text-slate-500">{row.product.sku}</div>
                      <div className="text-xs text-slate-500">
                        {row.batchCode ? `Batch ${row.batchCode}` : 'Tanpa batch'}{row.expiryDate ? ` · Exp ${formatDate(row.expiryDate)}` : ''}
                        {' · '}Lokasi #{row.locationId}{row.shelfPositionId !== null ? ` · Posisi #${row.shelfPositionId}` : ''}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">Saldo {formatQty(row.qtyBefore)} {row.product.unit_name}</div>
                    <label className="text-xs text-slate-500">Hasil hitung
                      <input className={`${inputCls} mt-1 tabular-nums`} inputMode="decimal" value={row.qtyCounted} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, qtyCounted: event.target.value } : item))} />
                      {error && <span role="alert" className="mt-1 block text-red-700">{error}</span>}
                    </label>
                    <button type="button" aria-label={`Hapus ${row.product.name}`} onClick={() => setRows((current) => current.filter((_, i) => i !== index))} className="rounded border border-slate-300 px-2 py-1 text-xs">Hapus</button>
                    <div className="text-xs text-slate-500 sm:col-span-4">Selisih perkiraan: {formatQty(difference)} {row.product.unit_name}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <Field label="Catatan dokumen (opsional)">
          <input className={inputCls} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Contoh: hitung fisik rak A" />
        </Field>

        {!confirming ? (
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" disabled={create.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
            <button type="submit" disabled={create.isPending || rows.length === 0} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Tinjau dan simpan Draft</button>
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>Draft menyimpan snapshot saldo saat ini dan belum mengubah stok. Draft tidak dapat diedit; bila salah, batalkan dan buat dokumen baru.</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={create.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2">Kembali</button>
              <button type="button" disabled={create.isPending} onClick={submit} className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">{create.isPending ? 'Menyimpan…' : 'Simpan Draft'}</button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

type DetailAction = 'request' | 'cancel' | 'approve' | 'reject';

function AdjustmentDetailDialog({
  adjustmentId,
  canRequest,
  canApprove,
  username,
  onClose,
  onChanged,
}: {
  adjustmentId: number;
  canRequest: boolean;
  canApprove: boolean;
  username: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [action, setAction] = useState<DetailAction | null>(null);
  const [note, setNote] = useState('');
  const [approverUsername, setApproverUsername] = useState(username);
  const [approverPassword, setApproverPassword] = useState('');
  const detail = useQuery({
    queryKey: ['inventory', 'adjustment', adjustmentId],
    queryFn: () => inventoryApi.adjustment(adjustmentId),
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['inventory', 'adjustments'] }),
      qc.invalidateQueries({ queryKey: ['inventory', 'adjustment', adjustmentId] }),
      qc.invalidateQueries({ queryKey: ['inventory'] }),
      qc.invalidateQueries({ queryKey: ['products'] }),
    ]);
    setAction(null);
    setNote('');
    setApproverPassword('');
    onChanged();
  };
  const request = useMutation({ mutationFn: () => inventoryApi.requestAdjustment(adjustmentId), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => inventoryApi.cancelAdjustment(adjustmentId, note.trim() || undefined), onSuccess: refresh });
  const approve = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => inventoryApi.approveAdjustment(adjustmentId, {
      decision,
      note: note.trim() || undefined,
      ...(decision === 'approve' && needsReauth ? {
        approver_username: approverUsername.trim(),
        approver_password: approverPassword,
      } : {}),
    }),
    onSuccess: refresh,
  });
  const saving = request.isPending || cancel.isPending || approve.isPending;
  const adjustment = detail.data;
  const needsReauth = Boolean(adjustment && ['loss', 'expired'].includes(adjustment.reason));

  return (
    <Modal title={adjustment ? `Adjustment ${adjustment.doc_number}` : 'Detail adjustment'} onClose={() => !saving && onClose()}>
      {detail.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat dokumen…</p> : detail.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={detail.error} /></div>
      ) : adjustment ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={request.error ?? cancel.error ?? approve.error} />
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Nomor dokumen" value={adjustment.doc_number} />
            <Detail label="Status" value={STATUS_LABEL[adjustment.status]} />
            <Detail label="Alasan" value={REASON_LABEL[adjustment.reason]} />
            <Detail label="Pemohon" value={`${adjustment.requested_by_name} · ${formatDateTime(adjustment.created_at)}`} />
            <Detail label="Disetujui oleh" value={adjustment.approved_by_name ? `${adjustment.approved_by_name} · ${formatDateTime(adjustment.approved_at)}` : '—'} />
            {adjustment.reauth_at && <Detail label="Autentikasi ulang" value={formatDateTime(adjustment.reauth_at)} />}
          </div>
          {adjustment.note && <p className="rounded-md bg-slate-50 p-3 text-sm">{adjustment.note}</p>}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Rincian hitung stok</h3>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-3 py-2">Produk / lokasi / batch</th><th className="px-3 py-2 text-right">Saldo snapshot</th><th className="px-3 py-2 text-right">Hasil hitung</th><th className="px-3 py-2 text-right">Selisih</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {adjustment.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        {item.product_name}<div className="font-mono text-xs text-slate-500">{item.sku}</div>
                        <div className="text-xs text-slate-500">{item.location_name}{item.shelf_position ? ` · ${item.shelf_position}` : ''}{item.batch_code ? ` · Batch ${item.batch_code}` : ''}{item.expiry_date ? ` · Exp ${formatDate(item.expiry_date)}` : ''}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQty(item.qty_before)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQty(item.qty_counted)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQty(item.qty_diff)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {action && (
            <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm">
                {action === 'request' ? 'Ajukan Draft ke Admin untuk persetujuan. Snapshot saldo akan diperiksa kembali saat posting.' :
                  action === 'cancel' ? 'Batalkan dokumen ini? Draft atau dokumen yang diajukan dapat dibatalkan.' :
                    action === 'approve' ? 'Setujui dan posting adjustment sekarang? Saldo stok akan berubah secara atomik.' :
                      'Tolak pengajuan ini? Saldo stok tidak akan berubah.'}
              </p>
              {(action === 'cancel' || action === 'reject') && (
                <Field label={action === 'reject' ? 'Alasan penolakan' : 'Alasan pembatalan'}>
                  <textarea className={`${inputCls} min-h-20`} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} required={action === 'reject'} />
                </Field>
              )}
              {action === 'approve' && needsReauth && (
                <>
                  <p className="text-xs text-amber-900">Persetujuan untuk kehilangan/kedaluwarsa memerlukan autentikasi ulang akun approver.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Username approver">
                      <input className={inputCls} autoComplete="username" value={approverUsername} onChange={(event) => setApproverUsername(event.target.value)} required />
                    </Field>
                    <Field label="Password approver">
                      <input className={inputCls} type="password" autoComplete="current-password" value={approverPassword} onChange={(event) => setApproverPassword(event.target.value)} required />
                    </Field>
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" disabled={saving} onClick={() => setAction(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Kembali</button>
                <button
                  type="button"
                  disabled={saving || (action === 'reject' && !note.trim()) || (action === 'approve' && needsReauth && (!approverUsername.trim() || !approverPassword))}
                  onClick={() => {
                    if (action === 'request') request.mutate();
                    else if (action === 'cancel') cancel.mutate();
                    else approve.mutate(action);
                  }}
                  className={`rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60 ${action === 'reject' || action === 'cancel' ? 'bg-red-700' : 'bg-slate-900'}`}
                >
                  {saving ? 'Memproses…' : action === 'request' ? 'Ajukan' : action === 'cancel' ? 'Batalkan' : action === 'reject' ? 'Tolak pengajuan' : 'Setujui & posting'}
                </button>
              </div>
            </section>
          )}

          {!action && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              {canRequest && adjustment.status === 'draft' && <button type="button" onClick={() => setAction('request')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Ajukan</button>}
              {canRequest && ['draft', 'requested'].includes(adjustment.status) && <button type="button" onClick={() => { setNote(''); setAction('cancel'); }} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Batalkan</button>}
              {canApprove && adjustment.status === 'requested' && <>
                <button type="button" onClick={() => { setNote(''); setAction('reject'); }} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Tolak</button>
                <button type="button" onClick={() => { setApproverPassword(''); setAction('approve'); }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Setujui &amp; posting</button>
              </>}
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
