import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/api/types';
import {
  buildCreatePayload, buildUpdatePayload, emptyValues, validateProduct, valuesFromProduct,
} from './productForm';

const admin = { canSetPrice: true, canActivate: true };
const kasir = { canSetPrice: false, canActivate: false };

const product: Product = {
  id: 1, sku: 'P-000001', barcode: '2000000000015', name: 'Teh Botol', category_id: 3,
  category_name: 'Minuman', unit_name: 'pcs', track_expiry: false, sell_price: '3500.00',
  avg_cost: '2000.00', min_stock: '10.000', critical_stock: '3.000', status: 'active',
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
  it('menerima koma desimal pada harga', () => {
    const v = { ...emptyValues(), name: 'X', sellPrice: '1500,50' };
    expect(validateProduct(v, 'create', admin).sell_price).toBeUndefined();
  });
  it('aktifkan tanpa harga ditolak saat edit', () => {
    const noPrice = { ...product, sell_price: null, status: 'pending_price' as const };
    const v = { ...valuesFromProduct(noPrice), status: 'active' as const };
    expect(validateProduct(v, 'edit', admin, noPrice).status).toBeTruthy();
  });
});

describe('buildCreatePayload', () => {
  it('Kasir tidak mengirim harga', () => {
    const v = { ...emptyValues(), name: ' Roti ', sellPrice: '5000' };
    const p = buildCreatePayload(v, kasir);
    expect(p.sell_price).toBeUndefined();
    expect(p.name).toBe('Roti');
  });
  it('Admin mengirim harga ternormalisasi; sku/barcode kosong dilewati', () => {
    const v = { ...emptyValues(), name: 'Roti', sellPrice: '5000,5' };
    const p = buildCreatePayload(v, admin);
    expect(p.sell_price).toBe('5000.5');
    expect('sku' in p).toBe(false);
    expect('barcode' in p).toBe(false);
  });
});

describe('buildUpdatePayload', () => {
  it('tanpa perubahan menghasilkan objek kosong', () => {
    expect(buildUpdatePayload(valuesFromProduct(product), product, admin)).toEqual({});
  });
  it('harga sama secara numerik tidak dianggap berubah', () => {
    const v = { ...valuesFromProduct(product), sellPrice: '3500' };
    expect(buildUpdatePayload(v, product, admin)).toEqual({});
  });
  it('hanya kolom yang berubah + alasan', () => {
    const v = { ...valuesFromProduct(product), sellPrice: '4000', reason: 'naik harga' };
    expect(buildUpdatePayload(v, product, admin)).toEqual({ sell_price: '4000', reason: 'naik harga' });
  });
  it('tanpa price.change/product.activate, harga dan status tidak dikirim', () => {
    const v = { ...valuesFromProduct(product), name: 'Baru', sellPrice: '9999', status: 'inactive' as const };
    expect(buildUpdatePayload(v, product, kasir)).toEqual({ name: 'Baru' });
  });
});
