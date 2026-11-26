import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  children: ReactNode;
}

/** Dialog sederhana. Klik latar tidak menutup agar data form tidak hilang tak sengaja. */
export function Modal({ title, onClose, closeOnEscape = true, showCloseButton = true, children }: Props) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, closeOnEscape]);

  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="my-8 w-full max-w-xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          {showCloseButton && <button type="button" onClick={onClose} aria-label="Tutup" className="rounded p-1 text-slate-500 hover:bg-slate-100">✕</button>}
        </div>
        {children}
      </div>
    </div>
  );
}
