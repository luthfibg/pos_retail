export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{note ?? 'Belum dibangun. Menunggu kontrak API dari backend.'}</p>
    </div>
  );
}
