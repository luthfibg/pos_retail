import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { purchaseOrderApi, supplierApi } from '@/lib/api/endpoints';
import type { PurchaseOrder, PurchaseOrderStatus, PurchaseRequisition } from '@/lib/api/types';
import { formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthProvider';

const ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  pending_confirmation: 'Menunggu konfirmasi Owner',
  approved: 'Disetujui',
  sent: 'Dikirim ke supplier',
  partially_received: 'Diterima sebagian',
  received: 'Diterima lengkap',
  cancelled: 'Dibatalkan',
};

type OrderLine = { selected: boolean; qty: string; price: string };
type Credentials = { approver_username: string; approver_password: string };

function today(): string {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

export function PurchaseOrderCreateDialog({
  pr,
  onClose,
  onCreated,
}: {
  pr: PurchaseRequisition;
  onClose: () => void;
  onCreated: (po: PurchaseOrder) => void;
}) {
  const suppliers = useQuery({
    queryKey: ['suppliers', 'active-for-purchase-order'],
    queryFn: () => supplierApi.list({ active_only: true, per_page: 100 }),
  });
  const rowsWithRemaining = pr.items.filter((item) => Number(item.qty_remaining) > 0);
  const [supplierId, setSupplierId] = useState('');
  const [terms, setTerms] = useState<'prepaid' | 'credit' | 'cod'>('cod');
  const [orderDate, setOrderDate] = useState(today);
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<Record<number, OrderLine>>(() => Object.fromEntries(
    rowsWithRemaining.map((item) => [item.product_id, {
      selected: true,
      qty: String(item.qty_remaining),
      price: item.est_price === null ? '' : String(item.est_price),
    }]),
  ));
  const selectedLineCount = rowsWithRemaining.filter((item) => lines[item.product_id]?.selected).length;
  const create = useMutation({
    mutationFn: () => purchaseOrderApi.create({
      pr_id: pr.id,
      supplier_id: Number(supplierId),
      payment_terms: terms,
      order_date: orderDate,
      expected_date: expectedDate || undefined,
      items: rowsWithRemaining.flatMap((item) => {
        const line = lines[item.product_id];
        return line?.selected ? [{
          product_id: item.product_id,
          qty_ordered: line.qty,
          unit_price: line.price,
        }] : [];
      }),
    }),
    onSuccess: onCreated,
  });

  function chooseSupplier(id: string) {
    setSupplierId(id);
    const supplier = suppliers.data?.data.find((item) => String(item.id) === id);
    setTerms(supplier?.default_payment_terms ?? 'cod');
  }

  function updateLine(productId: number, patch: Partial<OrderLine>) {
    setLines((current) => ({
      ...current,
      [productId]: { selected: false, qty: '', price: '', ...current[productId], ...patch },
    }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Modal title={`Buat PO dari ${pr.doc_number}`} onClose={() => !create.isPending && onClose()}>
      <form className="space-y-4 p-5" onSubmit={submit}>
        <p className="text-sm text-slate-600">Buat PO per supplier. Kuantitas tidak boleh melebihi sisa permintaan pada PR.</p>
        <ErrorNotice error={suppliers.error} />
        <ErrorNotice error={create.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier">
            <select className={inputCls} required value={supplierId} onChange={(event) => chooseSupplier(event.target.value)} disabled={suppliers.isLoading}>
              <option value="">{suppliers.isLoading ? 'Memuat supplier…' : 'Pilih supplier'}</option>
              {suppliers.data?.data.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
            </select>
          </Field>
          <Field label="Termin pembayaran">
            <select className={inputCls} value={terms} onChange={(event) => setTerms(event.target.value as 'prepaid' | 'credit' | 'cod')}>
              <option value="prepaid">Prabayar</option>
              <option value="credit">Kredit</option>
              <option value="cod">Bayar saat terima (COD)</option>
            </select>
          </Field>
          <Field label="Tanggal PO">
            <input className={inputCls} type="date" required value={orderDate} onChange={(event) => setOrderDate(event.target.value)} />
          </Field>
          <Field label="Perkiraan tanggal tiba">
            <input className={inputCls} type="date" min={orderDate} value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
          </Field>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Item PO</h3>
          {rowsWithRemaining.length === 0 ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Semua jumlah PR sudah dialokasikan ke PO.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto">
              {rowsWithRemaining.map((item) => {
                const line = lines[item.product_id] ?? { selected: false, qty: '', price: '' };
                return (
                  <div key={item.product_id} className="grid grid-cols-[auto_1fr_5.5rem_7rem] items-end gap-2 rounded-md border border-slate-200 p-2">
                    <input type="checkbox" aria-label={`Pilih ${item.name}`} checked={line.selected} onChange={(event) => updateLine(item.product_id, { selected: event.target.checked })} />
                    <div className="min-w-0 text-sm">
                      <div className="truncate font-medium">{item.name}</div>
                      <div className="text-xs text-slate-500">Sisa {formatQty(item.qty_remaining)} {item.unit_name}</div>
                    </div>
                    <label className="text-xs text-slate-500">Jumlah
                      <input className={`${inputCls} mt-1 px-2`} type="number" min="0.001" max={item.qty_remaining} step="0.001" required={line.selected} disabled={!line.selected} value={line.qty} onChange={(event) => updateLine(item.product_id, { qty: event.target.value })} />
                    </label>
                    <label className="text-xs text-slate-500">Harga/unit
                      <input className={`${inputCls} mt-1 px-2`} type="number" min="0" step="0.01" required={line.selected} disabled={!line.selected} value={line.price} onChange={(event) => updateLine(item.product_id, { price: event.target.value })} />
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" disabled={create.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
          <button type="submit" disabled={create.isPending || selectedLineCount === 0} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {create.isPending ? 'Menyimpan…' : 'Simpan PO Draft'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PurchaseOrderManageDialog({
  poId,
  onClose,
  onChanged,
}: {
  poId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [credentials, setCredentials] = useState<Credentials>({ approver_username: '', approver_password: '' });
  const order = useQuery({ queryKey: ['purchase-order', poId], queryFn: () => purchaseOrderApi.get(poId) });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['purchase-order', poId] }),
      qc.invalidateQueries({ queryKey: ['purchase-requisitions'] }),
    ]);
    onChanged();
  };
  const submit = useMutation({ mutationFn: () => purchaseOrderApi.submit(poId), onSuccess: refresh });
  const confirm = useMutation({
    mutationFn: () => purchaseOrderApi.confirm(poId, credentials),
    onSuccess: () => { setCredentials({ approver_username: '', approver_password: '' }); return refresh(); },
  });
  const send = useMutation({ mutationFn: () => purchaseOrderApi.send(poId), onSuccess: refresh });
  const po = order.data;
  const busy = submit.isPending || confirm.isPending || send.isPending;

  return (
    <Modal title="Kelola Purchase Order" onClose={() => !busy && onClose()}>
      {order.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat PO…</p> : order.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={order.error} /></div>
      ) : po ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={submit.error ?? confirm.error ?? send.error} />
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div><div className="text-xs text-slate-500">Nomor PO</div><div className="font-mono font-medium">{po.doc_number}</div></div>
            <div><div className="text-xs text-slate-500">Status</div><div className="font-medium">{ORDER_STATUS_LABEL[po.status]}</div></div>
            <div><div className="text-xs text-slate-500">Supplier</div><div className="font-medium">{po.supplier_name}</div></div>
            <div><div className="text-xs text-slate-500">Total</div><div className="font-medium">{formatRupiah(po.total)}</div></div>
            <div><div className="text-xs text-slate-500">Tanggal PO</div><div>{po.order_date}</div></div>
            <div><div className="text-xs text-slate-500">Perkiraan tiba</div><div>{po.expected_date ?? '—'}</div></div>
            <div><div className="text-xs text-slate-500">Dibuat oleh</div><div>{po.created_by_name} · {formatDateTime(po.created_at)}</div></div>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[460px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Produk</th><th className="px-3 py-2 text-right">Jumlah</th><th className="px-3 py-2 text-right">Harga/unit</th><th className="px-3 py-2 text-right">Subtotal</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{po.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">{item.name}<div className="font-mono text-xs text-slate-500">{item.sku}</div></td>
                  <td className="px-3 py-2 text-right">{formatQty(item.qty_ordered)} {item.unit_name}</td>
                  <td className="px-3 py-2 text-right">{formatRupiah(item.unit_price)}</td>
                  <td className="px-3 py-2 text-right">{formatRupiah(item.line_total)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {po.status === 'pending_confirmation' && can('purchase_requisition.approve') && (
            <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm">PO memerlukan konfirmasi Owner. Masukkan kredensial pemberi persetujuan untuk autentikasi ulang.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username Owner"><input className={inputCls} autoComplete="username" required value={credentials.approver_username} onChange={(event) => setCredentials({ ...credentials, approver_username: event.target.value })} /></Field>
                <Field label="Password Owner"><input className={inputCls} type="password" autoComplete="current-password" required value={credentials.approver_password} onChange={(event) => setCredentials({ ...credentials, approver_password: event.target.value })} /></Field>
              </div>
            </section>
          )}
          {po.status === 'draft' && can('purchase_order.create') && (
            <button type="button" disabled={busy} onClick={() => submit.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {submit.isPending ? 'Mengajukan…' : 'Ajukan PO'}
            </button>
          )}
          {po.status === 'pending_confirmation' && can('purchase_requisition.approve') && (
            <button type="button" disabled={busy || !credentials.approver_username || !credentials.approver_password} onClick={() => confirm.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {confirm.isPending ? 'Mengonfirmasi…' : 'Konfirmasi Owner'}
            </button>
          )}
          {po.status === 'approved' && can('purchase_order.send') && (
            <button type="button" disabled={busy} onClick={() => send.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {send.isPending ? 'Mengirim…' : 'Tandai dikirim ke supplier'}
            </button>
          )}
          {po.status === 'sent' && <p className="text-sm text-slate-600">PO telah dikirim ke supplier.</p>}
        </div>
      ) : null}
    </Modal>
  );
}
