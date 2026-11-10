import { useEffect, useRef, useState } from 'react';
import { readScannerSettings, type ScannerSettings } from './scannerSettings';

declare global {
  interface Window {
    __simulateScan?: (code: string) => Promise<void>;
  }
}

export const SCANNER_INTER_KEY_DELAY_MS = 40;
export const SCANNER_MINIMUM_CHARACTERS = 6;
export const SCANNER_DUPLICATE_WINDOW_MS = 800;
const HUMAN_DIGIT_DELAY_MS = 50;

export interface ScannerDiagnostic {
  raw: string;
  length: number;
  averageInterKeyDelayMs: number;
  maxInterKeyDelayMs: number;
  suffix: 'Enter' | 'Tab' | 'none';
  accepted: boolean;
  reason?: string;
}

export function shouldAcceptScannerCode(code: string, at: number, previousCode: string, previousAt: number): boolean {
  return code !== previousCode || at - previousAt >= SCANNER_DUPLICATE_WINDOW_MS;
}

interface ScannerHandlers {
  onScan: (code: string, context: { source: 'keyboard' }) => void;
  onDiagnostic?: (diagnostic: ScannerDiagnostic) => void;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
}

export class ScannerBurstBuffer {
  private characters: Array<{ key: string; at: number }> = [];
  private readonly maxInterKeyDelayMs: number;
  private readonly minimumCharacters: number;

  constructor(maxInterKeyDelayMs = SCANNER_INTER_KEY_DELAY_MS, minimumCharacters = SCANNER_MINIMUM_CHARACTERS) {
    this.maxInterKeyDelayMs = maxInterKeyDelayMs;
    this.minimumCharacters = minimumCharacters;
  }

  input(key: string, at: number): { digits: string; scan?: string; enter?: boolean; diagnostic?: Omit<ScannerDiagnostic, 'accepted' | 'reason'> } {
    if (key.length === 1 && !/[\u0000-\u001f]/.test(key)) {
      let digits = '';
      const last = this.characters.at(-1);
      if (last && at - last.at > this.maxInterKeyDelayMs) {
        digits = this.flushDigits();
      }
      this.characters.push({ key, at });
      return { digits };
    }

    if (key === 'Enter' || key === 'Tab') {
      const last = this.characters.at(-1);
      const isScan = this.characters.length >= this.minimumCharacters
        && last !== undefined
        && at - last.at <= this.maxInterKeyDelayMs;
      if (isScan) {
        const diagnostic = this.diagnostic(key as 'Enter' | 'Tab');
        const scan = diagnostic.raw;
        this.characters = [];
        return { digits: '', scan, diagnostic };
      }
      const digits = this.flushDigits();
      return { digits, enter: key === 'Enter' };
    }

    if (key === 'Backspace') return { digits: this.flushDigits() };
    return { digits: '' };
  }

  flush(): string {
    return this.flushDigits();
  }

  finishWithoutSuffix(): { digits: string; diagnostic?: Omit<ScannerDiagnostic, 'accepted' | 'reason'> } {
    const last = this.characters.at(-1);
    if (this.characters.length >= this.minimumCharacters && last) {
      const diagnostic = this.diagnostic('none');
      this.characters = [];
      return { digits: '', diagnostic };
    }

    return { digits: this.flushDigits() };
  }

  private diagnostic(suffix: 'Enter' | 'Tab' | 'none'): Omit<ScannerDiagnostic, 'accepted' | 'reason'> {
    const delays = this.characters.slice(1).map((entry, index) => entry.at - (this.characters[index]?.at ?? entry.at));
    const total = delays.reduce((sum, delay) => sum + delay, 0);
    return {
      raw: this.characters.map((entry) => entry.key).join(''),
      length: this.characters.length,
      averageInterKeyDelayMs: delays.length ? Math.round(total / delays.length) : 0,
      maxInterKeyDelayMs: delays.length ? Math.max(...delays) : 0,
      suffix,
    };
  }

  private flushDigits(): string {
    const digits = this.characters.map((entry) => entry.key).filter((key) => /^\d$/.test(key)).join('');
    this.characters = [];
    return digits;
  }
}

export function useScannerCapture({
  active,
  onScan,
  onDiagnostic,
  onDigit,
  onBackspace,
  onEnter,
}: ScannerHandlers & { active: boolean }) {
  const [settings, setSettings] = useState<ScannerSettings>(readScannerSettings);
  const handlers = useRef({ onScan, onDiagnostic, onDigit, onBackspace, onEnter });
  handlers.current = { onScan, onDiagnostic, onDigit, onBackspace, onEnter };

  useEffect(() => {
    const update = () => setSettings(readScannerSettings());
    window.addEventListener('opname-scanner-settings-changed', update);
    return () => window.removeEventListener('opname-scanner-settings-changed', update);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const simulate = async (code: string) => {
      for (const key of code) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    };
    window.__simulateScan = simulate;
    return () => {
      delete window.__simulateScan;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const buffer = new ScannerBurstBuffer(settings.maxInterKeyDelayMs, settings.minimumCharacters);
    let flushTimer = 0;
    let fallbackTimer = 0;
    let lastScan = '';
    let lastScanAt = 0;
    let lastReadableKeyAt = 0;

    const report = (diagnostic: Omit<ScannerDiagnostic, 'accepted' | 'reason'>, accepted: boolean, reason?: string) => {
      handlers.current.onDiagnostic?.({ ...diagnostic, accepted, ...(reason ? { reason } : {}) });
    };

    const flush = () => {
      const result = buffer.finishWithoutSuffix();
      if (result.diagnostic) {
        report(result.diagnostic, false, 'Akhiran Enter atau Tab tidak terdeteksi.');
      } else if (result.digits) {
        handlers.current.onDigit(result.digits);
      }
      flushTimer = 0;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const editable = event.target instanceof HTMLElement
        && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      const now = performance.now();
      if (event.key === 'Unidentified' || event.keyCode === 229) {
        fallbackTimer = now + 250;
        return;
      }
      const result = buffer.input(event.key, now);
      if (event.key.length === 1) lastReadableKeyAt = now;
      if (flushTimer) window.clearTimeout(flushTimer);
      if (event.key.length === 1 && !editable) event.preventDefault();

      if (result.scan !== undefined) {
        event.preventDefault();
        const accepted = shouldAcceptScannerCode(result.scan, now, lastScan, lastScanAt);
        report(result.diagnostic!, accepted, accepted ? undefined : 'Scan kembar dalam 800 ms diabaikan.');
        if (accepted) {
          lastScan = result.scan;
          lastScanAt = now;
          handlers.current.onScan(result.scan, { source: 'keyboard' });
        }
        return;
      }

      if (result.digits && !editable) handlers.current.onDigit(result.digits);
      if (event.key.length === 1) {
        flushTimer = window.setTimeout(flush, Math.max(HUMAN_DIGIT_DELAY_MS, settings.maxInterKeyDelayMs + 20));
      }
      if (event.key === 'Backspace' && !editable) {
        event.preventDefault();
        handlers.current.onBackspace();
      }
      if (result.enter && !editable) {
        event.preventDefault();
        handlers.current.onEnter();
      }
    };

    const onBeforeInput = (event: InputEvent) => {
      const now = performance.now();
      const isFallback = now <= fallbackTimer || now - lastReadableKeyAt > 250;
      if (!isFallback || !event.data) return;
      event.preventDefault();
      for (const key of event.data) {
        const result = buffer.input(key, performance.now());
        if (result.scan) return;
      }
      if (flushTimer) window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(flush, Math.max(HUMAN_DIGIT_DELAY_MS, settings.maxInterKeyDelayMs + 20));
    };

    const resumeCapture = () => {
      if (document.visibilityState === 'visible') {
        const activeElement = document.activeElement;
        const editing = activeElement instanceof HTMLElement
          && (activeElement.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(activeElement.tagName));
        if (!editing) {
          document.querySelector<HTMLInputElement>('[data-opname-scanner-capture]')?.focus({ preventScroll: true });
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('beforeinput', onBeforeInput, true);
    window.addEventListener('focus', resumeCapture);
    document.addEventListener('visibilitychange', resumeCapture);
    resumeCapture();
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('beforeinput', onBeforeInput, true);
      window.removeEventListener('focus', resumeCapture);
      document.removeEventListener('visibilitychange', resumeCapture);
      if (flushTimer) window.clearTimeout(flushTimer);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };
  }, [active, settings.maxInterKeyDelayMs, settings.minimumCharacters]);
}
