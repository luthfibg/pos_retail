import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';

export function AdjustmentOpnamePage() {
  const { pathname } = useLocation();
  const { can } = useAuth();
  const canOpname = can('opname.view');
  const activeTab = pathname.includes('/opname') ? 'opname' : 'final';
  const finalHref = '/inventory/adjustments/adjustment';
  const opnameHref = '/inventory/adjustments/opname';

  if (!canOpname) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold">Tidak ada akses</h1>
        <p className="mt-1 text-sm text-slate-600">Akun Anda tidak memiliki izin untuk membuka halaman ini.</p>
      </div>
    );
  }

  if (pathname === '/inventory/adjustments') {
    return <Navigate to={opnameHref} replace />;
  }

  function moveTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const targetId = event.key === 'Home'
      ? 'opname-tab'
      : event.key === 'End'
        ? 'final-tab'
        : activeTab === 'final' ? 'opname-tab' : 'final-tab';
    event.preventDefault();
    const target = document.getElementById(targetId);
    if (target instanceof HTMLAnchorElement) {
      target.focus();
      target.click();
    }
  }

  return (
    <div className="min-w-0 pb-24 md:pb-6">
      {/* Judul dan tab hanya untuk layar; tanpa no-print keduanya memenuhi halaman 1 hasil cetak. */}
      <header className="no-print px-4 pt-5 md:px-6 md:pt-6">
        <h1 className="text-xl font-semibold">Stok Opname</h1>
      </header>
      <div className="no-print sticky top-0 z-20 mt-4 border-y border-slate-200 bg-white/95 px-4 backdrop-blur md:px-6">
        <nav role="tablist" aria-label="Stok Opname" onKeyDown={moveTab} className="flex w-full">
          <NavLink
            to={opnameHref}
            role="tab"
            id="opname-tab"
            aria-selected={activeTab === 'opname'}
            aria-controls="opname-panel"
            tabIndex={activeTab === 'opname' ? 0 : -1}
            className={`flex min-h-12 flex-1 items-center justify-center border-b-2 px-3 text-sm font-medium ${activeTab === 'opname' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}
          >
            Hitung Stok
          </NavLink>
          <NavLink
            to={finalHref}
            role="tab"
            id="final-tab"
            aria-selected={activeTab === 'final'}
            aria-controls="final-panel"
            tabIndex={activeTab === 'final' ? 0 : -1}
            className={`flex min-h-12 flex-1 items-center justify-center border-b-2 px-3 text-sm font-medium ${activeTab === 'final' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}
          >
            Final Stok
          </NavLink>
        </nav>
      </div>
      <section role="tabpanel" id="final-panel" aria-labelledby="final-tab" hidden={activeTab !== 'final'} className="min-w-0 px-4 py-4 md:px-6">
        {activeTab === 'final' && <Outlet />}
      </section>
      <section role="tabpanel" id="opname-panel" aria-labelledby="opname-tab" hidden={activeTab !== 'opname'} className="min-w-0 px-4 py-4 md:px-6">
        {activeTab === 'opname' && <Outlet />}
      </section>
    </div>
  );
}

export function AdjustmentOpnameRedirect() {
  return <Navigate to="opname" replace />;
}