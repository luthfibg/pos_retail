import type {
  ProductStock,
  SupplierReturnBucket,
  SupplierReturnInput,
} from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { qtyToMilli } from '@/lib/money';
import type { ProductOption } from '@/features/inventory/openingForm';

export interface SupplierReturnLine {
  key: number;
  product: ProductOption;
  sourceBucket: SupplierReturnBucket;
  qty: string;
  available: string;
}

export interface SupplierReturnFormErrors {
  general?: string;
  rows: Record<number, string>;
}

export function availableReturnQty(stock: ProductStock, sourceBucket: SupplierReturnBucket): string {
  const field = sourceBucket === 'sellable' ? 'qty_sellable' : 'qty_damaged';
  const total = stock.batches.reduce((sum, balance) => {
    if (stock.track_expiry && balance.batch_id === null) return sum;
    return sum + (qtyToMilli(balance[field]) ?? 0n);
  }, 0n);
  return `${total / 1000n}.${(total % 1000n).toString().padStart(3, '0')}`;
}

export function validateSupplierReturn(
  supplierId: number | null,
  rows: SupplierReturnLine[],
  note: string,
): SupplierReturnFormErrors {
  const errors: SupplierReturnFormErrors = { rows: {} };
  if (!supplierId) errors.general = 'Pilih supplier.';
  if (rows.length === 0) errors.general = 'Tambahkan minimal satu barang.';
  if (rows.length > 200) errors.general = 'Maksimal 200 baris per dokumen.';
  if (note.trim().length > 500) errors.general = 'Catatan maksimal 500 karakter.';

  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const available = qtyToMilli(row.available);
    const qty = qtyToMilli(row.qty);
    if (qty === null || qty <= 0n || qty > 99_999_000n) {
      errors.rows[index] = 'Qty harus lebih dari 0 dan maksimal 99.999, 3 desimal.';
    } else if (available === null || qty > available) {
      errors.rows[index] = 'Qty melebihi saldo bucket produk.';
    }

    const key = `${row.product.id}:${row.sourceBucket}`;
    if (seen.has(key)) errors.rows[index] = 'Produk dan bucket stok tidak boleh dicatat dua kali.';
    seen.add(key);
  });

  return errors;
}

export function buildSupplierReturnInput(
  supplierId: number,
  rows: SupplierReturnLine[],
  note: string,
): SupplierReturnInput {
  const input: SupplierReturnInput = {
    return_type: 'outgoing',
    supplier_id: supplierId,
    items: rows.map((row) => ({
      product_id: row.product.id,
      source_bucket: row.sourceBucket,
      qty: normalizeDecimal(row.qty),
    })),
  };
  if (note.trim()) input.note = note.trim();
  return input;
}
