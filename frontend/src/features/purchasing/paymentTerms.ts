import type { PurchaseOrderPaymentTerms } from '@/lib/api/types';

export const PURCHASE_ORDER_PAYMENT_TERMS_LABEL: Record<PurchaseOrderPaymentTerms, string> = {
  top: 'TOP (Turn Of Payment)',
  cbd: 'CBD (Cash Before Delivery)',
  cod: 'COD (Cash On Delivery)',
};

export function formatPurchaseOrderPaymentTerms(terms: PurchaseOrderPaymentTerms, days: number | null): string {
  return terms === 'top' && days !== null
    ? `${PURCHASE_ORDER_PAYMENT_TERMS_LABEL[terms]} · ${days} hari`
    : PURCHASE_ORDER_PAYMENT_TERMS_LABEL[terms];
}
