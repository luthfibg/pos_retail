import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { purchaseFundApi } from '@/lib/api/endpoints';
import { formatRupiah } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthProvider';

const emptyAccount = {
  bank_name: '',
  account_name: '',
  account_number: '',
  opening_balance: '0',
  reason: '',
};

export function PurchaseFundPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [account, setAccount] = useState(emptyAccount);
  const [adjustment, setAdjustment] = useState({ accountId: '', direction: 'increase' as 'increase' | 'decrease', amount: '', reason: '' });
  const summary = useQuery({
    queryKey: ['purchase-fund'],
    queryFn: purchaseFundApi.summary,
    enabled: can('purchase_fund.view') || can('purchase_fund.allocate'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['purchase-fund'] });
  const create = useMutation({
    mutationFn: () => purchaseFundApi.createBankAccount(account),
    onSuccess: () => {
      setAccount(emptyAccount);
      return refresh();
    },
  });
  const adjust = useMutation({
    mutationFn: () => purchaseFundApi.adjustBankAccount(Number(adjustment.accountId), {
      direction: adjustment.direction,
      amount: adjustment.amount,
      reason: adjustment.reason,
    }),
    onSuccess: () => {
      setAdjustment({ accountId: '', direction: 'increase', amount: '', reason: '' });
      return refresh();
    },
  });

  function submitAccount(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  function submitAdjustment(event: FormEvent) {
    event.preventDefault();
    adjust.mutate();
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold">Kas Pembelian & rekening bank</h2>
        <p className="mt-1 text-xs text-slate-600">
          Saldo rekening dicatat manual. Alokasi hanya mencadangkan dana di sistem dan bukan transfer bank.
        </p>
      </div>
      <ErrorNotice error={summary.error ?? create.error ?? adjust.error} />
      {summary.isLoading ? <p className="text-sm text-slate-500">Memuat saldo…</p> : summary.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Saldo Kas Pembelian</div>
              <div className="mt-1 font-semibold tabular-nums">{formatRupiah(summary.data.balance)}</div>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Dialokasikan ke PO aktif</div>
              <div className="mt-1 font-semibold tabular-nums">{formatRupiah(summary.data.reserved_total)}</div>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Rekening</th>
                  <th className="px-3 py-2 text-right">Saldo tercatat</th>
                  <th className="px-3 py-2 text-right">Dicadangkan</th>
                  <th className="px-3 py-2 text-right">Tersedia untuk alokasi</th>
                  {can('bank_account.manage') && <th className="px-3 py-2">Penyesuaian</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.data.bank_accounts.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.bank_name} · {item.account_name}</div>
                      <div className="text-xs text-slate-500">{item.account_number_masked}{item.is_active ? '' : ' · Nonaktif'}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(item.balance)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(item.reserved_for_purchase_fund)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatRupiah(item.available_balance)}</td>
                    {can('bank_account.manage') && (
                      <td className="px-3 py-2">
                        {item.is_active && <button
                          type="button"
                          className="text-xs font-medium text-blue-700 underline"
                          onClick={() => setAdjustment((current) => ({ ...current, accountId: String(item.id) }))}
                        >
                          Sesuaikan saldo
                        </button>}
                      </td>
                    )}
                  </tr>
                ))}
                {summary.data.bank_accounts.length === 0 && (
                  <tr><td className="px-3 py-4 text-center text-slate-500" colSpan={can('bank_account.manage') ? 5 : 4}>Belum ada rekening bank.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {adjustment.accountId && can('bank_account.manage') && (
            <form className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2" onSubmit={submitAdjustment}>
              <div className="sm:col-span-2 text-sm font-medium">
                Penyesuaian manual · {summary.data.bank_accounts.find((item) => String(item.id) === adjustment.accountId)?.bank_name}
              </div>
              <Field label="Jenis penyesuaian">
                <select className={inputCls} value={adjustment.direction} onChange={(event) => setAdjustment({ ...adjustment, direction: event.target.value as 'increase' | 'decrease' })}>
                  <option value="increase">Tambah saldo</option>
                  <option value="decrease">Kurangi saldo</option>
                </select>
              </Field>
              <Field label="Jumlah">
                <LocalDecimalInput className={inputCls} kind="price" required value={adjustment.amount} onChange={(amount) => setAdjustment({ ...adjustment, amount })} />
              </Field>
              <Field label="Alasan" >
                <input className={inputCls} required maxLength={255} value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} />
              </Field>
              <div className="flex items-end gap-2">
                <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" disabled={adjust.isPending} onClick={() => setAdjustment({ accountId: '', direction: 'increase', amount: '', reason: '' })}>Batal</button>
                <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={adjust.isPending}>
                  {adjust.isPending ? 'Menyimpan…' : 'Simpan penyesuaian'}
                </button>
              </div>
            </form>
          )}
          {can('bank_account.manage') && (
            <details className="rounded-md border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium">Tambah rekening bank</summary>
              <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={submitAccount}>
                <Field label="Nama bank">
                  <input className={inputCls} required maxLength={100} value={account.bank_name} onChange={(event) => setAccount({ ...account, bank_name: event.target.value })} />
                </Field>
                <Field label="Nama pemilik rekening">
                  <input className={inputCls} required maxLength={150} value={account.account_name} onChange={(event) => setAccount({ ...account, account_name: event.target.value })} />
                </Field>
                <Field label="Nomor rekening">
                  <input className={inputCls} required maxLength={60} value={account.account_number} onChange={(event) => setAccount({ ...account, account_number: event.target.value })} />
                </Field>
                <Field label="Saldo awal">
                  <LocalDecimalInput className={inputCls} kind="price" required value={account.opening_balance} onChange={(opening_balance) => setAccount({ ...account, opening_balance })} />
                </Field>
                <Field label="Alasan pencatatan saldo awal">
                  <input className={inputCls} required maxLength={255} value={account.reason} onChange={(event) => setAccount({ ...account, reason: event.target.value })} />
                </Field>
                <div className="sm:col-span-2">
                  <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={create.isPending}>
                    {create.isPending ? 'Menyimpan…' : 'Simpan rekening'}
                  </button>
                </div>
              </form>
            </details>
          )}
        </>
      )}
    </section>
  );
}
