import { describe, expect, it } from 'vitest';
import { chartHeight, validateDashboardFilters } from './dashboardFilters';

describe('validateDashboardFilters', () => {
  it('accepts a valid date range and optional cashier ID', () => {
    expect(validateDashboardFilters({ dateFrom: '2026-10-01', dateTo: '2026-10-31', cashierId: '23' })).toBeNull();
  });

  it('rejects invalid dates, reversed ranges, and ranges longer than 365 days', () => {
    expect(validateDashboardFilters({ dateFrom: '2026-02-30', dateTo: '2026-03-01', cashierId: '' })).not.toBeNull();
    expect(validateDashboardFilters({ dateFrom: '2026-03-02', dateTo: '2026-03-01', cashierId: '' })).not.toBeNull();
    expect(validateDashboardFilters({ dateFrom: '2025-01-01', dateTo: '2026-01-02', cashierId: '' })).not.toBeNull();
  });

  it('requires a positive safe integer cashier ID', () => {
    expect(validateDashboardFilters({ dateFrom: '2026-10-01', dateTo: '2026-10-01', cashierId: '0' })).not.toBeNull();
    expect(validateDashboardFilters({ dateFrom: '2026-10-01', dateTo: '2026-10-01', cashierId: '1.5' })).not.toBeNull();
    expect(validateDashboardFilters({ dateFrom: '2026-10-01', dateTo: '2026-10-01', cashierId: '8' })).toBeNull();
  });
});

describe('chartHeight', () => {
  it('returns a bounded percentage without floating point money arithmetic', () => {
    expect(chartHeight('50.00', '100.00')).toBe(50);
    expect(chartHeight('0.00', '100.00')).toBe(0);
    expect(chartHeight('120.00', '100.00')).toBe(100);
    expect(chartHeight('0.01', '100.00')).toBe(2);
  });
});
