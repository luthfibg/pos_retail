import { describe, expect, it } from 'vitest';
import { buildFloatPolicyInput, validateFloatPolicy, valuesFromFloatPolicy } from './floatPolicyForm';

describe('valuesFromFloatPolicy', () => {
  it('mengisi form kosong dengan pembulatan default backend', () => {
    expect(valuesFromFloatPolicy(null)).toEqual({
      mode: 'fixed',
      fixedAmount: '',
      percent: '',
      percentBase: '',
      minAmount: '',
      maxAmount: '',
      roundingUnit: '1000',
      reason: '',
    });
  });
});

describe('validateFloatPolicy', () => {
  it('meminta nominal untuk mode tetap', () => {
    expect(validateFloatPolicy(valuesFromFloatPolicy(null)).fixedAmount).toBeTruthy();
    expect(validateFloatPolicy({ ...valuesFromFloatPolicy(null), fixedAmount: '500000' })).toEqual({});
  });

  it('memvalidasi persen, basis, batas minimum/maksimum, dan pembulatan', () => {
    const base = valuesFromFloatPolicy(null);
    expect(validateFloatPolicy({
      ...base,
      mode: 'percent',
      percent: '10,5',
      percentBase: 'cash_sales_shift',
      minAmount: '100000',
      maxAmount: '500000',
    })).toEqual({});
    expect(validateFloatPolicy({ ...base, mode: 'percent', percent: '101', percentBase: '' })).toMatchObject({
      percent: expect.any(String),
      percentBase: expect.any(String),
    });
    expect(validateFloatPolicy({ ...base, fixedAmount: '500', minAmount: '2000', maxAmount: '1000' }).minAmount).toBeTruthy();
    expect(validateFloatPolicy({ ...base, fixedAmount: '500', roundingUnit: '0' }).roundingUnit).toBeTruthy();
  });
});

describe('buildFloatPolicyInput', () => {
  it('mengirim nominal tetap dan hanya batas yang diisi', () => {
    expect(buildFloatPolicyInput({
      ...valuesFromFloatPolicy(null),
      fixedAmount: '500000',
      minAmount: '100000',
      reason: '  Kebijakan awal  ',
    })).toEqual({
      mode: 'fixed',
      fixed_amount: '500000',
      min_amount: '100000',
      rounding_unit: 1000,
      reason: 'Kebijakan awal',
    });
  });

  it('mengirim basis persen dan menolak basis kosong', () => {
    const values = { ...valuesFromFloatPolicy(null), mode: 'percent' as const, percent: '10,5', percentBase: 'cash_on_hand' as const };
    expect(buildFloatPolicyInput(values)).toEqual({
      mode: 'percent',
      percent: '10.5',
      percent_base: 'cash_on_hand',
      rounding_unit: 1000,
    });
    expect(() => buildFloatPolicyInput({ ...values, percentBase: '' })).toThrow();
  });
});
