import { describe, expect, it } from 'vitest';
import {
  buildPartialDepositInput, buildReceiveDepositInput, validateDepositReason,
  validatePartialDeposit, validateReceiveDeposit,
} from './depositForm';

describe('validatePartialDeposit', () => {
  it('menerima hitungan kas positif hingga dua desimal dan catatan opsional', () => {
    expect(validatePartialDeposit({ amount: '850000', note: '' })).toEqual({});
    expect(validatePartialDeposit({ amount: '850000,50', note: '  Setoran tengah hari  ' })).toEqual({});
  });

  it('menolak nominal kosong, nol, format invalid, dan catatan terlalu panjang', () => {
    expect(validatePartialDeposit({ amount: '', note: '' }).amount).toBeTruthy();
    expect(validatePartialDeposit({ amount: '0', note: '' }).amount).toBeTruthy();
    expect(validatePartialDeposit({ amount: '10.999', note: '' }).amount).toBeTruthy();
    expect(validatePartialDeposit({ amount: '10', note: 'x'.repeat(501) }).note).toBeTruthy();
  });
});

describe('validateReceiveDeposit', () => {
  it('tidak meminta catatan bila jumlah yang diterima sama dengan setoran', () => {
    expect(validateReceiveDeposit({ amount: '800000', note: '' }, '800000.00')).toEqual({});
  });

  it('meminta catatan bila ada selisih dan memvalidasi nominal', () => {
    expect(validateReceiveDeposit({ amount: '799000', note: '' }, '800000').note).toBeTruthy();
    expect(validateReceiveDeposit({ amount: '', note: '' }, '800000').amount).toBeTruthy();
    expect(validateReceiveDeposit({ amount: '799000', note: 'x'.repeat(501) }, '800000').note).toBeTruthy();
  });
});

describe('validateDepositReason', () => {
  it('mewajibkan alasan koreksi hingga 500 karakter', () => {
    expect(validateDepositReason('  ')).toBeTruthy();
    expect(validateDepositReason('Selisih sudah diselesaikan')).toBeUndefined();
    expect(validateDepositReason('x'.repeat(501))).toBeTruthy();
  });
});

describe('deposit payload builders', () => {
  it('menormalisasi jumlah dan mengirim catatan hanya bila diisi', () => {
    expect(buildPartialDepositInput({ amount: '850000,50', note: '  Siang  ' })).toEqual({
      counted_amount: '850000.50',
      note: 'Siang',
    });
    expect(buildReceiveDepositInput({ amount: '850000', note: ' ' })).toEqual({ received_amount: '850000' });
  });
});
