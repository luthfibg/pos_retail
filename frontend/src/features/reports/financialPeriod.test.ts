import { describe, expect, it } from 'vitest';
import { currentMonthDateRange } from './financialPeriod';

describe('currentMonthDateRange', () => {
  it('uses the full current month, including dates after today', () => {
    expect(currentMonthDateRange('2026-11-17')).toEqual({
      date_from: '2026-11-01',
      date_to: '2026-11-30',
    });
  });

  it('handles leap years', () => {
    expect(currentMonthDateRange('2024-02-29')).toEqual({
      date_from: '2024-02-01',
      date_to: '2024-02-29',
    });
  });
});
