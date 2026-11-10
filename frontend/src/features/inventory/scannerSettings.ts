export const DEFAULT_SCANNER_SETTINGS = {
  maxInterKeyDelayMs: 40,
  minimumCharacters: 6,
  keepScreenAwake: true,
  soundAndVibration: true,
};

const STORAGE_KEY = 'pos.opname.scanner-settings.v1';
export type ScannerSettings = typeof DEFAULT_SCANNER_SETTINGS;

export function readScannerSettings(): ScannerSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SCANNER_SETTINGS;
    const value = JSON.parse(stored) as Partial<ScannerSettings>;
    return {
      maxInterKeyDelayMs: clamp(Math.round(value.maxInterKeyDelayMs ?? 40), 20, 150),
      minimumCharacters: clamp(Math.round(value.minimumCharacters ?? 6), 3, 10),
      keepScreenAwake: value.keepScreenAwake ?? true,
      soundAndVibration: value.soundAndVibration ?? true,
    };
  } catch {
    return DEFAULT_SCANNER_SETTINGS;
  }
}

export function writeScannerSettings(settings: ScannerSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent('opname-scanner-settings-changed'));
}

export function resetScannerSettings(): ScannerSettings {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('opname-scanner-settings-changed'));
  return DEFAULT_SCANNER_SETTINGS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
