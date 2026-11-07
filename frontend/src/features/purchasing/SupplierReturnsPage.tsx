import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import type { ProductOption } from '@/features/inventory/openingForm';
import {
  inventoryApi,
  productApi,
  supplierReturnApi,
} from '@/lib/api/endpoints';
import type {
  ApprovalAuthMode,
  ProductSupplier,
  SupplierReturn,
  SupplierReturnStatus,
} from '@/lib/api/types';
import { formatDate, formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { availableReturnQty, buildSupplierReturnInput, buildSupplierReturnItems, validateSupplierReturn, type SupplierReturnLine } from './supplierReturnForm';
import { sharedActiveSuppliers } from '@/features/products/productForm';

type InitialReturnProduct = ProductOption & { suppliers: ProductSupplier[] };
type InitialReturnDraft = {
  qty: string;
};

const STATUS_LABEL: Record<SupplierReturnStatus, string> = {
  draft: 'Draft',
  submitted: 'Menunggu keputusan supplier',
  accepted: 'Disetujui supplier',
  rejected: 'Ditolak supplier',
  replacement_received: 'Barang pengganti diterima',
  written_off: 'Sudah write-off',
  cancelled: 'Dibatalkan',
};
function sumQty(left: string | null, right: string | null): string {
  return (Number(left ?? 0) + Number(right ?? 0)).toFixed(3);
}
const RETURN_STATUSES = Object.keys(STATUS_LABEL) as SupplierReturnStatus[];

export function SupplierReturnsPage() {
  const { can } = useAuth();
  const canCreate = can('supplier_return.create');
  const canWriteOff = can('inventory.adjust.approve');
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialProductIds] = useState(() => [...new Set(
    (searchParams.get('products') ?? '')
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  )]);
  const [queryInput, setQueryInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState<SupplierReturnStatus | ''>('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(() => canCreate && searchParams.get('create') === '1'
    && initialProductIds.length > 0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const initialProductQueries = useQueries({
    queries: initialProductIds.map((id) => ({
      queryKey: ['products', 'detail', id],
      queryFn: () => productApi.get(id),
      enabled: createOpen,
    })),
  });
  const initialProducts = initialProductQueries.flatMap((query) => query.data
    ? [{
      id: query.data.id,
      sku: query.data.sku,
      name: query.data.name,
      unit_name: query.data.unit_name,
      track_expiry: query.data.track_expiry,
      suppliers: query.data.suppliers,
    }]
    : []);
  const initialProductSuppliers = sharedActiveSuppliers(initialProducts);
  const initialProductsError = initialProductQueries.find((query) => query.error)?.error;
  const initialProductsLoading = initialProductQueries.some((query) => query.isLoading);
  const initialProductsIncomplete = initialProductIds.length > 0
    && (initialProductsLoading || initialProducts.length !== initialProductIds.length);

  useEffect(() => {
    if ((initialProductIds.length > 0
      && (searchParams.has('create') || searchParams.has('products')))
      || searchParams.has('gr_id')) {
      setSearchParams({}, { replace: true });
    }
  }, [initialProductIds.length, searchParams, setSearchParams]);

  const returns = useQuery({
    queryKey: ['supplier-returns', { queryText, status }],
    queryFn: async () => {
      const filters = { q: queryText || undefined, status: status || undefined, per_page: 100 };
      const firstPage = await supplierReturnApi.list({ ...filters, page: 1 });
      const otherPages = await Promise.all(Array.from(
        { length: firstPage.last_page - 1 },
        (_, index) => supplierReturnApi.list({ ...filters, page: index + 2 }),
      ));

      return [...firstPage.data, ...otherPages.flatMap((result) => result.data)].sort((a, b) => (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id
      ));
    },
  });
  const returnItems = returns.data ?? [];
  const lastPage = Math.max(1, Math.ceil(returnItems.length / 25));
  const pageItems = returnItems.slice((page - 1) * 25, page * 25);

  function search(event: FormEvent) {
    event.preventDefault();
    setQueryText(queryInput.trim());
    setPage(1);
  }

  return (
    <>
      <div className="no-print space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Retur Barang</h1>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setCreateOpen(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Buat Retur Barang
          </button>
        )}
      </header>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <Field label="Nomor dokumen">
            <input className={`${inputCls} w-52`} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="RET-…" />
          </Field>
          <Field label="Status">
            <select className={`${inputCls} w-56`} value={status} onChange={(event) => { setStatus(event.target.value as SupplierReturnStatus | ''); setPage(1); }}>
              <option value="">Semua status</option>
              {RETURN_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
            </select>
          </Field>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Terapkan</button>
        </form>

        <ErrorNotice error={returns.error} />
        {returns.isLoading && <p className="text-sm text-slate-500">Memuat retur supplier…</p>}
        {returns.data && returnItems.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada dokumen yang cocok.</p>}
        {returns.data && returnItems.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nomor retur</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Pemohon</th>
                    <th className="px-3 py-2">Dibuat</th>
                    {canWriteOff && <th className="px-3 py-2 text-right">Nilai rugi</th>}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-mono font-medium">{item.doc_number}</td>
                      <td className="px-3 py-2">{item.supplier_name}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[item.status]}</td>
                      <td className="px-3 py-2">{item.requested_by_name}</td>
                      <td className="px-3 py-2">{formatDateTime(item.created_at)}</td>
                      {canWriteOff && <td className="px-3 py-2 text-right">{item.loss_amount ? formatRupiah(item.loss_amount) : '—'}</td>}
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setSelectedId(item.id)} className="font-medium text-blue-700 hover:underline">Detail</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              lastPage={lastPage}
              from={returnItems.length === 0 ? null : (page - 1) * 25 + 1}
              to={Math.min(page * 25, returnItems.length)}
              total={returnItems.length}
              onPage={setPage}
            />
          </>
        )}
      </section>
      </div>

      {createOpen && (
        <SupplierReturnCreateDialog
          initialProducts={initialProducts}
          initialProductSuppliers={initialProductSuppliers}
          hasInitialSelection={initialProductIds.length > 0}
          initialProductsLoading={initialProductsLoading}
          initialProductsError={initialProductsError}
          initialProductsIncomplete={initialProductsIncomplete}
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            setSelectedId(created.id);
            void returns.refetch();
          }}
        />
      )}
      {selectedId !== null && (
        <SupplierReturnDetailDialog
          returnId={selectedId}
          canCreate={canCreate}
          canWriteOff={canWriteOff}
          onClose={() => setSelectedId(null)}
          onChanged={() => { void returns.refetch(); }}
        />
      )}
    </>
  );
}

function SupplierReturnCreateDialog({
  initialProducts,
  initialProductSuppliers,
  hasInitialSelection,
  initialProductsLoading,
  initialProductsError,
  initialProductsIncomplete,
  onClose,
  onCreated,
}: {
  initialProducts: InitialReturnProduct[];
  initialProductSuppliers: ProductSupplier[];
  hasInitialSelection: boolean;
  initialProductsLoading: boolean;
  initialProductsError: unknown;
  initialProductsIncomplete: boolean;
  onClose: () => void;
  onCreated: (created: SupplierReturn) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [initialDrafts, setInitialDrafts] = useState<Record<number, InitialReturnDraft>>({});
  const [initialSupplierApplied, setInitialSupplierApplied] = useState(false);
  const [mergeReturnId, setMergeReturnId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ general?: string; rows: Record<number, string> }>({ rows: {} });

  const initialStockQueries = useQueries({
    queries: initialProducts.map((initialProduct) => ({
      queryKey: ['inventory', 'product-stock', initialProduct.id],
      queryFn: () => inventoryApi.productStock(initialProduct.id),
    })),
  });
  const outgoingRows: SupplierReturnLine[] = initialProducts.map((selectedProduct, index) => ({
    key: selectedProduct.id,
    product: selectedProduct,
    qty: initialDrafts[selectedProduct.id]?.qty ?? '',
    available: initialStockQueries[index]?.data ? availableReturnQty(initialStockQueries[index]!.data!) : '0.000',
  }));
  const mergeCandidates = useQuery({
    queryKey: ['supplier-returns', 'merge-candidates', supplierId],
    queryFn: async () => {
      const filters = {
        return_type: 'outgoing' as const,
        status: 'draft' as const,
        supplier_id: supplierId!,
        per_page: 100,
      };
      const firstPage = await supplierReturnApi.list({ ...filters, page: 1 });
      const otherPages = await Promise.all(Array.from(
        { length: firstPage.last_page - 1 },
        (_, index) => supplierReturnApi.list({ ...filters, page: index + 2 }),
      ));

      return [...firstPage.data, ...otherPages.flatMap((page) => page.data)];
    },
    enabled: supplierId !== null && hasInitialSelection,
  });
  const validation = validateSupplierReturn(supplierId, outgoingRows, note);
  const outgoingReady = supplierId !== null
    && outgoingRows.length > 0
    && outgoingRows.every((row) => row.qty.trim() !== '')
    && !validation.general
    && Object.keys(validation.rows).length === 0;

  useEffect(() => {
    if (!initialSupplierApplied && !initialProductsLoading) {
      setInitialSupplierApplied(true);
      if (initialProductSuppliers.length === 1) setSupplierId(initialProductSuppliers[0]!.id);
    }
  }, [initialProductSuppliers, initialProductsLoading, initialSupplierApplied]);

  useEffect(() => {
    setMergeReturnId(null);
  }, [supplierId]);

  const create = useMutation({
    mutationFn: () => {
      const selectedSupplier = supplierId;
      if (selectedSupplier === null) throw new Error('Supplier produk belum dipilih.');
      return supplierReturnApi.create(buildSupplierReturnInput(selectedSupplier, outgoingRows, note));
    },
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['supplier-returns'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
      onCreated(created);
    },
  });

  const merge = useMutation({
    mutationFn: () => {
      if (mergeReturnId === null || supplierId === null) throw new Error('Pilih draft retur yang akan digabung.');
      return supplierReturnApi.merge(mergeReturnId, buildSupplierReturnItems(outgoingRows));
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['supplier-returns'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
      onCreated(updated);
    },
  });

  function initialDraft(productId: number): InitialReturnDraft {
    return initialDrafts[productId] ?? { qty: '' };
  }

  function updateInitialDraft(productId: number, patch: Partial<InitialReturnDraft>) {
    setInitialDrafts((current) => ({
      ...current,
      [productId]: { ...initialDraft(productId), ...patch },
    }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setErrors(validation);
    if (outgoingReady) create.mutate();
  }

  const close = () => { if (!create.isPending && !merge.isPending) onClose(); };

  return (
    <Modal title="Buat Retur Barang" onClose={close}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <ErrorNotice error={initialProductsError ?? mergeCandidates.error ?? create.error ?? merge.error} />
        {errors.general && <p role="alert" className="text-sm text-red-700">{errors.general}</p>}
        {initialProductsIncomplete && !initialProductsLoading && !initialProductsError && (
          <p role="alert" className="text-sm text-red-700">Data produk retur tidak lengkap. Kembali ke master produk dan pilih ulang.</p>
        )}
        {!hasInitialSelection && (
          <div className="space-y-3 rounded-md bg-slate-50 p-4 text-sm">
            <p>Pilih barang yang akan diretur melalui checkbox di master Produk.</p>
            <button type="button" onClick={() => { onClose(); navigate('/products'); }} className="rounded-md border border-slate-300 px-3 py-2 font-medium">
              Pilih barang
            </button>
          </div>
        )}
        {initialProducts.length > 0 && initialProductSuppliers.length === 0 && (
          <p role="alert" className="text-sm text-red-700">Produk yang dipilih tidak memiliki supplier aktif yang sama.</p>
        )}

        {hasInitialSelection && (
          <Field label="Supplier" error={errors.general && !supplierId ? errors.general : undefined}>
            <select
              className={inputCls}
              value={supplierId ?? ''}
              onChange={(event) => setSupplierId(event.target.value ? Number(event.target.value) : null)}
              disabled={initialProductSuppliers.length === 0 || initialProductSuppliers.length === 1}
              required
            >
              <option value="">{initialProductsLoading ? 'Memuat supplier produk…' : 'Pilih supplier produk'}</option>
              {initialProductSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>)}
            </select>
          </Field>
        )}

        {hasInitialSelection && (
          <div className="space-y-3">
            {initialProductsLoading && <p className="text-sm text-slate-500">Memuat produk pilihan…</p>}
            {initialProducts.map((initialProduct, index) => {
              const productStock = initialStockQueries[index];
              const draft = initialDraft(initialProduct.id);
              const rowError = draft.qty.trim() ? validation.rows[index] : undefined;

              return (
                <section key={initialProduct.id} className="space-y-3 rounded-md border border-slate-200 p-3">
                  <div>
                    <p className="font-medium">{initialProduct.name}</p>
                    <p className="font-mono text-xs text-slate-500">{initialProduct.sku}</p>
                  </div>
                  <ErrorNotice error={productStock?.error} />
                  {productStock?.isLoading && <p className="text-xs text-slate-500">Memuat saldo stok…</p>}
                  <Field
                    label={`Jumlah barang (tersedia ${formatQty(outgoingRows[index]?.available ?? '0')})`}
                    error={rowError}
                    hint="Gunakan koma untuk pecahan, misalnya 1,5."
                  >
                    <LocalDecimalInput
                      className={`${inputCls} w-36`}
                      kind="quantity"
                      value={draft.qty}
                      onChange={(value) => updateInitialDraft(initialProduct.id, { qty: value })}
                      placeholder="Contoh: 20"
                      disabled={!productStock?.data || productStock.isLoading}
                    />
                  </Field>
                </section>
              );
            })}
            {mergeCandidates.data && mergeCandidates.data.length > 0 && (
              <Field label="Gabungkan ke draft retur yang sudah ada">
                <select
                  className={inputCls}
                  value={mergeReturnId ?? ''}
                  onChange={(event) => setMergeReturnId(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">Pilih draft retur</option>
                  {mergeCandidates.data.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.doc_number} · {formatDateTime(candidate.created_at)}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        )}
        {hasInitialSelection && (
          <>
            <Field label="Catatan" hint="Maksimal 500 karakter">
              <textarea className={inputCls} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={close} disabled={create.isPending || merge.isPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
              <button
                type="submit"
                disabled={!outgoingReady || create.isPending || merge.isPending || initialProductsLoading || Boolean(initialProductsError) || initialProductsIncomplete || initialProductSuppliers.length === 0}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {create.isPending ? 'Menyimpan…' : 'Simpan Draft Baru'}
              </button>
              {mergeCandidates.data && mergeCandidates.data.length > 0 && (
                <button
                  type="button"
                  disabled={!outgoingReady || mergeReturnId === null || merge.isPending || create.isPending || initialProductsLoading || Boolean(initialProductsError) || initialProductsIncomplete}
                  onClick={() => merge.mutate()}
                  className="rounded-md border border-blue-700 px-3 py-2 text-sm font-medium text-blue-700 disabled:opacity-50"
                >
                  {merge.isPending ? 'Menggabungkan…' : 'Gabungkan retur'}
                </button>
              )}
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

type DetailAction = 'decision' | 'replacement' | 'writeoff' | null;

function SupplierReturnDetailDialog({
  returnId,
  canCreate,
  canWriteOff,
  onClose,
  onChanged,
}: {
  returnId: number;
  canCreate: boolean;
  canWriteOff: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [action, setAction] = useState<DetailAction>(null);
  const [decision, setDecision] = useState<'accept' | 'reject'>('accept');
  const [decisionNote, setDecisionNote] = useState('');
  const [replacementForm, setReplacementForm] = useState<Record<number, { expiryDate: string; batchCode: string }>>({});
  const [approverUsername, setApproverUsername] = useState('');
  const [approverPassword, setApproverPassword] = useState('');
  const [approverKey, setApproverKey] = useState('');
  const [writeOffNote, setWriteOffNote] = useState('');
  const approvalMode: ApprovalAuthMode = me?.approval_auth_mode ?? 'password';

  const detail = useQuery({
    queryKey: ['supplier-return', returnId],
    queryFn: () => supplierReturnApi.get(returnId),
  });
  const productDetails = useQueries({
    queries: (detail.data?.items ?? []).map((item) => ({
      queryKey: ['products', 'detail', item.product_id],
      queryFn: () => productApi.get(item.product_id),
      enabled: action === 'replacement',
    })),
  });

  const refresh = async (updated: SupplierReturn) => {
    queryClient.setQueryData(['supplier-return', returnId], updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['supplier-returns'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
    ]);
    setAction(null);
    setApproverPassword('');
    setApproverKey('');
    onChanged();
  };
  const submitReturn = useMutation({ mutationFn: () => supplierReturnApi.submit(returnId), onSuccess: refresh });
  const cancelReturn = useMutation({
    mutationFn: () => supplierReturnApi.cancel(returnId, decisionNote.trim() || undefined),
    onSuccess: refresh,
  });
  const decide = useMutation({
    mutationFn: () => supplierReturnApi.supplierDecision(returnId, decision, decisionNote.trim() || undefined),
    onSuccess: refresh,
  });
  const receiveReplacement = useMutation({
    mutationFn: (current: SupplierReturn) => supplierReturnApi.receiveReplacement(returnId, current.items.map((item) => {
      const values = replacementForm[item.id] ?? { expiryDate: item.expiry_date ?? '', batchCode: '' };
      return {
        return_item_id: item.id,
        ...(values.expiryDate ? { expiry_date: values.expiryDate } : {}),
        ...(values.batchCode.trim() ? { batch_code: values.batchCode.trim() } : {}),
      };
    })),
    onSuccess: async (updated) => {
      await refresh(updated);
      const nextReceipt = updated.replacement_goods_receipts?.[0];
      navigate(nextReceipt ? `/goods-receipts?gr_id=${nextReceipt.id}` : '/goods-receipts');
    },
  });
  const writeOff = useMutation({
    mutationFn: () => supplierReturnApi.writeOff(returnId, {
      approver_username: approverUsername.trim(),
      ...(approvalMode !== 'key' ? { approver_password: approverPassword } : {}),
      ...(approvalMode !== 'password' ? { approver_key: approverKey } : {}),
      note: writeOffNote.trim() || undefined,
    }),
    onSuccess: (updated) => {
      setApproverUsername('');
      setWriteOffNote('');
      return refresh(updated);
    },
    onSettled: () => {
      setApproverPassword('');
      setApproverKey('');
    },
  });

  function replaceValue(itemId: number, patch: Partial<{ expiryDate: string; batchCode: string }>) {
    setReplacementForm((current) => ({
      ...current,
      [itemId]: {
        ...current[itemId],
        expiryDate: current[itemId]?.expiryDate ?? '',
        batchCode: current[itemId]?.batchCode ?? '',
        ...patch,
      },
    }));
  }
  const close = () => {
    if ([submitReturn, cancelReturn, decide, receiveReplacement, writeOff].some((mutation) => mutation.isPending)) return;
    onClose();
  };
  const anyPending = submitReturn.isPending || cancelReturn.isPending || decide.isPending || receiveReplacement.isPending || writeOff.isPending;
  const actionError = submitReturn.error ?? cancelReturn.error ?? decide.error ?? receiveReplacement.error ?? writeOff.error;
  const returnDoc = detail.data;
  const needsPassword = approvalMode !== 'key';
  const needsKey = approvalMode !== 'password';
  const reauthReady = approverUsername.trim().length > 0
    && (!needsPassword || approverPassword.length > 0)
    && (!needsKey || approverKey.length > 0);
  const replacementReady = returnDoc?.items.every((item, index) => {
    const trackExpiry = productDetails[index]?.data?.track_expiry ?? item.expiry_date !== null;
    const values = replacementForm[item.id] ?? { expiryDate: '', batchCode: '' };
    return !trackExpiry || values.expiryDate !== '';
  }) ?? false;

  return (
    <>
      <Modal title={returnDoc ? `Retur ${returnDoc.doc_number}` : 'Detail retur supplier'} onClose={close}>
      <div className="space-y-4 p-5">
        <ErrorNotice error={detail.error ?? actionError} />
        {detail.isLoading && <p className="text-sm text-slate-500">Memuat detail retur…</p>}
        {returnDoc && (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p><span className="text-slate-500">Supplier:</span> {returnDoc.supplier_name}</p>
              <p><span className="text-slate-500">Status:</span> {STATUS_LABEL[returnDoc.status]}</p>
              {returnDoc.goods_receipt_doc_number && <p><span className="text-slate-500">GR asal:</span> {returnDoc.goods_receipt_doc_number}</p>}
              {returnDoc.invoice_no && <p><span className="text-slate-500">Faktur supplier:</span> {returnDoc.invoice_no}</p>}
              <p><span className="text-slate-500">Pemohon:</span> {returnDoc.requested_by_name}</p>
              <p><span className="text-slate-500">Dibuat:</span> {formatDateTime(returnDoc.created_at)}</p>
              {returnDoc.submitted_at && <p><span className="text-slate-500">Diajukan:</span> {formatDateTime(returnDoc.submitted_at)}</p>}
              {returnDoc.decided_by_name && <p><span className="text-slate-500">Diputus oleh:</span> {returnDoc.decided_by_name}</p>}
              {returnDoc.decided_at && <p><span className="text-slate-500">Waktu keputusan:</span> {formatDateTime(returnDoc.decided_at)}</p>}
              {canWriteOff && returnDoc.loss_amount && <p><span className="text-slate-500">Nilai rugi HPP:</span> {formatRupiah(returnDoc.loss_amount)}</p>}
              {returnDoc.approved_by_name && <p><span className="text-slate-500">Write-off disetujui:</span> {returnDoc.approved_by_name}</p>}
            </div>
            {(returnDoc.note || returnDoc.decision_note) && (
              <div className="space-y-1 rounded-md bg-slate-50 p-3 text-sm">
                {returnDoc.note && <p><span className="font-medium">Catatan:</span> {returnDoc.note}</p>}
                {returnDoc.decision_note && <p><span className="font-medium">Catatan keputusan supplier:</span> {returnDoc.decision_note}</p>}
              </div>
            )}
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Produk</th>
                    <th className="px-3 py-2">PO asal / lokasi / batch</th>
                    <th className="px-3 py-2">Rincian barang</th>
                    <th className="px-3 py-2 text-right">Jumlah retur</th>
                    <th className="px-3 py-2 text-right">Harga Modal</th>
                    <th className="px-3 py-2">Barang pengganti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returnDoc.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">{item.product_name}<span className="block font-mono text-xs text-slate-500">{item.sku}</span></td>
                      <td className="px-3 py-2">{item.source_po_doc_number ?? 'PO tidak tercatat'}<span className="block text-xs text-slate-500">{item.location_name} · {item.batch_code ?? 'Tanpa batch'}{item.shelf_position ? ` · ${item.shelf_position}` : ''}</span></td>
                      <td className="px-3 py-2">{item.goods_receipt_item_id !== null
                        ? <>Total datang {formatQty(sumQty(item.qty_received_safe, item.qty_damaged_at_receipt))}<span className="block text-xs text-slate-500">Aman {formatQty(item.qty_received_safe ?? '0')} · Rusak {formatQty(item.qty_damaged_at_receipt ?? item.qty)}</span><span className="block text-xs text-slate-500">{item.disposition === 'quarantine' ? 'Masuk karantina' : 'Dikembalikan ke supplier'}</span></>
                        : item.source_bucket === 'sellable' ? 'Sellable' : 'Rusak'}</td>
                      <td className="px-3 py-2 text-right">{formatQty(item.qty)} {item.unit_name}</td>
                      <td className="px-3 py-2 text-right">{item.unit_cost ? formatRupiah(item.unit_cost) : '—'}</td>
                      <td className="px-3 py-2">{item.replacement_batch_code ?? '—'}{item.replacement_expiry_date ? ` · ${formatDate(item.replacement_expiry_date)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => window.print()} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cetak retur</button>
              {returnDoc.return_type === 'incoming' && canCreate && returnDoc.status === 'draft' && (
                <button type="button" disabled={anyPending} onClick={() => {
                  if (window.confirm('Tandai retur ini sudah dicetak dan dikirim ke supplier?')) submitReturn.mutate();
                }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {submitReturn.isPending ? 'Menyimpan…' : 'Ajukan retur ke supplier'}
                </button>
              )}
              {returnDoc.return_type === 'incoming' && canCreate && returnDoc.status === 'submitted' && (
                <>
                  <button type="button" disabled={anyPending} onClick={() => {
                    setDecision('accept');
                    setDecisionNote('');
                    setAction('decision');
                  }} className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Retur diterima</button>
                  <button type="button" disabled={anyPending} onClick={() => {
                    setDecision('reject');
                    setDecisionNote('');
                    setAction('decision');
                  }} className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60">Retur ditolak</button>
                </>
              )}
              </div>
            {canCreate && returnDoc.return_type === 'outgoing' && returnDoc.status === 'draft' && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <button type="button" disabled={anyPending} onClick={() => {
                  if (window.confirm('Ajukan retur ke supplier? Stok pada lokasi/batch terkait akan dipindahkan ke karantina.')) submitReturn.mutate();
                }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {submitReturn.isPending ? 'Mengajukan…' : 'Ajukan ke supplier'}
                </button>
                <button type="button" disabled={anyPending} onClick={() => setAction('decision')} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batalkan Draft</button>
              </div>
            )}
            {canCreate && returnDoc.return_type === 'outgoing' && returnDoc.status === 'submitted' && (
              <div className="border-t border-slate-100 pt-3">
                <button type="button" onClick={() => { setAction('decision'); setDecision('accept'); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Catat keputusan supplier</button>
              </div>
            )}
            {canCreate && returnDoc.return_type === 'outgoing' && returnDoc.status === 'accepted' && (
              <div className="border-t border-slate-100 pt-3">
                <button type="button" onClick={() => setAction('replacement')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Terima barang pengganti</button>
              </div>
            )}
            {canWriteOff && returnDoc.return_type === 'outgoing' && returnDoc.status === 'rejected' && (
              <div className="border-t border-slate-100 pt-3">
                <button type="button" onClick={() => setAction('writeoff')} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white">Setujui write-off</button>
              </div>
            )}
            {action === 'decision' && (
              <div className="space-y-3 rounded-md border border-slate-200 p-3">
                {returnDoc.status === 'draft' ? (
                  <>
                    <h3 className="text-sm font-semibold">Batalkan draft retur</h3>
                    <Field label="Alasan (opsional)"><textarea className={inputCls} rows={2} maxLength={500} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} /></Field>
                    <button type="button" disabled={anyPending} onClick={() => {
                      if (window.confirm('Batalkan Draft retur ini?')) cancelReturn.mutate();
                    }} className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-60">Konfirmasi pembatalan</button>
                  </>
                ) : returnDoc.return_type === 'incoming' ? (
                  <>
                    <h3 className="text-sm font-semibold">{decision === 'accept' ? 'Konfirmasi retur diterima' : 'Konfirmasi retur ditolak'}</h3>
                    <p className="text-xs text-slate-600">
                      {decision === 'accept'
                        ? 'Barang pengganti akan langsung menambah stok. Barang rusak di karantina akan dikeluarkan; penerimaan PO tidak berubah.'
                        : 'Nilai rugi dihitung dari HPP dikali jumlah retur. Barang yang masih di karantina tidak akan dihapus dari stok.'}
                    </p>
                    <Field label={decision === 'reject' ? 'Alasan penolakan (wajib)' : 'Catatan (opsional)'}>
                      <textarea className={inputCls} rows={2} maxLength={500} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} />
                    </Field>
                    <button type="button" disabled={anyPending || (decision === 'reject' && !decisionNote.trim())} onClick={() => {
                      if (window.confirm(decision === 'accept'
                        ? 'Konfirmasi barang pengganti diterima dan tambahkan ke stok?'
                        : 'Catat penolakan supplier dan simpan nilai kerugian?')) decide.mutate();
                    }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                      {decide.isPending ? 'Menyimpan…' : 'Simpan keputusan'}
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold">Catat keputusan supplier</h3>
                    <Field label="Keputusan">
                      <select className={inputCls} value={decision} onChange={(event) => setDecision(event.target.value as 'accept' | 'reject')}>
                        <option value="accept">Supplier menerima retur</option>
                        <option value="reject">Supplier menolak retur</option>
                      </select>
                    </Field>
                    <Field label={decision === 'reject' ? 'Alasan penolakan (wajib)' : 'Catatan (opsional)'}>
                      <textarea className={inputCls} rows={2} maxLength={500} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} />
                    </Field>
                    <button type="button" disabled={anyPending || (decision === 'reject' && !decisionNote.trim())} onClick={() => {
                      if (window.confirm(decision === 'accept' ? 'Supplier menerima retur dan stok karantina akan keluar?' : 'Catat penolakan supplier? Barang akan tetap dikarantina sampai write-off disetujui.')) decide.mutate();
                    }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Simpan keputusan</button>
                  </>
                )}
                <button type="button" onClick={() => setAction(null)} disabled={anyPending} className="ml-2 text-sm text-slate-600 underline">Tutup</button>
              </div>
            )}
            {action === 'replacement' && (
              <div className="space-y-3 rounded-md border border-slate-200 p-3">
                <div>
                  <h3 className="text-sm font-semibold">Penerimaan barang pengganti</h3>
                  <p className="text-xs text-slate-600">Buat GR draft per PO asal. Stok baru bertambah setelah GR diposting.</p>
                </div>
                {returnDoc.items.map((item, index) => {
                  const trackExpiry = productDetails[index]?.data?.track_expiry ?? item.expiry_date !== null;
                  const values = replacementForm[item.id] ?? { expiryDate: '', batchCode: '' };
                  return (
                    <div key={item.id} className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <p className="text-sm font-medium">{item.product_name} · {formatQty(item.qty)} {item.unit_name}</p>
                        <p className="text-xs text-slate-500">{item.location_name} · qty penerimaan sama dengan qty retur</p>
                      </div>
                      <Field label={trackExpiry ? 'Kedaluwarsa (wajib)' : 'Kedaluwarsa (opsional)'}>
                        <input className={inputCls} type="date" required={trackExpiry} value={values.expiryDate} onChange={(event) => replaceValue(item.id, { expiryDate: event.target.value })} />
                      </Field>
                      <Field label="Kode batch (opsional)">
                        <input className={inputCls} maxLength={60} value={values.batchCode} onChange={(event) => replaceValue(item.id, { batchCode: event.target.value })} />
                      </Field>
                    </div>
                  );
                })}
                <ErrorNotice error={productDetails.find((query) => query.error)?.error} />
                {!replacementReady && <p role="alert" className="text-xs text-red-700">Tanggal kedaluwarsa wajib diisi untuk produk yang melacak kedaluwarsa.</p>}
                <div className="flex gap-2">
                  <button type="button" disabled={anyPending || !replacementReady || productDetails.some((query) => query.isLoading)} onClick={() => {
                    if (window.confirm('Buat draft GR pengganti untuk setiap PO asal? Stok belum bertambah sampai GR diposting.')) receiveReplacement.mutate(returnDoc);
                  }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{receiveReplacement.isPending ? 'Membuat draft…' : 'Buat draft GR pengganti'}</button>
                  <button type="button" onClick={() => setAction(null)} disabled={anyPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
                </div>
              </div>
            )}
            {action === 'writeoff' && (
              <div className="space-y-3 rounded-md border border-red-200 bg-red-50/50 p-3">
                <div>
                  <h3 className="text-sm font-semibold">Persetujuan write-off</h3>
                  <p className="text-xs text-slate-600">Barang tetap di karantina sampai persetujuan ini berhasil. Autentikasi ulang mengikuti mode persetujuan toko: {approvalMode}.</p>
                </div>
                <Field label="Username Owner/Admin">
                  <input className={inputCls} autoComplete="username" value={approverUsername} onChange={(event) => setApproverUsername(event.target.value)} />
                </Field>
                {needsPassword && <Field label="Password Owner/Admin"><input className={inputCls} type="password" autoComplete="current-password" value={approverPassword} onChange={(event) => setApproverPassword(event.target.value)} /></Field>}
                {needsKey && <Field label="Kunci otorisasi"><input className={inputCls} type="password" autoComplete="off" value={approverKey} onChange={(event) => setApproverKey(event.target.value)} /></Field>}
                <Field label="Catatan persetujuan (opsional)"><textarea className={inputCls} rows={2} maxLength={500} value={writeOffNote} onChange={(event) => setWriteOffNote(event.target.value)} /></Field>
                <div className="flex gap-2">
                  <button type="button" disabled={anyPending || !reauthReady} onClick={() => {
                    if (window.confirm('Setujui write-off? Stok karantina akan dikurangi secara permanen.')) writeOff.mutate();
                  }} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{writeOff.isPending ? 'Memproses…' : 'Setujui write-off'}</button>
                  <button type="button" onClick={() => { setAction(null); setApproverPassword(''); setApproverKey(''); }} disabled={anyPending} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Batal</button>
                </div>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end border-t border-slate-100 pt-3">
          <button type="button" onClick={close} disabled={anyPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Tutup</button>
        </div>
      </div>
      </Modal>
      {returnDoc && (
        <SupplierReturnPrintSheet
          returnDoc={returnDoc}
          storeName={me?.store?.name ?? 'POS Retail SMK'}
        />
      )}
    </>
  );
}

function SupplierReturnPrintSheet({
  returnDoc,
  storeName,
}: {
  returnDoc: SupplierReturn;
  storeName: string;
}) {
  const hasReceiptItems = returnDoc.items.some((item) => item.goods_receipt_item_id !== null);

  return (
    <div className="print-only print-doc">
      <article>
        <header className="mb-4 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div>
            <div className="text-base font-bold">{storeName}</div>
            <h1 className="text-xl font-bold tracking-wide">RETUR BARANG</h1>
          </div>
          <div className="text-right text-xs leading-5">
            <div className="font-mono text-sm font-bold">{returnDoc.doc_number}</div>
            <div>Dibuat: {formatDateTime(returnDoc.created_at)}</div>
            <div>Status: {STATUS_LABEL[returnDoc.status]}</div>
          </div>
        </header>
        <section className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <p><strong>Supplier:</strong> {returnDoc.supplier_name}</p>
          <p><strong>Pemohon:</strong> {returnDoc.requested_by_name}</p>
          {returnDoc.goods_receipt_doc_number && <p><strong>GR asal:</strong> {returnDoc.goods_receipt_doc_number}</p>}
          {returnDoc.invoice_no && <p><strong>Faktur supplier:</strong> {returnDoc.invoice_no}</p>}
        </section>
        <table>
          <thead>
            <tr>
              <th>No</th>
              <th>Barang</th>
              {hasReceiptItems && <th>PO asal</th>}
              <th className="text-right">Jumlah retur</th>
              <th className="text-right">Harga Modal</th>
              {hasReceiptItems && <th>Penanganan</th>}
            </tr>
          </thead>
          <tbody>
            {returnDoc.items.map((item, index) => (
              <tr key={item.id}>
                <td>{index + 1}</td>
                <td>{item.product_name}<span className="block font-mono text-xs">{item.sku}</span></td>
                {hasReceiptItems && <td>{item.source_po_doc_number ?? '—'}</td>}
                <td className="text-right">{formatQty(item.qty)} {item.unit_name}</td>
                <td className="text-right">{item.unit_cost ? formatRupiah(item.unit_cost) : '—'}</td>
                {hasReceiptItems && <td>{item.disposition === 'quarantine' ? 'Masuk karantina' : 'Dikembalikan ke supplier'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-sm"><strong>Catatan:</strong> {returnDoc.note ?? '—'}</p>
        <div className="mt-12 grid grid-cols-2 gap-12 text-center text-sm">
          <div>Diserahkan oleh<div className="mt-16 border-t border-black pt-1">{returnDoc.requested_by_name}</div></div>
          <div>Diterima supplier<div className="mt-16 border-t border-black pt-1">Nama dan tanda tangan</div></div>
        </div>
      </article>
    </div>
  );
}
