import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { goodsReceiptApi, productApi, purchaseOrderApi } from '@/lib/api/endpoints';
import type { GoodsReceipt, PurchaseOrderItem } from '@/lib/api/types';
import { formatDate, formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { buildGoodsReceiptItems, validateGoodsReceiptLines, type GoodsReceiptLineErrors, type GoodsReceiptLineForm, type GoodsReceiptLineErrorMap } from './goodsReceiptForm';

function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());
}

function emptyLine(poItem: PurchaseOrderItem, key = String(poItem.id)): GoodsReceiptLineForm {
  return {
    key,
    poItemId: poItem.id,
    qtyReceived: '',
    qtyDamaged: '',
    expiryDate: '',
    note: '',
  };
}

export function GoodsReceiptsPage() {
  const [searchParams] = useSearchParams();
  const [poSearchValue, setPoSearchValue] = useState('');
  const [poSearch, setPoSearch] = useState('');
  const [poPage, setPoPage] = useState(1);
  const [receiptSearchValue, setReceiptSearchValue] = useState('');
  const [receiptSearch, setReceiptSearch] = useState('');
  const [receiptPage, setReceiptPage] = useState(1);
  const [createPoId, setCreatePoId] = useState<number | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(() => {
    const id = Number(searchParams.get('gr_id'));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });

  const purchaseOrders = useQuery({
    queryKey: ['purchase-orders', 'receivable', poSearch, poPage],
    queryFn: () => purchaseOrderApi.receivable({ q: poSearch || undefined, page: poPage, per_page: 25 }),
  });
  const receipts = useQuery({
    queryKey: ['goods-receipts', receiptSearch, receiptPage],
    queryFn: () => goodsReceiptApi.list({ q: receiptSearch || undefined, page: receiptPage, per_page: 25 }),
  });

  function applyPoSearch(event: FormEvent) {
    event.preventDefault();
    setPoSearch(poSearchValue.trim());
    setPoPage(1);
  }

  function applyReceiptSearch(event: FormEvent) {
    event.preventDefault();
    setReceiptSearch(receiptSearchValue.trim());
    setReceiptPage(1);
  }

  return (
    <div className="space-y-5 p-6">
      <header>
        <h1 className="text-xl font-semibold">Penerimaan Barang</h1>
      </header>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Pemesanan diterima</h2>
          </div>
          <form onSubmit={applyPoSearch} className="flex gap-2">
            <label className="sr-only" htmlFor="receivable-po-search">Cari nomor PO</label>
            <input id="receivable-po-search" className={`${inputCls} w-52`} value={poSearchValue} onChange={(event) => setPoSearchValue(event.target.value)} placeholder="Nomor PO" />
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cari</button>
          </form>
        </div>
        <ErrorNotice error={purchaseOrders.error} />
        {purchaseOrders.isLoading ? <p className="text-sm text-slate-500">Memuat PO…</p> : null}
        {purchaseOrders.data?.data.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Tidak ada PO yang dapat diterima.</p>}
        {purchaseOrders.data && purchaseOrders.data.data.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nomor PO</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Tanggal terima barang</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseOrders.data.data.map((po) => (
                    <tr key={po.id}>
                      <td className="px-3 py-2 font-mono font-medium">{po.doc_number}</td>
                      <td className="px-3 py-2">{po.supplier_name}</td>
                      <td className="px-3 py-2">{po.expected_date ? formatDate(po.expected_date) : '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setCreatePoId(po.id)} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">Terima PO</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={purchaseOrders.data.current_page}
              lastPage={purchaseOrders.data.last_page}
              from={purchaseOrders.data.from}
              to={purchaseOrders.data.to}
              total={purchaseOrders.data.total}
              onPage={setPoPage}
            />
          </>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Data Penerimaan Barang</h2>
          </div>
          <form onSubmit={applyReceiptSearch} className="flex gap-2">
            <label className="sr-only" htmlFor="receipt-search">Cari nomor penerimaan</label>
            <input id="receipt-search" className={`${inputCls} w-52`} value={receiptSearchValue} onChange={(event) => setReceiptSearchValue(event.target.value)} placeholder="Nomor GR" />
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cari</button>
          </form>
        </div>
        <ErrorNotice error={receipts.error} />
        {receipts.isLoading ? <p className="text-sm text-slate-500">Memuat riwayat…</p> : null}
        {receipts.data?.data.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada dokumen penerimaan.</p>}
        {receipts.data && receipts.data.data.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">PO / Supplier</th>
                    <th className="px-3 py-2">Nomor GR</th>
                    <th className="px-3 py-2">Nama Kasir</th>
                    <th className="px-3 py-2">Cek Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receipts.data.data.map((receipt) => (
                    <tr key={receipt.id}>
                      <td className="px-3 py-2">{receipt.po_doc_number}<div className="text-xs text-slate-500">{receipt.supplier_name}{receipt.supplier_return_doc_number ? ` · Pengganti ${receipt.supplier_return_doc_number}` : ''}</div></td>
                      <td className="px-3 py-2 font-mono font-medium">{receipt.doc_number}</td>
                      <td className="px-3 py-2">
                        <span className="block">{receipt.received_by_name}</span>
                        {receipt.received_by_cashier_number && <span className="block text-xs text-slate-500">{receipt.received_by_cashier_number}</span>}
                      </td>
                      <td className="px-3 py-2"><button type="button" onClick={() => setSelectedReceiptId(receipt.id)} className="font-medium text-blue-700 hover:underline">Detail / Proses</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={receipts.data.current_page}
              lastPage={receipts.data.last_page}
              from={receipts.data.from}
              to={receipts.data.to}
              total={receipts.data.total}
              onPage={setReceiptPage}
            />
          </>
        )}
      </section>

      {createPoId !== null && <CreateGoodsReceiptDialog poId={createPoId} onClose={() => setCreatePoId(null)} onCreated={(receipt) => { setCreatePoId(null); setSelectedReceiptId(receipt.id); }} />}
      {selectedReceiptId !== null && <GoodsReceiptDetailDialog receiptId={selectedReceiptId} onClose={() => setSelectedReceiptId(null)} />}
    </div>
  );
}

function CreateGoodsReceiptDialog({
  poId,
  onClose,
  onCreated,
}: {
  poId: number;
  onClose: () => void;
  onCreated: (receipt: GoodsReceipt) => void;
}) {
  const qc = useQueryClient();
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<GoodsReceiptLineForm[]>([]);
  const [lineErrors, setLineErrors] = useState<GoodsReceiptLineErrorMap>({});
  const initialized = useRef(false);
  const po = useQuery({ queryKey: ['purchase-order', poId], queryFn: () => purchaseOrderApi.get(poId) });
  const expiryQueries = useQueries({
    queries: (po.data?.items ?? []).map((item) => ({
      queryKey: ['products', item.product_id],
      queryFn: () => productApi.get(item.product_id),
    })),
  });
  const tracksExpiry = useMemo(() => Object.fromEntries(
    (po.data?.items ?? []).map((item, index) => [item.product_id, expiryQueries[index]?.data?.track_expiry ?? false]),
  ), [po.data?.items, expiryQueries]);
  const expiryLoading = expiryQueries.some((query) => query.isLoading);
  const expiryError = expiryQueries.find((query) => query.error)?.error;

  useEffect(() => {
    if (po.data && !initialized.current) {
      setLines(po.data.items.map((item) => emptyLine(item)));
      initialized.current = true;
    }
  }, [po.data]);

  const create = useMutation({
    mutationFn: () => {
      if (!po.data) throw new Error('Data PO belum tersedia.');
      return goodsReceiptApi.create({
        po_id: poId,
        delivery_note_no: deliveryNoteNo.trim() || undefined,
        invoice_no: invoiceNo.trim() || undefined,
        note: note.trim() || undefined,
        post: true,
        complete_po: true,
        items: buildGoodsReceiptItems(po.data.items, lines),
      });
    },
    onSuccess: async (receipt) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['goods-receipts'] }),
        qc.invalidateQueries({ queryKey: ['purchase-orders', 'receivable'] }),
        qc.invalidateQueries({ queryKey: ['purchase-order', poId] }),
        qc.invalidateQueries({ queryKey: ['supplier-returns'] }),
      ]);
      onCreated(receipt);
    },
  });

  function submitReceipt(event: FormEvent) {
    event.preventDefault();
    create.reset();
    const errors = po.data ? validateGoodsReceiptLines(po.data.items, lines, tracksExpiry, todayWib()) : {};
    setLineErrors(errors);
    if (po.data && Object.keys(errors).length === 0 && !expiryLoading && !expiryError) create.mutate();
  }

  function updateLine(id: string, key: keyof GoodsReceiptLineForm, value: string) {
    setLines((current) => current.map((line) => line.key === id ? { ...line, [key]: value } : line));
    setLineErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    create.reset();
  }

  return (
    <Modal title="Terima PO" onClose={() => !create.isPending && onClose()}>
      {po.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat detail PO…</p> : po.error ? <div className="space-y-3 p-5"><ErrorNotice error={po.error} /></div> : po.data ? (
        <form onSubmit={submitReceipt} noValidate className="space-y-4 p-5">
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="font-mono font-semibold">{po.data.doc_number}</div>
            <div>{po.data.supplier_name} · {po.data.status === 'approved' ? 'Disetujui' : po.data.status === 'partially_received' ? 'Sebagian diterima' : 'Dikirim'}</div>
            {po.data.total !== null && <div className="mt-1 text-xs text-slate-500">Nilai PO: {formatRupiah(po.data.total)}</div>}
          </div>
          <ErrorNotice error={expiryError} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nomor surat jalan">
              <input className={inputCls} maxLength={60} value={deliveryNoteNo} onChange={(event) => setDeliveryNoteNo(event.target.value)} />
            </Field>
            <Field label="Nomor faktur">
              <input className={inputCls} maxLength={60} value={invoiceNo} onChange={(event) => setInvoiceNo(event.target.value)} />
            </Field>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Pemeriksaan barang</h3>
            {lines.length === 0 ? <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">PO ini tidak memiliki barang.</p> : null}
            {lines.map((line) => {
              const item = po.data!.items.find((candidate) => candidate.id === line.poItemId)!;
              const errors = lineErrors[line.key] as GoodsReceiptLineErrors | undefined;
              const expiryRequired = tracksExpiry[item.product_id];
              return (
                <div key={line.key} className="space-y-3 rounded-md border border-slate-200 p-3">
                  <div>
                    <div className="font-medium">{item.name}<span className="ml-2 font-mono text-xs text-slate-500">{item.sku}</span></div>
                    <div className="text-xs text-slate-600">Sisa pesanan PO: {formatQty(item.qty_remaining)} {item.unit_name}</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={`Barang bagus (${item.unit_name})`} error={errors?.qtyReceived}>
                      <LocalDecimalInput className={inputCls} kind="quantity" value={line.qtyReceived} onChange={(value) => updateLine(line.key, 'qtyReceived', value)} />
                    </Field>
                    <Field label={`Barang rusak (${item.unit_name})`} error={errors?.qtyDamaged}>
                      <LocalDecimalInput className={inputCls} kind="quantity" value={line.qtyDamaged} onChange={(value) => updateLine(line.key, 'qtyDamaged', value)} />
                    </Field>
                    <Field label="Tanggal kedaluwarsa" error={errors?.expiryDate}>
                      <input type="date" min={todayWib()} className={inputCls} value={line.expiryDate} onChange={(event) => updateLine(line.key, 'expiryDate', event.target.value)} disabled={expiryLoading || !expiryRequired} />
                    </Field>
                    <Field label="Catatan baris (opsional)">
                      <input className={inputCls} maxLength={255} value={line.note} onChange={(event) => updateLine(line.key, 'note', event.target.value)} />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
          <Field label="Catatan penerimaan (opsional)">
            <textarea className={inputCls} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <ErrorNotice error={create.error} />
          <div className="flex justify-end gap-2">
            <button type="button" disabled={create.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
            <button type="submit" disabled={lines.length === 0 || expiryLoading || Boolean(expiryError) || create.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{create.isPending ? 'Memproses…' : expiryLoading ? 'Memuat produk…' : 'Konfirmasi penerimaan'}</button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

function GoodsReceiptDetailDialog({
  receiptId,
  onClose,
}: {
  receiptId: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [confirmPosting, setConfirmPosting] = useState(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const detail = useQuery({ queryKey: ['goods-receipt', receiptId], queryFn: () => goodsReceiptApi.get(receiptId) });
  const receipt = detail.data;
  const attachmentsOpen = receipt?.attachments_open ?? false;

  const upload = useMutation({
    mutationFn: () => {
      if (!attachmentFile) throw new Error('Pilih berkas lampiran terlebih dahulu.');
      return goodsReceiptApi.uploadAttachment(receiptId, attachmentFile);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['goods-receipt', receiptId] });
      setAttachmentFile(null);
      setAttachmentError('');
      if (attachmentInput.current) attachmentInput.current.value = '';
    },
  });
  const download = useMutation({
    mutationFn: (attachmentId: number) => goodsReceiptApi.downloadAttachment(receiptId, attachmentId),
    onSuccess: (blob, attachmentId) => {
      const attachment = receipt?.attachments.find((item) => item.id === attachmentId);
      if (!attachment) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const postReceipt = useMutation({
    mutationFn: () => goodsReceiptApi.post(receiptId),
    onSuccess: async () => {
      setConfirmPosting(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['goods-receipt', receiptId] }),
        qc.invalidateQueries({ queryKey: ['goods-receipts'] }),
        qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
        qc.invalidateQueries({ queryKey: ['purchase-requisitions'] }),
      ]);
    },
  });
  const mutationError = upload.error ?? download.error ?? postReceipt.error;
  const saving = upload.isPending || download.isPending || postReceipt.isPending;
  const canPost = (receipt?.status === 'draft' || receipt?.status === 'checked')
    && can('goods_receipt.create');

  return (
    <Modal title="Detail penerimaan" onClose={() => !saving && onClose()}>
      {detail.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat detail penerimaan…</p> : detail.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={detail.error} /></div>
      ) : receipt ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={mutationError} />
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Detail label="Nomor GR" value={receipt.doc_number} />
            <Detail label="Nomor PO" value={receipt.po_doc_number} />
            <Detail label="Supplier" value={receipt.supplier_name} />
            <div><div className="text-xs text-slate-500">Nama Kasir</div><div className="font-medium">{receipt.received_by_name}</div>{receipt.received_by_cashier_number && <div className="text-xs text-slate-500">{receipt.received_by_cashier_number}</div>}</div>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Detail label="Surat jalan" value={receipt.delivery_note_no || 'Belum dicatat'} />
            <Detail label="Faktur" value={receipt.invoice_no || 'Belum dicatat'} />
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Barang</th><th className="px-3 py-2 text-right">Barang bagus</th><th className="px-3 py-2 text-right">Barang rusak</th><th className="px-3 py-2 text-right">Belum diterima</th><th className="px-3 py-2">Tanggal kedaluwarsa</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receipt.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">{item.name}<div className="font-mono text-xs text-slate-500">{item.sku}</div></td>
                    <td className="px-3 py-2 text-right">{formatQty(item.qty_received)} {item.unit_name}</td>
                    <td className="px-3 py-2 text-right">{formatQty(item.qty_damaged)} {item.unit_name}</td>
                    <td className="px-3 py-2 text-right">{formatQty(item.qty_short)} {item.unit_name}</td>
                    <td className="px-3 py-2">{item.expiry_date ? formatDate(item.expiry_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {receipt.note && <p className="rounded-md bg-slate-50 p-3 text-sm">Catatan: {receipt.note}</p>}
          {canPost && (
            <section className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm">GR ini masih draft. Posting akan menambahkan jumlah diterima ke stok dan memperbarui PO.</p>
              {confirmPosting ? (
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={postReceipt.isPending} onClick={() => setConfirmPosting(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
                  <button type="button" disabled={postReceipt.isPending} onClick={() => postReceipt.mutate()} className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                    {postReceipt.isPending ? 'Memposting…' : 'Konfirmasi posting'}
                  </button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button type="button" onClick={() => setConfirmPosting(true)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Posting ke stok</button>
                </div>
              )}
            </section>
          )}
            <section className="space-y-3 rounded-md border border-slate-200 p-3">
              <div>
                <h3 className="text-sm font-semibold">Lampiran dokumen</h3>
                <p className="mt-1 text-xs text-slate-500">Format berkas: JPEG, PNG, WebP, atau PDF.</p>
              </div>
              {receipt.attachments.length > 0 ? (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
                  {receipt.attachments.map((attachment) => (
                    <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="break-all font-medium">{attachment.original_name}</div>
                        <div className="text-xs text-slate-500">
                          {attachment.mime_type} · {(attachment.size_bytes / 1024 / 1024).toFixed(2)} MB · {attachment.uploaded_by_name} · {formatDateTime(attachment.created_at)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={download.isPending}
                        onClick={() => download.mutate(attachment.id)}
                        className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {download.isPending && download.variables === attachment.id ? 'Mengunduh…' : 'Unduh'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-500">Belum ada lampiran.</p>}
              {attachmentsOpen && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Tambah lampiran">
                    <input
                      ref={attachmentInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className={`${inputCls} max-w-md`}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setAttachmentError(file && file.size > 10 * 1024 * 1024 ? 'Ukuran berkas maksimal 10 MB.' : '');
                        setAttachmentFile(file && file.size <= 10 * 1024 * 1024 ? file : null);
                      }}
                    />
                  </Field>
                  <button
                    type="button"
                    disabled={!attachmentFile || Boolean(attachmentError) || upload.isPending}
                    onClick={() => upload.mutate()}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {upload.isPending ? 'Mengunggah…' : 'Unggah'}
                  </button>
                </div>
              )}
              {attachmentError && <p role="alert" className="text-xs text-red-700">{attachmentError}</p>}
            </section>


        </div>
      ) : null}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-slate-500">{label}</div><div className="font-medium">{value}</div></div>;
}
