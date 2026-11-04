import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatLocalDecimal, formatMonthYear, formatQty, formatRupiah, parseApiTime, parseLocalDecimal, toWibDate } from './format';

describe('format', () => {
  it('menampilkan rupiah tanpa desimal bila bulat', () => {
    expect(formatRupiah('3500.00').replace(/\s/g, ' ')).toBe('Rp 3.500');
  });
  it('menampilkan dua desimal bila pecahan', () => {
    expect(formatRupiah('3500.50')).toContain('3.500,50');
  });
  it('menampilkan rupiah dengan pemisah ribuan tanpa desimal nol yang tidak perlu', () => {
    expect(formatRupiah('6000.00')).toContain('6.000');
    expect(formatRupiah('6000.00')).not.toContain(',00');
    expect(formatRupiah('6000.50')).toContain('6.000,50');
  });
  it('null menjadi strip', () => {
    expect(formatRupiah(null)).toBe('—');
    expect(formatQty(undefined)).toBe('—');
  });
  it('qty membuang nol di belakang', () => {
    expect(formatQty('3.000')).toBe('3');
    expect(formatQty('12.500')).toBe('12,5');
  });

  it('waktu API tanpa zona dibaca sebagai UTC', () => {
    expect(parseApiTime('2026-10-23 03:15:00.123').toISOString()).toBe('2026-10-23T03:15:00.123Z');
    expect(parseApiTime('2026-10-23T03:15:00Z').toISOString()).toBe('2026-10-23T03:15:00.000Z');
  });
  it('menampilkan WIB (UTC+7)', () => {
    // 03:15 UTC = 10:15 WIB
    expect(formatDateTime('2026-10-23 03:15:00.000')).toMatch(/10[.:]15/);
  });
  it('tanggal murni tidak bergeser', () => {
    expect(formatDate('2027-03-01')).toContain('2027');
    expect(formatDate('2027-03-01')).toMatch(/\b1\b/);
    expect(formatDate(null)).toBe('—');
  });
  it('menampilkan bulan dan tahun periode tanpa menggeser tanggal', () => {
    expect(formatMonthYear('2026-10-01')).toBe('Oktober 2026');
    expect(formatMonthYear('2026-13-01')).toBe('—');
    expect(formatMonthYear(null)).toBe('—');
  });
});

describe('formatLocalDecimal', () => {
  it('menghilangkan nol pecahan yang tidak perlu dan memakai pemisah Indonesia', () => {
    expect(formatLocalDecimal('20.000', 'quantity')).toBe('20');
    expect(formatLocalDecimal('1250.500', 'quantity')).toBe('1.250,5');
    expect(formatLocalDecimal('6000.00', 'price')).toBe('6.000');
    expect(formatLocalDecimal('6000.50', 'price')).toBe('6.000,5');
  });

  it('menerjemahkan masukan lokal ke angka desimal kanonis untuk API', () => {
    expect(parseLocalDecimal('1.250,5')).toBe('1250.5');
    expect(parseLocalDecimal('20.000')).toBe('20000');
    expect(parseLocalDecimal('6000,50')).toBe('6000.50');
    expect(parseLocalDecimal('1.5')).toBe('1.5');
  });
});

describe('toWibDate', () => {
  it('batas hari WIB: 17:00 UTC adalah tengah malam WIB berikutnya', () => {
    expect(toWibDate('2026-10-24 17:00:00.000')).toBe('2026-10-25');
    expect(toWibDate('2026-10-25 16:59:59.999')).toBe('2026-10-25');
    expect(toWibDate('2026-10-25 03:00:00.000')).toBe('2026-10-25');
  });
  it('kosong atau tak terbaca menjadi string kosong', () => {
    expect(toWibDate(null)).toBe('');
    expect(toWibDate('bukan tanggal')).toBe('');
  });
});
