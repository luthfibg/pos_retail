import type { CreditState } from '@/lib/api/types';

export const CREDIT_LABEL: Record<CreditState, string> = {
  limit_not_set: 'Batas belum diisi',
  available: 'Kredit tersedia',
  exhausted: 'Batas habis',
  archived: 'Diarsipkan',
};

export const CREDIT_HINT: Record<CreditState, string> = {
  limit_not_set: 'Batas kredit belum ditetapkan Admin; transaksi kredit belum dapat dilakukan.',
  available: 'Dapat memakai kredit sesuai sisa batas bulan ini.',
  exhausted: 'Sisa batas habis. Tawarkan tunai; pengecualian hanya oleh Admin.',
  archived: 'Debitur diarsipkan dan tidak dapat dipakai untuk transaksi baru.',
};

export const CREDIT_CLS: Record<CreditState, string> = {
  limit_not_set: 'bg-amber-100 text-amber-800 ring-amber-200',
  available: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  exhausted: 'bg-red-100 text-red-800 ring-red-200',
  archived: 'bg-slate-100 text-slate-700 ring-slate-300',
};

export const canUseCredit = (state: CreditState): boolean => state === 'available';
