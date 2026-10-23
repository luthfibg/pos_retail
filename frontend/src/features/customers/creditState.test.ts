import { describe, expect, it } from 'vitest';
import type { CreditState } from '@/lib/api/types';
import { CREDIT_HINT, CREDIT_LABEL, canUseCredit } from './creditState';

const states: CreditState[] = ['not_verified', 'limit_not_set', 'available', 'exhausted', 'inactive'];

describe('creditState', () => {
  it('hanya available yang boleh kredit', () => {
    expect(states.filter(canUseCredit)).toEqual(['available']);
  });
  it('setiap status punya label dan keterangan', () => {
    for (const s of states) {
      expect(CREDIT_LABEL[s]).toBeTruthy();
      expect(CREDIT_HINT[s]).toBeTruthy();
    }
  });
});
