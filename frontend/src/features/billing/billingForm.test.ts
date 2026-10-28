import { describe, expect, it } from 'vitest';
import { buildPaymentInput, validatePayment, type PaymentValues } from './billingForm';

const blank: PaymentValues = { amount: '', receivedOn: '', reference: '', note: '' };

describe('validatePayment', () => {
  it('accepts a partial payment and validates it using exact decimal cents', () => {
    expect(validatePayment({ ...blank, amount: '1250.50' }, '2000.00')).toBeNull();
  });

  it('rejects invalid, zero, excessive, and overpayment amounts', () => {
    expect(validatePayment({ ...blank, amount: '0' }, '100.00')).not.toBeNull();
    expect(validatePayment({ ...blank, amount: '10.123' }, '100.00')).not.toBeNull();
    expect(validatePayment({ ...blank, amount: '100.01' }, '100.00')).not.toBeNull();
    expect(validatePayment({ ...blank, amount: '1000000000000' }, '1000000000000')).not.toBeNull();
  });

  it('validates payment date and builds a trimmed API payload', () => {
    expect(validatePayment({ ...blank, amount: '10', receivedOn: '2026-02-30' }, '20')).not.toBeNull();
    expect(buildPaymentInput({ amount: '10.00', receivedOn: '2026-10-28', reference: '  REF  ', note: ' ' })).toEqual({
      amount: '10.00',
      received_on: '2026-10-28',
      reference: 'REF',
    });
  });
});
