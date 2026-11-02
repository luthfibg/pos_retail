import { describe, expect, it } from 'vitest';
import { normalizeAuthorizationKey, validateAuthorizationKey, validateGeneratedKeyChoice } from './authorizationKeyLogic';

describe('authorization key form logic', () => {
  it('normalizes codes to uppercase and passphrase whitespace', () => {
    expect(normalizeAuthorizationKey('code', ' ab12cd ')).toBe('AB12CD');
    expect(normalizeAuthorizationKey('passphrase', '  rahasia   untuk   pemilik ')).toBe('rahasia untuk pemilik');
  });

  it('validates six-character codes and rejects repeated characters', () => {
    expect(validateAuthorizationKey('code', 'ab23cd')).toBeUndefined();
    expect(validateAuthorizationKey('code', 'abc')).toBeTruthy();
    expect(validateAuthorizationKey('code', 'AAAAAA')).toContain('diulang');
  });

  it('requires a long passphrase with at least three words', () => {
    expect(validateAuthorizationKey('passphrase', 'Kunci rahasia untuk persetujuan')).toBeUndefined();
    expect(validateAuthorizationKey('passphrase', 'kalimat pendek')).toBeTruthy();
    expect(validateAuthorizationKey('passphrase', '1234567890123456')).toBeTruthy();
  });

  it('allows automatic generation only for codes', () => {
    expect(validateGeneratedKeyChoice('code', true)).toBeUndefined();
    expect(validateGeneratedKeyChoice('passphrase', true)).toBeTruthy();
  });
});
