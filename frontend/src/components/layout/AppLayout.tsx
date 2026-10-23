import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { NAV_ITEMS } from './nav';

export function AppLayout() {
  const { me, can, logout } = useAuth();
  const items = NAV_ITEMS.filter((i) => can(i.permission));

  return (
    <div className="flex h-full">
      <aside className="no-print flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold">POS Retail SMK</div>
            <div className="truncate text-xs text-slate-500">{me?.store.name}</div>
          </div>
          <NotificationBell />
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`
              }
            >
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-sm">
          <div className="font-medium">{me?.user.name}</div>
          <div className="text-xs text-slate-500">{me?.roles.join(', ')}</div>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Keluar
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
