import type { VatInput, VatSetting } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { moneyToCents } from '@/lib/money';

export interface VatFormValues {
  enabled: boolean;
  rate: string;
  /** true = harga jual sudah termasuk PPN; false = PPN ditambahkan di atas harga; null = belum dipilih */
  includes: boolean | null;
}

export type VatErrors = Partial<Record<'rate' | 'price_includes_tax', string>>;

export const valuesFromVat = (s: VatSetting): VatFormValues => ({
  enabled: s.enabled,
  rate: s.rate ?? '',
  includes: s.price_includes_tax,
});

const RATE_RE = /^\d{1,3}(\.\d{1,2})?$/;

export function validateVat(v: VatFormValues): VatErrors {
  const e: VatErrors = {};
  if (!v.enabled) return e;
  const rate = normalizeDecimal(v.rate);
  const cents = moneyToCents(rate);
  if (!rate) e.rate = 'Tarif wajib diisi saat PPN diaktifkan.';
  else if (!RATE_RE.test(rate) || cents === null) e.rate = 'Tarif tidak valid (angka, maks. 2 desimal).';
  else if (cents > 10000n) e.rate = 'Tarif tidak boleh lebih dari 100.';
  if (v.includes === null) e.price_includes_tax = 'Pilih apakah harga jual sudah termasuk PPN.';
  return e;
}

/** Panggil validateVat lebih dulu. Menonaktifkan hanya mengirim `enabled: false` (riwayat tarif tidak dihapus). */
export function buildVatInput(v: VatFormValues): VatInput {
  if (!v.enabled) return { enabled: false };
  if (v.includes === null) throw new Error('Pilih status harga termasuk PPN sebelum menyimpan.');
  return { enabled: true, rate: normalizeDecimal(v.rate), price_includes_tax: v.includes };
}

/** Apakah isi form berbeda dari pengaturan tersimpan (tarif dibandingkan sebagai angka, bukan teks). */
export function isVatDirty(v: VatFormValues, saved: VatSetting): boolean {
  if (v.enabled !== saved.enabled) return true;
  if (!v.enabled) return false;
  const a = moneyToCents(normalizeDecimal(v.rate));
  const b = saved.rate === null ? null : moneyToCents(saved.rate);
  return a !== b || v.includes !== saved.price_includes_tax;
}
