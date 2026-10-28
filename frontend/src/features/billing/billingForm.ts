export interface PaymentValues {
  amount: string;
  receivedOn: string;
  reference: string;
  note: string;
}

export function validatePayment(values: PaymentValues, remaining: string): string | null {
  const amount = toCents(values.amount);
  const due = toCents(remaining);
  if (amount === null || amount <= 0n) return 'Masukkan pembayaran lebih dari nol dengan maksimal 2 angka desimal.';
  if (amount > 99_999_999_999_900n) return 'Jumlah pembayaran melebihi batas yang diizinkan.';
  if (due === null || amount > due) return 'Jumlah pembayaran tidak boleh melebihi sisa tagihan.';
  if (values.receivedOn && !isCalendarDate(values.receivedOn)) return 'Tanggal pembayaran tidak valid.';
  if (values.reference.trim().length > 100) return 'Referensi maksimal 100 karakter.';
  if (values.note.trim().length > 255) return 'Catatan maksimal 255 karakter.';
  return null;
}

export function buildPaymentInput(values: PaymentValues): {
  amount: string;
  received_on?: string;
  reference?: string;
  note?: string;
} {
  return {
    amount: values.amount.trim(),
    ...(values.receivedOn ? { received_on: values.receivedOn } : {}),
    ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
    ...(values.note.trim() ? { note: values.note.trim() } : {}),
  };
}

function toCents(value: string): bigint | null {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
