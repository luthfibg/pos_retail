import { describe, expect, it } from 'vitest';
import { normalizeThreshold, sameThreshold, validateThreshold } from './stockMonitoringForm';

describe('stockMonitoringForm', () => {
  it('menormalkan koma desimal dan menerima ambang default', () => {
    expect(normalizeThreshold(' 3,500 ')).toBe('3.500');
    expect(validateThreshold('3.000')).toEqual({});
    expect(validateThreshold('0')).toEqual({});
  });

  it('menerima batas maksimum yang tepat', () => {
    expect(validateThreshold('99999')).toEqual({});
  });

  it('membandingkan nilai desimal dengan skala yang sama', () => {
    expect(sameThreshold('3', '3.000')).toBe(true);
    expect(sameThreshold('3.001', '3.000')).toBe(false);
  });

  it.each(['', '-1', '100000', '99999.001', '1.0000', 'abc'])('menolak nilai ambang %s', (value) => {
    expect(validateThreshold(value).low_stock_threshold).toBeTruthy();
  });
});
