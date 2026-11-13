import type { PaymentTerms, PurchaseOrderPaymentTerms } from '@/lib/api/types';

export const PURCHASE_ORDER_PAYMENT_TERMS_LABEL: Record<PurchaseOrderPaymentTerms, string> = {
  top: 'TOP (Turn Of Payment)',
  cbd: 'CBD (Cash Before Delivery)',
  cod: 'COD (Cash On Delivery)',
};

export function purchaseOrderTermsFromSupplier(terms: PaymentTerms | null | undefined): PurchaseOrderPaymentTerms {
  switch (terms) {
    case 'credit': return 'top';
    case 'prepaid': return 'cbd';
    case 'cod': return 'cod';
    default: return 'cod';
  }
}

export function formatPurchaseOrderPaymentTerms(terms: PurchaseOrderPaymentTerms, days: number | null): string {
  return terms === 'top' && days !== null
    ? `${PURCHASE_ORDER_PAYMENT_TERMS_LABEL[terms]} · ${days} hari`
    : PURCHASE_ORDER_PAYMENT_TERMS_LABEL[terms];
}
