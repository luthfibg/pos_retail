import { useEffect, useState } from 'react';
import { readScannerSettings, writeScannerSettings } from './scannerSettings';

export function useScanFeedback() {
  const [enabled, setEnabled] = useState(() => readScannerSettings().soundAndVibration);
  useEffect(() => {
    const update = () => setEnabled(readScannerSettings().soundAndVibration);
    window.addEventListener('opname-scanner-settings-changed', update);
    return () => window.removeEventListener('opname-scanner-settings-changed', update);
  }, []);

  function setPreference(value: boolean) {
    writeScannerSettings({ ...readScannerSettings(), soundAndVibration: value });
  }

  function play(kind: 'success' | 'error') {
    if (!enabled) return;
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(kind === 'success' ? 45 : [55, 45, 55]);
      }
    } catch {
      // Device feedback is optional.
    }

    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) return;
      const context = new AudioContextConstructor();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = kind === 'success' ? 880 : 440;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.onended = () => { void context.close(); };
    } catch {
      // Audio feedback is optional and may be blocked by browser policy.
    }
  }

  return { enabled, setEnabled: setPreference, success: () => play('success'), error: () => play('error') };
}
