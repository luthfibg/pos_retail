import type { MovementType } from '@/lib/api/types';

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  opening_balance: 'Stok awal',
  receipt: 'Penerimaan barang',
  putaway: 'Penempatan rak',
  transfer: 'Transfer',
  sale: 'Penjualan',
  sale_void: 'Pembatalan penjualan',
  customer_return: 'Retur pelanggan',
  supplier_return_out: 'Retur ke supplier',
  supplier_replacement_in: 'Penggantian supplier',
  adjustment: 'Adjustment',
  write_off: 'Penghapusan (write-off)',
};

export const BUCKET_LABEL: Record<string, string> = {
  sellable: 'layak jual',
  quarantine: 'karantina',
  damaged: 'rusak',
};

export const bucketLabel = (b: string | null) => (b ? BUCKET_LABEL[b] ?? b : '');

export type Direction = 'in' | 'out' | 'move';

/** Ada to_bucket saja = masuk; from_bucket saja = keluar; keduanya = pindah. */
export function directionOf(m: { from_bucket: string | null; to_bucket: string | null }): Direction {
  if (m.from_bucket && m.to_bucket) return 'move';
  if (m.from_bucket) return 'out';
  return 'in';
}
