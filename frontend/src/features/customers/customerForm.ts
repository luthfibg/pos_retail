import type { Customer, CustomerInput } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';

export type CustomerFormValues = Omit<CustomerInput, 'employment_type'> & {
  employment_type: CustomerInput['employment_type'] | '';
};

export type CustomerErrors = Partial<Record<keyof CustomerInput, string>>;
export type CustomerUpdate = Partial<CustomerInput>;

export const PAYMENT_STATUS = 'Pemotongan Gaji Tiap Bulan';

export const emptyCustomer = (): CustomerFormValues => ({
  customer_no: '',
  ktp_no: '',
  name: '',
  phone: '',
  address: '',
  domicile: '',
  company_name: '',
  position: '',
  department: '',
  employment_type: '',
  employment_start_date: '',
  hrd_name: '',
  hrd_phone: '',
  supervisor_name: '',
  supervisor_phone: '',
});

export const valuesFromCustomer = (customer: Customer): CustomerFormValues => ({
  customer_no: customer.customer_no,
  ktp_no: customer.ktp_no ?? '',
  name: customer.name,
  phone: customer.phone ?? '',
  address: customer.address ?? '',
  domicile: customer.domicile ?? '',
  company_name: customer.company_name ?? '',
  position: customer.position ?? '',
  department: customer.department ?? '',
  employment_type: customer.employment_type ?? '',
  employment_start_date: customer.employment_start_date ?? '',
  hrd_name: customer.hrd_name ?? '',
  hrd_phone: customer.hrd_phone ?? '',
  supervisor_name: customer.supervisor_name ?? '',
  supervisor_phone: customer.supervisor_phone ?? '',
});

const NO_RE = /^[A-Za-z0-9._\-\/]+$/;
const PHONE_RE = /^[+0-9()\-\s]{6,30}$/;

export function validateCustomer(values: CustomerFormValues): CustomerErrors {
  const errors: CustomerErrors = {};
  const required: Array<keyof CustomerInput> = [
    'customer_no', 'ktp_no', 'name', 'phone', 'address', 'domicile', 'company_name',
    'position', 'department', 'employment_start_date', 'hrd_name', 'hrd_phone',
    'supervisor_name', 'supervisor_phone',
  ];

  for (const field of required) {
    if (!values[field].trim()) errors[field] = 'Wajib diisi.';
  }
  if (!values.employment_type) errors.employment_type = 'Wajib diisi.';

  if (values.customer_no.trim() && (values.customer_no.trim().length > 40 || !NO_RE.test(values.customer_no.trim()))) {
    errors.customer_no = 'Nomor induk hanya boleh berisi huruf, angka, dan . _ - / (maks. 40 karakter).';
  }
  if (values.ktp_no.trim() && !/^\d{16}$/.test(values.ktp_no.trim())) {
    errors.ktp_no = 'Nomor KTP harus terdiri dari 16 angka.';
  }
  for (const field of ['phone', 'hrd_phone', 'supervisor_phone'] as const) {
    if (values[field].trim() && !PHONE_RE.test(values[field].trim())) errors[field] = 'Format nomor telepon tidak valid.';
  }
  if (values.employment_start_date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(values.employment_start_date);
    if (!match) {
      errors.employment_start_date = 'Tanggal mulai bekerja tidak valid.';
    } else {
      const [, yearText, monthText, dayText] = match;
      const year = Number(yearText);
      const month = Number(monthText);
      const day = Number(dayText);
      const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] ?? 0)) {
        errors.employment_start_date = 'Tanggal mulai bekerja tidak valid.';
      }
    }
  }
  return errors;
}

export function buildCustomerCreate(values: CustomerFormValues): CustomerInput | null {
  if (!values.employment_type) return null;
  const input: CustomerInput = { ...values, employment_type: values.employment_type };
  for (const field of Object.keys(input) as Array<keyof CustomerInput>) {
    Object.assign(input, { [field]: input[field].trim() });
  }
  return input;
}

export function buildCustomerUpdate(values: CustomerFormValues, original: Customer): CustomerUpdate {
  const payload: CustomerUpdate = {};
  for (const field of Object.keys(values) as Array<keyof CustomerInput>) {
    const originalValue = field === 'customer_no' ? original.customer_no : original[field] ?? '';
    if (field === 'employment_type' && !values.employment_type) continue;
    if (values[field] !== originalValue) Object.assign(payload, { [field]: values[field].trim() });
  }
  return payload;
}

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

export function validateMoney(raw: string, required: boolean): string | undefined {
  const value = normalizeDecimal(raw);
  if (!value) return required ? 'Nominal wajib diisi.' : undefined;
  if (!MONEY_RE.test(value)) return 'Nominal tidak valid (angka, maks. 2 desimal).';
  return undefined;
}
