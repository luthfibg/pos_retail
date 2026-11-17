import { describe, expect, it } from 'vitest';
import { formatPurchaseOrderPaymentTerms } from './paymentTerms';

describe('purchase order payment terms', () => {
  it('shows TOP days when the PO has a configured payment period', () => {
    expect(formatPurchaseOrderPaymentTerms('top', 30)).toBe('TOP (Turn Of Payment) · 30 hari');
    expect(formatPurchaseOrderPaymentTerms('top', null)).toBe('TOP (Turn Of Payment)');
    expect(formatPurchaseOrderPaymentTerms('cbd', null)).toBe('CBD (Cash Before Delivery)');
    expect(formatPurchaseOrderPaymentTerms('cod', null)).toBe('COD (Cash On Delivery)');
  });
});
