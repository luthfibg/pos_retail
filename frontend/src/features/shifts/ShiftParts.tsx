import type { ReactNode } from 'react';
import type { Shift, ShiftStatus } from '@/lib/api/types';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { SHIFT_STATUS_CLS, SHIFT_STATUS_LABEL, VARIANCE_CLS, VARIANCE_LABEL, varianceKind } from './shiftLogic';

export function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SHIFT_STATUS_CLS[status]}`}>
      {SHIFT_STATUS_LABEL[status]}
    </span>
  );
}

/** Selisih ditampilkan sebagai teks (Sesuai/Lebih/Kurang) + nominal, bukan hanya warna. */
export function VarianceText({ value }: { value: string | null }) {
  const kind = varianceKind(value);
  if (kind === 'unknown') return <span className="text-slate-400">—</span>;
  return (
    <span className={`font-medium ${VARIANCE_CLS[kind]}`}>
      {VARIANCE_LABEL[kind]}
      {kind !== 'zero' && <span className="tabular-nums"> {formatRupiah(value)}</span>}
    </span>
  );
}

export function ShiftFigures({ shift }: { shift: Shift }) {
  const s = shift.summary;
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  );
  return (
    <dl className="grid grid-cols-[11rem_1fr] gap-y-1.5 text-sm">
      {row('Kasir', shift.cashier_name)}
      {row('Dibuka', formatDateTime(shift.opened_at))}
      {shift.closed_at && row('Ditutup', formatDateTime(shift.closed_at))}
      {row('Saldo awal', formatRupiah(shift.opening_balance))}
      {row('Penjualan tunai', `${formatRupiah(s.cash_sales_total)} (${s.cash_sales_count} struk)`)}
      {row('Penjualan kredit karyawan', `${formatRupiah(s.credit_sales_total)} (${s.credit_sales_count} struk)`)}
      {row('Kas masuk lain', formatRupiah(s.cash_in))}
      {row('Kas keluar', formatRupiah(s.cash_out))}
      {shift.expected_cash !== null && row('Kas diharapkan', formatRupiah(shift.expected_cash))}
      {shift.counted_cash !== null && row('Kas terhitung', formatRupiah(shift.counted_cash))}
      {shift.variance !== null && row('Selisih', <VarianceText value={shift.variance} />)}
      {shift.variance_note && row('Keterangan selisih', <span className="whitespace-pre-wrap">{shift.variance_note}</span>)}
      {shift.reviewed_at && row('Ditinjau', formatDateTime(shift.reviewed_at))}
    </dl>
  );
}
