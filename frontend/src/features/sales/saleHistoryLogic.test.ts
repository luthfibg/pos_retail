import { describe, expect, it } from 'vitest';
import type { SaleSummary } from '@/lib/api/types';
import { canVoidSale, voidUnavailableReason } from './saleHistoryLogic';

const base: SaleSummary = {
  id: 1,
  doc_number: 'SALE-1',
  shift_id: 1,
  cashier_id: 2,
  cashier_name: 'Kasir',
  customer_id: null,
  customer_name: null,
  customer_no: null,
  payment_mode: 'cash',
  subtotal: '10000.00',
  discount_total: '0.00',
  tax_rate: null,
  tax_amount: '0.00',
  total: '10000.00',
  status: 'posted',
  billing_status: 'not_applicable',
  over_limit: false,
  posted_at: '2026-10-27 03:00:00.000',
};

describe('canVoidSale', () => {
  it('allows cash void only while its shift is open', () => {
    expect(canVoidSale(base, 'open')).toBe(true);
    expect(canVoidSale(base, 'closed')).toBe(false);
  });

  it('allows unbilled credit void and rejects billed or already voided sales', () => {
    expect(canVoidSale({ ...base, payment_mode: 'payroll_credit', billing_status: 'unbilled' }, undefined)).toBe(true);
    expect(canVoidSale({ ...base, payment_mode: 'payroll_credit', billing_status: 'invoiced' }, 'open')).toBe(false);
    expect(canVoidSale({ ...base, status: 'voided' }, 'open')).toBe(false);
  });
});

describe('voidUnavailableReason', () => {
  it('explains backend void restrictions', () => {
    expect(voidUnavailableReason(base, 'closed')).toContain('shift');
    expect(voidUnavailableReason({ ...base, payment_mode: 'payroll_credit', billing_status: 'paid' }, 'open')).toContain('credit note');
    expect(voidUnavailableReason(base, 'open')).toBeNull();
  });
});
