import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    __simulateScan?: (code: string) => Promise<void>;
  }
}

export const SCANNER_INTER_KEY_DELAY_MS = 40;
export const SCANNER_MINIMUM_CHARACTERS = 6;
export const SCANNER_DUPLICATE_WINDOW_MS = 800;
const HUMAN_DIGIT_DELAY_MS = 50;

export function shouldAcceptScannerCode(code: string, at: number, previousCode: string, previousAt: number): boolean {
  return code !== previousCode || at - previousAt >= SCANNER_DUPLICATE_WINDOW_MS;
}

interface ScannerHandlers {
  onScan: (code: string, context: { source: 'keyboard' }) => void;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
}

export class ScannerBurstBuffer {
  private characters: Array<{ key: string; at: number }> = [];

  input(key: string, at: number): { digits: string; scan?: string; enter?: boolean } {
    if (key.length === 1 && !/[\u0000-\u001f]/.test(key)) {
      let digits = '';
      const last = this.characters.at(-1);
      if (last && at - last.at > SCANNER_INTER_KEY_DELAY_MS) {
        digits = this.flushDigits();
      }
      this.characters.push({ key, at });
      return { digits };
    }

    if (key === 'Enter' || key === 'Tab') {
      const last = this.characters.at(-1);
      const isScan = this.characters.length >= SCANNER_MINIMUM_CHARACTERS
        && last !== undefined
        && at - last.at <= SCANNER_INTER_KEY_DELAY_MS;
      if (isScan) {
        const scan = this.characters.map((entry) => entry.key).join('');
        this.characters = [];
        return { digits: '', scan };
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

  private flushDigits(): string {
    const digits = this.characters.map((entry) => entry.key).filter((key) => /^\d$/.test(key)).join('');
    this.characters = [];
    return digits;
  }
}

export function useScannerCapture({
  active,
  onScan,
  onDigit,
  onBackspace,
  onEnter,
}: ScannerHandlers & { active: boolean }) {
  const handlers = useRef({ onScan, onDigit, onBackspace, onEnter });
  handlers.current = { onScan, onDigit, onBackspace, onEnter };

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
    const buffer = new ScannerBurstBuffer();
    let flushTimer = 0;
    let lastScan = '';
    let lastScanAt = 0;

    const flush = () => {
      const digits = buffer.flush();
      if (digits) handlers.current.onDigit(digits);
      flushTimer = 0;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const editable = event.target instanceof HTMLElement
        && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      const result = buffer.input(event.key, performance.now());
      if (flushTimer) window.clearTimeout(flushTimer);
      if (event.key.length === 1 && !editable) event.preventDefault();

      if (result.scan !== undefined) {
        event.preventDefault();
        const now = performance.now();
        if (shouldAcceptScannerCode(result.scan, now, lastScan, lastScanAt)) {
          lastScan = result.scan;
          lastScanAt = now;
          handlers.current.onScan(result.scan, { source: 'keyboard' });
        }
        return;
      }

      if (result.digits && !editable) handlers.current.onDigit(result.digits);
      if (event.key.length === 1) {
        flushTimer = window.setTimeout(flush, HUMAN_DIGIT_DELAY_MS);
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

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (flushTimer) window.clearTimeout(flushTimer);
    };
  }, [active]);
}
