import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { groupSections, sectionFromHash, visibleSections, type SectionId, type SettingsSection } from './settingsSections';

const AdminModel = lazy(() => import('./AdminModelSettingsPage').then((module) => ({ default: module.AdminModelSettingsPage })));
const Warehouse = lazy(() => import('./WarehouseSettingsPage').then((module) => ({ default: module.WarehouseSettingsPage })));
const Vat = lazy(() => import('@/features/pricing/VatSettingsPage').then((module) => ({ default: module.VatSettingsPage })));
const Discounts = lazy(() => import('@/features/pricing/DiscountsPage').then((module) => ({ default: module.DiscountsPage })));
const FloatPolicy = lazy(() => import('@/features/shifts/FloatPolicyPage').then((module) => ({ default: module.FloatPolicyPage })));
const Users = lazy(() => import('@/features/users/UsersPage').then((module) => ({ default: module.UsersPage })));

function SectionBody({ id }: { id: SectionId }) {
  switch (id) {
    case 'admin-model': return <AdminModel embedded />;
    case 'warehouse': return <Warehouse embedded />;
    case 'vat': return <Vat embedded />;
    case 'discounts': return <Discounts embedded />;
    case 'float-policy': return <FloatPolicy embedded />;
    case 'users': return <Users embedded />;
  }
}

/**
 * Satu layar gulir untuk semua pengaturan, seperti Pengaturan di Windows/Android: indeks kategori di kiri,
 * bagian yang dapat dibuka-tutup di kanan. Bagian dimuat saat pertama dibuka dan tetap terpasang setelahnya,
 * sehingga isian yang belum disimpan tidak hilang bila bagian ditutup sementara.
 */
export function SettingsPage() {
  const { can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const all = useMemo(() => visibleSections(can), [can]);
  const shown = useMemo(() => visibleSections(can, query), [can, query]);
  const groups = useMemo(() => groupSections(shown), [shown]);

  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(all.map((section) => [section.id, section.defaultOpen])));
  const [visited, setVisited] = useState<Record<string, boolean>>(() => Object.fromEntries(all.filter((section) => section.defaultOpen).map((section) => [section.id, true])));

  function reveal(id: SectionId) {
    setOpen((current) => ({ ...current, [id]: true }));
    setVisited((current) => ({ ...current, [id]: true }));
  }

  function toggle(id: SectionId) {
    if (open[id]) setOpen((current) => ({ ...current, [id]: false }));
    else reveal(id);
  }

  function setAll(value: boolean) {
    for (const section of shown) {
      if (value) reveal(section.id);
      else setOpen((current) => ({ ...current, [section.id]: false }));
    }
  }

  function goTo(id: SectionId) {
    reveal(id);
    navigate({ hash: `#${id}` }, { replace: true });
    window.setTimeout(() => document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  // Tautan dalam (mis. /settings#users dari rute lama) membuka bagian lalu menggulir ke sana.
  const availableKey = all.map((section) => section.id).join(',');
  useEffect(() => {
    const id = sectionFromHash(location.hash, all);
    if (!id) return;
    setOpen((current) => ({ ...current, [id]: true }));
    setVisited((current) => ({ ...current, [id]: true }));
    const timer = window.setTimeout(() => document.getElementById(`section-${id}`)?.scrollIntoView({ block: 'start' }), 80);
    return () => window.clearTimeout(timer);
  }, [location.hash, availableKey]);

  if (all.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold">Tidak ada pengaturan</h1>
        <p className="mt-1 text-sm text-slate-600">Akun Anda tidak memiliki izin untuk mengubah pengaturan apa pun.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pengaturan</h1>
          <p className="mt-1 text-sm text-slate-600">Semua pengaturan toko dalam satu layar. Gulir ke bawah atau pilih kategori di kiri.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Cari pengaturan"
            placeholder="Cari pengaturan"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => setAll(true)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Buka semua</button>
          <button type="button" onClick={() => setAll(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Tutup semua</button>
        </div>
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Kategori pengaturan" className="hidden lg:block">
          <div className="sticky top-4 space-y-4">
            {groups.map((group) => (
              <div key={group.id}>
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</div>
                <ul className="mt-1 space-y-0.5">
                  {group.sections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => goTo(section.id)}
                        className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${location.hash === `#${section.id}` ? 'bg-slate-100 font-semibold' : ''}`}
                      >
                        {section.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-6">
          {groups.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Tidak ada pengaturan yang cocok dengan “{query}”.</p>}
          {groups.map((group) => (
            <div key={group.id} className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 lg:hidden">{group.label}</div>
              {group.sections.map((section) => (
                <SectionCard key={section.id} section={section} open={Boolean(open[section.id])} mounted={Boolean(visited[section.id])} onToggle={() => toggle(section.id)} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionCard({ section, open, mounted, onToggle }: { section: SettingsSection; open: boolean; mounted: boolean; onToggle: () => void }) {
  const panelId = `panel-${section.id}`;
  return (
    <section id={`section-${section.id}`} className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50"
        >
          <span>
            <span className="block text-base font-semibold">{section.title}</span>
            <span className="mt-0.5 block text-sm font-normal text-slate-600">{section.description}</span>
          </span>
          <span aria-hidden className="shrink-0 text-lg text-slate-500">{open ? '−' : '+'}</span>
        </button>
      </h2>
      {mounted && (
        <div id={panelId} hidden={!open} className="border-t border-slate-200 bg-slate-50 p-5">
          <Suspense fallback={<p className="text-sm text-slate-500">Memuat…</p>}>
            <SectionBody id={section.id} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
