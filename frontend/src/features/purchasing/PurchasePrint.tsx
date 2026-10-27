import { useEffect } from 'react';
import type { PurchaseOrder, PurchaseRequisition, Supplier } from '@/lib/api/types';
import { formatDate, formatDateTime, formatQty, formatRupiah } from '@/lib/format';

export type PrintJob =
  | { kind: 'pr'; pr: PurchaseRequisition }
  | { kind: 'po'; po: PurchaseOrder; supplier: Supplier | null };

const TERMS_LABEL = { prepaid: 'Prabayar', credit: 'Kredit', cod: 'Bayar saat terima (COD)' } as const;

/**
 * Lembar cetak A4 untuk PR dan PO. Tampil hanya saat mencetak (kelas `print-only`);
 * seluruh layar lain memakai `no-print`. Semua angka berasal dari server.
 * Memicu `window.print()` begitu lembar terpasang, lalu memanggil `onDone` setelah dialog cetak selesai.
 */
export function PurchasePrintSheet({ job, storeName, onDone }: { job: PrintJob; storeName: string; onDone: () => void }) {
  useEffect(() => {
    window.addEventListener('afterprint', onDone, { once: true });
    const timer = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', onDone);
    };
  }, [job, onDone]);

  return (
    <div className="print-only print-doc">
      {job.kind === 'pr' ? <PrSheet pr={job.pr} storeName={storeName} /> : <PoSheet po={job.po} supplier={job.supplier} storeName={storeName} />}
    </div>
  );
}

function Header({ storeName, title, docNumber, rows }: { storeName: string; title: string; docNumber: string; rows: Array<[string, string]> }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
      <div>
        <div className="text-base font-bold">{storeName}</div>
        <div className="text-xl font-bold tracking-wide">{title}</div>
      </div>
      <dl className="text-right text-xs leading-5">
        <div className="font-mono text-sm font-bold">{docNumber}</div>
        {rows.map(([label, value]) => <div key={label}>{label}: {value}</div>)}
      </dl>
    </header>
  );
}

function Signatures({ cells }: { cells: Array<{ role: string; name?: string | null; at?: string | null }> }) {
  return (
    <div className="mt-10 grid grid-cols-3 gap-6 text-center text-xs" style={{ breakInside: 'avoid' }}>
      {cells.map((cell) => (
        <div key={cell.role}>
          <div>{cell.role}</div>
          <div className="h-16" />
          <div className="border-t border-black pt-1 font-medium">{cell.name || '(............................)'}</div>
          {cell.at && <div className="text-[10px]">{cell.at}</div>}
        </div>
      ))}
    </div>
  );
}

function PrSheet({ pr, storeName }: { pr: PurchaseRequisition; storeName: string }) {
  const finance = pr.approvals.find((a) => a.step === 'finance_check' && a.decision === 'approved');
  const owner = pr.approvals.find((a) => a.step === 'owner_auth' && a.decision === 'approved');
  return (
    <article>
      <Header
        storeName={storeName}
        title="PERMINTAAN PEMBELIAN"
        docNumber={pr.doc_number}
        rows={[['Diajukan', formatDateTime(pr.submitted_at)], ['Pemohon', pr.requester_name]]}
      />
      {pr.reason && <p className="mb-3 text-xs"><strong>Alasan / kebutuhan:</strong> {pr.reason}</p>}
      <table>
        <thead>
          <tr><th>No</th><th>SKU</th><th>Produk</th><th className="text-right">Jumlah</th><th>Satuan</th><th className="text-right">Estimasi/unit</th><th>Catatan</th></tr>
        </thead>
        <tbody>
          {pr.items.map((item, i) => (
            <tr key={item.id}>
              <td>{i + 1}</td>
              <td className="font-mono">{item.sku}</td>
              <td>{item.name}</td>
              <td className="text-right">{formatQty(item.qty)}</td>
              <td>{item.unit_name}</td>
              <td className="text-right">{formatRupiah(item.est_price)}</td>
              <td>{item.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-right text-sm font-bold">Estimasi total: {formatRupiah(pr.est_total)}</p>
      <Signatures
        cells={[
          { role: 'Pemohon', name: pr.requester_name, at: formatDateTime(pr.submitted_at) },
          { role: 'Diperiksa Finance', name: finance?.decided_by_name, at: finance ? formatDateTime(finance.decided_at) : null },
          { role: 'Disetujui Owner', name: owner?.decided_by_name, at: owner ? formatDateTime(owner.decided_at) : null },
        ]}
      />
    </article>
  );
}

function PoSheet({ po, supplier, storeName }: { po: PurchaseOrder; supplier: Supplier | null; storeName: string }) {
  return (
    <article>
      <Header
        storeName={storeName}
        title="PURCHASE ORDER"
        docNumber={po.doc_number}
        rows={[['Tanggal PO', formatDate(po.order_date)], ['Perkiraan tiba', formatDate(po.expected_date)], ['Ref. PR', po.pr_doc_number]]}
      />
      <section className="mb-3 grid grid-cols-2 gap-6 text-xs leading-5">
        <div>
          <div className="font-bold">Kepada (Supplier)</div>
          <div>{po.supplier_name}</div>
          {supplier?.contact_name && <div>Up. {supplier.contact_name}</div>}
          {supplier?.address && <div>{supplier.address}</div>}
          {supplier?.phone && <div>Telp. {supplier.phone}</div>}
        </div>
        <div>
          <div className="font-bold">Ketentuan</div>
          <div>Pembayaran: {TERMS_LABEL[po.payment_terms]}</div>
          <div>Dibuat oleh: {po.created_by_name}</div>
        </div>
      </section>
      <table>
        <thead>
          <tr><th>No</th><th>SKU</th><th>Produk</th><th className="text-right">Jumlah</th><th>Satuan</th><th className="text-right">Harga/unit</th><th className="text-right">Subtotal</th></tr>
        </thead>
        <tbody>
          {po.items.map((item, i) => (
            <tr key={item.id}>
              <td>{i + 1}</td>
              <td className="font-mono">{item.sku}</td>
              <td>{item.name}</td>
              <td className="text-right">{formatQty(item.qty_ordered)}</td>
              <td>{item.unit_name}</td>
              <td className="text-right">{formatRupiah(item.unit_price)}</td>
              <td className="text-right">{formatRupiah(item.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-right text-sm font-bold">Total: {formatRupiah(po.total)}</p>
      <Signatures
        cells={[
          { role: 'Dibuat oleh', name: po.created_by_name, at: formatDateTime(po.created_at) },
          { role: 'Disetujui Owner' },
          { role: 'Supplier' },
        ]}
      />
    </article>
  );
}
