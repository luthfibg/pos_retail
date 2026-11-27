import type { Customer } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { PAYMENT_STATUS } from './customerForm';

const value = (text?: string | null) => text?.trim() || '—';

export function CustomerRegistrationPrint({ customer }: { customer: Customer }) {
  const rows = [
    ['Nomor KTP', value(customer.ktp_no), 'Nomor Induk Karyawan', customer.customer_no],
    ['Nama lengkap sesuai KTP', customer.name, 'Nomor telepon/HP', value(customer.phone)],
    ['Alamat sesuai KTP', value(customer.address), 'Domisili sekarang', value(customer.domicile)],
    ['Perusahaan', value(customer.company_name), 'Jabatan', value(customer.position)],
    ['Departemen/Divisi', value(customer.department), 'Status karyawan', customer.employment_type === 'contract' ? 'Kontrak' : 'Tetap'],
    ['Mulai bekerja', customer.employment_start_date ? formatDate(customer.employment_start_date) : '—', 'Status pembayaran', PAYMENT_STATUS],
    ['Nama HRD', value(customer.hrd_name), 'Nomor telepon/HP HRD', value(customer.hrd_phone)],
    ['Atasan langsung', value(customer.supervisor_name), 'Nomor telepon/HP atasan', value(customer.supervisor_phone)],
  ];

  const signatures = [
    { role: 'Pemohon', name: customer.name },
    { role: 'Diketahui, Atasan Langsung', name: value(customer.supervisor_name) },
    { role: 'Diketahui, HRD', name: value(customer.hrd_name) },
    { role: 'Disetujui', name: value(customer.company_name) },
  ];

  return (
    <article className="print-only print-doc customer-registration-print text-black">
      <header className="mb-6 border-b-2 border-black pb-3 text-center">
        <h1 className="text-xl font-bold">FORMULIR PENDAFTARAN DEBITUR</h1>
        <p className="mt-1 text-sm">Pelanggan Toko — Pemotongan Gaji Tiap Bulan</p>
      </header>

      <table>
        <tbody>
          {rows.map(([labelA, valueA, labelB, valueB]) => (
            <tr key={labelA}>
              <th className="w-[20%]">{labelA}</th>
              <td className="w-[30%]">{valueA}</td>
              <th className="w-[20%]">{labelB}</th>
              <td className="w-[30%]">{valueB}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-5 text-justify text-xs leading-5">
        Dengan ini saya mengajukan pendaftaran sebagai debitur/pelanggan toko dan menyatakan data yang dicantumkan benar.
        Saya menyetujui pembayaran transaksi kredit melalui pemotongan gaji setiap bulan sesuai ketentuan perusahaan.
      </p>

      <section className="mt-8 grid grid-cols-4 gap-3 text-center text-xs">
        {signatures.map((signature) => (
          <div key={signature.role} className="flex flex-col items-center">
            <div className="min-h-8 font-medium">{signature.role}</div>
            <div className="h-20 w-full" />
            <div className="w-full border-t border-black pt-1 font-medium">{signature.name}</div>
          </div>
        ))}
      </section>
    </article>
  );
}
