import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Modal } from '@/components/ui/Modal';
import { bankAccountApi, purchaseOrderApi, purchaseRequisitionApi, settingsApi, supplierApi } from '@/lib/api/endpoints';
import type { ApprovalAuthMode, PurchaseOrder, PurchaseOrderPaymentTerms, PurchaseOrderStatus, PurchaseRequisition, Supplier } from '@/lib/api/types';
import { formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { centsToMoney, lineCents, moneyToCents, qtyToMilli } from '@/lib/money';
import { useAuth } from '@/features/auth/AuthProvider';
import { PurchaseStageTracker } from './PurchaseStageTracker';
import { isPoPrintable, poStage } from './purchaseFlow';
import { PURCHASE_ORDER_PAYMENT_TERMS_LABEL, purchaseOrderTermsFromSupplier } from './paymentTerms';

export const ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  pending_confirmation: 'Menunggu konfirmasi Owner',
  approved: 'Disetujui',
  sent: 'Dikirim ke supplier',
  partially_received: 'Diterima sebagian',
  received: 'Sukses',
  cancelled: 'Dibatalkan',
};

type OrderLine = { selected: boolean; qty: string; price: string };
type Credentials = { approver_username: string; approver_password: string; approver_key: string };

function today(): string {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

async function loadActiveSuppliers(): Promise<Supplier[]> {
  const firstPage = await supplierApi.list({ active_only: true, per_page: 100 });
  if (firstPage.last_page === 1) return firstPage.data;

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.last_page - 1 }, (_, index) =>
      supplierApi.list({ active_only: true, per_page: 100, page: index + 2 }),
    ),
  );

  return [...firstPage.data, ...remainingPages.flatMap((page) => page.data)];
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
  const { me } = useAuth();
  const approvalMode: ApprovalAuthMode = me?.approval_auth_mode ?? 'password';
  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts', 'purchase-order'],
    queryFn: bankAccountApi.list,
  });
  const availability = useQuery({
    queryKey: ['purchase-requisition', pr.id, 'purchase-order-items'],
    queryFn: () => purchaseRequisitionApi.purchaseOrderItems(pr.id),
  });
  const supplierSelection = useQuery({
    queryKey: ['settings', 'purchase-order-supplier-selection'],
    queryFn: settingsApi.purchaseOrderSupplierSelection,
  });
  const masterSuppliers = useQuery({
    queryKey: ['suppliers', 'purchase-order'],
    queryFn: loadActiveSuppliers,
    enabled: supplierSelection.data?.mode === 'manual',
  });
  const rowsWithRemaining = availability.data?.items ?? [];
  const productSupplierOptions = useMemo(() => {
    const options = new Map<number, (typeof rowsWithRemaining)[number]['suppliers'][number]>();
    for (const item of rowsWithRemaining) {
      for (const supplier of item.suppliers) options.set(supplier.id, supplier);
    }
    return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rowsWithRemaining]);
  const automaticSupplierSelection = supplierSelection.data?.mode === 'product';
  const supplierOptions = automaticSupplierSelection
    ? productSupplierOptions
    : masterSuppliers.data ?? [];
  const autoSupplier = automaticSupplierSelection && supplierOptions.length === 1 ? supplierOptions[0] : null;
  const [supplierId, setSupplierId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [terms, setTerms] = useState<PurchaseOrderPaymentTerms>('cod');
  const [paymentTermDays, setPaymentTermDays] = useState('');
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
  useEffect(() => {
    if (!availability.data || !supplierSelection.data) return;
    setSupplierId((current) => {
      if (current && supplierOptions.some((supplier) => String(supplier.id) === current)) return current;
      return autoSupplier ? String(autoSupplier.id) : '';
    });
    if (autoSupplier) {
      setTerms(purchaseOrderTermsFromSupplier(autoSupplier.default_payment_terms));
      setPaymentTermDays('');
    }
  }, [availability.data, autoSupplier, supplierOptions, supplierSelection.data]);
  const chosenSupplierId = Number(supplierId);
  const availableItems = rowsWithRemaining.filter((item) =>
    item.suppliers.some((supplier) => supplier.id === chosenSupplierId),
  );
  const unmappedItems = rowsWithRemaining.filter((item) => item.suppliers.length === 0);
  const selectedLineCount = availableItems.filter((item) => lines[item.product_id]?.selected).length;
  const totalCents = availableItems.reduce((total, item) => {
    const line = lines[item.product_id];
    if (!line?.selected) return total;
    const quantity = qtyToMilli(line.qty);
    const price = moneyToCents(line.price);
    return quantity === null || price === null ? total : total + lineCents(quantity, price);
  }, 0n);
  const hasInvalidSelectedLine = availableItems.some((item) => {
    const line = lines[item.product_id];
    if (!line?.selected) return false;
    return qtyToMilli(line.qty) === null || moneyToCents(line.price) === null;
  });
  const orderTotal = centsToMoney(totalCents);
  const bankAccounts = bankAccountsQuery.data ?? [];
  const selectedBank = bankAccounts.find((account) => String(account.id) === bankAccountId);
  const create = useMutation({
    mutationFn: () => purchaseOrderApi.create({
      pr_id: pr.id,
      supplier_id: Number(supplierId),
      bank_account_id: Number(bankAccountId),
      approver_username: credentials.approver_username.trim(),
      ...(approvalMode !== 'key' ? { approver_password: credentials.approver_password } : {}),
      ...(approvalMode !== 'password' ? { approver_key: credentials.approver_key } : {}),
      payment_terms: terms,
      ...(terms === 'top' ? { payment_term_days: Number(paymentTermDays) } : {}),
      order_date: orderDate,
      expected_date: expectedDate || undefined,
      items: availableItems.flatMap((item) => {
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
    const supplier = supplierOptions.find((item) => String(item.id) === id);
    setTerms(purchaseOrderTermsFromSupplier(supplier?.default_payment_terms));
    setPaymentTermDays('');
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
        <ErrorNotice error={availability.error} />
        <ErrorNotice error={bankAccountsQuery.error} />
        <ErrorNotice error={supplierSelection.error ?? masterSuppliers.error} />
        <ErrorNotice error={create.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier">
            <select
              className={inputCls}
              required
              value={supplierId}
              onChange={(event) => chooseSupplier(event.target.value)}
              disabled={availability.isLoading || supplierSelection.isLoading || supplierSelection.isError || masterSuppliers.isLoading || masterSuppliers.isError || (automaticSupplierSelection && supplierOptions.length <= 1)}
            >
              <option value="">{supplierOptions.length === 0 ? (automaticSupplierSelection ? 'Tidak ada supplier produk' : 'Tidak ada supplier aktif') : 'Pilih supplier'}</option>
              {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
            </select>
          </Field>
          <Field label="Termin pembayaran">
            <select
              className={inputCls}
              value={terms}
              onChange={(event) => {
                const nextTerms = event.target.value as PurchaseOrderPaymentTerms;
                setTerms(nextTerms);
                if (nextTerms !== 'top') setPaymentTermDays('');
              }}
            >
              {(Object.keys(PURCHASE_ORDER_PAYMENT_TERMS_LABEL) as PurchaseOrderPaymentTerms[]).map((term) => (
                <option key={term} value={term}>{PURCHASE_ORDER_PAYMENT_TERMS_LABEL[term]}</option>
              ))}
            </select>
          </Field>
          {terms === 'top' && (
            <Field label="Jumlah hari TOP">
              <input
                className={inputCls}
                type="number"
                min={1}
                max={65535}
                step={1}
                required
                value={paymentTermDays}
                onChange={(event) => setPaymentTermDays(event.target.value)}
              />
            </Field>
          )}
          <Field label="Tanggal PO">
            <input className={inputCls} type="date" required value={orderDate} onChange={(event) => setOrderDate(event.target.value)} />
          </Field>
          <Field label="Permintaan tiba">
            <input className={inputCls} type="date" min={orderDate} value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
          </Field>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Item PO</h3>
          {availability.isLoading ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Memuat jumlah barang yang dapat dipesan…</p>
          ) : availability.error ? null : rowsWithRemaining.length === 0 ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Semua jumlah Permintaan sudah dialokasikan ke PO.</p>
          ) : productSupplierOptions.length === 0 ? (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Belum ada supplier aktif yang terhubung ke produk pada Permintaan ini.</p>
          ) : supplierId === '' ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Pilih supplier untuk melihat produk yang dapat dipesan.</p>
          ) : availableItems.length === 0 ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Tidak ada produk tersisa untuk supplier ini.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto">
              {availableItems.map((item) => {
                const line = lines[item.product_id] ?? { selected: false, qty: '', price: '' };
                return (
                  <div key={item.product_id} className="grid grid-cols-[auto_1fr_5.5rem_7rem] items-center gap-2 rounded-md border border-slate-200 p-2">
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
          {unmappedItems.length > 0 && <p className="text-sm text-amber-800">Sebagian produk belum memiliki supplier aktif di master produk.</p>}
        </section>

        <section className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <h3 className="font-semibold">Rekening Tercantum</h3>
            <span className="font-medium tabular-nums">Total PO: {formatRupiah(orderTotal)}</span>
          </div>
          <Field label="Pilih rekening">
            <select className={inputCls} required value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} disabled={bankAccountsQuery.isLoading || bankAccountsQuery.isError}>
              <option value="">{bankAccountsQuery.isLoading ? 'Memuat rekening…' : 'Pilih rekening'}</option>
              {bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.bank_name} · {account.account_name} ({account.account_number_masked})
                </option>
              ))}
            </select>
          </Field>
          {bankAccountsQuery.data && bankAccounts.length === 0 && <p className="text-xs text-amber-800">Belum ada rekening aktif.</p>}
        </section>

        <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <div>
            <h3 className="text-sm font-semibold">Persetujuan Owner</h3>
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
          <button type="submit" disabled={create.isPending || availability.isLoading || availability.isFetching || availability.isError || supplierId === '' || bankAccountsQuery.isLoading || bankAccountsQuery.isError || !selectedBank || selectedLineCount === 0 || hasInvalidSelectedLine || (terms === 'top' && !/^[1-9]\d*$/.test(paymentTermDays))} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
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
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['purchase-order', poId] }),
      qc.invalidateQueries({ queryKey: ['purchase-requisitions'] }),
    ]);
    onChanged();
  };
  const submit = useMutation({ mutationFn: () => purchaseOrderApi.submit(poId), onSuccess: refresh });
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
  const busy = submit.isPending || confirm.isPending || send.isPending;

  return (
    <Modal title="Kelola Purchase Order" onClose={() => !busy && onClose()}>
      {order.isLoading ? <p className="p-5 text-sm text-slate-500">Memuat PO…</p> : order.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={order.error} /></div>
      ) : po ? (
        <div className="space-y-4 p-5">
          <ErrorNotice error={submit.error ?? confirm.error ?? send.error} />
          <PurchaseStageTracker current={poStage(po.status)} />
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div><div className="text-xs text-slate-500">Nomor PO</div><div className="font-mono font-medium">{po.doc_number}</div></div>
            <div>
              <div className="text-xs text-slate-500">Status</div>
              <div className={`font-medium ${po.status === 'received' ? 'text-emerald-700' : ''}`}>{ORDER_STATUS_LABEL[po.status]}</div>
            </div>
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
          {po.bank_account && (
            <section className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
              <div className="font-semibold">Rekening tercantum</div>
              <div className="mt-1">{po.bank_account.bank_name} · {po.bank_account.account_name} ({po.bank_account.account_number_masked})</div>
            </section>
          )}
          {po.status === 'pending_confirmation' && can('purchase_requisition.approve') && (
            <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username Owner"><input className={inputCls} autoComplete="username" required value={credentials.approver_username} onChange={(event) => setCredentials({ ...credentials, approver_username: event.target.value })} /></Field>
                {approvalMode !== 'key' && <Field label="Password Owner"><input className={inputCls} type="password" autoComplete="current-password" required value={credentials.approver_password} onChange={(event) => setCredentials({ ...credentials, approver_password: event.target.value })} /></Field>}
                {approvalMode !== 'password' && <Field label="Kunci otorisasi Owner"><input className={inputCls} type="password" autoComplete="off" required value={credentials.approver_key} onChange={(event) => setCredentials({ ...credentials, approver_key: event.target.value })} /></Field>}
              </div>
            </section>
          )}
          {po.status === 'draft' && can('purchase_order.create') && (
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
              <button type="button" disabled={busy || !hasPrinted} onClick={() => send.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {send.isPending ? 'Menyimpan…' : 'Konfirmasi sudah dikirim ke supplier'}
              </button>
            </div>
          )}
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
