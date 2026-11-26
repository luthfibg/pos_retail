import { describe, expect, it } from 'vitest';
import { loadReceiptPaperSize, RECEIPT_PAPER_LABELS, saveReceiptPaperSize } from './receiptPrintSettings';

function createStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
}

describe('receipt print settings', () => {
  it('defaults to 80 mm thermal when no valid device setting exists', () => {
    expect(loadReceiptPaperSize(createStorage())).toBe('80');
    expect(loadReceiptPaperSize(createStorage({ 'pos.receipt-paper-size': '57' }))).toBe('80');
  });

  it('persists and restores each supported paper width', () => {
    for (const size of ['58', '76', '80'] as const) {
      const storage = createStorage();
      saveReceiptPaperSize(size, storage);
      expect(loadReceiptPaperSize(storage)).toBe(size);
    }
  });

  it('describes printer type in the setting label', () => {
    expect(RECEIPT_PAPER_LABELS).toEqual({
      '58': '58 mm thermal',
      '76': '76 mm dot matrix',
      '80': '80 mm thermal',
    });
  });
});
