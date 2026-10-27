import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
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
  submitted: 'Menunggu Finance',
  finance_checked: 'Menunggu Owner',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  returned: 'Dikembalikan',
  converted: 'Selesai dipesan',
  cancelled: 'Dibatalkan',
};

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
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [createPoForPr, setCreatePoForPr] = useState<PurchaseRequisition | null>(null);
  const [managePoId, setManagePoId] = useState<number | null>(null);

  const list = useQuery({
    queryKey: ['purchase-requisitions', canViewAll ? 'all' : 'mine', queryText, status, page],
    queryFn: () => purchaseRequisitionApi.list({
      q: queryText || undefined,
      status: status || undefined,
      mine: !canViewAll,
      page,
      per_page: 25,
    }),
  });

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setQueryText(queryInput.trim());
    setPage(1);
  }

  return (
    <div className="space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Permintaan Pembelian</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            {canViewAll
              ? 'Tinjau PR toko dan pantau status pemeriksaan Finance, persetujuan Owner, hingga PO.'
              : 'Buat PR untuk kebutuhan barang. Setelah diajukan, PR diperiksa Finance lalu menunggu persetujuan Owner.'}
          </p>
        </div>
        {canCreatePr && <button type="button" onClick={() => setCreateOpen(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Buat PR</button>}
      </header>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <form onSubmit={applySearch} className="flex flex-wrap items-end gap-3">
          <Field label="Nomor PR">
            <input className={`${inputCls} w-56`} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="PR-…" />
          </Field>
          <Field label="Status">
            <select className={`${inputCls} w-56`} value={status} onChange={(event) => { setStatus(event.target.value as PurchaseRequisitionStatus | ''); setPage(1); }}>
              <option value="">Semua status</option>
              {FILTER_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
            </select>
          </Field>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Terapkan</button>
        </form>

        <ErrorNotice error={list.error} />
        {list.isLoading ? <p className="text-sm text-slate-500">Memuat permintaan…</p> : null}
        {list.data?.data.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada PR yang cocok.</p>}
        {list.data && list.data.data.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nomor PR</th>
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
                      <td className="px-3 py-2 font-mono font-medium">{pr.doc_number}</td>
                      {canViewAll && <td className="px-3 py-2">{pr.requester_name}</td>}
                      <td className="max-w-xs truncate px-3 py-2">{pr.reason || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pr.items_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(pr.est_total)}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[pr.status]}</td>
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

      {createOpen && <PurchaseRequisitionForm onClose={() => setCreateOpen(false)} onSaved={(pr) => { setCreateOpen(false); setSelectedId(pr.id); }} />}
      {editId !== null && <PurchaseRequisitionForm prId={editId} onClose={() => setEditId(null)} onSaved={(pr) => { setEditId(null); setSelectedId(pr.id); }} />}
      {selectedId !== null && <PurchaseRequisitionDetailDialog
        prId={selectedId}
        canManagePr={canCreatePr}
        canCancel={can('purchase_requisition.create')}
        canFinanceCheck={can('purchase_requisition.finance_check')}
        canApprove={can('purchase_requisition.approve')}
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
  if (detail.isLoading) return <Modal title="Ubah PR" onClose={onClose}><p className="p-5 text-sm text-slate-500">Memuat PR…</p></Modal>;
  if (detailError) return <Modal title="Ubah PR" onClose={onClose}><div className="space-y-3 p-5"><ErrorNotice error={detailError} /></div></Modal>;

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
                  <Field label="Jumlah" error={rowErrors.qty}>
                    <input className={inputCls} inputMode="decimal" value={row.qty} onChange={(event) => updateRow(row.key, { qty: event.target.value })} />
                  </Field>
                  <Field label="Estimasi harga / unit (opsional)" error={rowErrors.est_price}>
                    <input className={inputCls} inputMode="decimal" value={row.estPrice} onChange={(event) => updateRow(row.key, { estPrice: event.target.value })} />
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
            <p>{prId === undefined ? 'Simpan permintaan sebagai Draft?' : 'Simpan perubahan Draft PR?' } PR belum diajukan ke Finance.</p>
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
  canApprove,
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
  canApprove: boolean;
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
  const [confirmAction, setConfirmAction] = useState<'submit' | 'cancel' | 'finance-pass' | 'finance-return' | 'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [approverUsername, setApproverUsername] = useState('');
  const [approverPassword, setApproverPassword] = useState('');
  const detail = useQuery({ queryKey: ['purchase-requisition', prId], queryFn: () => purchaseRequisitionApi.get(prId) });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['purchase-requisitions'] }),
      qc.invalidateQueries({ queryKey: ['purchase-requisition', prId] }),
    ]);
    setConfirmAction(null);
    setNote('');
    setApproverUsername('');
    setApproverPassword('');
    onSaved();
    if (closeOnSuccess) onClose();
  };
  const submit = useMutation({ mutationFn: () => purchaseRequisitionApi.submit(prId), onSuccess: refresh, onError: () => setConfirmAction(null) });
  const cancel = useMutation({ mutationFn: () => purchaseRequisitionApi.cancel(prId), onSuccess: refresh, onError: () => setConfirmAction(null) });
  const financeCheck = useMutation({
    mutationFn: (decision: 'pass' | 'return') => purchaseRequisitionApi.financeCheck(prId, { decision, note: note.trim() || undefined }),
    onSuccess: refresh,
  });
  const approve = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => purchaseRequisitionApi.approve(prId, {
      decision,
      note: note.trim() || undefined,
      approver_username: approverUsername.trim(),
      approver_password: approverPassword,
    }),
    onSuccess: refresh,
  });
  const saving = submit.isPending || cancel.isPending || financeCheck.isPending || approve.isPending;
  const pr = detail.data;
  const active = Boolean(pr && (pr.status === 'draft' || pr.status === 'returned'));
  const cancellable = Boolean(pr && ['draft', 'returned', 'submitted'].includes(pr.status));

  return (
    <Modal title="Detail permintaan pembelian" onClose={() => !saving && onClose()}>
      {detail.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat PR…</p> : detail.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={detail.error} /></div>
      ) : pr ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={submit.error ?? cancel.error ?? financeCheck.error ?? approve.error} />
          <PurchaseStageTracker current={trackerStageForPr(pr)} archivedNote={`Status: ${STATUS_LABEL[pr.status]}. PR ini tidak lagi berjalan di alur pembelian.`} />
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Nomor PR" value={pr.doc_number} />
            <Detail label="Status" value={STATUS_LABEL[pr.status]} />
            <Detail label="Pemohon" value={pr.requester_name} />
            <Detail label="Dibuat" value={formatDateTime(pr.created_at)} />
            <Detail label="Diajukan" value={formatDateTime(pr.submitted_at)} />
            <Detail label="Estimasi total" value={formatRupiah(pr.est_total)} />
          </div>
          {pr.reason && <p className="rounded-md bg-slate-50 p-3 text-sm">{pr.reason}</p>}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Barang yang diminta</h3>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Produk</th><th className="px-3 py-2 text-right">Diminta</th><th className="px-3 py-2 text-right">Dipesan</th><th className="px-3 py-2 text-right">Sisa</th><th className="px-3 py-2 text-right">Estimasi/unit</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {pr.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">{item.name}<div className="font-mono text-xs text-slate-500">{item.sku}{item.note ? ` · ${item.note}` : ''}</div></td>
                      <td className="px-3 py-2 text-right">{formatQty(item.qty)} {item.unit_name}</td>
                      <td className="px-3 py-2 text-right">{formatQty(item.qty_ordered)}</td>
                      <td className="px-3 py-2 text-right">{formatQty(item.qty_remaining)}</td>
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

          {confirmAction === 'finance-pass' || confirmAction === 'finance-return' || confirmAction === 'approve' || confirmAction === 'reject' ? (
            <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm">
                {confirmAction === 'finance-pass' ? 'Teruskan PR ke tahap persetujuan Owner?' :
                  confirmAction === 'finance-return' ? 'Kembalikan PR kepada pemohon untuk diperbaiki.' :
                    confirmAction === 'approve' ? 'Setujui PR dan izinkan Purchasing membuat PO?' :
                      'Tolak PR ini?'}
              </p>
              {(confirmAction === 'finance-return' || confirmAction === 'reject') && (
                <Field label="Catatan keputusan">
                  <textarea className={`${inputCls} min-h-20`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} required />
                </Field>
              )}
              {(confirmAction === 'approve' || confirmAction === 'reject') && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Username pemberi persetujuan">
                    <input className={inputCls} autoComplete="username" value={approverUsername} onChange={(event) => setApproverUsername(event.target.value)} required />
                  </Field>
                  <Field label="Password pemberi persetujuan">
                    <input className={inputCls} type="password" autoComplete="current-password" value={approverPassword} onChange={(event) => setApproverPassword(event.target.value)} required />
                  </Field>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" disabled={saving} onClick={() => setConfirmAction(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Kembali</button>
                <button
                  type="button"
                  disabled={saving || ((confirmAction === 'finance-return' || confirmAction === 'reject') && !note.trim()) || ((confirmAction === 'approve' || confirmAction === 'reject') && (!approverUsername.trim() || !approverPassword))}
                  onClick={() => {
                    if (confirmAction === 'finance-pass') financeCheck.mutate('pass');
                    else if (confirmAction === 'finance-return') financeCheck.mutate('return');
                    else if (confirmAction === 'approve') approve.mutate('approve');
                    else approve.mutate('reject');
                  }}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {saving ? 'Memproses…' : 'Konfirmasi keputusan'}
                </button>
              </div>
            </section>
          ) : null}

          {confirmAction === 'submit' && (
            <ConfirmBox
              text="PR akan diajukan ke Finance dan tidak dapat diubah sampai dikembalikan."
              pending={submit.isPending}
              onBack={() => setConfirmAction(null)}
              onConfirm={() => submit.mutate()}
              confirmLabel="Konfirmasi ajukan"
            />
          )}
          {confirmAction === 'cancel' && (
            <ConfirmBox
              text="Batalkan PR ini? Tindakan ini tidak dapat dibatalkan."
              pending={cancel.isPending}
              onBack={() => setConfirmAction(null)}
              onConfirm={() => cancel.mutate()}
              confirmLabel="Konfirmasi pembatalan"
              danger
            />
          )}
          {!confirmAction && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              {onPrint && isPrPrintable(pr.status) && <button type="button" onClick={() => onPrint(pr)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cetak PR</button>}
              {canManagePr && active && <button type="button" onClick={onEdit} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Ubah Draft</button>}
              {canManagePr && active && <button type="button" onClick={() => setConfirmAction('submit')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Ajukan ke Finance</button>}
              {canCancel && cancellable && <button type="button" onClick={() => setConfirmAction('cancel')} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Batalkan PR</button>}
              {canFinanceCheck && pr.status === 'submitted' && <>
                <button type="button" onClick={() => { setNote(''); setConfirmAction('finance-return'); }} className="rounded-md border border-amber-400 px-3 py-2 text-sm text-amber-800">Kembalikan</button>
                <button type="button" onClick={() => setConfirmAction('finance-pass')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Lolos Finance</button>
              </>}
              {canApprove && pr.status === 'finance_checked' && <>
                <button type="button" onClick={() => { setNote(''); setApproverUsername(''); setApproverPassword(''); setConfirmAction('reject'); }} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Tolak</button>
                <button type="button" onClick={() => { setNote(''); setApproverUsername(''); setApproverPassword(''); setConfirmAction('approve'); }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Setujui sebagai Owner</button>
              </>}
              {canCreatePo && pr.status === 'approved' && pr.items.some((item) => Number(item.qty_remaining) > 0) && (
                <button type="button" onClick={() => onCreatePo(pr)} className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white">Buat PO</button>
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
