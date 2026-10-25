import { describe, expect, it } from 'vitest';
import {
  centsToMoney, compareMoney, lineCents, milliToQty, moneyToCents, qtyToMilli, subtractMoney,
} from './money';

describe('uang', () => {
  it('membaca dan menulis string uang tanpa float', () => {
    expect(moneyToCents('3500.00')).toBe(350000n);
    expect(moneyToCents('3500.5')).toBe(350050n);
    expect(moneyToCents('3500')).toBe(350000n);
    expect(moneyToCents('-0.01')).toBe(-1n);
    expect(centsToMoney(350050n)).toBe('3500.50');
    expect(centsToMoney(5n)).toBe('0.05');
    expect(centsToMoney(-1n)).toBe('-0.01');
  });
  it('menolak input tak valid', () => {
    expect(moneyToCents('1.234')).toBeNull();
    expect(moneyToCents('1,5')).toBeNull();
    expect(moneyToCents('abc')).toBeNull();
    expect(moneyToCents('')).toBeNull();
    expect(moneyToCents(null)).toBeNull();
  });
  it('angka besar tidak kehilangan ketelitian', () => {
    expect(centsToMoney(moneyToCents('999999999999.99') ?? 0n)).toBe('999999999999.99');
  });
  it('kurang dan banding', () => {
    expect(subtractMoney('50000', '27500.00')).toBe('22500.00');
    expect(subtractMoney('20000', '27500')).toBe('-7500.00');
    expect(subtractMoney('x', '1')).toBeNull();
    expect(compareMoney('10.00', '9.99')).toBe(1);
    expect(compareMoney('10', '10.00')).toBe(0);
    expect(compareMoney('1', '2')).toBe(-1);
    expect(compareMoney('1', 'z')).toBeNull();
  });
});

describe('qty dan total baris', () => {
  it('qty per seribu', () => {
    expect(qtyToMilli('12.5')).toBe(12500n);
    expect(qtyToMilli('3')).toBe(3000n);
    expect(qtyToMilli('0.001')).toBe(1n);
    expect(qtyToMilli('1.2345')).toBeNull();
    expect(qtyToMilli('-1')).toBeNull();
    expect(milliToQty(500n)).toBe('0.500');
    expect(milliToQty(99999000n)).toBe('99999.000');
  });
  it('total baris dibulatkan setengah ke atas seperti backend', () => {
    const price = moneyToCents('10000.00') ?? 0n;
    expect(centsToMoney(lineCents(qtyToMilli('0.5') ?? 0n, price))).toBe('5000.00');
    expect(centsToMoney(lineCents(qtyToMilli('2') ?? 0n, price))).toBe('20000.00');
    // 0.333 x 100.00 = 33.30
    expect(centsToMoney(lineCents(333n, 10000n))).toBe('33.30');
    // 0.001 x 0.50 = 0.0005 -> 0.00 ; 0.001 x 5.00 = 0.005 -> 0.01 (setengah ke atas)
    expect(centsToMoney(lineCents(1n, 50n))).toBe('0.00');
    expect(centsToMoney(lineCents(1n, 500n))).toBe('0.01');
  });
});
