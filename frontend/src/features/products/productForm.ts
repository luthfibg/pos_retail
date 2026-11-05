import type { Product, ProductInput, ProductStatus, ProductSupplier } from '@/lib/api/types';

/** Kemampuan pengguna yang memengaruhi form. Diturunkan dari permission; backend tetap memvalidasi. */
export interface ProductCaps {
  canSetPrice: boolean; // price.change
  canSetCost: boolean; // price.change
  canActivate: boolean; // product.activate
}

export interface ProductFormValues {
  sku: string;
  barcode: string;
  name: string;
  categoryId: string; // '' = tanpa kategori
  unitName: string;
  trackExpiry: boolean;
  sellPrice: string;
  unitCost: string;
  minStock: string;
  criticalStock: string;
  restockQuantity: string;
  supplierIds: number[];
  status: ProductStatus;
  reason: string;
}

export function sharedActiveSuppliers(products: Array<{ suppliers: ProductSupplier[] }>): ProductSupplier[] {
  if (products.length === 0) return [];
  const firstProductSuppliers = products[0]!.suppliers.filter((supplier) => supplier.is_active);
  const sharedIds = products.slice(1).reduce(
    (ids, product) => ids.filter((id) => product.suppliers.some((supplier) => supplier.is_active && supplier.id === id)),
    firstProductSuppliers.map((supplier) => supplier.id),
  );
  return firstProductSuppliers.filter((supplier) => sharedIds.includes(supplier.id));
}

export type FormErrors = Partial<Record<
  'sku' | 'barcode' | 'name' | 'category_id' | 'unit_name' | 'sell_price' | 'unit_cost' | 'min_stock' | 'critical_stock' | 'restock_quantity' | 'supplier_ids' | 'status',
  string
>>;

export type UpdatePayload = Partial<Omit<ProductInput, 'sku' | 'barcode'>> & {
  status?: 'active' | 'inactive';
  reason?: string;
};

export function emptyValues(): ProductFormValues {
  return {
    sku: '', barcode: '', name: '', categoryId: '', unitName: 'pcs', trackExpiry: false,
    sellPrice: '', unitCost: '', minStock: '0', criticalStock: '0', restockQuantity: '0', supplierIds: [], status: 'pending_price', reason: '',
  };
}

export function valuesFromProduct(p: Product): ProductFormValues {
  return {
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    categoryId: p.category_id === null ? '' : String(p.category_id),
    unitName: p.unit_name,
    trackExpiry: p.track_expiry,
    sellPrice: p.sell_price ?? '',
    unitCost: p.unit_cost,
    minStock: p.min_stock,
    criticalStock: p.critical_stock,
    restockQuantity: p.restock_quantity,
    supplierIds: p.suppliers.map((supplier) => supplier.id),
    status: p.status,
    reason: '',
  };
}

/** Terima koma desimal ala Indonesia ("1500,5") dan spasi. */
export function normalizeDecimal(s: string): string {
  return s.trim().replace(',', '.');
}

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,9}(\.\d{1,3})?$/;

export function validateProduct(
  v: ProductFormValues,
  mode: 'create' | 'edit',
  caps: ProductCaps,
  original?: Product,
): FormErrors {
  const e: FormErrors = {};

  if (!v.name.trim()) e.name = 'Nama produk wajib diisi.';
  else if (v.name.trim().length > 200) e.name = 'Maksimal 200 karakter.';

  if (!v.unitName.trim()) e.unit_name = 'Satuan wajib diisi.';
  else if (v.unitName.trim().length > 20) e.unit_name = 'Maksimal 20 karakter.';
  if (v.supplierIds.length === 0) e.supplier_ids = 'Pilih minimal satu supplier.';

  if (mode === 'create') {
    if (v.sku.trim() && !/^[A-Za-z0-9._-]{1,40}$/.test(v.sku.trim())) {
      e.sku = 'Hanya huruf, angka, titik, garis bawah, dan strip (maks. 40).';
    }
    if (v.barcode.trim() && !/^[A-Za-z0-9-]{1,64}$/.test(v.barcode.trim())) {
      e.barcode = 'Hanya huruf, angka, dan strip (maks. 64).';
    }
  }

  const price = normalizeDecimal(v.sellPrice);
  if (caps.canSetPrice && price && !PRICE_RE.test(price)) {
    e.sell_price = 'Harga tidak valid (maks. 2 desimal).';
  }

  const unitCost = normalizeDecimal(v.unitCost);
  const costChanged = original !== undefined && Number(original.unit_cost) !== Number(unitCost);
  if (mode === 'create' || (caps.canSetCost && costChanged)) {
    if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(unitCost) || Number(unitCost) <= 0) {
      e.unit_cost = 'Harga Modal wajib lebih dari 0 (maksimal 4 desimal).';
    }
  }

  const min = normalizeDecimal(v.minStock);
  const crit = normalizeDecimal(v.criticalStock);
  if (!min || !QTY_RE.test(min)) e.min_stock = 'Isi angka (maks. 3 desimal).';
  if (!crit || !QTY_RE.test(crit)) e.critical_stock = 'Isi angka (maks. 3 desimal).';
  if (!e.min_stock && !e.critical_stock && Number(crit) > Number(min)) {
    e.critical_stock = 'Batas kritis tidak boleh lebih besar dari batas minimum.';
  }
  const restock = normalizeDecimal(v.restockQuantity);
  const restockMatch = /^(\d+)(?:\.(\d{1,3}))?$/.exec(restock);
  const restockInteger = restockMatch?.[1]?.replace(/^0+(?=\d)/, '');
  if (
    !restockMatch
    || !restockInteger
    || restockInteger.length > 5
    || (restockInteger.length === 5 && restockInteger > '99999')
    || (restockInteger === '99999' && /[1-9]/.test(restockMatch[2] ?? ''))
  ) {
    e.restock_quantity = 'Isi angka 0–99.999 dengan maksimal 3 desimal.';
  }

  if (mode === 'edit' && v.status === 'active') {
    const hasPrice = caps.canSetPrice ? price !== '' : original?.sell_price != null;
    if (!hasPrice) e.status = 'Harga jual harus diisi sebelum produk diaktifkan.';
  }

  return e;
}

export function buildCreatePayload(v: ProductFormValues, caps: ProductCaps): ProductInput {
  const input: ProductInput = {
    name: v.name.trim(),
    unit_name: v.unitName.trim(),
    track_expiry: v.trackExpiry,
    min_stock: normalizeDecimal(v.minStock),
    critical_stock: normalizeDecimal(v.criticalStock),
    restock_quantity: normalizeDecimal(v.restockQuantity),
    unit_cost: normalizeDecimal(v.unitCost),
    supplier_ids: v.supplierIds,
  };
  if (v.sku.trim()) input.sku = v.sku.trim();
  if (v.barcode.trim()) input.barcode = v.barcode.trim();
  if (v.categoryId) input.category_id = Number(v.categoryId);
  // Harga hanya dikirim bila berwenang; tanpa harga produk berstatus pending_price.
  const price = normalizeDecimal(v.sellPrice);
  if (caps.canSetPrice && price) input.sell_price = price;
  return input;
}

const sameNumber = (a: string | null, b: string) => a !== null && Number(a) === Number(b);

/** Hanya kirim kolom yang berubah. Objek kosong = tidak ada perubahan (tidak perlu request). */
export function buildUpdatePayload(
  v: ProductFormValues,
  original: Product,
  caps: ProductCaps,
): UpdatePayload {
  const p: UpdatePayload = {};

  if (v.name.trim() !== original.name) p.name = v.name.trim();
  if (v.unitName.trim() !== original.unit_name) p.unit_name = v.unitName.trim();
  if (v.trackExpiry !== original.track_expiry) p.track_expiry = v.trackExpiry;

  const newCat = v.categoryId ? Number(v.categoryId) : null;
  if (newCat !== original.category_id) p.category_id = newCat;

  const min = normalizeDecimal(v.minStock);
  const crit = normalizeDecimal(v.criticalStock);
  if (!sameNumber(original.min_stock, min)) p.min_stock = min;
  if (!sameNumber(original.critical_stock, crit)) p.critical_stock = crit;

  const restock = normalizeDecimal(v.restockQuantity);
  if (!sameNumber(original.restock_quantity, restock)) p.restock_quantity = restock;
  const supplierIds = [...v.supplierIds].sort((a, b) => a - b);
  const originalSupplierIds = original.suppliers.map((supplier) => supplier.id).sort((a, b) => a - b);
  if (supplierIds.length !== originalSupplierIds.length || supplierIds.some((id, index) => id !== originalSupplierIds[index])) {
    p.supplier_ids = supplierIds;
  }

  const unitCost = normalizeDecimal(v.unitCost);
  if (caps.canSetCost && !sameNumber(original.unit_cost, unitCost)) p.unit_cost = unitCost;

  const price = normalizeDecimal(v.sellPrice);
  if (caps.canSetPrice && price && !sameNumber(original.sell_price, price)) p.sell_price = price;

  if (caps.canActivate && v.status !== original.status && v.status !== 'pending_price') {
    p.status = v.status;
  }

  if (Object.keys(p).length > 0 && v.reason.trim()) p.reason = v.reason.trim();
  return p;
}
