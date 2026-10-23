import { describe, expect, it } from 'vitest';
import { canSell, varianceKind } from './shiftLogic';

describe('varianceKind', () => {
  it('nol dalam berbagai bentuk', () => {
    expect(varianceKind('0.00')).toBe('zero');
    expect(varianceKind('0')).toBe('zero');
    expect(varianceKind('-0.00')).toBe('zero');
  });
  it('lebih dan kurang', () => {
    expect(varianceKind('5000.00')).toBe('over');
    expect(varianceKind('-5000.00')).toBe('short');
    expect(varianceKind('-0.01')).toBe('short');
  });
  it('kosong atau tak terbaca', () => {
    expect(varianceKind(null)).toBe('unknown');
    expect(varianceKind('abc')).toBe('unknown');
  });
});

describe('canSell', () => {
  it('hanya shift open', () => {
    expect(canSell('open')).toBe(true);
    expect(canSell('counting')).toBe(false);
    expect(canSell('closed')).toBe(false);
    expect(canSell(undefined)).toBe(false);
  });
});
