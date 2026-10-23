import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">Halaman tidak ditemukan</h1>
      <Link to="/" className="mt-2 inline-block text-sm text-slate-700 underline">Kembali</Link>
    </div>
  );
}
