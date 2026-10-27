import type { CashMovementType } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { moneyToCents } from '@/lib/money';

export interface CashMovementFormValues {
  type: CashMovementType;
  amount: string;
  reason: string;
}

export type CashMovementField = 'type' | 'amount' | 'reason';
export type CashMovementErrors = Partial<Record<CashMovementField, string>>;

const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;

export function validateCashMovement(values: CashMovementFormValues): CashMovementErrors {
  const errors: CashMovementErrors = {};
  const amount = normalizeDecimal(values.amount);
  const validAmount = AMOUNT_RE.test(amount);
  const cents = validAmount ? moneyToCents(amount) : null;

  if (!['in', 'out'].includes(values.type)) errors.type = 'Pilih jenis pergerakan kas.';
  if (!amount) errors.amount = 'Nominal wajib diisi.';
  else if (!validAmount || cents === null) errors.amount = 'Nominal tidak valid (maks. 2 desimal).';
  else if (cents <= 0n) errors.amount = 'Nominal harus lebih dari Rp0.';

  const reason = values.reason.trim();
  if (!reason) errors.reason = 'Keterangan wajib diisi.';
  else if (reason.length > 255) errors.reason = 'Keterangan maksimal 255 karakter.';

  return errors;
}

export function buildCashMovementInput(values: CashMovementFormValues) {
  return {
    type: values.type,
    amount: normalizeDecimal(values.amount),
    reason: values.reason.trim(),
  };
}
