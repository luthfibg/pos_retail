import { describe, expect, it } from 'vitest';
import type { BillingPeriod, Movement, Shift } from '@/lib/api/types';
import { summarizeCashierShifts, summarizeInventoryMovements, sumBillingPeriods } from './dashboardSummary';

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 1,
    product_id: 1,
    sku: 'P-1',
    product_name: 'Produk',
    batch_id: null,
    batch_code: null,
    expiry_date: null,
    movement_type: 'receipt',
    qty: '1',
    unit_cost: '1',
    from_location_id: null,
    from_bucket: null,
    to_location_id: null,
    to_bucket: 'sellable',
    ref_type: null,
    ref_id: null,
    occurred_at: '2026-01-01T00:00:00Z',
    created_by: null,
    created_by_name: null,
    ...overrides,
  };
}

function period(overrides: Partial<BillingPeriod> = {}): BillingPeriod {
  return {
    id: 1,
    label: 'Periode',
    period_month: '2026-06-01',
    status: 'invoiced',
    scheduled_close_date: null,
    starts_at: '2026-06-01T00:00:00Z',
    closed_at: null,
    sales_count: 1,
    sales_total: '100.00',
    invoice_id: 1,
    ...overrides,
  };
}

function cashierShift(overrides: Partial<Pick<Shift, 'id' | 'status' | 'summary'>> = {}): Pick<Shift, 'id' | 'status' | 'summary'> {
  return {
    id: 1,
    status: 'closed',
    summary: {
      cash_sales_count: 1,
      cash_sales_total: '2.00',
      credit_sales_count: 1,
      credit_sales_total: '4.50',
      cash_in: '0.50',
      cash_out: '0.25',
      partial_deposits: '0',
    },
    ...overrides,
  };
}

describe('dashboard inventory summaries', () => {
  it('sums only store entries and exits with exact HPP amounts', () => {
    const totals = summarizeInventoryMovements([
      movement({ id: 1, qty: '3.125', unit_cost: '2.1234' }),
      movement({ id: 2, movement_type: 'sale', qty: '2', unit_cost: '10.1234', from_bucket: 'sellable', to_bucket: null }),
      movement({ id: 3, movement_type: 'transfer', qty: '10', unit_cost: '99', from_bucket: 'sellable', to_bucket: 'quarantine' }),
      movement({ id: 4, qty: '1', unit_cost: null }),
    ]);

    expect(totals).toEqual({
      inboundQtyMilli: 4125n,
      outboundQtyMilli: 2000n,
      inboundCents: 664n,
      outboundCents: 2025n,
      missingCostCount: 1,
    });
  });

  it('reports malformed API decimal values instead of silently omitting totals', () => {
    expect(() => summarizeInventoryMovements([movement({ qty: '1.2345' })])).toThrow('Kuantitas');
    expect(() => summarizeInventoryMovements([movement({ unit_cost: '1.23456' })])).toThrow('HPP');
  });
});

describe('dashboard cashier shift summaries', () => {
  it('sums financial details from closed and reviewed reports only', () => {
    const totals = summarizeCashierShifts([
      cashierShift(),
      cashierShift({
        id: 2,
        status: 'reviewed',
        summary: {
          cash_sales_count: 2,
          cash_sales_total: '3.00',
          credit_sales_count: 1,
          credit_sales_total: '1.00',
          cash_in: '0.25',
          cash_out: '0.15',
          partial_deposits: '0',
        },
      }),
      cashierShift({ id: 3, status: 'open' }),
    ]);

    expect(totals).toEqual({
      reportCount: 2,
      cashSalesCents: 500n,
      creditSalesCents: 550n,
      cashInCents: 75n,
      cashOutCents: 40n,
    });
  });

  it('reports malformed report totals', () => {
    expect(() => summarizeCashierShifts([
      cashierShift({ summary: { ...cashierShift().summary, cash_sales_total: 'invalid' } }),
    ])).toThrow('penjualan tunai shift');
  });
});

describe('dashboard billing summaries', () => {
  const periods = [
    period({ id: 1, sales_total: '100.25' }),
    period({ id: 2, period_month: '2026-06-15', sales_total: '10.50', status: 'closed' }),
    period({ id: 3, period_month: '2026-06-20', sales_total: '50.00', status: 'cancelled' }),
    period({ id: 4, period_month: '2026-05-01', sales_total: '75.00' }),
    period({ id: 5, period_month: '2025-06-01', sales_total: '900.00' }),
  ];

  it('sums the selected month and year while excluding cancelled periods', () => {
    expect(sumBillingPeriods(periods, 2026, 6)).toBe(11075n);
    expect(sumBillingPeriods(periods, 2026)).toBe(18575n);
  });

  it('reports malformed billing totals', () => {
    expect(() => sumBillingPeriods([period({ sales_total: 'invalid' })], 2026)).toThrow('Nilai tagihan');
  });
});
