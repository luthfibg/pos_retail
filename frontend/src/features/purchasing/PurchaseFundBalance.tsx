import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { purchaseFundApi } from '@/lib/api/endpoints';
import { formatRupiah } from '@/lib/format';

/**
 * Saldo Kas Pembelian ringkas untuk header papan pembelian.
 * Rincian rekening bank, penyesuaian saldo, dan total alokasi PO tidak ditampilkan di sini.
 */
export function PurchaseFundBalance() {
  const { can } = useAuth();
  const summary = useQuery({
    queryKey: ['purchase-fund'],
    queryFn: purchaseFundApi.summary,
    enabled: can('purchase_fund.view') || can('purchase_fund.allocate'),
  });

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-right" aria-live="polite">
      <div className="text-xs text-slate-500">Saldo Kas Pembelian</div>
      {summary.isError ? (
        <div className="max-w-56 text-xs text-red-700">{summary.error instanceof Error ? summary.error.message : 'Saldo gagal dimuat.'}</div>
      ) : (
        <div className="font-semibold tabular-nums">{summary.data ? formatRupiah(summary.data.balance) : 'Memuat…'}</div>
      )}
    </div>
  );
}
