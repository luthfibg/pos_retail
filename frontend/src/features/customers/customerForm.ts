import type { Customer, CustomerInput, CustomerStatus } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';

export interface CustomerFormValues {
  customerNo: string;
  name: string;
  department: string;
  status: CustomerStatus;
  reason: string;
}

export type CustomerErrors = Partial<Record<'customer_no' | 'name' | 'department' | 'status', string>>;

export type CustomerUpdate = Partial<CustomerInput> & { status?: 'active' | 'inactive'; reason?: string };

export const emptyCustomer = (): CustomerFormValues => ({
  customerNo: '', name: '', department: '', status: 'pending_verification', reason: '',
});

export const valuesFromCustomer = (c: Customer): CustomerFormValues => ({
  customerNo: c.customer_no, name: c.name, department: c.department ?? '', status: c.status, reason: '',
});

const NO_RE = /^[A-Za-z0-9._\-\/]+$/;

export function validateCustomer(v: CustomerFormValues): CustomerErrors {
  const e: CustomerErrors = {};
  const no = v.customerNo.trim();
  if (!no) e.customer_no = 'Nomor karyawan (NIK) wajib diisi.';
  else if (no.length > 40) e.customer_no = 'Maksimal 40 karakter.';
  else if (!NO_RE.test(no)) e.customer_no = 'Hanya huruf, angka, dan . _ - /';
  if (!v.name.trim()) e.name = 'Nama wajib diisi.';
  else if (v.name.trim().length > 150) e.name = 'Maksimal 150 karakter.';
  if (v.department.trim().length > 100) e.department = 'Maksimal 100 karakter.';
  return e;
}

export function buildCustomerCreate(v: CustomerFormValues): CustomerInput {
  const input: CustomerInput = { customer_no: v.customerNo.trim(), name: v.name.trim() };
  if (v.department.trim()) input.department = v.department.trim();
  return input;
}

/** Hanya kolom yang berubah. Status hanya boleh active<->inactive (verifikasi lewat tombol Verifikasi). */
export function buildCustomerUpdate(v: CustomerFormValues, original: Customer): CustomerUpdate {
  const p: CustomerUpdate = {};
  if (v.customerNo.trim() !== original.customer_no) p.customer_no = v.customerNo.trim();
  if (v.name.trim() !== original.name) p.name = v.name.trim();

  const dept = v.department.trim() === '' ? null : v.department.trim();
  if (dept !== (original.department ?? null)) p.department = dept;

  if (
    original.status !== 'pending_verification' &&
    v.status !== original.status &&
    v.status !== 'pending_verification'
  ) {
    p.status = v.status;
  }

  if (Object.keys(p).length > 0 && v.reason.trim()) p.reason = v.reason.trim();
  return p;
}

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

/** Validasi nominal batas kredit. Mengembalikan pesan galat, atau undefined bila valid. */
export function validateMoney(raw: string, required: boolean): string | undefined {
  const v = normalizeDecimal(raw);
  if (!v) return required ? 'Nominal wajib diisi.' : undefined;
  if (!MONEY_RE.test(v)) return 'Nominal tidak valid (angka, maks. 2 desimal).';
  return undefined;
}

export function buildVerifyPayload(limit: string, note: string, canSetLimit: boolean) {
  const p: { credit_limit?: string; note?: string } = {};
  const l = normalizeDecimal(limit);
  if (canSetLimit && l) p.credit_limit = l; // tanpa izin set_limit, backend menjawab 403
  if (note.trim()) p.note = note.trim();
  return p;
}
