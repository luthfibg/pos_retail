import { normalizeDecimal } from '@/features/products/productForm';
import { moneyToCents } from '@/lib/money';

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

export interface DepositFormValues {
  amount: string;
  note: string;
}

export interface DepositReceiveValues extends DepositFormValues {}

export type DepositErrors = Partial<Record<'amount' | 'note' | 'reason', string>>;

function validMoney(value: string): boolean {
  const normalized = normalizeDecimal(value);
  return MONEY_RE.test(normalized) && moneyToCents(normalized) !== null;
}

export function validatePartialDeposit(values: DepositFormValues): DepositErrors {
  const errors: DepositErrors = {};
  const amount = normalizeDecimal(values.amount);
  const cents = moneyToCents(amount);

  if (!amount) errors.amount = 'Uang terhitung wajib diisi.';
  else if (!validMoney(amount) || cents === null) errors.amount = 'Nominal tidak valid (maks. 2 desimal).';
  else if (cents <= 0n) errors.amount = 'Nominal harus lebih dari Rp0.';

  if (values.note.trim().length > 500) errors.note = 'Catatan maksimal 500 karakter.';
  return errors;
}

export function validateReceiveDeposit(values: DepositReceiveValues, expectedAmount: string): DepositErrors {
  const errors: DepositErrors = {};
  const amount = normalizeDecimal(values.amount);
  if (!amount) errors.amount = 'Jumlah uang yang diterima wajib diisi.';
  else if (!validMoney(amount)) errors.amount = 'Nominal tidak valid (maks. 2 desimal).';

  const cents = amount ? moneyToCents(amount) : null;
  const expected = moneyToCents(expectedAmount);
  if (cents !== null && expected !== null && cents !== expected && !values.note.trim()) {
    errors.note = 'Catatan wajib diisi bila jumlah diterima berbeda.';
  }
  if (values.note.trim().length > 500) errors.note = 'Catatan maksimal 500 karakter.';
  return errors;
}

export function validateDepositReason(reason: string): string | undefined {
  if (!reason.trim()) return 'Alasan koreksi wajib diisi.';
  if (reason.trim().length > 500) return 'Alasan maksimal 500 karakter.';
  return undefined;
}

export function buildPartialDepositInput(values: DepositFormValues): { counted_amount: string; note?: string } {
  const note = values.note.trim();
  return {
    counted_amount: normalizeDecimal(values.amount),
    ...(note ? { note } : {}),
  };
}

export function buildReceiveDepositInput(values: DepositReceiveValues): { received_amount: string; note?: string } {
  const note = values.note.trim();
  return {
    received_amount: normalizeDecimal(values.amount),
    ...(note ? { note } : {}),
  };
}
