import type { Supplier, SupplierInput } from '@/lib/api/types';

export interface SupplierFormValues {
  code: string;
  name: string;
  contactName: string;
  phone: string;
  address: string;
  isActive: boolean;
}

export type SupplierErrors = Partial<Record<
  'code' | 'name' | 'contact_name' | 'phone' | 'address' | 'is_active',
  string
>>;

export type SupplierUpdate = Partial<Omit<SupplierInput, 'code'>> & { is_active?: boolean };

export function emptySupplier(): SupplierFormValues {
  return { code: '', name: '', contactName: '', phone: '', address: '', isActive: true };
}

export function valuesFromSupplier(s: Supplier): SupplierFormValues {
  return {
    code: s.code,
    name: s.name,
    contactName: s.contact_name ?? '',
    phone: s.phone ?? '',
    address: s.address ?? '',
    isActive: s.is_active,
  };
}

export function validateSupplier(v: SupplierFormValues, mode: 'create' | 'edit'): SupplierErrors {
  const e: SupplierErrors = {};
  if (mode === 'create') {
    const code = v.code.trim();
    if (!code) e.code = 'Kode supplier wajib diisi.';
    else if (!/^[A-Za-z0-9._-]{1,30}$/.test(code)) e.code = 'Hanya huruf, angka, titik, garis bawah, dan strip (maks. 30).';
  }
  if (!v.name.trim()) e.name = 'Nama supplier wajib diisi.';
  else if (v.name.trim().length > 150) e.name = 'Maksimal 150 karakter.';
  if (v.contactName.trim().length > 120) e.contact_name = 'Maksimal 120 karakter.';
  if (v.phone.trim().length > 40) e.phone = 'Maksimal 40 karakter.';
  if (v.address.trim().length > 255) e.address = 'Maksimal 255 karakter.';
  return e;
}

export function buildSupplierCreate(v: SupplierFormValues): SupplierInput {
  const input: SupplierInput = {
    code: v.code.trim(),
    name: v.name.trim(),
  };
  if (v.contactName.trim()) input.contact_name = v.contactName.trim();
  if (v.phone.trim()) input.phone = v.phone.trim();
  if (v.address.trim()) input.address = v.address.trim();
  return input;
}

/** Hanya kolom yang berubah. Kolom opsional yang dikosongkan dikirim sebagai null. */
export function buildSupplierUpdate(v: SupplierFormValues, original: Supplier): SupplierUpdate {
  const p: SupplierUpdate = {};
  if (v.name.trim() !== original.name) p.name = v.name.trim();

  const optional = (value: string, old: string | null): string | null | undefined => {
    const next = value.trim() === '' ? null : value.trim();
    return next === (old ?? null) ? undefined : next;
  };
  const contact = optional(v.contactName, original.contact_name);
  const phone = optional(v.phone, original.phone);
  const address = optional(v.address, original.address);
  if (contact !== undefined) p.contact_name = contact;
  if (phone !== undefined) p.phone = phone;
  if (address !== undefined) p.address = address;

  if (v.isActive !== original.is_active) p.is_active = v.isActive;
  return p;
}
