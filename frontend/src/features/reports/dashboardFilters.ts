export interface DashboardFilterValues {
  dateFrom: string;
  dateTo: string;
  cashierId: string;
}

export function validateDashboardFilters({ dateFrom, dateTo, cashierId }: DashboardFilterValues): string | null {
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo)) return 'Pilih tanggal awal dan akhir yang valid.';
  if (dateFrom > dateTo) return 'Tanggal awal tidak boleh setelah tanggal akhir.';

  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo}T00:00:00Z`);
  const days = (to - from) / 86_400_000;
  if (days > 365) return 'Rentang laporan maksimal 365 hari.';
  if (cashierId && (!/^[1-9]\d*$/.test(cashierId) || !Number.isSafeInteger(Number(cashierId)))) {
    return 'ID kasir harus berupa bilangan bulat positif.';
  }
  return null;
}

export function chartHeight(value: string, maximum: string): number {
  const valueCents = decimalToCents(value);
  const maximumCents = decimalToCents(maximum);
  if (valueCents === null || maximumCents === null || maximumCents <= 0n || valueCents <= 0n) return 0;
  const hundredths = (valueCents * 10_000n) / maximumCents;
  return Math.min(100, Math.max(2, Number(hundredths) / 100));
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decimalToCents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const units = BigInt(match[2] ?? '0') * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -units : units;
}
