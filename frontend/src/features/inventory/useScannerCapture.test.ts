import { describe, expect, it } from 'vitest';
import {
  SCANNER_DUPLICATE_WINDOW_MS,
  ScannerBurstBuffer,
  SCANNER_MINIMUM_CHARACTERS,
  shouldAcceptScannerCode,
} from './useScannerCapture';

describe('ScannerBurstBuffer', () => {
  it('recognizes a barcode burst followed by Enter without releasing its digits', () => {
    const buffer = new ScannerBurstBuffer();
    const barcode = '8996000012345';
    let result: ReturnType<ScannerBurstBuffer['input']> = { digits: '' };
    [...barcode].forEach((key, index) => {
      result = buffer.input(key, index * 10);
      expect(result.digits).toBe('');
    });
    result = buffer.input('Enter', barcode.length * 10);
    expect(result.scan).toBe(barcode);
    expect(result.enter).toBeUndefined();
    expect(buffer.flush()).toBe('');
  });

  it('treats a slower human quantity followed by Enter as digits, not a scan', () => {
    const buffer = new ScannerBurstBuffer();
    expect(buffer.input('1', 0).digits).toBe('');
    const second = buffer.input('2', 60);
    expect(second.digits).toBe('1');
    const enter = buffer.input('Enter', 80);
    expect(enter.digits).toBe('2');
    expect(enter.enter).toBe(true);
    expect(SCANNER_MINIMUM_CHARACTERS).toBe(6);
  });

  it('does not classify a short fast human input as a scan', () => {
    const buffer = new ScannerBurstBuffer();
    buffer.input('1', 0);
    buffer.input('2', 10);
    const enter = buffer.input('Enter', 20);
    expect(enter.scan).toBeUndefined();
    expect(enter.digits).toBe('12');
    expect(enter.enter).toBe(true);
  });

  it('resets the burst on timeout so slow typing is flushed as quantity', () => {
    const buffer = new ScannerBurstBuffer();
    buffer.input('1', 0);
    buffer.input('2', 10);
    expect(buffer.flush()).toBe('12');
    const enter = buffer.input('Enter', 70);
    expect(enter.scan).toBeUndefined();
    expect(enter.enter).toBe(true);
    expect(SCANNER_DUPLICATE_WINDOW_MS).toBe(800);
  });

  it('ignores a repeated barcode only inside the duplicate window', () => {
    expect(shouldAcceptScannerCode('8996000012345', 799, '8996000012345', 100)).toBe(false);
    expect(shouldAcceptScannerCode('8996000012345', 900, '8996000012345', 100)).toBe(true);
    expect(shouldAcceptScannerCode('8996000099999', 101, '8996000012345', 100)).toBe(true);
  });
});
