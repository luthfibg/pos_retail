import type { Sale } from '@/lib/api/types';
import { formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { moneyToCents } from '@/lib/money';

export type ThermalPaperSize = '58' | '80';

const nonZero = (v: string): boolean => (moneyToCents(v) ?? 0n) !== 0n;

/**
 * Struk dari respons server (tidak ada perhitungan di klien). Lebar tetap kecil agar dekat dengan kertas
 * thermal; cetak lewat CSS print browser (menu dan tombol memakai kelas `no-print`).
 */
export function ReceiptView({ sale, paperSize = '80' }: { sale: Sale; paperSize?: ThermalPaperSize }) {
  const r = sale.receipt;
  const credit = sale.payment_mode === 'payroll_credit';

  return (
    <div className={`receipt receipt-${paperSize} mx-auto w-full max-w-[22rem] rounded-lg border border-slate-200 bg-white p-4 font-mono text-xs leading-5`}>
      {r.is_void && (
        <div className="mb-2 border-2 border-red-700 py-1 text-center text-sm font-bold text-red-700">{r.void_label ?? 'DIBATALKAN'}</div>
      )}
      {r.is_copy && (
        <div className="mb-2 border border-slate-700 py-0.5 text-center font-bold">{r.copy_label ?? 'SALINAN'}</div>
      )}

      <div className="text-center">
        <div className="text-sm font-bold">{r.store_name ?? 'POS Retail SMK'}</div>
        <div>{sale.doc_number}</div>
        <div>{formatDateTime(sale.posted_at)}</div>
        <div>Kasir: {sale.cashier_name ?? '—'}</div>
      </div>

      {credit && sale.customer_name && (
        <div className="mt-2 border-t border-dashed border-slate-400 pt-2">
          Karyawan: {sale.customer_name}
          {sale.customer_no ? ` (${sale.customer_no})` : ''}
        </div>
      )}

      <div className="mt-2 space-y-1 border-t border-dashed border-slate-400 pt-2">
        {sale.items.map((i) => (
          <div key={i.id}>
            <div>{i.name}</div>
            <div className="flex justify-between tabular-nums">
              <span>{formatQty(i.qty)} {i.unit_name} × {formatRupiah(i.unit_price)}</span>
              <span>{formatRupiah(i.line_total)}</span>
            </div>
            {nonZero(i.discount_amount) && (
              <div className="flex justify-between tabular-nums text-slate-600">
                <span>Diskon</span>
                <span>-{formatRupiah(i.discount_amount)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 space-y-0.5 border-t border-dashed border-slate-400 pt-2 tabular-nums">
        <div className="flex justify-between"><span>Subtotal</span><span>{formatRupiah(sale.subtotal)}</span></div>
        {nonZero(sale.discount_total) && (
          <div className="flex justify-between"><span>Diskon</span><span>-{formatRupiah(sale.discount_total)}</span></div>
        )}
        {nonZero(sale.tax_amount) && (
          <div className="flex justify-between"><span>PPN{sale.tax_rate ? ` ${formatQty(sale.tax_rate)}%` : ''}</span><span>{formatRupiah(sale.tax_amount)}</span></div>
        )}
        <div className="print-payment-method flex justify-between"><span>Metode</span><span>{sale.payment_mode === 'cash' ? 'Tunai' : 'Kredit potong gaji'}</span></div>
        <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{formatRupiah(sale.total)}</span></div>
        {sale.payment && (
          <>
            <div className="flex justify-between"><span>Tunai</span><span>{formatRupiah(sale.payment.amount_tendered)}</span></div>
            <div className="flex justify-between"><span>Kembali</span><span>{formatRupiah(sale.payment.change_given)}</span></div>
          </>
        )}
      </div>

      {sale.over_limit && <div className="mt-2 text-center font-bold">** MELEBIHI BATAS KREDIT **</div>}
      {r.note && <div className="mt-2 text-center">{r.note}</div>}
      <div className="mt-3 text-center">Terima kasih</div>
    </div>
  );
}
