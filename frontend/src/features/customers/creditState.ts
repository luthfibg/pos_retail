import type { CreditState, CustomerStatus } from '@/lib/api/types';

export const CREDIT_LABEL: Record<CreditState, string> = {
  not_verified: 'Belum diverifikasi',
  limit_not_set: 'Batas belum diisi',
  available: 'Kredit tersedia',
  exhausted: 'Batas habis',
  inactive: 'Nonaktif',
};

export const CREDIT_HINT: Record<CreditState, string> = {
  not_verified: 'Menunggu verifikasi Admin. Sementara hanya bisa transaksi tunai.',
  limit_not_set: 'Sudah diverifikasi, tetapi batas kredit belum diisi Admin. Kredit ditahan; hanya tunai.',
  available: 'Dapat memakai kredit sesuai sisa batas bulan ini.',
  exhausted: 'Sisa batas habis. Tawarkan tunai; pengecualian hanya oleh Admin.',
  inactive: 'Karyawan nonaktif; tidak dapat dipilih untuk kredit.',
};

export const CREDIT_CLS: Record<CreditState, string> = {
  not_verified: 'bg-amber-100 text-amber-800 ring-amber-200',
  limit_not_set: 'bg-amber-100 text-amber-800 ring-amber-200',
  available: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  exhausted: 'bg-red-100 text-red-800 ring-red-200',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  pending_verification: 'Menunggu verifikasi',
  active: 'Aktif',
  inactive: 'Nonaktif',
};

export const STATUS_CLS: Record<CustomerStatus, string> = {
  pending_verification: 'bg-amber-100 text-amber-800 ring-amber-200',
  active: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-200',
};

/** Hanya `available` yang boleh memakai kredit (dasar tombol "Kredit" di POS). */
export const canUseCredit = (state: CreditState): boolean => state === 'available';
