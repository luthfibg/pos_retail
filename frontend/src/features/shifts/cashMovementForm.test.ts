import { describe, expect, it } from 'vitest';
import { buildCashMovementInput, validateCashMovement, type CashMovementFormValues } from './cashMovementForm';

const valid: CashMovementFormValues = { type: 'in', amount: '50000', reason: 'Tambahan modal' };

describe('validateCashMovement', () => {
  it('menerima kas masuk dan keluar dengan nominal positif dua desimal', () => {
    expect(validateCashMovement(valid)).toEqual({});
    expect(validateCashMovement({ ...valid, type: 'out', amount: '1250,50' })).toEqual({});
  });

  it('mewajibkan jenis, nominal valid dan positif, serta keterangan', () => {
    expect(validateCashMovement({ ...valid, amount: '' }).amount).toBeTruthy();
    expect(validateCashMovement({ ...valid, amount: '0' }).amount).toBeTruthy();
    expect(validateCashMovement({ ...valid, amount: '10.999' }).amount).toBeTruthy();
    expect(validateCashMovement({ ...valid, type: 'other' as CashMovementFormValues['type'] }).type).toBeTruthy();
    expect(validateCashMovement({ ...valid, reason: '   ' }).reason).toBeTruthy();
    expect(validateCashMovement({ ...valid, reason: 'x'.repeat(256) }).reason).toBeTruthy();
  });
});

describe('buildCashMovementInput', () => {
  it('menormalkan nominal dan memangkas keterangan', () => {
    expect(buildCashMovementInput({ type: 'out', amount: '1250,5', reason: '  Beli alat tulis  ' })).toEqual({
      type: 'out',
      amount: '1250.5',
      reason: 'Beli alat tulis',
    });
  });
});
