import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export function AdjustmentOpnamePage() {
  const { pathname } = useLocation();
  const activeTab = pathname.endsWith('/opname') ? 'opname' : 'adjustment';
  const adjustmentHref = '/inventory/adjustments/adjustment';
  const opnameHref = '/inventory/adjustments/opname';

  function moveTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const targetId = event.key === 'Home'
      ? 'adjustment-tab'
      : event.key === 'End'
        ? 'opname-tab'
        : activeTab === 'adjustment' ? 'opname-tab' : 'adjustment-tab';
    event.preventDefault();
    const target = document.getElementById(targetId);
    if (target instanceof HTMLAnchorElement) {
      target.focus();
      target.click();
    }
  }

  return (
    <div className="min-w-0 pb-24 md:pb-6">
      <header className="px-4 pt-5 md:px-6 md:pt-6">
        <h1 className="text-xl font-semibold">Adjustment &amp; Opname</h1>
        <p className="mt-1 text-sm text-slate-600">Kelola penyesuaian stok dan stock opname toko.</p>
      </header>
      <div className="sticky top-0 z-20 mt-4 border-y border-slate-200 bg-white/95 px-4 backdrop-blur md:px-6">
        <nav role="tablist" aria-label="Adjustment dan opname" onKeyDown={moveTab} className="flex w-full">
          <NavLink
            to={adjustmentHref}
            role="tab"
            id="adjustment-tab"
            aria-selected={activeTab === 'adjustment'}
            aria-controls="adjustment-panel"
            tabIndex={activeTab === 'adjustment' ? 0 : -1}
            className={`flex min-h-12 flex-1 items-center justify-center border-b-2 px-3 text-sm font-medium ${activeTab === 'adjustment' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}
          >
            Adjustment
          </NavLink>
          <NavLink
            to={opnameHref}
            role="tab"
            id="opname-tab"
            aria-selected={activeTab === 'opname'}
            aria-controls="opname-panel"
            tabIndex={activeTab === 'opname' ? 0 : -1}
            className={`flex min-h-12 flex-1 items-center justify-center border-b-2 px-3 text-sm font-medium ${activeTab === 'opname' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}
          >
            Opname
          </NavLink>
        </nav>
      </div>
      <section role="tabpanel" id="adjustment-panel" aria-labelledby="adjustment-tab" hidden={activeTab !== 'adjustment'} className="min-w-0 px-4 py-4 md:px-6">
        {activeTab === 'adjustment' && <Outlet />}
      </section>
      <section role="tabpanel" id="opname-panel" aria-labelledby="opname-tab" hidden={activeTab !== 'opname'} className="min-w-0 px-4 py-4 md:px-6">
        {activeTab === 'opname' && <Outlet />}
      </section>
    </div>
  );
}
