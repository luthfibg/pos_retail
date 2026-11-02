import { useState, type FormEvent } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { ProductPicker } from '@/features/products/ProductPicker';
import type { ProductOption } from '@/features/inventory/openingForm';
import {
  inventoryApi,
  productApi,
  supplierApi,
  supplierReturnApi,
} from '@/lib/api/endpoints';
import type {
  ApprovalAuthMode,
  SupplierReturn,
  SupplierReturnBucket,
  SupplierReturnStatus,
} from '@/lib/api/types';
import { formatDate, formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { availableReturnBalances, buildSupplierReturnInput, validateSupplierReturn, type SupplierReturnLine } from './supplierReturnForm';

const STATUS_LABEL: Record<SupplierReturnStatus, string> = {
  draft: 'Draft',
  submitted: 'Menunggu keputusan supplier',
  accepted: 'Disetujui supplier',
  rejected: 'Ditolak supplier',
  replacement_received: 'Barang pengganti diterima',
  written_off: 'Sudah write-off',
  cancelled: 'Dibatalkan',
};
const STATUSES = Object.keys(STATUS_LABEL) as SupplierReturnStatus[];
let lineSequence = 0;

export function SupplierReturnsPage() {
  const { can } = useAuth();
  const canCreate = can('supplier_return.create');
  const canWriteOff = can('inventory.adjust.approve');
  const [queryInput, setQueryInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState<SupplierReturnStatus | ''>('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const returns = useQuery({
    queryKey: ['supplier-returns', { queryText, status, page }],
    queryFn: () => supplierReturnApi.list({
      q: queryText || undefined,
      status: status || undefined,
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
          <h1 className="text-xl font-semibold">Retur Supplier</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Ajukan retur stok kepada supplier. Barang masuk karantina setelah draft diajukan dan tidak dapat dijual selama menunggu keputusan.
          </p>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setCreateOpen(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Buat retur
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
              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
            </select>
          </Field>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Terapkan</button>
        </form>

        <ErrorNotice error={returns.error} />
        {returns.isLoading && <p className="text-sm text-slate-500">Memuat retur supplier…</p>}
        {returns.data?.data.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada dokumen yang cocok.</p>}
        {returns.data && returns.data.data.length > 0 && (
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
                  {returns.data.data.map((item) => (
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
              page={returns.data.current_page}
              lastPage={returns.data.last_page}
              from={returns.data.from}
              to={returns.data.to}
              total={returns.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>

      {createOpen && (
        <SupplierReturnCreateDialog
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
    </div>
  );
}

function SupplierReturnCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: SupplierReturn) => void;
}) {
  const queryClient = useQueryClient();
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [sourceBucket, setSourceBucket] = useState<SupplierReturnBucket>('sellable');
  const [balanceId, setBalanceId] = useState<number | null>(null);
  const [qty, setQty] = useState('');
  const [rows, setRows] = useState<SupplierReturnLine[]>([]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ general?: string; rows: Record<number, string> }>({ rows: {} });

  const suppliers = useQuery({
    queryKey: ['suppliers', 'return-picker', supplierSearch],
    queryFn: () => supplierApi.list({ q: supplierSearch || undefined, active_only: true, per_page: 50 }),
  });
  const stock = useQuery({
    queryKey: ['inventory', 'product-stock', product?.id],
    queryFn: () => inventoryApi.productStock(product!.id),
    enabled: product !== null,
  });
  const balances = stock.data ? availableReturnBalances(stock.data, sourceBucket) : [];
  const selectedBalance = balances.find((item) => item.balance_id === balanceId) ?? null;

  const create = useMutation({
    mutationFn: () => {
      const selectedSupplier = supplierId;
      const validation = validateSupplierReturn(selectedSupplier, rows, note);
      setErrors(validation);
      if (validation.general || Object.keys(validation.rows).length > 0 || selectedSupplier === null) {
        throw new Error(validation.general ?? 'Periksa kembali baris retur.');
      }
      return supplierReturnApi.create(buildSupplierReturnInput(selectedSupplier, rows, note));
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

  function addLine() {
    if (!product || !selectedBalance || !qty.trim()) return;
    const row: SupplierReturnLine = {
      key: ++lineSequence,
      product,
      balance: selectedBalance,
      sourceBucket,
      qty: qty.trim(),
    };
    const nextRows = [...rows, row];
    const validation = validateSupplierReturn(supplierId ?? 1, nextRows, note);
    if (validation.rows[nextRows.length - 1]) {
      setErrors({ rows: { [nextRows.length - 1]: validation.rows[nextRows.length - 1]! } });
      return;
    }
    setRows(nextRows);
    setErrors({ rows: {} });
    setProduct(null);
    setBalanceId(null);
    setQty('');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateSupplierReturn(supplierId, rows, note);
    setErrors(validation);
    if (!validation.general && Object.keys(validation.rows).length === 0) create.mutate();
  }

  const close = () => { if (!create.isPending) onClose(); };

  return (
    <Modal title="Buat Draft Retur Supplier" onClose={close}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <p className="text-sm text-slate-600">Draft belum mengubah stok. Stok baru dipindahkan ke karantina saat retur diajukan.</p>
        <ErrorNotice error={suppliers.error ?? stock.error ?? create.error} />
        {errors.general && <p role="alert" className="text-sm text-red-700">{errors.general}</p>}

        <Field label="Cari supplier">
          <input className={inputCls} value={supplierSearch} onChange={(event) => { setSupplierSearch(event.target.value); setSupplierId(null); }} placeholder="Nama atau kode supplier" />
        </Field>
        <Field label="Supplier" error={errors.general && !supplierId ? errors.general : undefined}>
          <select className={inputCls} value={supplierId ?? ''} onChange={(event) => setSupplierId(event.target.value ? Number(event.target.value) : null)} required>
            <option value="">Pilih supplier aktif</option>
            {(suppliers.data?.data ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>)}
          </select>
        </Field>

        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <Field label="Produk">
            <ProductPicker value={product} onChange={(value) => { setProduct(value); setBalanceId(null); }} />
          </Field>
          {product && (
            <>
              <ErrorNotice error={stock.error} />
              <Field label="Bucket stok yang diretur">
                <select className={inputCls} value={sourceBucket} onChange={(event) => { setSourceBucket(event.target.value as SupplierReturnBucket); setBalanceId(null); }}>
                  <option value="sellable">Sellable</option>
                  <option value="damaged">Rusak (damaged)</option>
                </select>
              </Field>
              {stock.isLoading && <p className="text-xs text-slate-500">Memuat saldo stok…</p>}
              {stock.data && (
                <Field label="Lokasi / batch / posisi">
                  <select className={inputCls} value={balanceId ?? ''} onChange={(event) => setBalanceId(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">Pilih saldo stok</option>
                    {balances.map((balance) => (
                      <option key={balance.balance_id} value={balance.balance_id}>
                        {balance.location_id} — {balance.batch_code ?? 'Tanpa batch'}{balance.expiry_date ? ` / exp ${formatDate(balance.expiry_date)}` : ''}
                        {balance.shelf_position_id ? ` / posisi ${balance.shelf_position_id}` : ''} — tersedia {formatQty(sourceBucket === 'sellable' ? balance.qty_sellable : balance.qty_damaged)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {balances.length === 0 && stock.data && <p className="text-xs text-amber-800">Tidak ada saldo positif pada bucket ini.</p>}
              <div className="flex flex-wrap items-end gap-2">
                <Field label={`Qty ${selectedBalance ? `(tersedia ${formatQty(sourceBucket === 'sellable' ? selectedBalance.qty_sellable : selectedBalance.qty_damaged)})` : ''}`} hint="Gunakan koma untuk pecahan, misalnya 1,5.">
                  <LocalDecimalInput className={`${inputCls} w-36`} kind="quantity" value={qty} onChange={setQty} placeholder="Contoh: 20" />
                </Field>
                <button type="button" onClick={addLine} disabled={!product || !selectedBalance || !qty.trim()} className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Tambah barang</button>
              </div>
              {errors.rows[rows.length] && <p role="alert" className="text-xs text-red-700">{errors.rows[rows.length]}</p>}
            </>
          )}
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Barang retur</h3>
            {rows.map((row, index) => (
              <div key={row.key} className="flex items-start justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{row.product.name} <span className="font-mono text-xs text-slate-500">{row.product.sku}</span></p>
                  <p className="text-xs text-slate-600">{row.balance.location_id} · {row.balance.batch_code ?? 'Tanpa batch'} · {row.sourceBucket} · {formatQty(row.qty)} {row.product.unit_name}</p>
                  {errors.rows[index] && <p role="alert" className="text-xs text-red-700">{errors.rows[index]}</p>}
                </div>
                <button type="button" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} className="text-xs text-red-700 underline">Hapus</button>
              </div>
            ))}
          </div>
        )}
        <Field label="Catatan" hint="Maksimal 500 karakter">
          <textarea className={inputCls} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={close} disabled={create.isPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
          <button type="submit" disabled={create.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{create.isPending ? 'Menyimpan…' : 'Simpan Draft'}</button>
        </div>
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
  const { me } = useAuth();
  const [action, setAction] = useState<DetailAction>(null);
  const [decision, setDecision] = useState<'accept' | 'reject'>('accept');
  const [decisionNote, setDecisionNote] = useState('');
  const [replacementForm, setReplacementForm] = useState<Record<number, { expiryDate: string; batchCode: string; shelfPositionId: string }>>({});
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
      const values = replacementForm[item.id] ?? { expiryDate: item.expiry_date ?? '', batchCode: '', shelfPositionId: '' };
      return {
        return_item_id: item.id,
        ...(values.expiryDate ? { expiry_date: values.expiryDate } : {}),
        ...(values.batchCode.trim() ? { batch_code: values.batchCode.trim() } : {}),
        ...(values.shelfPositionId.trim() ? { shelf_position_id: Number(values.shelfPositionId) } : {}),
      };
    })),
    onSuccess: refresh,
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

  function replaceValue(itemId: number, patch: Partial<{ expiryDate: string; batchCode: string; shelfPositionId: string }>) {
    setReplacementForm((current) => ({
      ...current,
      [itemId]: {
        ...current[itemId],
        expiryDate: current[itemId]?.expiryDate ?? '',
        batchCode: current[itemId]?.batchCode ?? '',
        shelfPositionId: current[itemId]?.shelfPositionId ?? '',
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
    const values = replacementForm[item.id] ?? { expiryDate: '', batchCode: '', shelfPositionId: '' };
    return !trackExpiry || values.expiryDate !== '';
  }) ?? false;

  return (
    <Modal title={returnDoc ? `Retur ${returnDoc.doc_number}` : 'Detail retur supplier'} onClose={close}>
      <div className="space-y-4 p-5">
        <ErrorNotice error={detail.error ?? actionError} />
        {detail.isLoading && <p className="text-sm text-slate-500">Memuat detail retur…</p>}
        {returnDoc && (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p><span className="text-slate-500">Supplier:</span> {returnDoc.supplier_name}</p>
              <p><span className="text-slate-500">Status:</span> {STATUS_LABEL[returnDoc.status]}</p>
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
                    <th className="px-3 py-2">Lokasi / batch</th>
                    <th className="px-3 py-2">Sumber</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    {canWriteOff && <th className="px-3 py-2 text-right">HPP snapshot</th>}
                    <th className="px-3 py-2">Barang pengganti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returnDoc.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">{item.product_name}<span className="block font-mono text-xs text-slate-500">{item.sku}</span></td>
                      <td className="px-3 py-2">{item.location_name}<span className="block text-xs text-slate-500">{item.batch_code ?? 'Tanpa batch'}{item.shelf_position ? ` · ${item.shelf_position}` : ''}</span></td>
                      <td className="px-3 py-2">{item.source_bucket === 'sellable' ? 'Sellable' : 'Rusak'}</td>
                      <td className="px-3 py-2 text-right">{formatQty(item.qty)} {item.unit_name}</td>
                      {canWriteOff && <td className="px-3 py-2 text-right">{item.unit_cost ? formatRupiah(item.unit_cost) : '—'}</td>}
                      <td className="px-3 py-2">{item.replacement_batch_code ?? '—'}{item.replacement_expiry_date ? ` · ${formatDate(item.replacement_expiry_date)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canCreate && returnDoc.status === 'draft' && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <button type="button" disabled={anyPending} onClick={() => {
                  if (window.confirm('Ajukan retur ke supplier? Stok pada lokasi/batch terkait akan dipindahkan ke karantina.')) submitReturn.mutate();
                }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {submitReturn.isPending ? 'Mengajukan…' : 'Ajukan ke supplier'}
                </button>
                <button type="button" disabled={anyPending} onClick={() => setAction('decision')} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batalkan Draft</button>
              </div>
            )}
            {canCreate && returnDoc.status === 'submitted' && (
              <div className="border-t border-slate-100 pt-3">
                <button type="button" onClick={() => { setAction('decision'); setDecision('accept'); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Catat keputusan supplier</button>
              </div>
            )}
            {canCreate && returnDoc.status === 'accepted' && (
              <div className="border-t border-slate-100 pt-3">
                <button type="button" onClick={() => setAction('replacement')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Terima barang pengganti</button>
              </div>
            )}
            {canWriteOff && returnDoc.status === 'rejected' && (
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
                  <p className="text-xs text-slate-600">Penerimaan memproses seluruh item sekaligus, sebanyak qty retur asal. Barang masuk ke sellable.</p>
                </div>
                {returnDoc.items.map((item, index) => {
                  const trackExpiry = productDetails[index]?.data?.track_expiry ?? item.expiry_date !== null;
                  const values = replacementForm[item.id] ?? { expiryDate: '', batchCode: '', shelfPositionId: '' };
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
                      <Field label="ID posisi rak (opsional)" hint="Kosongkan bila tidak menggunakan posisi rak">
                        <input className={inputCls} inputMode="numeric" value={values.shelfPositionId} onChange={(event) => replaceValue(item.id, { shelfPositionId: event.target.value.replace(/\D/g, '') })} />
                      </Field>
                    </div>
                  );
                })}
                <ErrorNotice error={productDetails.find((query) => query.error)?.error} />
                {!replacementReady && <p role="alert" className="text-xs text-red-700">Tanggal kedaluwarsa wajib diisi untuk produk yang melacak kedaluwarsa.</p>}
                <div className="flex gap-2">
                  <button type="button" disabled={anyPending || !replacementReady || productDetails.some((query) => query.isLoading)} onClick={() => {
                    if (window.confirm('Terima barang pengganti untuk seluruh item retur? Stok sellable akan bertambah.')) receiveReplacement.mutate(returnDoc);
                  }} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{receiveReplacement.isPending ? 'Memproses…' : 'Konfirmasi penerimaan'}</button>
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
  );
}
