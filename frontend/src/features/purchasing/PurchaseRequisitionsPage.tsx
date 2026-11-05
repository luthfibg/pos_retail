import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { ProductPicker } from '@/features/products/ProductPicker';
import { useAuth } from '@/features/auth/AuthProvider';
import { purchaseRequisitionApi } from '@/lib/api/endpoints';
import type { PurchaseRequisition, PurchaseRequisitionStatus } from '@/lib/api/types';
import { formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { PurchaseOrderCreateDialog, PurchaseOrderManageDialog } from './PurchaseOrderDialogs';
import { PurchaseStageTracker } from './PurchaseStageTracker';
import { isPrPrintable, trackerStageForPr } from './purchaseFlow';
import {
  buildPurchaseRequisitionInput,
  mapPurchaseRequisitionServerErrors,
  newPurchaseRequisitionRow,
  validatePurchaseRequisition,
  type PurchaseRequisitionErrors,
  type PurchaseRequisitionRow,
} from './purchaseRequisitionForm';

export const STATUS_LABEL: Record<PurchaseRequisitionStatus, string> = {
  draft: 'Draft',
  submitted: 'Belum Diperiksa',
  finance_checked: 'Siap dibuat PO (legacy)',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  returned: 'Dikembalikan',
  converted: 'Selesai dipesan',
  cancelled: 'Dibatalkan',
};

const STATUS_TEXT_COLOR: Record<PurchaseRequisitionStatus, string> = {
  draft: 'text-slate-600',
  submitted: 'text-orange-700',
  finance_checked: 'text-blue-700',
  approved: 'text-emerald-700',
  rejected: 'text-red-700',
  returned: 'text-amber-700',
  converted: 'text-green-700',
  cancelled: 'text-slate-500',
};

export function PurchaseRequisitionStatusText({ status }: { status: PurchaseRequisitionStatus }) {
  return <span className={`font-medium ${STATUS_TEXT_COLOR[status]}`}>{STATUS_LABEL[status]}</span>;
}

const FILTER_STATUSES: PurchaseRequisitionStatus[] = [
  'draft', 'submitted', 'finance_checked', 'returned', 'approved', 'rejected', 'converted', 'cancelled',
];

export function PurchaseRequisitionsPage() {
  const { can } = useAuth();
  const canViewAll = can('purchase_requisition.finance_check')
    || can('purchase_requisition.approve')
    || can('purchase_order.create')
    || can('purchase_order.send');
  const canCreatePr = can('purchase_requisition.create');
  const canManagePo = can('purchase_order.create')
    || can('purchase_order.send')
    || can('purchase_requisition.approve');
  const [queryInput, setQueryInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState<PurchaseRequisitionStatus | ''>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [createPoForPr, setCreatePoForPr] = useState<PurchaseRequisition | null>(null);
  const [managePoId, setManagePoId] = useState<number | null>(null);

  const list = useQuery({
    queryKey: ['purchase-requisitions', canViewAll ? 'all' : 'visible', queryText, status, page],
    queryFn: () => purchaseRequisitionApi.list({
      q: queryText || undefined,
      status: status || undefined,
      page,
      per_page: 25,
    }),
    refetchInterval: canCreatePr ? 30_000 : false,
  });

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setQueryText(queryInput.trim());
    setPage(1);
  }

  return (
    <div className="space-y-5 p-6">
      <header className="space-y-1">
        <div>
          <h1 className="text-xl font-semibold">Permintaan Pembelian</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            {canViewAll
              ? 'Periksa Permintaan toko, siapkan PO dengan satu otorisasi Owner, lalu pantau pengiriman hingga penerimaan.'
              : 'Ajukan Permintaan otomatis dari pemantauan stok ke Finance.'}
          </p>
        </div>
      </header>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <form onSubmit={applySearch} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_minmax(14rem,1fr)_auto] lg:items-end">
          <Field label="Nomor Permintaan">
            <input className={inputCls} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Masukkan nomor…" />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={status} onChange={(event) => { setStatus(event.target.value as PurchaseRequisitionStatus | ''); setPage(1); }}>
              <option value="">Semua status</option>
              {FILTER_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
            </select>
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Terapkan</button>
            {canCreatePr && (
              <button
                type="button"
                onClick={() => void list.refetch()}
                disabled={list.isFetching}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
              >
                {list.isFetching ? 'Memuat…' : 'Perbarui daftar'}
              </button>
            )}
          </div>
        </form>

        <ErrorNotice error={list.error} />
        {list.isLoading ? <p className="text-sm text-slate-500">Memuat permintaan…</p> : null}
        {list.data?.data.length === 0 && (
          <div className="space-y-1 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <p>Belum ada Permintaan yang cocok.</p>
            {canCreatePr && (
              <p>
                Permintaan otomatis dibuat untuk produk berstatus Aktif saat stok jual ≤ ambang pemantauan dan jumlah isi ulang produk lebih dari 0.
                Produk yang sudah tercakup Permintaan atau PO aktif tidak diminta ulang. Daftar diperbarui otomatis setiap 30 detik.
              </p>
            )}
          </div>
        )}
        {list.data && list.data.data.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nomor Permintaan</th>
                    {canViewAll && <th className="px-3 py-2">Pemohon</th>}
                    <th className="px-3 py-2">Alasan</th>
                    <th className="px-3 py-2 text-right">Barang</th>
                    <th className="px-3 py-2 text-right">Estimasi</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Diajukan</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.data.map((pr) => (
                    <tr key={pr.id}>
                      <td className="px-3 py-2 font-mono font-medium">
                        {pr.doc_number}
                        {pr.is_auto_generated && <span className="mt-1 block font-sans text-xs font-medium text-blue-700">Otomatis · pemantauan stok</span>}
                      </td>
                      {canViewAll && <td className="px-3 py-2">{pr.is_auto_generated ? 'Sistem pemantauan stok' : pr.requester_name}</td>}
                      <td className="max-w-xs truncate px-3 py-2">{pr.reason || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pr.items_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(pr.est_total)}</td>
                      <td className="px-3 py-2"><PurchaseRequisitionStatusText status={pr.status} /></td>
                      <td className="px-3 py-2">{formatDateTime(pr.submitted_at)}</td>
                      <td className="px-3 py-2"><button type="button" onClick={() => setSelectedId(pr.id)} className="font-medium text-blue-700 hover:underline">Detail</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.current_page} lastPage={list.data.last_page} from={list.data.from} to={list.data.to} total={list.data.total} onPage={setPage} />
          </>
        )}
      </section>

      {editId !== null && <PurchaseRequisitionForm prId={editId} onClose={() => setEditId(null)} onSaved={(pr) => { setEditId(null); setSelectedId(pr.id); }} />}
      {selectedId !== null && <PurchaseRequisitionDetailDialog
        prId={selectedId}
        canManagePr={canCreatePr}
        canCancel={can('purchase_requisition.create')}
        canFinanceCheck={can('purchase_requisition.finance_check')}
        canCreatePo={can('purchase_order.create')}
        canManagePo={canManagePo}
        onClose={() => setSelectedId(null)}
        onEdit={() => { setEditId(selectedId); setSelectedId(null); }}
        onSaved={() => { void list.refetch(); }}
        onCreatePo={(pr) => { setSelectedId(null); setCreatePoForPr(pr); }}
        onManagePo={(poId) => { setSelectedId(null); setManagePoId(poId); }}
      />}
      {createPoForPr && <PurchaseOrderCreateDialog
        pr={createPoForPr}
        onClose={() => setCreatePoForPr(null)}
        onCreated={(po) => { setCreatePoForPr(null); setManagePoId(po.id); void list.refetch(); }}
      />}
      {managePoId !== null && <PurchaseOrderManageDialog
        poId={managePoId}
        onClose={() => setManagePoId(null)}
        onChanged={() => { void list.refetch(); }}
      />}
    </div>
  );
}

export function PurchaseRequisitionForm({
  prId,
  onClose,
  onSaved,
}: {
  prId?: number;
  onClose: () => void;
  onSaved: (pr: PurchaseRequisition) => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<PurchaseRequisitionRow[]>(() => Array.from({ length: 3 }, newPurchaseRequisitionRow));
  const [errors, setErrors] = useState<PurchaseRequisitionErrors>({ rows: {} });
  const [indexMap, setIndexMap] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const initialized = useRef(false);
  const detail = useQuery({
    queryKey: ['purchase-requisition', prId],
    queryFn: () => purchaseRequisitionApi.get(prId!),
    enabled: prId !== undefined,
  });

  useEffect(() => {
    if (!detail.data || initialized.current) return;
    setReason(detail.data.reason ?? '');
    setRows(detail.data.items.map((item) => ({
      ...newPurchaseRequisitionRow(),
      product: { id: item.product_id, sku: item.sku, name: item.name, unit_name: item.unit_name, track_expiry: false },
      qty: item.qty,
      estPrice: item.est_price ?? '',
      note: item.note ?? '',
    })));
    initialized.current = true;
  }, [detail.data]);

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof buildPurchaseRequisitionInput>) =>
      prId === undefined
        ? purchaseRequisitionApi.create(input.payload)
        : purchaseRequisitionApi.update(prId, input.payload),
    onSuccess: async (pr) => {
      await qc.invalidateQueries({ queryKey: ['purchase-requisitions'] });
      await qc.invalidateQueries({ queryKey: ['purchase-requisition', pr.id] });
      onSaved(pr);
    },
    onError: (error) => {
      setConfirming(false);
      if (error instanceof ApiError && error.status === 422) setErrors(mapPurchaseRequisitionServerErrors(error.errors, indexMap));
    },
  });

  function review(event: FormEvent) {
    event.preventDefault();
    save.reset();
    const found = validatePurchaseRequisition(rows, reason);
    setErrors(found);
    if (!found.general && Object.keys(found.rows).length === 0) {
      const built = buildPurchaseRequisitionInput(rows, reason);
      setIndexMap(built.indexMap);
      setConfirming(true);
    }
  }

  function updateRow(key: number, patch: Partial<PurchaseRequisitionRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
    setErrors((current) => {
      const index = rows.findIndex((row) => row.key === key);
      const next = { ...current, rows: { ...current.rows } };
      delete next.rows[index];
      return next;
    });
    save.reset();
  }

  const detailError = detail.error;
  if (detail.isLoading) return <Modal title="Ubah Permintaan" onClose={onClose}><p className="p-5 text-sm text-slate-500">Memuat Permintaan…</p></Modal>;
  if (detailError) return <Modal title="Ubah Permintaan" onClose={onClose}><div className="space-y-3 p-5"><ErrorNotice error={detailError} /></div></Modal>;

  return (
    <Modal title={prId === undefined ? 'Buat permintaan pembelian' : 'Ubah permintaan pembelian'} onClose={() => !save.isPending && onClose()}>
      <form onSubmit={review} noValidate className="space-y-4 p-5">
        {errors.general && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errors.general}</div>}
        <Field label="Alasan / kebutuhan" hint="Opsional, maksimal 500 karakter.">
          <textarea className={inputCls} rows={2} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setErrors((current) => ({ ...current, general: undefined })); save.reset(); }} />
        </Field>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Daftar barang</h3>
            <button type="button" disabled={rows.length >= 100} onClick={() => setRows((current) => [...current, newPurchaseRequisitionRow()])} className="text-sm font-medium text-blue-700 disabled:text-slate-400">Tambah baris</button>
          </div>
          {rows.map((row, index) => {
            const rowErrors = errors.rows[index] ?? {};
            return (
              <div key={row.key} className="space-y-3 rounded-md border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <Field label={`Produk ${index + 1}`} error={rowErrors.product_id}>
                      <ProductPicker value={row.product} onChange={(product) => updateRow(row.key, { product })} placeholder="Cari nama, SKU, atau barcode" />
                    </Field>
                  </div>
                  <button type="button" disabled={rows.length <= 1} onClick={() => { setRows((current) => current.filter((item) => item.key !== row.key)); setErrors((current) => ({ ...current, rows: {} })); }} aria-label={`Hapus baris ${index + 1}`} className="mt-6 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">Hapus</button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Jumlah" error={rowErrors.qty} hint="Contoh: 20 atau 1,5. Maksimal 3 angka pecahan.">
                    <LocalDecimalInput className={inputCls} kind="quantity" value={row.qty} onChange={(value) => updateRow(row.key, { qty: value })} />
                  </Field>
                  <Field label="Estimasi harga / unit (opsional)" error={rowErrors.est_price} hint="Contoh: 6.000 atau 6.000,50.">
                    <LocalDecimalInput className={inputCls} kind="price" value={row.estPrice} onChange={(value) => updateRow(row.key, { estPrice: value })} />
                  </Field>
                  <Field label="Catatan baris" error={rowErrors.note}>
                    <input className={inputCls} maxLength={255} value={row.note} onChange={(event) => updateRow(row.key, { note: event.target.value })} />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
        <ErrorNotice error={save.error instanceof ApiError && save.error.status === 422 ? null : save.error} />
        {confirming ? (
          <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>{prId === undefined ? 'Simpan permintaan sebagai Draft?' : 'Simpan perubahan Draft Permintaan?' } Permintaan belum diajukan ke Finance.</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={save.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2">Periksa lagi</button>
              <button type="button" disabled={save.isPending} onClick={() => save.mutate(buildPurchaseRequisitionInput(rows, reason))} className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">{save.isPending ? 'Menyimpan…' : 'Simpan Draft'}</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" disabled={save.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
            <button type="submit" disabled={save.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Periksa Draft</button>
          </div>
        )}
      </form>
    </Modal>
  );
}

export function PurchaseRequisitionDetailDialog({
  prId,
  canManagePr,
  canCancel,
  canFinanceCheck,
  canCreatePo,
  canManagePo,
  onClose,
  onEdit,
  onSaved,
  onCreatePo,
  onManagePo,
  closeOnSuccess = false,
  onPrint,
}: {
  prId: number;
  canManagePr: boolean;
  canCancel: boolean;
  canFinanceCheck: boolean;
  canCreatePo: boolean;
  canManagePo: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSaved: () => void;
  onCreatePo: (pr: PurchaseRequisition) => void;
  onManagePo: (poId: number) => void;
  /** Tutup dialog setelah aksi yang mengubah status berhasil (dipakai papan tahap). */
  closeOnSuccess?: boolean;
  onPrint?: (pr: PurchaseRequisition) => void;
}) {
  const qc = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<'cancel' | 'finance-return' | null>(null);
  const [note, setNote] = useState('');
  const detail = useQuery({ queryKey: ['purchase-requisition', prId], queryFn: () => purchaseRequisitionApi.get(prId) });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['purchase-requisitions'] }),
      qc.invalidateQueries({ queryKey: ['purchase-requisition', prId] }),
    ]);
    setConfirmAction(null);
    setNote('');
    onSaved();
    if (closeOnSuccess) onClose();
  };
  const submit = useMutation({ mutationFn: () => purchaseRequisitionApi.submit(prId), onSuccess: refresh, onError: () => setConfirmAction(null) });
  const cancel = useMutation({ mutationFn: () => purchaseRequisitionApi.cancel(prId), onSuccess: refresh, onError: () => setConfirmAction(null) });
  const financeCheck = useMutation({
    mutationFn: (decision: 'pass' | 'return') => purchaseRequisitionApi.financeCheck(prId, { decision, note: note.trim() || undefined }),
    onSuccess: refresh,
  });
  const saving = submit.isPending || cancel.isPending || financeCheck.isPending;
  const pr = detail.data;
  const active = Boolean(pr && (pr.status === 'draft' || pr.status === 'returned'));
  const cancellable = Boolean(pr && ['draft', 'returned', 'submitted'].includes(pr.status));

  return (
    <Modal title="Detail permintaan pembelian" onClose={() => !saving && onClose()}>
      {detail.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat Permintaan…</p> : detail.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={detail.error} /></div>
      ) : pr ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={submit.error ?? cancel.error ?? financeCheck.error} />
          {!pr.is_auto_generated && <PurchaseStageTracker current={trackerStageForPr(pr)} archivedNote={`Status: ${STATUS_LABEL[pr.status]}. Permintaan ini tidak lagi berjalan di alur pembelian.`} />}
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Nomor Permintaan" value={pr.doc_number} />
            <div>
              <div className="text-xs text-slate-500">Status</div>
              <div><PurchaseRequisitionStatusText status={pr.status} /></div>
            </div>
            {!pr.is_auto_generated && <Detail label="Pemohon" value={pr.requester_name} />}
            <Detail label="Dibuat" value={formatDateTime(pr.created_at)} />
            <Detail label="Diajukan" value={formatDateTime(pr.submitted_at)} />
            <Detail label="Total Permintaan" value={formatRupiah(pr.est_total)} />
          </div>
          {pr.reason && !pr.is_auto_generated && <p className="rounded-md bg-slate-50 p-3 text-sm">{pr.reason}</p>}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Barang yang diminta</h3>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Produk</th><th className="px-3 py-2 text-right">Jumlah Barang</th><th className="px-3 py-2 text-right">Harga satuan</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {pr.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">{item.name}<div className="font-mono text-xs text-slate-500">{item.sku}{item.note && !pr.is_auto_generated ? ` · ${item.note}` : ''}</div></td>
                      <td className="px-3 py-2 text-right">{formatQty(item.qty)} {item.unit_name}</td>
                      <td className="px-3 py-2 text-right">{formatRupiah(item.est_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {pr.approvals.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Riwayat pemeriksaan</h3>
              <div className="space-y-2">
                {pr.approvals.map((approval, index) => (
                  <div key={`${approval.step}-${index}`} className="rounded-md border border-slate-200 p-3 text-sm">
                    <div className="font-medium">{approval.step === 'finance_check' ? 'Pemeriksaan Finance' : 'Persetujuan Owner'} · {approval.decision === 'approved' ? 'Disetujui' : approval.decision === 'returned' ? 'Dikembalikan' : 'Ditolak'}</div>
                    <div className="text-xs text-slate-500">{approval.decided_by_name} · {formatDateTime(approval.decided_at)}{approval.is_self_approval ? ' · Disetujui sendiri' : ''}</div>
                    {approval.note && <p className="mt-1">{approval.note}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {pr.purchase_orders.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Purchase Order</h3>
              <div className="space-y-2">
                {pr.purchase_orders.map((po) => (
                  <div key={po.id} className="flex justify-between rounded-md bg-slate-50 p-3 text-sm">
                    <span className="font-mono">{po.doc_number} · {po.status.replaceAll('_', ' ')}</span>
                    <span className="flex items-center gap-3">{formatRupiah(po.total)}{canManagePo && <button type="button" onClick={() => onManagePo(po.id)} className="font-medium text-blue-700 underline">Kelola</button>}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {confirmAction === 'finance-return' ? (
            <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm">Kembalikan Permintaan kepada pemohon untuk diperbaiki.</p>
              <Field label="Catatan keputusan">
                <textarea className={`${inputCls} min-h-20`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} required />
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" disabled={saving} onClick={() => setConfirmAction(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Kembali</button>
                <button
                  type="button"
                  disabled={saving || !note.trim()}
                  onClick={() => financeCheck.mutate('return')}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {saving ? 'Mengembalikan…' : 'Kembalikan Permintaan'}
                </button>
              </div>
            </section>
          ) : null}

          {confirmAction === 'cancel' && (
            <ConfirmBox
              text="Batalkan Permintaan ini? Tindakan ini tidak dapat dibatalkan."
              pending={cancel.isPending}
              onBack={() => setConfirmAction(null)}
              onConfirm={() => cancel.mutate()}
              confirmLabel="Konfirmasi pembatalan"
              danger
            />
          )}
          {!confirmAction && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              {onPrint && isPrPrintable(pr.status) && <button type="button" onClick={() => onPrint(pr)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cetak Permintaan</button>}
              {canManagePr && active && !pr.is_auto_generated && <button type="button" onClick={onEdit} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Ubah Draft</button>}
              {canManagePr && active && <button type="button" disabled={saving} onClick={() => submit.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{submit.isPending ? 'Mengajukan…' : 'Ajukan ke Finance'}</button>}
              {canCancel && cancellable && !pr.is_auto_generated && <button type="button" onClick={() => setConfirmAction('cancel')} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Batalkan Permintaan</button>}
              {canFinanceCheck && pr.status === 'submitted' && <>
                <button type="button" onClick={() => { setNote(''); setConfirmAction('finance-return'); }} className="rounded-md border border-amber-400 px-3 py-2 text-sm text-amber-800">Kembali</button>
                <button type="button" disabled={saving} onClick={() => financeCheck.mutate('pass')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{financeCheck.isPending ? 'Memproses…' : 'Lanjutkan'}</button>
              </>}
              {canCreatePo && (pr.status === 'approved' || pr.status === 'finance_checked') && (
                <button type="button" onClick={() => onCreatePo(pr)} className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white">Buat Permintaan</button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function ConfirmBox({
  text,
  pending,
  onBack,
  onConfirm,
  confirmLabel,
  danger = false,
}: {
  text: string;
  pending: boolean;
  onBack: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>{text}</p>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={pending} onClick={onBack} className="rounded-md border border-slate-300 px-3 py-2">Kembali</button>
        <button type="button" disabled={pending} onClick={onConfirm} className={`rounded-md px-3 py-2 font-medium text-white disabled:opacity-60 ${danger ? 'bg-red-700' : 'bg-slate-900'}`}>{pending ? 'Memproses…' : confirmLabel}</button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-slate-500">{label}</div><div className="font-medium">{value}</div></div>;
}
