import { describe, expect, it } from 'vitest';
import type { Discount } from '@/lib/api/types';
import {
  buildDiscountCreate, buildDiscountUpdate, describeValue, emptyDiscount, isRealDate, validateDiscount, valuesFromDiscount,
} from './discountForm';

// 25 Okt 2026 00:00 WIB = 24 Okt 2026 17:00 UTC; berakhir 31 Okt 23:59:59.999 WIB = 31 Okt 16:59:59.999 UTC
const disc: Discount = {
  id: 1, name: 'Promo Akhir Bulan', target_type: 'product', target_id: 12, target_name: 'Air', discount_type: 'percent',
  value: '10.00', starts_at: '2026-10-24 17:00:00.000', ends_at: '2026-10-31 16:59:59.999', is_active: true, status: 'active',
};
const ok = { ...emptyDiscount(), name: 'Promo', targetId: 12, value: '10' };

describe('validateDiscount', () => {
  it('nama, target, dan nilai wajib saat tambah', () => {
    const e = validateDiscount(emptyDiscount(), 'create');
    expect(e.name).toBeTruthy();
    expect(e.target_id).toBeTruthy();
    expect(e.value).toBeTruthy();
  });
  it('target tidak diperiksa saat ubah', () => {
    expect(validateDiscount({ ...valuesFromDiscount(disc) }, 'edit').target_id).toBeUndefined();
  });
  it('nilai: > 0, maks 2 desimal, koma diterima, persen <= 100', () => {
    expect(validateDiscount({ ...ok, value: '0' }, 'create').value).toBeTruthy();
    expect(validateDiscount({ ...ok, value: '-5' }, 'create').value).toBeTruthy();
    expect(validateDiscount({ ...ok, value: '1.234' }, 'create').value).toBeTruthy();
    expect(validateDiscount({ ...ok, value: '12,5' }, 'create').value).toBeUndefined();
    expect(validateDiscount({ ...ok, value: '100' }, 'create').value).toBeUndefined();
    expect(validateDiscount({ ...ok, value: '100.01' }, 'create').value).toBeTruthy();
    expect(validateDiscount({ ...ok, discountType: 'amount', value: '2500' }, 'create').value).toBeUndefined();
  });
  it('tanggal: nyata dan akhir tidak sebelum mulai; mulai wajib saat ubah', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(validateDiscount({ ...ok, startsAt: '2026-02-30' }, 'create').starts_at).toBeTruthy();
    expect(validateDiscount({ ...ok, startsAt: '2026-11-10', endsAt: '2026-11-01' }, 'create').ends_at).toBeTruthy();
    expect(validateDiscount({ ...ok, startsAt: '2026-11-01', endsAt: '2026-11-01' }, 'create').ends_at).toBeUndefined();
    expect(validateDiscount({ ...valuesFromDiscount(disc), startsAt: '' }, 'edit').starts_at).toBeTruthy();
  });
});

describe('payload', () => {
  it('tambah: tanggal kosong dilewati, nilai ternormalisasi', () => {
    expect(buildDiscountCreate({ ...ok, name: ' Promo ', value: '12,5' })).toEqual({
      name: 'Promo', target_type: 'product', target_id: 12, discount_type: 'percent', value: '12.5',
    });
    expect(buildDiscountCreate({ ...ok, startsAt: '2026-11-01', endsAt: '2026-11-30' })).toEqual({
      name: 'Promo', target_type: 'product', target_id: 12, discount_type: 'percent', value: '10', starts_at: '2026-11-01', ends_at: '2026-11-30',
    });
  });
  it('tambah tanpa target melempar galat', () => {
    expect(() => buildDiscountCreate({ ...ok, targetId: null })).toThrow();
  });
  it('form dari diskon memakai tanggal WIB, bukan UTC', () => {
    const v = valuesFromDiscount(disc);
    expect(v.startsAt).toBe('2026-10-25');
    expect(v.endsAt).toBe('2026-10-31');
  });
  it('ubah tanpa perubahan = kosong (tanggal sama tidak dikirim ulang)', () => {
    expect(buildDiscountUpdate(valuesFromDiscount(disc), disc)).toEqual({});
  });
  it('nilai sama secara numerik tidak dianggap berubah', () => {
    expect(buildDiscountUpdate({ ...valuesFromDiscount(disc), value: '10' }, disc)).toEqual({});
  });
  it('hanya kolom yang berubah; mengosongkan tanggal akhir dikirim null', () => {
    const v = { ...valuesFromDiscount(disc), value: '15', endsAt: '', isActive: false };
    expect(buildDiscountUpdate(v, disc)).toEqual({ value: '15', ends_at: null, is_active: false });
  });
  it('ganti jenis selalu ikut mengirim nilai agar batas persen diperiksa server', () => {
    const v = { ...valuesFromDiscount(disc), discountType: 'amount' as const };
    expect(buildDiscountUpdate(v, disc)).toEqual({ discount_type: 'amount', value: '10.00' });
  });
});

describe('describeValue', () => {
  const rp = (v: string) => `Rp ${v}`;
  it('persen dan nominal per unit', () => {
    expect(describeValue('percent', '10.00', rp)).toBe('10%');
    expect(describeValue('percent', '12.50', rp)).toBe('12,5%');
    expect(describeValue('percent', '7.25', rp)).toBe('7,25%');
    expect(describeValue('amount', '500.00', rp)).toBe('Rp 500.00 / unit');
  });
});
