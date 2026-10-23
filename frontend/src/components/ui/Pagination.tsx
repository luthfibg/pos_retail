interface Props {
  page: number;
  lastPage: number;
  from: number | null;
  to: number | null;
  total: number;
  onPage: (p: number) => void;
}

export function Pagination({ page, lastPage, from, to, total, onPage }: Props) {
  if (lastPage <= 1) return null;
  const btn = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50';
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{from}–{to} dari {total}</span>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</button>
        <button type="button" className={btn} disabled={page >= lastPage} onClick={() => onPage(page + 1)}>Berikutnya</button>
      </div>
    </div>
  );
}
