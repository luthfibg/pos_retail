import { FLOW_STAGES, type FlowTab } from './purchaseFlow';

/** Pelacak posisi dokumen dalam alur pembelian (dipakai di dialog detail PR dan PO). */
export function PurchaseStageTracker({ current, archivedNote }: { current: FlowTab; archivedNote?: string }) {
  if (current === 'archive') {
    return <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{archivedNote ?? 'Dokumen ini sudah keluar dari alur pembelian.'}</div>;
  }
  const index = FLOW_STAGES.findIndex((stage) => stage.key === current);

  return (
    <ol aria-label="Posisi dalam alur pembelian" className="flex items-start">
      {FLOW_STAGES.map((stage, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <li key={stage.key} aria-current={active ? 'step' : undefined} className="relative flex flex-1 flex-col items-center gap-1 text-center">
            {i > 0 && <span aria-hidden className={`absolute left-[-50%] top-3 h-0.5 w-full ${i <= index ? 'bg-slate-900' : 'bg-slate-200'}`} />}
            <span
              className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                done ? 'bg-slate-900 text-white' : active ? 'bg-blue-700 text-white ring-4 ring-blue-100' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={`text-[11px] leading-tight ${active ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
