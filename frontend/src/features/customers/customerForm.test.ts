import { describe, expect, it } from 'vitest';
import type { Customer } from '@/lib/api/types';
import {
  buildCustomerCreate, buildCustomerUpdate, emptyCustomer, PAYMENT_STATUS, validateCustomer,
  validateMoney, valuesFromCustomer, type CustomerFormValues,
} from './customerForm';

const customer: Customer = {
  id: 3,
  customer_no: 'NIK-100',
  ktp_no: '3201234567890001',
  name: 'Budi',
  phone: '08123456789',
  address: 'Jl. KTP No. 1',
  domicile: 'Jl. Domisili No. 2',
  company_name: 'PT Contoh',
  position: 'Operator',
  department: 'Produksi',
  employment_type: 'permanent',
  employment_start_date: '2024-01-15',
  hrd_name: 'HRD Contoh',
  hrd_phone: '08123456780',
  supervisor_name: 'Atasan Contoh',
  supervisor_phone: '08123456781',
  credit_state: 'available',
  credit_remaining: '900000.00',
};

const validValues = (): CustomerFormValues => ({
  ...emptyCustomer(),
  customer_no: ' NIK-100 ',
  ktp_no: ' 3201234567890001 ',
  name: ' Budi ',
  phone: ' 08123456789 ',
  address: ' Jl. KTP No. 1 ',
  domicile: ' Jl. Domisili No. 2 ',
  company_name: ' PT Contoh ',
  position: ' Operator ',
  department: ' Produksi ',
  employment_type: 'permanent',
  employment_start_date: '2024-01-15',
  hrd_name: ' HRD Contoh ',
  hrd_phone: ' 08123456780 ',
  supervisor_name: ' Atasan Contoh ',
  supervisor_phone: ' 08123456781 ',
});

describe('validateCustomer', () => {
  it('requires all registration profile fields', () => {
    const errors = validateCustomer(emptyCustomer());
    expect(errors.customer_no).toBeTruthy();
    expect(errors.ktp_no).toBeTruthy();
    expect(errors.name).toBeTruthy();
    expect(errors.employment_type).toBeTruthy();
    expect(errors.supervisor_phone).toBeTruthy();
  });

  it('validates KTP number, employee number, phone and employment date', () => {
    const values = {
      ...validValues(),
      ktp_no: '123',
      customer_no: 'NIK #1',
      phone: 'abc',
      employment_start_date: '2024-02-31',
    };
    const errors = validateCustomer(values);
    expect(errors.ktp_no).toBeTruthy();
    expect(errors.customer_no).toBeTruthy();
    expect(errors.phone).toBeTruthy();
    expect(errors.employment_start_date).toBeTruthy();
  });
});

describe('customer payloads', () => {
  it('trims all fields for registration', () => {
    expect(buildCustomerCreate(validValues())).toEqual({
      customer_no: 'NIK-100',
      ktp_no: '3201234567890001',
      name: 'Budi',
      phone: '08123456789',
      address: 'Jl. KTP No. 1',
      domicile: 'Jl. Domisili No. 2',
      company_name: 'PT Contoh',
      position: 'Operator',
      department: 'Produksi',
      employment_type: 'permanent',
      employment_start_date: '2024-01-15',
      hrd_name: 'HRD Contoh',
      hrd_phone: '08123456780',
      supervisor_name: 'Atasan Contoh',
      supervisor_phone: '08123456781',
    });
  });

  it('does not send unchanged values and sends only the edited profile field', () => {
    expect(buildCustomerUpdate(valuesFromCustomer(customer), customer)).toEqual({});
    expect(buildCustomerUpdate({ ...valuesFromCustomer(customer), name: 'Budi Baru' }, customer))
      .toEqual({ name: 'Budi Baru' });
  });

  it('uses the fixed payroll deduction payment status', () => {
    expect(PAYMENT_STATUS).toBe('Pemotongan Gaji Tiap Bulan');
  });
});

describe('money', () => {
  it('validates optional and required amounts', () => {
    expect(validateMoney('', true)).toBeTruthy();
    expect(validateMoney('', false)).toBeUndefined();
    expect(validateMoney('1500000', true)).toBeUndefined();
    expect(validateMoney('1500000,50', true)).toBeUndefined();
    expect(validateMoney('1.5', false)).toBeUndefined();
    expect(validateMoney('abc', true)).toBeTruthy();
    expect(validateMoney('-5', true)).toBeTruthy();
  });
});
