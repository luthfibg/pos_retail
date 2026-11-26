export const RECEIPT_PAPER_SIZES = ['58', '76', '80'] as const;

export type ThermalPaperSize = (typeof RECEIPT_PAPER_SIZES)[number];

export const RECEIPT_PAPER_LABELS: Record<ThermalPaperSize, string> = {
  '58': '58 mm thermal',
  '76': '76 mm dot matrix',
  '80': '80 mm thermal',
};

const STORAGE_KEY = 'pos.receipt-paper-size';

export function loadReceiptPaperSize(storage: Pick<Storage, 'getItem'> = localStorage): ThermalPaperSize {
  const saved = storage.getItem(STORAGE_KEY);
  return RECEIPT_PAPER_SIZES.find((size) => size === saved) ?? '80';
}

export function saveReceiptPaperSize(size: ThermalPaperSize, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, size);
}
