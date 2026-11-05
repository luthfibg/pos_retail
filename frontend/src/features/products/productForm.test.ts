import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/api/types';
import {
  buildCreatePayload, buildUpdatePayload, emptyValues, validateProduct, valuesFromProduct,
} from './productForm';

const admin = { canSetPrice: true, canSetCost: true, canActivate: true };
const kasir = { canSetPrice: false, canSetCost: false, canActivate: false };

const product: Product = {
  id: 1, sku: 'P-000001', barcode: '2000000000015', name: 'Teh Botol', category_id: 3,
  category_name: 'Minuman', unit_name: 'pcs', track_expiry: false, sell_price: '3500.00',
  unit_cost: '2000.0000',
  suppliers: [{ id: 8, code: 'SUP-8', name: 'Supplier Teh', is_active: true, default_payment_terms: 'cod' }],
  min_stock: '10.000', critical_stock: '3.000', restock_quantity: '24.000', status: 'active',
  stock_sellable: '12.000', stock_status: 'aman',
};

describe('validateProduct', () => {
  it('nama wajib', () => {
    expect(validateProduct(emptyValues(), 'create', admin).name).toBeTruthy();
  });
  it('kritis tidak boleh melebihi minimum', () => {
    const v = { ...emptyValues(), name: 'X', minStock: '5', criticalStock: '6' };
    expect(validateProduct(v, 'create', admin).critical_stock).toBeTruthy();
  });
  it('jumlah isi ulang dibatasi 99.999 unit dan tiga desimal', () => {
    const valid = { ...emptyValues(), name: 'X', restockQuantity: '99999' };
    const tooLarge = { ...emptyValues(), name: 'X', restockQuantity: '99999,001' };
    expect(validateProduct(valid, 'create', admin).restock_quantity).toBeUndefined();
    expect(validateProduct(tooLarge, 'create', admin).restock_quantity).toBeTruthy();
  });
  it('menerima koma desimal pada harga', () => {
    const v = { ...emptyValues(), name: 'X', sellPrice: '1500,50' };
    expect(validateProduct(v, 'create', admin).sell_price).toBeUndefined();
  });
  it('Harga Modal wajib lebih dari nol saat membuat produk dan mendukung empat desimal', () => {
    const empty = { ...emptyValues(), name: 'X' };
    const valid = { ...empty, unitCost: '1250,1234' };
    expect(validateProduct(empty, 'create', admin).unit_cost).toBeTruthy();
    expect(validateProduct(valid, 'create', admin).unit_cost).toBeUndefined();
  });
  it('aktifkan tanpa harga ditolak saat edit', () => {
    const noPrice = { ...product, sell_price: null, status: 'pending_price' as const };
    const v = { ...valuesFromProduct(noPrice), status: 'active' as const };
    expect(validateProduct(v, 'edit', admin, noPrice).status).toBeTruthy();
  });
});

describe('buildCreatePayload', () => {
  it('menyertakan supplier yang dipilih', () => {
    const v = { ...emptyValues(), name: 'Roti', supplierIds: [4, 9] };
    expect(buildCreatePayload(v, kasir).supplier_ids).toEqual([4, 9]);
  });

  it('Kasir tidak mengirim harga', () => {
    const v = { ...emptyValues(), name: ' Roti ', sellPrice: '5000', unitCost: '2000,1234' };
    const p = buildCreatePayload(v, kasir);
    expect(p.sell_price).toBeUndefined();
    expect(p.unit_cost).toBe('2000.1234');
    expect(p.restock_quantity).toBe('0');
    expect(p.name).toBe('Roti');
  });
  it('Admin mengirim harga ternormalisasi; sku/barcode kosong dilewati', () => {
    const v = { ...emptyValues(), name: 'Roti', sellPrice: '5000,5', unitCost: '2000' };
    const p = buildCreatePayload(v, admin);
    expect(p.sell_price).toBe('5000.5');
    expect(p.unit_cost).toBe('2000');
    expect('sku' in p).toBe(false);
    expect('barcode' in p).toBe(false);
  });
});

describe('buildUpdatePayload', () => {
  it('tanpa perubahan menghasilkan objek kosong', () => {
    expect(buildUpdatePayload(valuesFromProduct(product), product, admin)).toEqual({});
  });
  it('mengirimkan perubahan jumlah isi ulang saja', () => {
    const v = { ...valuesFromProduct(product), restockQuantity: '30' };
    expect(buildUpdatePayload(v, product, admin)).toEqual({ restock_quantity: '30' });
  });
  it('mengirimkan perubahan supplier saja', () => {
    const v = { ...valuesFromProduct(product), supplierIds: [9] };
    expect(buildUpdatePayload(v, product, admin)).toEqual({ supplier_ids: [9] });
  });
  it('mengirim Harga Modal yang dikoreksi hanya untuk pengguna berizin', () => {
    const v = { ...valuesFromProduct(product), unitCost: '2100' };
    expect(buildUpdatePayload(v, product, admin)).toEqual({ unit_cost: '2100' });
    expect(buildUpdatePayload(v, product, kasir)).toEqual({});
  });
  it('harga sama secara numerik tidak dianggap berubah', () => {
    const v = { ...valuesFromProduct(product), sellPrice: '3500' };
    expect(buildUpdatePayload(v, product, admin)).toEqual({});
  });
  it('hanya kolom yang berubah + alasan', () => {
    const v = { ...valuesFromProduct(product), sellPrice: '4000', reason: 'naik harga' };
    expect(buildUpdatePayload(v, product, admin)).toEqual({ sell_price: '4000', reason: 'naik harga' });
  });
  it('tanpa izin perubahan harga/Harga Modal dan aktivasi, tidak mengirim perubahan tersebut', () => {
    const v = { ...valuesFromProduct(product), name: 'Baru', sellPrice: '9999', status: 'inactive' as const };
    expect(buildUpdatePayload(v, product, kasir)).toEqual({ name: 'Baru' });
  });
});
