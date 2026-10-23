import { describe, expect, it } from 'vitest';
import { formatQty, formatRupiah } from './format';

describe('format', () => {
  it('menampilkan rupiah tanpa desimal bila bulat', () => {
    expect(formatRupiah('3500.00').replace(/\s/g, ' ')).toBe('Rp 3.500');
  });
  it('menampilkan dua desimal bila pecahan', () => {
    expect(formatRupiah('3500.50')).toContain('3.500,50');
  });
  it('null menjadi strip', () => {
    expect(formatRupiah(null)).toBe('—');
    expect(formatQty(undefined)).toBe('—');
  });
  it('qty membuang nol di belakang', () => {
    expect(formatQty('3.000')).toBe('3');
    expect(formatQty('12.500')).toBe('12,5');
  });
});
