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
  ProductSupplier,
  SupplierReturn,
} from '@/lib/api/types';
import { formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { availableReturnQty, buildSupplierReturnInput, validateSupplierReturn, type SupplierReturnLine } from './supplierReturnForm';
import { sharedActiveSuppliers } from '@/features/products/productForm';

type InitialReturnProduct = ProductOption & { suppliers: ProductSupplier[] };
type InitialReturnDraft = {
  qty: string;
};

export function SupplierReturnsPage() {
  const { can } = useAuth();
  const canCreate = can('supplier_return.create');
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialProductIds] = useState(() => [...new Set(
    (searchParams.get('products') ?? '')
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  )]);
  const [queryInput, setQueryInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(() => canCreate && searchParams.get('create') === '1'
    && initialProductIds.length > 0);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = Number(searchParams.get('return_id'));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });

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
      || searchParams.has('gr_id')
      || searchParams.has('return_id')) {
      setSearchParams({}, { replace: true });
    }
  }, [initialProductIds.length, searchParams, setSearchParams]);

  const returns = useQuery({
    queryKey: ['supplier-returns', { queryText }],
    queryFn: async () => {
      const filters = { q: queryText || undefined, per_page: 100 };
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
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Terapkan</button>
        </form>

        <ErrorNotice error={returns.error} />
        {returns.isLoading && <p className="text-sm text-slate-500">Memuat retur supplier…</p>}
        {returns.data && returnItems.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada dokumen yang cocok.</p>}
        {returns.data && returnItems.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nomor retur</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Pemohon</th>
                    <th className="px-3 py-2">Dibuat</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-mono font-medium">{item.doc_number}</td>
                      <td className="px-3 py-2">{item.supplier_name}</td>
                      <td className="px-3 py-2">{item.requested_by_name}</td>
                      <td className="px-3 py-2">{formatDateTime(item.created_at)}</td>
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
          onClose={() => setSelectedId(null)}
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
        queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] }),
      ]);
      onCreated(created);
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

  const close = () => { if (!create.isPending) onClose(); };

  return (
    <Modal title="Buat Retur Barang" onClose={close}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <ErrorNotice error={initialProductsError ?? create.error} />
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
          </div>
        )}
        {hasInitialSelection && (
          <>
            <Field label="Catatan" hint="Maksimal 500 karakter">
              <textarea className={inputCls} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">Retur akan langsung mengurangi stok dan membuat PR otomatis sesuai jumlah retur.</p>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                <button type="button" onClick={close} disabled={create.isPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
              <button
                type="submit"
                  disabled={!outgoingReady || create.isPending || initialProductsLoading || Boolean(initialProductsError) || initialProductsIncomplete || initialProductSuppliers.length === 0}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                  {create.isPending ? 'Memproses…' : 'Buat Retur'}
                </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

function SupplierReturnDetailDialog({ returnId, onClose }: { returnId: number; onClose: () => void }) {
  const { me } = useAuth();
  const detail = useQuery({
    queryKey: ['supplier-return', returnId],
    queryFn: () => supplierReturnApi.get(returnId),
  });
  const returnDoc = detail.data;

  if (!returnDoc) {
    return (
      <Modal title="Detail retur supplier" onClose={onClose}>
        <div className="space-y-4 p-5">
          <ErrorNotice error={detail.error} />
          {detail.isLoading && <p className="text-sm text-slate-500">Memuat detail retur…</p>}
          <div className="flex justify-end border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Tutup</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal title={`Retur ${returnDoc.doc_number}`} onClose={onClose}>
        <div className="space-y-4 p-5">
          <ErrorNotice error={detail.error} />
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p><span className="text-slate-500">Supplier:</span> {returnDoc.supplier_name}</p>
            {returnDoc.goods_receipt_doc_number && <p><span className="text-slate-500">GR asal:</span> {returnDoc.goods_receipt_doc_number}</p>}
            {returnDoc.invoice_no && <p><span className="text-slate-500">Faktur supplier:</span> {returnDoc.invoice_no}</p>}
            <p><span className="text-slate-500">Pemohon:</span> {returnDoc.requested_by_name}</p>
            <p><span className="text-slate-500">Dibuat:</span> {formatDateTime(returnDoc.created_at)}</p>
          </div>
          {returnDoc.note && <p className="rounded-md bg-slate-50 p-3 text-sm">Catatan: {returnDoc.note}</p>}
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Produk</th>
                  <th className="px-3 py-2">PO asal / lokasi / batch</th>
                  <th className="px-3 py-2 text-right">Jumlah retur</th>
                  <th className="px-3 py-2 text-right">Harga Satuan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {returnDoc.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">{item.product_name}<span className="block font-mono text-xs text-slate-500">{item.sku}</span></td>
                    <td className="px-3 py-2">{item.source_po_doc_number ?? 'PO tidak tercatat'}<span className="block text-xs text-slate-500">{item.location_name} · {item.batch_code ?? 'Tanpa batch'}{item.shelf_position ? ` · ${item.shelf_position}` : ''}</span></td>
                    <td className="px-3 py-2 text-right">{formatQty(item.qty)} {item.unit_name}</td>
                    <td className="px-3 py-2 text-right">{item.unit_cost ? formatRupiah(item.unit_cost) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={() => window.print()} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cetak</button>
            <button type="button" onClick={onClose} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Tutup</button>
          </div>
        </div>
      </Modal>
      <SupplierReturnPrintSheet returnDoc={returnDoc} storeName={me?.store?.name ?? 'POS Retail SMK'} />
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
