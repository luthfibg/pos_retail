import { describe, expect, it } from 'vitest';
import { bucketLabel, directionOf } from './movementLabels';

describe('directionOf', () => {
  it('masuk, keluar, pindah', () => {
    expect(directionOf({ from_bucket: null, to_bucket: 'sellable' })).toBe('in');
    expect(directionOf({ from_bucket: 'sellable', to_bucket: null })).toBe('out');
    expect(directionOf({ from_bucket: 'sellable', to_bucket: 'quarantine' })).toBe('move');
    expect(directionOf({ from_bucket: null, to_bucket: null, movement_direction: 'out' })).toBe('out');
  });
  it('label bucket dikenal dan tak dikenal', () => {
    expect(bucketLabel('quarantine')).toBe('karantina');
    expect(bucketLabel('x')).toBe('x');
    expect(bucketLabel(null)).toBe('');
  });
});
