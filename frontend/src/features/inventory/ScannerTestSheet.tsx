import { useEffect, useMemo, useState } from 'react';
import { useScannerCapture, type ScannerDiagnostic } from './useScannerCapture';
import { readScannerSettings, resetScannerSettings, writeScannerSettings, type ScannerSettings } from './scannerSettings';
import scannerGuide from '../../../../docs/PANDUAN_SCANNER_BLUETOOTH.md?raw';

interface Props {
  onClose: () => void;
}

export function ScannerTestSheet({ onClose }: Props) {
  const [settings, setSettings] = useState<ScannerSettings>(readScannerSettings);
  const [diagnostics, setDiagnostics] = useState<ScannerDiagnostic[]>([]);
  const [calibrationScans, setCalibrationScans] = useState<ScannerDiagnostic[]>([]);
  const [calibratedDelay, setCalibratedDelay] = useState<number | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [storageStatus, setStorageStatus] = useState('Memeriksa penyimpanan…');
  const [guideUrl, setGuideUrl] = useState('');

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!navigator.storage?.persisted) {
        if (alive) setStorageStatus('Perlindungan penyimpanan tidak tersedia di browser ini.');
        return;
      }
      try {
        const persisted = await navigator.storage.persisted();
        if (alive) setStorageStatus(persisted ? 'Penyimpanan lokal dilindungi.' : 'Penyimpanan lokal belum dilindungi.');
      } catch {
        if (alive) setStorageStatus('Status penyimpanan lokal tidak dapat diperiksa.');
      }
    };
    void check();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([scannerGuide], { type: 'text/markdown' }));
    setGuideUrl(url);
    return () => URL.revokeObjectURL(url);
  }, []);

  useScannerCapture({
    active: true,
    onScan: () => undefined,
    onDiagnostic: (diagnostic) => {
      setDiagnostics((current) => [diagnostic, ...current].slice(0, 5));
      if (diagnostic.accepted && diagnostic.suffix === 'Enter' && diagnostic.raw) {
        setCalibrationScans((current) => current.some((scan) => scan.raw === diagnostic.raw)
          ? current
          : [...current, diagnostic].slice(0, 3));
      }
    },
    onDigit: () => undefined,
    onBackspace: () => undefined,
    onEnter: () => undefined,
  });

  const currentStorage = useMemo(() => {
    const storage = navigator.storage;
    return storage ? 'IndexedDB siap bila tersedia.' : 'Penyimpanan offline tidak tersedia.';
  }, []);

  function updateSettings(next: ScannerSettings) {
    setSettings(next);
    writeScannerSettings(next);
  }

  function reset() {
    const defaults = resetScannerSettings();
    setSettings(defaults);
    setCalibrationScans([]);
    setCalibratedDelay(null);
  }

  function prepareCalibration() {
    if (calibrationScans.length < 3) return;
    setCalibratedDelay(Math.max(20, Math.min(150, Math.round(Math.max(...calibrationScans.map((scan) => scan.maxInterKeyDelayMs)) * 1.5))));
  }

  async function protectStorage() {
    if (!navigator.storage?.persist) {
      setStorageStatus('Perlindungan penyimpanan tidak tersedia di browser ini.');
      return;
    }
    try {
      const persisted = await navigator.storage.persist();
      setStorageStatus(persisted ? 'Penyimpanan lokal dilindungi.' : 'Browser tidak memberikan perlindungan penyimpanan.');
    } catch (error) {
      setStorageStatus(error instanceof Error ? `Perlindungan penyimpanan gagal: ${error.message}` : 'Perlindungan penyimpanan gagal.');
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center overflow-y-auto bg-slate-950/60 md:items-center md:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="scanner-test-title" className="my-auto min-h-full w-full space-y-4 bg-white p-4 md:min-h-0 md:max-w-xl md:rounded-xl md:p-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="scanner-test-title" className="text-lg font-semibold">Uji scanner</h2>
            <p className="mt-1 text-sm text-slate-600">Scan barcode berbeda untuk memeriksa koneksi keyboard/HID.</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-slate-300 px-3">Tutup</button>
        </header>

        <input
          data-opname-scanner-capture
          aria-hidden="true"
          tabIndex={-1}
          inputMode="none"
          autoComplete="off"
          className="fixed -left-[10000px] top-0 h-px w-px opacity-0"
        />
        <div className="rounded-lg border border-dashed border-slate-400 bg-slate-50 p-5 text-center">
          <p className="font-medium">Scan barcode apa saja</p>
          <p className="mt-1 text-xs text-slate-600">Scanner perlu mode keyboard/HID tanpa awalan dan akhiran Enter.</p>
        </div>

        {diagnostics[0] ? (
          <section aria-label="Hasil scan terakhir" className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
            <p className="break-all font-mono font-semibold">{diagnostics[0].raw || 'Tidak ada karakter terbaca'}</p>
            <p>Panjang {diagnostics[0].length} · jeda rata-rata {diagnostics[0].averageInterKeyDelayMs} ms · maksimal {diagnostics[0].maxInterKeyDelayMs} ms · akhiran {diagnostics[0].suffix}</p>
            <p className={diagnostics[0].accepted ? 'text-emerald-800' : 'text-amber-900'}>
              {diagnostics[0].accepted ? 'Scan diterima.' : `Scan ditolak: ${diagnostics[0].reason ?? 'Periksa pengaturan scanner.'}`}
            </p>
            {!diagnostics[0].accepted && diagnostics[0].suffix === 'none' && <p className="text-xs text-amber-900">Akhiran Enter tidak terdeteksi, atur scanner agar mengirim Enter.</p>}
            {!diagnostics[0].accepted && diagnostics[0].maxInterKeyDelayMs > settings.maxInterKeyDelayMs && <p className="text-xs text-amber-900">Jeda antar-karakter melebihi ambang. Jalankan kalibrasi.</p>}
          </section>
        ) : (
          <p className="text-sm text-slate-500">Belum ada scan. Jika karakter tidak terbaca, periksa mode keyboard pada scanner.</p>
        )}

        <section className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Kalibrasi</h3>
              <p className="text-xs text-slate-600">Scan tiga barcode yang berbeda ({calibrationScans.length}/3).</p>
            </div>
            <button type="button" disabled={calibrationScans.length < 3} onClick={prepareCalibration} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-50">Hitung ambang</button>
          </div>
          {calibratedDelay !== null && (
            <div className="space-y-2 rounded-md bg-emerald-50 p-3 text-sm">
              <p>Ambang yang disarankan: {calibratedDelay} ms.</p>
              <button type="button" onClick={() => updateSettings({ ...settings, maxInterKeyDelayMs: calibratedDelay })} className="min-h-10 rounded-md bg-emerald-800 px-3 text-white">Simpan hasil kalibrasi</button>
            </div>
          )}
        </section>

        <details open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)} className="rounded-lg border border-slate-200 p-3">
          <summary className="min-h-10 cursor-pointer font-medium">Pengaturan perangkat</summary>
          <div className="space-y-3 pt-2 text-sm">
            <label className="block">
              <span>Jeda maksimal antar-karakter: {settings.maxInterKeyDelayMs} ms</span>
              <input type="range" min="20" max="150" step="1" value={settings.maxInterKeyDelayMs} onChange={(event) => updateSettings({ ...settings, maxInterKeyDelayMs: Number(event.target.value) })} className="block min-h-11 w-full" />
            </label>
            <label className="block">
              <span>Panjang minimal barcode: {settings.minimumCharacters} karakter</span>
              <input type="range" min="3" max="10" step="1" value={settings.minimumCharacters} onChange={(event) => updateSettings({ ...settings, minimumCharacters: Number(event.target.value) })} className="block min-h-11 w-full" />
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={settings.soundAndVibration} onChange={(event) => updateSettings({ ...settings, soundAndVibration: event.target.checked })} />
              Suara dan getar
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={settings.keepScreenAwake} onChange={(event) => updateSettings({ ...settings, keepScreenAwake: event.target.checked })} />
              Jaga layar tetap menyala
            </label>
            <button type="button" onClick={reset} className="min-h-10 rounded-md border border-slate-300 px-3">Kembalikan ke bawaan</button>
          </div>
        </details>

        <section className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          <p>{storageStatus}</p>
          <p>{currentStorage}</p>
          <button type="button" onClick={() => void protectStorage()} className="mr-3 min-h-10 font-medium underline">Lindungi penyimpanan lokal</button>
          <a href={guideUrl} download="PANDUAN_SCANNER_BLUETOOTH.md" className="inline-flex min-h-10 items-center font-medium underline">Unduh panduan scanner Bluetooth</a>
        </section>
      </section>
    </div>
  );
}
