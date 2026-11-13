import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { inventoryApi } from '@/lib/api/endpoints';
import type { Product } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { Modal } from '@/components/ui/Modal';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { formatDate, formatDateTime, formatQty, formatRupiah } from '@/lib/format';

export function ProductStockDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const { can } = useAuth();
  const showCost = can('inventory.adjust.approve'); // HPP hanya untuk Admin

  const query = useQuery({
    queryKey: ['inventory', 'stock', product.id],
    queryFn: () => inventoryApi.productStock(product.id),
  });
  const [movementPage, setMovementPage] = useState(1);
  const movementQuery = useQuery({
    queryKey: ['inventory', 'stock-card-movements', product.id, movementPage],
    queryFn: () => inventoryApi.stockCardMovements(product.id, movementPage, 7),
    placeholderData: keepPreviousData,
  });
  const stock = query.data;

  return (
    <Modal title={`Kartu stok — ${product.name}`} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <ErrorNotice error={query.error} />
        <ErrorNotice error={movementQuery.error} />
        {query.isLoading && <p className="text-slate-500">Memuat…</p>}

        {stock && (
          <>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Barang bagus</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatQty(stock.totals.qty_sellable)} <span className="text-sm font-normal text-slate-500">{stock.unit_name}</span></dd>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Barang rusak</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatQty(stock.totals.qty_damaged)}</dd>
              </div>
            </dl>

            {showCost && (
              <p className="text-slate-600">Harga Modal: <span className="font-medium">{formatRupiah(stock.unit_cost)}</span></p>
            )}

            {movementQuery.isPending ? (
              <p className="text-slate-500">Memuat riwayat masuk-keluar…</p>
            ) : movementQuery.data?.data.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-slate-500">Belum ada data masuk-keluar untuk jenis transaksi ini.</p>
            ) : movementQuery.data ? (
              <div>
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2" rowSpan={2}>Tanggal</th>
                        <th className="px-3 py-2" rowSpan={2}>Kedaluwarsa</th>
                        <th className="px-3 py-2 text-center" colSpan={2}>Masuk</th>
                        <th className="px-3 py-2 text-center" colSpan={2}>Keluar</th>
                      </tr>
                      <tr>
                        <th className="px-3 py-2 text-right">Barang bagus</th>
                        <th className="px-3 py-2 text-right">Barang rusak</th>
                        <th className="px-3 py-2 text-right">Retur</th>
                        <th className="px-3 py-2 text-right">Penjualan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {movementQuery.data.data.map((movement) => (
                        <tr key={`${movement.reference_type}:${movement.reference_id}:${movement.expiry_date ?? 'none'}`}>
                          <td className="whitespace-nowrap px-3 py-2">{formatDateTime(movement.occurred_at)}</td>
                          <td className="whitespace-nowrap px-3 py-2">{formatDate(movement.expiry_date)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatQty(movement.good_in)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatQty(movement.damaged_in)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatQty(movement.return_out)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatQty(movement.sale_out)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                  <span>Halaman {movementQuery.data.current_page} dari {movementQuery.data.last_page} · {movementQuery.data.total} transaksi</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={movementQuery.data.current_page <= 1 || movementQuery.isFetching}
                      onClick={() => setMovementPage((page) => page - 1)}
                      className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
                    >
                      Sebelumnya
                    </button>
                    <button
                      type="button"
                      disabled={movementQuery.data.current_page >= movementQuery.data.last_page || movementQuery.isFetching}
                      onClick={() => setMovementPage((page) => page + 1)}
                      className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
                    >
                      Berikutnya
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              null
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
