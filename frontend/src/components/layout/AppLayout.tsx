import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { ChangePasswordDialog } from '@/features/users/ChangePasswordDialog';
import { getVisibleNavGroups } from './nav';

export function AppLayout() {
  const { me, can, logout } = useAuth();
  const location = useLocation();
  const isAdmin = can('shift.review');
  const groups = getVisibleNavGroups(can, isAdmin);
  const activeGroup = groups.find((group) =>
    group.items.some(({ to }) => location.pathname === to || location.pathname.startsWith(`${to}/`)),
  )?.label;
  const [expandedGroup, setExpandedGroup] = useState(activeGroup ?? groups[0]?.label ?? '');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  useEffect(() => {
    if (activeGroup) setExpandedGroup(activeGroup);
  }, [activeGroup]);

  if (me?.platform_operator) return <Navigate to="/platform/stores" replace />;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="no-print flex h-full w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold">POS Retail SMK</div>
            <div className="truncate text-xs text-slate-500">{me?.store?.name}</div>
          </div>
          <NotificationBell />
        </div>
        <nav className="min-h-0 flex-1 overflow-hidden p-2">
          {groups.map((group) => {
            const isExpanded = expandedGroup === group.label;
            return (
              <section key={group.label} className="mb-1">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedGroup(isExpanded ? '' : group.label)}
                  className="flex w-full items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200"
                >
                  <span>{group.label}</span>
                  <span aria-hidden="true">{isExpanded ? '-' : '+'}</span>
                </button>
                {isExpanded && (
                  <div className="space-y-1 pb-1">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          `block rounded-md border-l-2 bg-white px-3 py-2 text-sm text-slate-900 hover:bg-slate-50 ${isActive ? 'border-slate-900 font-semibold' : 'border-transparent'}`
                        }
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-slate-200 p-3 text-sm">
          <div className="font-medium">{me?.user.name}</div>
          <div className="text-xs text-slate-500">{me?.roles.join(', ')}</div>
          <button
            type="button"
            onClick={() => setChangePasswordOpen(true)}
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Ganti sandi
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Keluar
          </button>
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {changePasswordOpen && <ChangePasswordDialog onClose={() => setChangePasswordOpen(false)} />}
    </div>
  );
}
