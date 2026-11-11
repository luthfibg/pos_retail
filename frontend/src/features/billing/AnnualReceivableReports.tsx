import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { billingApi } from '@/lib/api/endpoints';
import type { AnnualReceivableReport } from '@/lib/api/types';
import { formatRupiah } from '@/lib/format';

export function AnnualReceivableReports() {
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [printReport, setPrintReport] = useState<AnnualReceivableReport | null>(null);
  const clearPrintReport = useCallback(() => setPrintReport(null), []);
  const years = useQuery({
    queryKey: ['annual-receivable-report-years'],
    queryFn: billingApi.annualReportYears,
    refetchInterval: 60_000,
  });
  const report = useQuery({
    queryKey: ['annual-receivable-report', openYear],
    queryFn: () => billingApi.annualReport(openYear!),
    enabled: openYear !== null,
    refetchInterval: openYear === years.data?.current_year ? 30_000 : false,
  });
  const print = useMutation({
    mutationFn: billingApi.annualReport,
    onSuccess: setPrintReport,
  });

  useEffect(() => {
    if (openYear === null && years.data) setOpenYear(years.data.current_year);
  }, [openYear, years.data]);

  return (
    <>
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <ErrorNotice error={years.error ?? print.error} />
        {years.isLoading ? <p className="text-sm text-slate-500">Memuat laporan…</p> : years.data ? (
          <div className="divide-y divide-slate-200">
            {years.data.years.map((item) => {
              const isOpen = openYear === item.year;
              return (
                <section key={item.year} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenYear(isOpen ? null : item.year)}
                      className="min-h-11 flex-1 text-left font-semibold hover:text-slate-700"
                    >
                      {item.year}{item.is_current ? ' · Berjalan' : ''}
                    </button>
                    <button
                      type="button"
                      disabled={!item.print_enabled || print.isPending}
                      onClick={() => print.mutate(item.year)}
                      className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {print.isPending && print.variables === item.year ? 'Menyiapkan…' : 'Cetak'}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="pt-3">
                      {report.isLoading ? <p className="text-sm text-slate-500">Memuat laporan…</p> : report.error ? (
                        <ErrorNotice error={report.error} />
                      ) : report.data ? (
                        <AnnualReportSummary report={report.data} />
                      ) : null}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : null}
      </section>
      {printReport && <AnnualReportPrint report={printReport} onDone={clearPrintReport} />}
    </>
  );
}

function AnnualReportSummary({ report }: { report: AnnualReceivableReport }) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Metric label="Total tagihan" value={formatRupiah(report.totals.billed)} />
        <Metric label="Sudah dibayar" value={formatRupiah(report.totals.paid)} />
        <Metric label="Sisa piutang" value={formatRupiah(report.totals.outstanding)} />
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-2 pr-3">Karyawan</th>
              <th className="py-2 pr-3">Divisi/Bagian</th>
              <th className="py-2 pr-3 text-right">Transaksi</th>
              <th className="py-2 pr-3 text-right">Tagihan</th>
              <th className="py-2 pr-3 text-right">Dibayar</th>
              <th className="py-2 text-right">Sisa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.customers.map((customer) => (
              <tr key={customer.customer_id}>
                <td className="py-2 pr-3">
                  <span className="block font-medium">{customer.name}</span>
                  <span className="text-xs text-slate-500">{customer.customer_no}</span>
                </td>
                <td className="py-2 pr-3">{customer.department ?? '—'}</td>
                <td className="py-2 pr-3 text-right">{customer.sales_count}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right">{formatRupiah(customer.billed)}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right">{formatRupiah(customer.paid)}</td>
                <td className="whitespace-nowrap py-2 text-right font-medium">{formatRupiah(customer.outstanding)}</td>
              </tr>
            ))}
            {report.customers.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-slate-500">—</td></tr>
            )}
          </tbody>
          <tfoot className="border-t border-slate-300 font-semibold">
            <tr>
              <td className="py-2 pr-3" colSpan={3}>Total</td>
              <td className="whitespace-nowrap py-2 pr-3 text-right">{formatRupiah(report.totals.billed)}</td>
              <td className="whitespace-nowrap py-2 pr-3 text-right">{formatRupiah(report.totals.paid)}</td>
              <td className="whitespace-nowrap py-2 text-right">{formatRupiah(report.totals.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function AnnualReportPrint({ report, onDone }: { report: AnnualReceivableReport; onDone: () => void }) {
  useEffect(() => {
    window.addEventListener('afterprint', onDone, { once: true });
    const timer = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', onDone);
    };
  }, [onDone]);

  return (
    <div className="print-only print-doc annual-receivable-print">
      <article>
        <header className="mb-5 border-b-2 border-black pb-3">
          <h1 className="text-2xl font-bold">LAPORAN PIUTANG TAHUNAN {report.year}</h1>
          <p>Periode {report.start_date} – {report.end_date}</p>
        </header>
        <AnnualReportSummary report={report} />
      </article>
    </div>
  );
}
