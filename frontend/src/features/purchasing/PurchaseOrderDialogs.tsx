import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Modal } from '@/components/ui/Modal';
import { purchaseFundApi, purchaseOrderApi, purchaseRequisitionApi, supplierApi } from '@/lib/api/endpoints';
import type { ApprovalAuthMode, PurchaseOrder, PurchaseOrderStatus, PurchaseRequisition } from '@/lib/api/types';
import { formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { centsToMoney, compareMoney, lineCents, moneyToCents, qtyToMilli } from '@/lib/money';
import { useAuth } from '@/features/auth/AuthProvider';
import { PurchaseStageTracker } from './PurchaseStageTracker';
import { isPoPrintable, poStage } from './purchaseFlow';

export const ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  pending_confirmation: 'Menunggu konfirmasi Owner',
  approved: 'Disetujui',
  sent: 'Dikirim ke supplier',
  partially_received: 'Diterima sebagian',
  received: 'Diterima lengkap',
  cancelled: 'Dibatalkan',
};

type OrderLine = { selected: boolean; qty: string; price: string };
type Credentials = { approver_username: string; approver_password: string; approver_key: string };

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
  const { can, me } = useAuth();
  const approvalMode: ApprovalAuthMode = me?.approval_auth_mode ?? 'password';
  const suppliers = useQuery({
    queryKey: ['suppliers', 'active-for-purchase-order'],
    queryFn: () => supplierApi.list({ active_only: true, per_page: 100 }),
  });
  const fund = useQuery({
    queryKey: ['purchase-fund'],
    queryFn: purchaseFundApi.summary,
    enabled: can('purchase_fund.allocate'),
  });
  const availability = useQuery({
    queryKey: ['purchase-requisition', pr.id, 'purchase-order-items'],
    queryFn: () => purchaseRequisitionApi.purchaseOrderItems(pr.id),
  });
  const rowsWithRemaining = availability.data?.items ?? [];
  const [supplierId, setSupplierId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [terms, setTerms] = useState<'prepaid' | 'credit' | 'cod'>('cod');
  const [orderDate, setOrderDate] = useState(today);
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<Record<number, OrderLine>>({});
  const [credentials, setCredentials] = useState<Credentials>({ approver_username: '', approver_password: '', approver_key: '' });
  const initializedAvailability = useRef(false);
  useEffect(() => {
    if (!availability.data || initializedAvailability.current) return;
    setLines(Object.fromEntries(availability.data.items.map((item) => [item.product_id, {
      selected: true,
      qty: String(item.qty_available),
      price: item.est_price === null ? '' : String(item.est_price),
    }])));
    initializedAvailability.current = true;
  }, [availability.data]);
  const selectedLineCount = rowsWithRemaining.filter((item) => lines[item.product_id]?.selected).length;
  const totalCents = rowsWithRemaining.reduce((total, item) => {
    const line = lines[item.product_id];
    if (!line?.selected) return total;
    const quantity = qtyToMilli(line.qty);
    const price = moneyToCents(line.price);
    return quantity === null || price === null ? total : total + lineCents(quantity, price);
  }, 0n);
  const hasInvalidSelectedLine = rowsWithRemaining.some((item) => {
    const line = lines[item.product_id];
    if (!line?.selected) return false;
    return qtyToMilli(line.qty) === null || moneyToCents(line.price) === null;
  });
  const orderTotal = centsToMoney(totalCents);
  const bankAccounts = fund.data?.bank_accounts.filter((account) => account.is_active) ?? [];
  const selectedBank = bankAccounts.find((account) => String(account.id) === bankAccountId);
  const selectedBankCanCover = selectedBank !== undefined && compareMoney(selectedBank.available_balance, orderTotal) !== -1;
  const create = useMutation({
    mutationFn: () => purchaseOrderApi.create({
      pr_id: pr.id,
      supplier_id: Number(supplierId),
      bank_account_id: Number(bankAccountId),
      approver_username: credentials.approver_username.trim(),
      ...(approvalMode !== 'key' ? { approver_password: credentials.approver_password } : {}),
      ...(approvalMode !== 'password' ? { approver_key: credentials.approver_key } : {}),
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
    <Modal title={`Buat PO dari Permintaan ${pr.doc_number}`} onClose={() => !create.isPending && onClose()}>
      <form className="space-y-4 p-5" onSubmit={submit}>
        <p className="text-sm text-slate-600">Pilih barang, sumber dana, lalu otorisasi Owner. PO langsung dibuat dan disetujui tanpa draft atau tahap persetujuan Owner terpisah.</p>
        <ErrorNotice error={suppliers.error} />
        <ErrorNotice error={availability.error} />
        <ErrorNotice error={fund.error} />
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
          {availability.isLoading ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Memuat jumlah barang yang dapat dipesan…</p>
          ) : availability.error ? null : rowsWithRemaining.length === 0 ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Semua jumlah Permintaan sudah dialokasikan ke PO.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto">
              {rowsWithRemaining.map((item) => {
                const line = lines[item.product_id] ?? { selected: false, qty: '', price: '' };
                return (
                  <div key={item.product_id} className="grid grid-cols-[auto_1fr_5.5rem_7rem] items-end gap-2 rounded-md border border-slate-200 p-2">
                    <input type="checkbox" aria-label={`Pilih ${item.name}`} checked={line.selected} onChange={(event) => updateLine(item.product_id, { selected: event.target.checked })} />
                    <div className="min-w-0 text-sm">
                      <div className="truncate font-medium">{item.name}</div>
                      <div className="text-xs text-slate-500">Maks. dapat dipesan: {formatQty(item.qty_available)} {item.unit_name}</div>
                    </div>
                    <label className="text-xs text-slate-500">Jumlah
                      <LocalDecimalInput className={`${inputCls} mt-1 px-2`} kind="quantity" required={line.selected} disabled={!line.selected} value={line.qty} onChange={(value) => updateLine(item.product_id, { qty: value })} aria-label={`Jumlah ${item.name}`} />
                    </label>
                    <label className="text-xs text-slate-500">Harga/unit
                      <LocalDecimalInput className={`${inputCls} mt-1 px-2`} kind="price" required={line.selected} disabled={!line.selected} value={line.price} onChange={(value) => updateLine(item.product_id, { price: value })} aria-label={`Harga per unit ${item.name}`} />
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <h3 className="font-semibold">Rekening sumber dana</h3>
            <span className="font-medium tabular-nums">Total PO: {formatRupiah(orderTotal)}</span>
          </div>
          <p className="text-xs text-slate-600">Seluruh total PO dicadangkan dari rekening terpilih setelah Owner mengesahkan. Pencadangan ini bukan transfer bank.</p>
          <Field label="Pilih rekening dengan saldo tersedia yang cukup">
            <select className={inputCls} required value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} disabled={fund.isLoading || fund.isError}>
              <option value="">{fund.isLoading ? 'Memuat rekening…' : 'Pilih rekening'}</option>
              {bankAccounts.map((account) => {
                const enough = compareMoney(account.available_balance, orderTotal) !== -1;
                return (
                  <option key={account.id} value={account.id} disabled={!enough}>
                    {account.bank_name} · {account.account_name} ({account.account_number_masked}) · tersedia {formatRupiah(account.available_balance)}{enough ? '' : ' · tidak cukup'}
                  </option>
                );
              })}
            </select>
          </Field>
          {fund.data && bankAccounts.length === 0 && <p className="text-xs text-amber-800">Belum ada rekening aktif. Tambahkan rekening sebelum membuat PO.</p>}
          {fund.data && bankAccounts.length > 0 && !bankAccounts.some((account) => compareMoney(account.available_balance, orderTotal) !== -1) && (
            <p className="text-xs text-amber-800">Saldo tersedia semua rekening aktif belum mencukupi total PO.</p>
          )}
        </section>

        <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <div>
            <h3 className="text-sm font-semibold">Persetujuan Owner</h3>
            <p className="mt-1 text-xs text-slate-600">Otorisasi ini sekaligus mengesahkan supplier, jumlah, harga, dan rekening sumber dana.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Username Owner">
              <input className={inputCls} autoComplete="username" required value={credentials.approver_username} onChange={(event) => setCredentials({ ...credentials, approver_username: event.target.value })} />
            </Field>
            {approvalMode !== 'key' && <Field label="Password Owner">
              <input className={inputCls} type="password" autoComplete="current-password" required value={credentials.approver_password} onChange={(event) => setCredentials({ ...credentials, approver_password: event.target.value })} />
            </Field>}
            {approvalMode !== 'password' && <Field label="Kunci otorisasi Owner">
              <input className={inputCls} type="password" autoComplete="off" required value={credentials.approver_key} onChange={(event) => setCredentials({ ...credentials, approver_key: event.target.value })} />
            </Field>}
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" disabled={create.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
          <button type="submit" disabled={create.isPending || availability.isLoading || availability.isFetching || availability.isError || fund.isLoading || fund.isError || selectedLineCount === 0 || hasInvalidSelectedLine || !selectedBankCanCover} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {create.isPending ? 'Membuat PO…' : 'Setujui & buat PO'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PurchaseOrderManageDialog({
  poId,
  hasPrinted = false,
  onClose,
  onChanged,
  onPrint,
}: {
  poId: number;
  hasPrinted?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onPrint?: (po: PurchaseOrder) => void;
}) {
  const qc = useQueryClient();
  const { can, me } = useAuth();
  const approvalMode: ApprovalAuthMode = me?.approval_auth_mode ?? 'password';
  const [credentials, setCredentials] = useState<Credentials>({ approver_username: '', approver_password: '', approver_key: '' });
  const order = useQuery({ queryKey: ['purchase-order', poId], queryFn: () => purchaseOrderApi.get(poId) });
  const fund = useQuery({
    queryKey: ['purchase-fund'],
    queryFn: purchaseFundApi.summary,
    enabled: poId > 0 && can('purchase_fund.allocate'),
  });
  const [bankAccountId, setBankAccountId] = useState('');
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['purchase-order', poId] }),
      qc.invalidateQueries({ queryKey: ['purchase-requisitions'] }),
      qc.invalidateQueries({ queryKey: ['purchase-fund'] }),
    ]);
    onChanged();
  };
  const submit = useMutation({ mutationFn: () => purchaseOrderApi.submit(poId), onSuccess: refresh });
  const allocate = useMutation({ mutationFn: () => purchaseFundApi.allocate(poId, Number(bankAccountId)), onSuccess: refresh });
  const confirm = useMutation({
    mutationFn: () => purchaseOrderApi.confirm(poId, {
      approver_username: credentials.approver_username.trim(),
      ...(approvalMode !== 'key' ? { approver_password: credentials.approver_password } : {}),
      ...(approvalMode !== 'password' ? { approver_key: credentials.approver_key } : {}),
    }),
    onSuccess: () => { setCredentials({ approver_username: '', approver_password: '', approver_key: '' }); return refresh(); },
  });
  const send = useMutation({ mutationFn: () => purchaseOrderApi.send(poId), onSuccess: refresh });
  const po = order.data;
  const busy = submit.isPending || confirm.isPending || send.isPending || allocate.isPending;

  return (
    <Modal title="Kelola Purchase Order" onClose={() => !busy && onClose()}>
      {order.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat PO…</p> : order.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={order.error} /></div>
      ) : po ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={submit.error ?? confirm.error ?? send.error ?? allocate.error ?? fund.error} />
          <PurchaseStageTracker current={poStage(po.status)} archivedNote="PO ini dibatalkan dan tidak lagi berjalan di alur pembelian." />
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
          {po.fund_allocation && (
            <section className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
              <div className="font-semibold">Dana PO sudah dialokasikan</div>
              <div className="mt-1">
                {po.fund_allocation.bank_name} · {po.fund_allocation.account_name} ({po.fund_allocation.account_number_masked})
                {' · '}{formatRupiah(po.fund_allocation.amount)}
              </div>
              <p className="mt-1 text-xs">Pencatatan ini hanya mencadangkan dana di sistem, bukan bukti transfer bank.</p>
            </section>
          )}
          {po.status === 'draft' && can('purchase_fund.allocate') && !po.fund_allocation && (
            <section className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
              <div>
                <h3 className="text-sm font-semibold">Alokasi Kas Pembelian</h3>
                <p className="mt-1 text-xs text-slate-600">Kebutuhan dana dihitung otomatis dari total PO sebesar {formatRupiah(po.total)}. Pilih rekening dengan saldo tersedia yang cukup; alokasi hanya pencadangan sistem, bukan transfer bank.</p>
              </div>
              <Field label="Rekening sumber">
                <select className={inputCls} value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} disabled={fund.isLoading}>
                  <option value="">{fund.isLoading ? 'Memuat rekening…' : 'Pilih rekening'}</option>
                  {fund.data?.bank_accounts.filter((account) => account.is_active).map((account) => {
                    const enough = compareMoney(account.available_balance, po.total ?? '0') !== -1;
                    return (
                      <option key={account.id} value={account.id} disabled={!enough}>
                        {account.bank_name} · {account.account_name} ({account.account_number_masked}) · tersedia {formatRupiah(account.available_balance)}{enough ? '' : ' · tidak cukup'}
                      </option>
                    );
                  })}
                </select>
              </Field>
              <button type="button" disabled={busy || !bankAccountId} onClick={() => allocate.mutate()} className="rounded-md bg-blue-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {allocate.isPending ? 'Mengalokasikan…' : 'Alokasikan dana PO'}
              </button>
            </section>
          )}
          {po.status === 'draft' && can('purchase_fund.allocate') && !po.fund_allocation
            && fund.data?.bank_accounts.every((account) => !account.is_active || compareMoney(account.available_balance, po.total ?? '0') === -1)
            && <p className="text-xs text-amber-800">Tidak ada rekening aktif dengan saldo tersedia yang cukup. Minta Finance/Admin memeriksa saldo rekening atau lakukan penyesuaian manual yang diaudit.</p>}
          {po.status === 'pending_confirmation' && can('purchase_requisition.approve') && (
            <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm">PO memerlukan konfirmasi Owner. Masukkan kredensial pemberi persetujuan untuk autentikasi ulang.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username Owner"><input className={inputCls} autoComplete="username" required value={credentials.approver_username} onChange={(event) => setCredentials({ ...credentials, approver_username: event.target.value })} /></Field>
                {approvalMode !== 'key' && <Field label="Password Owner"><input className={inputCls} type="password" autoComplete="current-password" required value={credentials.approver_password} onChange={(event) => setCredentials({ ...credentials, approver_password: event.target.value })} /></Field>}
                {approvalMode !== 'password' && <Field label="Kunci otorisasi Owner"><input className={inputCls} type="password" autoComplete="off" required value={credentials.approver_key} onChange={(event) => setCredentials({ ...credentials, approver_key: event.target.value })} /></Field>}
              </div>
            </section>
          )}
          {po.status === 'draft' && (can('purchase_order.create') || can('purchase_fund.allocate')) && (
            <button type="button" disabled={busy} onClick={() => submit.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {submit.isPending ? 'Mengajukan…' : 'Ajukan PO'}
            </button>
          )}
          {po.status === 'pending_confirmation' && can('purchase_requisition.approve') && (
            <button type="button" disabled={busy || !credentials.approver_username || (approvalMode !== 'key' && !credentials.approver_password) || (approvalMode !== 'password' && !credentials.approver_key)} onClick={() => confirm.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {confirm.isPending ? 'Mengonfirmasi…' : 'Konfirmasi Owner'}
            </button>
          )}
          {po.status === 'approved' && can('purchase_order.send') && (
            <div className="space-y-2">
              {!hasPrinted && <p className="text-sm text-amber-800">Cetak PO terlebih dahulu. Tombol pengiriman aktif setelah dialog cetak ditutup.</p>}
              <button type="button" disabled={busy || !hasPrinted} onClick={() => send.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {send.isPending ? 'Menyimpan…' : 'Konfirmasi sudah dikirim ke supplier'}
              </button>
            </div>
          )}
          {po.status === 'sent' && <p className="text-sm text-slate-600">PO telah dikirim ke supplier.</p>}
          {onPrint && isPoPrintable(po.status) && (
            <div className="flex justify-end border-t border-slate-100 pt-3">
              <button type="button" onClick={() => onPrint(po)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">{po.status === 'approved' && hasPrinted ? 'Cetak ulang PO' : 'Cetak PO'}</button>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
