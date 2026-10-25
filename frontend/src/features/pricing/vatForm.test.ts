import { describe, expect, it } from 'vitest';
import type { VatSetting } from '@/lib/api/types';
import { buildVatInput, isVatDirty, validateVat, valuesFromVat } from './vatForm';

const off: VatSetting = { enabled: false, rate: null, price_includes_tax: null, effective_from: null };
const on: VatSetting = { enabled: true, rate: '11.00', price_includes_tax: false, effective_from: '2026-10-25' };

describe('validateVat', () => {
  it('nonaktif tidak perlu apa-apa', () => {
    expect(validateVat(valuesFromVat(off))).toEqual({});
  });
  it('aktif wajib tarif dan status harga termasuk PPN', () => {
    const e = validateVat({ enabled: true, rate: '', includes: null });
    expect(e.rate).toBeTruthy();
    expect(e.price_includes_tax).toBeTruthy();
  });
  it('tarif 0..100 dengan maks 2 desimal; koma diterima', () => {
    expect(validateVat({ enabled: true, rate: '11', includes: true })).toEqual({});
    expect(validateVat({ enabled: true, rate: '11,5', includes: false })).toEqual({});
    expect(validateVat({ enabled: true, rate: '0', includes: false })).toEqual({});
    expect(validateVat({ enabled: true, rate: '100', includes: false })).toEqual({});
    expect(validateVat({ enabled: true, rate: '101', includes: false }).rate).toBeTruthy();
    expect(validateVat({ enabled: true, rate: '11.123', includes: false }).rate).toBeTruthy();
    expect(validateVat({ enabled: true, rate: '-1', includes: false }).rate).toBeTruthy();
    expect(validateVat({ enabled: true, rate: 'abc', includes: false }).rate).toBeTruthy();
  });
});

describe('buildVatInput', () => {
  it('nonaktif hanya mengirim enabled: false', () => {
    expect(buildVatInput({ enabled: false, rate: '11', includes: true })).toEqual({ enabled: false });
  });
  it('aktif mengirim tarif ternormalisasi dan status harga', () => {
    expect(buildVatInput({ enabled: true, rate: '11,5', includes: true })).toEqual({ enabled: true, rate: '11.5', price_includes_tax: true });
    expect(buildVatInput({ enabled: true, rate: '11', includes: false })).toEqual({ enabled: true, rate: '11', price_includes_tax: false });
  });
  it('aktif tanpa pilihan harga melempar galat', () => {
    expect(() => buildVatInput({ enabled: true, rate: '11', includes: null })).toThrow();
  });
});

describe('isVatDirty', () => {
  it('tanpa perubahan', () => {
    expect(isVatDirty(valuesFromVat(on), on)).toBe(false);
    expect(isVatDirty(valuesFromVat(off), off)).toBe(false);
    expect(isVatDirty({ enabled: true, rate: '11', includes: false }, on)).toBe(false); // 11 = 11.00
  });
  it('perubahan saklar, tarif, atau mode harga', () => {
    expect(isVatDirty({ ...valuesFromVat(on), enabled: false }, on)).toBe(true);
    expect(isVatDirty({ ...valuesFromVat(on), rate: '12' }, on)).toBe(true);
    expect(isVatDirty({ ...valuesFromVat(on), includes: true }, on)).toBe(true);
    expect(isVatDirty({ enabled: true, rate: '11', includes: false }, off)).toBe(true);
  });
  it('nonaktif tidak membandingkan tarif lama', () => {
    expect(isVatDirty({ enabled: false, rate: '5', includes: true }, off)).toBe(false);
  });
});
