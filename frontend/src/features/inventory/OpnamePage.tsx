import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { opnameApi } from '@/lib/api/endpoints';
import { newRequestId, shortMessage } from './opnameProcess';

export function OpnamePage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const active = useQuery({
    queryKey: ['opname', 'active'],
    queryFn: async () => {
      const [running, waiting] = await Promise.all([
        opnameApi.list({ status: 'in_progress', per_page: 10 }),
        opnameApi.list({ status: 'pending_approval', per_page: 10 }),
      ]);
      return [...running.data, ...waiting.data];
    },
  });

  const start = useMutation({
    mutationFn: () => opnameApi.start({ scope_type: 'all', client_request_id: newRequestId() }),
    onSuccess: (session) => navigate(`/inventory/adjustments/opname/${session.id}`),
  });

  const sessions = active.data ?? [];

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5">
      {can('opname.create') && (
        <button
          type="button"
          disabled={start.isPending}
          onClick={() => start.mutate()}
          className="min-h-14 rounded-xl bg-slate-900 px-10 text-lg font-semibold text-white disabled:opacity-60"
        >
          {start.isPending ? 'Memulai…' : 'Mulai Opname'}
        </button>
      )}
      {start.isError && <p role="alert" className="text-sm text-red-700">{shortMessage(start.error, 'Gagal memulai')}</p>}
      {sessions.length > 0 && (
        <ul className="w-full max-w-sm space-y-2">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                to={`/inventory/adjustments/opname/${session.id}`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4"
              >
                <span className="font-medium">{session.number}</span>
                <span className="text-sm text-slate-600">
                  {session.status === 'pending_approval' ? 'Menunggu' : `${session.counted_products}/${session.total_products}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
