import type { FloatPolicy, FloatPolicyInput, FloatPolicyMode, FloatPolicyPercentBase } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { moneyToCents } from '@/lib/money';

export interface FloatPolicyFormValues {
  mode: FloatPolicyMode;
  fixedAmount: string;
  percent: string;
  percentBase: FloatPolicyPercentBase | '';
  minAmount: string;
  maxAmount: string;
  roundingUnit: string;
  reason: string;
}

export type FloatPolicyField = 'fixedAmount' | 'percent' | 'percentBase' | 'minAmount' | 'maxAmount' | 'roundingUnit';
export type FloatPolicyErrors = Partial<Record<FloatPolicyField, string>>;

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

export function valuesFromFloatPolicy(policy: FloatPolicy | null): FloatPolicyFormValues {
  return {
    mode: policy?.mode ?? 'fixed',
    fixedAmount: policy?.fixed_amount ?? '',
    percent: policy?.percent ?? '',
    percentBase: policy?.percent_base ?? '',
    minAmount: policy?.min_amount ?? '',
    maxAmount: policy?.max_amount ?? '',
    roundingUnit: String(policy?.rounding_unit ?? 1000),
    reason: '',
  };
}

export function validateFloatPolicy(values: FloatPolicyFormValues): FloatPolicyErrors {
  const errors: FloatPolicyErrors = {};
  const fixed = normalizeDecimal(values.fixedAmount);
  const percent = normalizeDecimal(values.percent);

  if (values.mode === 'fixed') {
    const cents = moneyToCents(fixed);
    if (!fixed) errors.fixedAmount = 'Nominal endapan wajib diisi.';
    else if (!MONEY_RE.test(fixed) || cents === null) errors.fixedAmount = 'Nominal tidak valid (maks. 2 desimal).';
  } else {
    const cents = moneyToCents(percent);
    if (!percent) errors.percent = 'Persentase wajib diisi.';
    else if (!MONEY_RE.test(percent) || cents === null) errors.percent = 'Persentase tidak valid (maks. 2 desimal).';
    else if (cents > 10000n) errors.percent = 'Persentase harus antara 0 dan 100.';
    if (!values.percentBase) errors.percentBase = 'Pilih dasar perhitungan endapan.';
  }

  const min = normalizeDecimal(values.minAmount);
  const max = normalizeDecimal(values.maxAmount);
  const minCents = min ? moneyToCents(min) : null;
  const maxCents = max ? moneyToCents(max) : null;
  if (min && (!MONEY_RE.test(min) || minCents === null)) errors.minAmount = 'Nominal minimum tidak valid (maks. 2 desimal).';
  if (max && (!MONEY_RE.test(max) || maxCents === null)) errors.maxAmount = 'Nominal maksimum tidak valid (maks. 2 desimal).';
  if (!errors.minAmount && !errors.maxAmount && minCents !== null && maxCents !== null && minCents > maxCents) {
    errors.minAmount = 'Batas minimum tidak boleh melebihi maksimum.';
  }

  if (!/^\d+$/.test(values.roundingUnit) || Number(values.roundingUnit) < 1 || Number(values.roundingUnit) > 1_000_000) {
    errors.roundingUnit = 'Pembulatan harus bilangan bulat antara 1 dan 1.000.000 rupiah.';
  }

  return errors;
}

export function buildFloatPolicyInput(values: FloatPolicyFormValues): FloatPolicyInput {
  const common = {
    ...(normalizeDecimal(values.minAmount) ? { min_amount: normalizeDecimal(values.minAmount) } : {}),
    ...(normalizeDecimal(values.maxAmount) ? { max_amount: normalizeDecimal(values.maxAmount) } : {}),
    rounding_unit: Number(values.roundingUnit),
    ...(values.reason.trim() ? { reason: values.reason.trim() } : {}),
  };

  if (values.mode === 'fixed') {
    return { mode: 'fixed', fixed_amount: normalizeDecimal(values.fixedAmount), ...common };
  }
  if (!values.percentBase) throw new Error('Pilih dasar perhitungan endapan.');
  return {
    mode: 'percent',
    percent: normalizeDecimal(values.percent),
    percent_base: values.percentBase,
    ...common,
  };
}
