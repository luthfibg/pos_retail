import { useEffect, useState } from 'react';
import { readScannerSettings } from './scannerSettings';

export function useScreenWakeLock(active: boolean): void {
  const [enabled, setEnabled] = useState(() => readScannerSettings().keepScreenAwake);
  useEffect(() => {
    const update = () => setEnabled(readScannerSettings().keepScreenAwake);
    window.addEventListener('opname-scanner-settings-changed', update);
    return () => window.removeEventListener('opname-scanner-settings-changed', update);
  }, []);

  useEffect(() => {
    if (!active || !enabled || document.visibilityState !== 'visible') return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock?.request('screen') ?? null;
      } catch {
        lock = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
      else if (lock) {
        void lock.release();
        lock = null;
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (lock) void lock.release();
      lock = null;
    };
  }, [active, enabled]);
}
