export interface StockMonitoringErrors {
  low_stock_threshold?: string;
}

export function normalizeThreshold(value: string): string {
  return value.trim().replace(',', '.');
}

export function sameThreshold(a: string, b: string): boolean {
  const canonical = (value: string) => {
    const [whole = '', fraction = ''] = normalizeThreshold(value).split('.');
    return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(3, '0')}`;
  };
  return canonical(a) === canonical(b);
}

export function validateThreshold(value: string): StockMonitoringErrors {
  const normalized = normalizeThreshold(value);
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);
  const integer = match?.[1]?.replace(/^0+(?=\d)/, '');

  if (
    !match
    || !integer
    || integer.length > 5
    || (integer.length === 5 && integer > '99999')
    || (integer === '99999' && /[1-9]/.test(match[2] ?? ''))
  ) {
    return { low_stock_threshold: 'Isi angka 0–99.999 dengan maksimal 3 desimal.' };
  }

  return {};
}
