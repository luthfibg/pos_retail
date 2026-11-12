import { describe, expect, it } from 'vitest';
import type { OpnameReport } from '@/lib/api/types';
import { canFinish, formatCount, formatDiff, parseCount, shortMessage, varianceRows } from './opnameProcess';

describe('opnameProcess', () => {
  it('membaca hitungan dengan koma atau titik dan menolak isian tidak valid', () => {
    expect(parseCount('5')).toBe(5);
    expect(parseCount(' 2,5 ')).toBe(2.5);
    expect(parseCount('0.125')).toBe(0.125);
    expect(parseCount('')).toBe(null);
    expect(parseCount('-1')).toBe(null);
    expect(parseCount('1,2345')).toBe(null);
    expect(parseCount('abc')).toBe(null);
  });

  it('menampilkan hitungan tanpa nol di belakang koma', () => {
    expect(formatCount('5.000')).toBe('5');
    expect(formatCount('5.500')).toBe('5,5');
    expect(formatCount(null)).toBe('');
    expect(formatCount(undefined)).toBe('');
    expect(formatCount('x')).toBe('');
  });

  it('selesai hanya bila semua produk sudah dihitung', () => {
    expect(canFinish(0, 0)).toBe(false);
    expect(canFinish(3, 5)).toBe(false);
    expect(canFinish(5, 5)).toBe(true);
  });

  it('memendekkan pesan galat panjang', () => {
    expect(shortMessage(new Error('Gagal terhubung'), 'Gagal')).toBe('Gagal terhubung');
    expect(shortMessage(new Error('x'.repeat(100)), 'Gagal')).toBe('Gagal');
    expect(shortMessage({ firstError: () => 'Opname lain berjalan' }, 'Gagal')).toBe('Opname lain berjalan');
    expect(shortMessage('bukan error', 'Gagal')).toBe('Gagal');
    expect(shortMessage(null, 'Gagal')).toBe('Gagal');
  });

  it('meratakan produk berselisih dari semua kategori, bertanda dan berurutan', () => {
    const line = (item_id: number, name: string, diff_qty: string, direction: 'short' | 'over') => ({
      item_id, product_id: item_id, name, barcode: '', system_qty: '0', counted_qty: '0', diff_qty, direction, revised: false,
    });
    const report = {
      session: { id: 1, status: 'pending_approval' }, complete: true,
      categories: [{
        id: 1, name: 'A', products_counted: 3, variance_count: 2, short_qty: '0', over_qty: '0',
        lines: [line(2, 'Teh', '2.000', 'short'), line(9, 'Sama', '0.000', 'over')],
        children: [{ id: 2, name: 'B', products_counted: 1, variance_count: 1, short_qty: '0', over_qty: '0', lines: [line(1, 'Gula', '1.500', 'over')], children: [] }],
      }],
    } as OpnameReport;

    const rows = varianceRows(report);
    expect(rows.map((row) => [row.name, row.diff])).toEqual([['Gula', 1.5], ['Teh', -2]]);
    expect(rows.map((row) => formatDiff(row.diff))).toEqual(['+1,5', '−2']);
    expect(varianceRows(undefined)).toEqual([]);
  });
});
