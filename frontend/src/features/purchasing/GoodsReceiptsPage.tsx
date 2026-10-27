import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { goodsReceiptApi, productApi, purchaseOrderApi } from '@/lib/api/endpoints';
import type { GoodsReceipt, GoodsReceiptStatus, PurchaseOrderItem } from '@/lib/api/types';
import { formatDate, formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { buildGoodsReceiptItems, validateGoodsReceiptLines, type GoodsReceiptLineErrors, type GoodsReceiptLineForm, type GoodsReceiptLineErrorMap } from './goodsReceiptForm';

const STATUS_LABEL: Record<GoodsReceiptStatus, string> = {
  draft: 'Draft',
  checked: 'Diperiksa',
  posted: 'Terposting',
  cancelled: 'Dibatalkan',
};

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
    batchCode: '',
    note: '',
  };
}

export function GoodsReceiptsPage() {
  const { can } = useAuth();
  const [poSearchValue, setPoSearchValue] = useState('');
  const [poSearch, setPoSearch] = useState('');
  const [poPage, setPoPage] = useState(1);
  const [receiptSearchValue, setReceiptSearchValue] = useState('');
  const [receiptSearch, setReceiptSearch] = useState('');
  const [receiptPage, setReceiptPage] = useState(1);
  const [createPoId, setCreatePoId] = useState<number | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);

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
        <p className="mt-1 text-sm text-slate-600">Terima barang dari PO yang dapat diproses. Stok bertambah setelah dokumen penerimaan diposting.</p>
      </header>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">PO yang dapat diterima</h2>
            <p className="text-xs text-slate-500">PO berstatus disetujui, dikirim, atau sebagian diterima.</p>
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
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Tanggal diharapkan</th>
                    <th className="px-3 py-2 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseOrders.data.data.map((po) => (
                    <tr key={po.id}>
                      <td className="px-3 py-2 font-mono font-medium">{po.doc_number}</td>
                      <td className="px-3 py-2">{po.supplier_name}</td>
                      <td className="px-3 py-2">{po.status === 'partially_received' ? 'Sebagian diterima' : po.status === 'approved' ? 'Disetujui' : 'Dikirim'}</td>
                      <td className="px-3 py-2">{po.expected_date ? formatDate(po.expected_date) : '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setCreatePoId(po.id)} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">Buat penerimaan</button>
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
            <h2 className="font-semibold">Riwayat penerimaan</h2>
            <p className="text-xs text-slate-500">Buka dokumen untuk melihat detail, memposting Draft, atau memverifikasi dokumen.</p>
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
                    <th className="px-3 py-2">Nomor GR</th>
                    <th className="px-3 py-2">PO / Supplier</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Dokumen</th>
                    <th className="px-3 py-2">Dibuat oleh</th>
                    <th className="px-3 py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receipts.data.data.map((receipt) => (
                    <tr key={receipt.id}>
                      <td className="px-3 py-2 font-mono font-medium">{receipt.doc_number}</td>
                      <td className="px-3 py-2">{receipt.po_doc_number}<div className="text-xs text-slate-500">{receipt.supplier_name}</div></td>
                      <td className="px-3 py-2">{STATUS_LABEL[receipt.status]}</td>
                      <td className="px-3 py-2">{receipt.document_status === 'verified' ? 'Terverifikasi' : 'Menunggu verifikasi'}</td>
                      <td className="px-3 py-2">{receipt.received_by_name}</td>
                      <td className="px-3 py-2"><button type="button" onClick={() => setSelectedReceiptId(receipt.id)} className="font-medium text-blue-700 hover:underline">Detail</button></td>
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
      {selectedReceiptId !== null && <GoodsReceiptDetailDialog receiptId={selectedReceiptId} canVerify={can('goods_receipt.verify_documents')} onClose={() => setSelectedReceiptId(null)} />}
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
  const [confirming, setConfirming] = useState(false);
  const lineSequence = useRef(0);
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
      setLines(po.data.items.filter((item) => item.qty_remaining !== '0.000').map((item) => emptyLine(item)));
      initialized.current = true;
    }
  }, [po.data]);

  const create = useMutation({
    mutationFn: () => goodsReceiptApi.create({
      po_id: poId,
      delivery_note_no: deliveryNoteNo.trim() || undefined,
      invoice_no: invoiceNo.trim() || undefined,
      note: note.trim() || undefined,
      post: false,
      items: buildGoodsReceiptItems(lines),
    }),
    onSuccess: async (receipt) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['goods-receipts'] }),
        qc.invalidateQueries({ queryKey: ['purchase-orders', 'receivable'] }),
        qc.invalidateQueries({ queryKey: ['purchase-order', poId] }),
      ]);
      onCreated(receipt);
    },
  });

  function review(event: FormEvent) {
    event.preventDefault();
    create.reset();
    const errors = po.data
      ? validateGoodsReceiptLines(po.data.items, lines, tracksExpiry, todayWib())
      : {};
    setLineErrors(errors);
    if (po.data && Object.keys(errors).length === 0 && !expiryLoading && !expiryError) setConfirming(true);
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
    <Modal title="Buat penerimaan barang" onClose={() => !create.isPending && onClose()}>
      {po.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat detail PO…</p> : po.error ? <div className="space-y-3 p-5"><ErrorNotice error={po.error} /></div> : po.data ? (
        <form onSubmit={review} noValidate className="space-y-4 p-5">
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
            <h3 className="text-sm font-semibold">Jumlah barang</h3>
            {lines.length === 0 ? <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Semua jumlah PO sudah diterima.</p> : null}
            {lines.map((line) => {
              const item = po.data!.items.find((candidate) => candidate.id === line.poItemId)!;
              const errors = lineErrors[line.key] as GoodsReceiptLineErrors | undefined;
              const expiryRequired = tracksExpiry[item.product_id];
              return (
                <div key={line.key} className="space-y-3 rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <div className="font-medium">{item.name}<span className="ml-2 font-mono text-xs text-slate-500">{item.sku}</span></div>
                      <div className="text-xs text-slate-600">Sisa PO: {formatQty(item.qty_remaining)} {item.unit_name}</div>
                    </div>
                    <div className="flex items-start gap-2">
                      <button type="button" onClick={() => setLines((current) => [...current, emptyLine(item, `${item.id}-${++lineSequence.current}`)])} className="text-xs font-medium text-blue-700 hover:underline">Tambah batch</button>
                      {lines.filter((candidate) => candidate.poItemId === item.id).length > 1 && <button type="button" onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))} className="text-xs text-red-700 hover:underline">Hapus baris</button>}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={`Diterima (${item.unit_name})`} error={errors?.qtyReceived}>
                      <input className={inputCls} inputMode="decimal" value={line.qtyReceived} onChange={(event) => updateLine(line.key, 'qtyReceived', event.target.value)} />
                    </Field>
                    <Field label={`Rusak (${item.unit_name})`} error={errors?.qtyDamaged}>
                      <input className={inputCls} inputMode="decimal" value={line.qtyDamaged} onChange={(event) => updateLine(line.key, 'qtyDamaged', event.target.value)} />
                    </Field>
                    <Field label="Tanggal kedaluwarsa" error={errors?.expiryDate} hint={expiryRequired ? 'Wajib untuk produk yang melacak kedaluwarsa.' : 'Kosongkan untuk produk tanpa pelacakan kedaluwarsa.'}>
                      <input type="date" min={todayWib()} className={inputCls} value={line.expiryDate} onChange={(event) => updateLine(line.key, 'expiryDate', event.target.value)} disabled={expiryLoading || !expiryRequired} />
                    </Field>
                    <Field label="Kode batch (opsional)">
                      <input className={inputCls} maxLength={60} value={line.batchCode} onChange={(event) => updateLine(line.key, 'batchCode', event.target.value)} />
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
          {confirming && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p>Dokumen penerimaan Draft akan dibuat. Stok belum bertambah sampai Draft diposting.</p>
              <div className="flex justify-end gap-2">
                <button type="button" disabled={create.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2">Periksa lagi</button>
                <button type="button" disabled={create.isPending || expiryLoading || Boolean(expiryError)} onClick={() => create.mutate()} className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">{create.isPending ? 'Menyimpan…' : 'Konfirmasi buat Draft'}</button>
              </div>
            </div>
          )}
          {!confirming && (
            <div className="flex justify-end gap-2">
              <button type="button" disabled={create.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
              <button type="submit" disabled={lines.length === 0 || expiryLoading || Boolean(expiryError) || create.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{expiryLoading ? 'Memuat produk…' : 'Periksa Draft'}</button>
            </div>
          )}
        </form>
      ) : null}
    </Modal>
  );
}

function GoodsReceiptDetailDialog({
  receiptId,
  canVerify,
  onClose,
}: {
  receiptId: number;
  canVerify: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [confirmAction, setConfirmAction] = useState<'post' | 'cancel' | 'verify' | null>(null);
  const detail = useQuery({ queryKey: ['goods-receipt', receiptId], queryFn: () => goodsReceiptApi.get(receiptId) });
  const receipt = detail.data;
  const attachmentsOpen = receipt !== undefined && receipt.status !== 'cancelled' && receipt.document_status !== 'verified';

  useEffect(() => {
    setDeliveryNoteNo(detail.data?.delivery_note_no ?? '');
    setInvoiceNo(detail.data?.invoice_no ?? '');
  }, [detail.data]);

  async function refresh(receipt: GoodsReceipt) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['goods-receipts'] }),
      qc.invalidateQueries({ queryKey: ['goods-receipt', receiptId] }),
      qc.invalidateQueries({ queryKey: ['purchase-orders', 'receivable'] }),
      qc.invalidateQueries({ queryKey: ['purchase-order', receipt.po_id] }),
    ]);
    setConfirmAction(null);
  }

  const post = useMutation({ mutationFn: () => goodsReceiptApi.post(receiptId), onSuccess: refresh, onError: () => setConfirmAction(null) });
  const cancel = useMutation({ mutationFn: () => goodsReceiptApi.cancel(receiptId), onSuccess: refresh, onError: () => setConfirmAction(null) });
  const verify = useMutation({
    mutationFn: () => goodsReceiptApi.verifyDocuments(receiptId, { delivery_note_no: deliveryNoteNo.trim(), invoice_no: invoiceNo.trim() }),
    onSuccess: refresh,
    onError: () => setConfirmAction(null),
  });
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
  const mutationError = post.error ?? cancel.error ?? verify.error ?? upload.error ?? download.error;
  const saving = post.isPending || cancel.isPending || verify.isPending || upload.isPending || download.isPending;

  return (
    <Modal title="Detail penerimaan" onClose={() => !saving && onClose()}>
      {detail.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat detail penerimaan…</p> : detail.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={detail.error} /></div>
      ) : receipt ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={mutationError} />
          {mutationError instanceof ApiError && mutationError.status === 422 && <p className="text-xs text-slate-500">Periksa kembali sisa PO dan kelengkapan dokumen; data mungkin telah berubah sejak penerimaan dibuat.</p>}
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Detail label="Nomor GR" value={receipt.doc_number} />
            <Detail label="Nomor PO" value={receipt.po_doc_number} />
            <Detail label="Supplier" value={receipt.supplier_name} />
            <Detail label="Status" value={STATUS_LABEL[receipt.status]} />
            <Detail label="Status dokumen" value={receipt.document_status === 'verified' ? 'Terverifikasi' : 'Menunggu verifikasi'} />
            <Detail label="Dibuat oleh" value={receipt.received_by_name} />
            <Detail label="Diposting" value={formatDateTime(receipt.posted_at)} />
            {receipt.verified_by_name && <Detail label="Diverifikasi oleh" value={`${receipt.verified_by_name} · ${formatDateTime(receipt.verified_at)}`} />}
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Detail label="Surat jalan" value={receipt.delivery_note_no || 'Belum dicatat'} />
            <Detail label="Faktur" value={receipt.invoice_no || 'Belum dicatat'} />
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Barang</th><th className="px-3 py-2 text-right">Diterima</th><th className="px-3 py-2 text-right">Rusak</th><th className="px-3 py-2">Batch / Kedaluwarsa</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receipt.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">{item.name}<div className="font-mono text-xs text-slate-500">{item.sku}</div></td>
                    <td className="px-3 py-2 text-right">{formatQty(item.qty_received)} {item.unit_name}</td>
                    <td className="px-3 py-2 text-right">{formatQty(item.qty_damaged)} {item.unit_name}</td>
                    <td className="px-3 py-2">{item.batch_code || '—'}{item.expiry_date && <div className="text-xs text-slate-500">Exp {formatDate(item.expiry_date)}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {receipt.note && <p className="rounded-md bg-slate-50 p-3 text-sm">Catatan: {receipt.note}</p>}

            <section className="space-y-3 rounded-md border border-slate-200 p-3">
              <div>
                <h3 className="text-sm font-semibold">Lampiran dokumen</h3>
                <p className="mt-1 text-xs text-slate-500">JPEG, PNG, WebP, atau PDF; maksimum 10 MB per berkas. Berkas disimpan privat.</p>
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

            {receipt.status === 'draft' && (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm">Draft belum mengubah stok. Posting akan menambahkan jumlah diterima ke stok, memperbarui sisa PO, dan tidak memasukkan jumlah rusak ke stok.</p>
              {confirmAction === 'post' ? (
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={post.isPending} onClick={() => setConfirmAction(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
                  <button type="button" disabled={post.isPending} onClick={() => post.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">{post.isPending ? 'Memposting…' : 'Konfirmasi posting'}</button>
                </div>
              ) : confirmAction === 'cancel' ? (
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={cancel.isPending} onClick={() => setConfirmAction(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Kembali</button>
                  <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate()} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white">{cancel.isPending ? 'Membatalkan…' : 'Konfirmasi pembatalan'}</button>
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmAction('cancel')} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Batalkan Draft</button>
                  <button type="button" onClick={() => setConfirmAction('post')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Posting penerimaan</button>
                </div>
              )}
            </div>
          )}

          {canVerify && receipt.status === 'posted' && receipt.document_status === 'pending' && (
            <form onSubmit={(event) => { event.preventDefault(); setConfirmAction('verify'); }} className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
              <h3 className="text-sm font-semibold">Verifikasi surat jalan dan faktur</h3>
              <p className="text-xs text-slate-600">Kedua nomor wajib diisi; verifikasi tersedia setelah penerimaan diposting.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nomor surat jalan"><input className={inputCls} maxLength={60} required value={deliveryNoteNo} onChange={(event) => setDeliveryNoteNo(event.target.value)} /></Field>
                <Field label="Nomor faktur"><input className={inputCls} maxLength={60} required value={invoiceNo} onChange={(event) => setInvoiceNo(event.target.value)} /></Field>
              </div>
              {confirmAction === 'verify' ? (
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={verify.isPending} onClick={() => setConfirmAction(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Periksa lagi</button>
                  <button type="button" disabled={verify.isPending || !deliveryNoteNo.trim() || !invoiceNo.trim()} onClick={() => verify.mutate()} className="rounded-md bg-blue-800 px-3 py-2 text-sm font-medium text-white">{verify.isPending ? 'Memverifikasi…' : 'Konfirmasi verifikasi'}</button>
                </div>
              ) : <div className="flex justify-end"><button type="submit" className="rounded-md bg-blue-800 px-3 py-2 text-sm font-medium text-white">Periksa dokumen</button></div>}
            </form>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-slate-500">{label}</div><div className="font-medium">{value}</div></div>;
}
