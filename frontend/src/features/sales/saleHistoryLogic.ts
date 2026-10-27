import type { SaleSummary, ShiftStatus } from '@/lib/api/types';

export const SALE_STATUS_LABEL = {
  posted: 'Terposting',
  voided: 'Dibatalkan',
} as const;

export const BILLING_STATUS_LABEL = {
  not_applicable: 'Tunai',
  unbilled: 'Belum ditagihkan',
  invoiced: 'Sudah ditagihkan',
  paid: 'Sudah dibayar',
} as const;

export function canVoidSale(sale: SaleSummary, shiftStatus: ShiftStatus | undefined): boolean {
  if (sale.status !== 'posted') return false;
  if (sale.payment_mode === 'cash') return shiftStatus === 'open';
  return sale.billing_status === 'unbilled';
}

export function voidUnavailableReason(sale: SaleSummary, shiftStatus: ShiftStatus | undefined): string | null {
  if (sale.status !== 'posted') return 'Struk ini sudah dibatalkan.';
  if (sale.payment_mode === 'payroll_credit' && sale.billing_status !== 'unbilled') {
    return 'Struk kredit yang sudah ditagihkan tidak dapat dibatalkan; diperlukan credit note.';
  }
  if (sale.payment_mode === 'cash' && shiftStatus !== 'open') {
    return 'Struk tunai hanya dapat dibatalkan selama shift terkait masih berjalan.';
  }
  return null;
}
