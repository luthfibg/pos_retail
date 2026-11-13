import { describe, expect, it } from 'vitest';
import { formatPurchaseOrderPaymentTerms, purchaseOrderTermsFromSupplier } from './paymentTerms';

describe('purchase order payment terms', () => {
  it('maps supplier defaults to the current PO terms', () => {
    expect(purchaseOrderTermsFromSupplier('credit')).toBe('top');
    expect(purchaseOrderTermsFromSupplier('prepaid')).toBe('cbd');
    expect(purchaseOrderTermsFromSupplier('cod')).toBe('cod');
    expect(purchaseOrderTermsFromSupplier(null)).toBe('cod');
  });

  it('shows TOP days when the PO has a configured payment period', () => {
    expect(formatPurchaseOrderPaymentTerms('top', 30)).toBe('TOP (Turn Of Payment) · 30 hari');
    expect(formatPurchaseOrderPaymentTerms('top', null)).toBe('TOP (Turn Of Payment)');
    expect(formatPurchaseOrderPaymentTerms('cbd', null)).toBe('CBD (Cash Before Delivery)');
    expect(formatPurchaseOrderPaymentTerms('cod', null)).toBe('COD (Cash On Delivery)');
  });
});
