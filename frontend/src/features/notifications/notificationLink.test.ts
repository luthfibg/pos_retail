import { describe, expect, it } from 'vitest';
import { badgeText, notificationTarget } from './notificationLink';

describe('notificationTarget', () => {
  it('batas kredit dibutuhkan -> detail karyawan', () => {
    expect(notificationTarget({ type: 'customer.limit_needed', entity_type: 'customer', entity_id: 7 })).toBe('/customers?open=7');
  });
  it('tipe tak dikenal atau tanpa entitas -> null', () => {
    expect(notificationTarget({ type: 'lain', entity_type: null, entity_id: null })).toBeNull();
    expect(notificationTarget({ type: 'customer.limit_needed', entity_type: 'customer', entity_id: null })).toBeNull();
  });
});

describe('badgeText', () => {
  it('membatasi 99+', () => {
    expect(badgeText(3)).toBe('3');
    expect(badgeText(100)).toBe('99+');
  });
});
