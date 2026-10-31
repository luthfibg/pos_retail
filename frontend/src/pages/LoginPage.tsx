import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/lib/api/client';

export function LoginPage() {
  const { status, me, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);

  if (status === 'authed') return <Navigate to={me?.platform_operator ? '/platform/stores' : from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return; // cegah kirim ganda
    setBusy(true);
    setError(null);
    setRecoveryOpen(false);
    setRecoveryAvailable(false);
    try {
      const currentUser = await login(username.trim(), password);
      navigate(currentUser.platform_operator ? '/platform/stores' : from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Terlalu banyak percobaan. Coba lagi sebentar.');
      } else {
        setError(err instanceof ApiError ? err.firstError('username') : 'Gagal masuk.');
        if (err instanceof ApiError && err.status === 422) setRecoveryAvailable(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">POS Retail SMK</h1>
          <p className="text-sm text-slate-500">Masuk untuk melanjutkan</p>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
        {recoveryOpen && (
          <section className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">Lupa username atau password operator sistem?</p>
            <p>
              Pemulihan hanya dapat dilakukan oleh administrator server melalui CLI. Hubungi administrator dan minta
              mereka menjalankan command berikut pada backend:
            </p>
            <code className="block overflow-x-auto rounded bg-white px-2 py-1 font-mono text-xs">
              php artisan platform:operator-credentials-reset
            </code>
            <p>
              Administrator akan memilih akun operator dari daftar, lalu menetapkan username dan password baru.
              Untuk akun toko, hubungi Admin toko.
            </p>
          </section>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Username</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Password</span>
          <input
            type="password"
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Memproses…' : 'Masuk'}
        </button>
        {recoveryAvailable && !recoveryOpen && (
          <button
            type="button"
            onClick={() => setRecoveryOpen(true)}
            className="w-full text-sm text-slate-700 underline"
          >
            Lupa username atau password?
          </button>
        )}
      </form>
    </div>
  );
}
