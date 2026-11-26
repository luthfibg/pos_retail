import { useEffect, useRef, useState } from 'react';
import { Field, inputCls } from '@/components/ui/Field';
import { loadReceiptPaperSize, RECEIPT_PAPER_LABELS, saveReceiptPaperSize, type ThermalPaperSize } from './receiptPrintSettings';

export function CashierSettingsPage() {
  const [paperSize, setPaperSize] = useState<ThermalPaperSize>(() => loadReceiptPaperSize());
  const [error, setError] = useState<string | null>(null);
  const [printingTest, setPrintingTest] = useState(false);
  const testPrintCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => testPrintCleanupRef.current?.(), []);

  function changePaperSize(size: ThermalPaperSize) {
    try {
      saveReceiptPaperSize(size);
      setPaperSize(size);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? `Pengaturan perangkat tidak dapat disimpan: ${reason.message}` : 'Pengaturan perangkat tidak dapat disimpan.');
    }
  }

  function printTestReceipt() {
    if (printingTest) return;
    setError(null);
    setPrintingTest(true);
    const cleanup = () => {
      document.body.classList.remove('receipt-test-printing');
      window.removeEventListener('afterprint', cleanup);
      testPrintCleanupRef.current = null;
      setPrintingTest(false);
    };
    testPrintCleanupRef.current = cleanup;
    document.body.classList.add('receipt-test-printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(() => {
      try {
        window.print();
      } catch (reason) {
        cleanup();
        setError(reason instanceof Error ? `Cetak uji gagal: ${reason.message}` : 'Cetak uji gagal.');
      }
    }, 80);
  }

  return (
    <div className="space-y-5 p-6">
      <header>
        <h1 className="text-xl font-semibold">Pengaturan</h1>
        <p className="mt-1 text-sm text-slate-600">Atur jenis dan lebar kertas struk untuk perangkat kasir ini.</p>
      </header>

      <section className="max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <h2 className="font-semibold">Printer struk</h2>
          <p className="mt-1 text-sm text-slate-600">Pengaturan disimpan di browser perangkat ini dan digunakan untuk transaksi serta cetak ulang.</p>
        </div>
        <Field label="Jenis dan lebar kertas">
          <select
            className={inputCls}
            aria-label="Jenis dan lebar kertas struk"
            value={paperSize}
            onChange={(event) => changePaperSize(event.target.value as ThermalPaperSize)}
          >
            {Object.entries(RECEIPT_PAPER_LABELS).map(([size, label]) => (
              <option key={size} value={size}>{label}</option>
            ))}
          </select>
        </Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button
          type="button"
          disabled={printingTest}
          onClick={printTestReceipt}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {printingTest ? 'Mencetak uji…' : 'Cetak uji'}
        </button>
      </section>

      <ReceiptPrinterTestSheet paperSize={paperSize} />
    </div>
  );
}

function ReceiptPrinterTestSheet({ paperSize }: { paperSize: ThermalPaperSize }) {
  return (
    <div className={`print-test-only receipt receipt-${paperSize} mx-auto w-full max-w-[22rem] bg-white p-4 font-mono text-xs leading-5`}>
      <div className="text-center">
        <div className="text-sm font-bold">UJI CETAK POS</div>
        <div>{RECEIPT_PAPER_LABELS[paperSize]}</div>
        <div>Jika teks terbaca dan tidak terpotong, printer siap.</div>
      </div>
      <div className="mt-2 border-t border-dashed border-slate-400 pt-2">
        <div className="flex justify-between"><span>Nama barang contoh</span><span>10.000</span></div>
        <div className="flex justify-between"><span>Jumlah</span><span>1</span></div>
        <div className="flex justify-between font-bold"><span>TOTAL</span><span>10.000</span></div>
      </div>
      <div className="mt-2 text-center">----- UJUNG CETAK -----</div>
    </div>
  );
}
