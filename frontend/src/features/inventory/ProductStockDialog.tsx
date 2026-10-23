import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '@/lib/api/endpoints';
import type { Product } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { Modal } from '@/components/ui/Modal';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ExpiryBadge } from '@/components/ui/ExpiryBadge';
import { formatDate, formatDateTime, formatQty, formatRupiah } from '@/lib/format';

export function ProductStockDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const { can } = useAuth();
  const showCost = can('inventory.adjust.approve'); // HPP hanya untuk Admin

  const query = useQuery({
    queryKey: ['inventory', 'stock', product.id],
    queryFn: () => inventoryApi.productStock(product.id),
  });
  const stock = query.data;

  return (
    <Modal title={`Stok & batch — ${product.name}`} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <ErrorNotice error={query.error} />
        {query.isLoading && <p className="text-slate-500">Memuat…</p>}

        {stock && (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Layak jual</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatQty(stock.totals.qty_sellable)} <span className="text-sm font-normal text-slate-500">{stock.unit_name}</span></dd>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Karantina</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatQty(stock.totals.qty_quarantine)}</dd>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Rusak</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatQty(stock.totals.qty_damaged)}</dd>
              </div>
            </dl>

            {showCost && (
              <p className="text-slate-600">HPP rata-rata: <span className="font-medium">{formatRupiah(stock.avg_cost)}</span></p>
            )}

            {stock.batches.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-slate-500">Belum ada stok untuk produk ini.</p>
            ) : (
              <div>
                <p className="mb-1 text-xs text-slate-500">Urutan dari atas = urutan dijual lebih dulu (FEFO). Kasir tidak memilih batch.</p>
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Batch</th>
                        <th className="px-3 py-2">Kadaluarsa</th>
                        <th className="px-3 py-2 text-right">Layak jual</th>
                        <th className="px-3 py-2 text-right">Karantina</th>
                        <th className="px-3 py-2 text-right">Rusak</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stock.batches.map((b) => (
                        <tr key={b.balance_id}>
                          <td className="px-3 py-2">
                            {b.batch_code ?? '—'}
                            <div className="text-xs text-slate-400">
                              {b.is_opening ? 'Stok awal' : 'Diterima'} · {formatDateTime(b.received_at)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {formatDate(b.expiry_date)}
                            <div className="mt-0.5"><ExpiryBadge status={b.expiry_status} /></div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatQty(b.qty_sellable)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatQty(b.qty_quarantine)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatQty(b.qty_damaged)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Link to={`/inventory/movements?product_id=${product.id}`} onClick={onClose} className="inline-block text-slate-700 underline">
              Lihat riwayat pergerakan
            </Link>
          </>
        )}
      </div>
    </Modal>
  );
}
