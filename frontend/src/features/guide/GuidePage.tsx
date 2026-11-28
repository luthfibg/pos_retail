import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  groupSections, guideForRoles, sectionFromHash, sectionMatches,
  type GuideBlock, type GuideSection,
} from './guideContent';

const NOTE_CLS = {
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
} as const;

export function GuidePage() {
  const { me } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const guide = guideForRoles(me?.roles ?? []);

  const sections = useMemo(
    () => (guide?.sections ?? []).filter((section) => sectionMatches(section, query)),
    [guide, query],
  );
  const groups = useMemo(() => groupSections(sections), [sections]);

  function goTo(id: string) {
    navigate({ hash: `#${id}` }, { replace: true });
    window.setTimeout(() => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  // Tautan langsung ke bagian (mis. /guide#stok-opname) menggulir ke bagian itu saat dibuka.
  useEffect(() => {
    if (!guide) return;
    const id = sectionFromHash(location.hash, guide.sections);
    if (!id) return;
    const timer = window.setTimeout(() => document.getElementById(`guide-${id}`)?.scrollIntoView({ block: 'start' }), 80);
    return () => window.clearTimeout(timer);
  }, [guide, location.hash]);

  if (!guide) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold">Panduan belum tersedia</h1>
        <p className="mt-1 text-sm text-slate-600">Belum ada panduan untuk role {me?.roles.join(', ') || 'Anda'}.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{guide.title}</h1>
          <p className="text-sm text-slate-500">{guide.scope}</p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Cari panduan"
            placeholder="Cari panduan"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Cetak
          </button>
        </div>
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Indeks panduan" className="no-print hidden lg:block">
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
          {groups.length === 0 && (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Tidak ada bagian yang cocok dengan “{query}”.</p>
          )}
          {groups.map((group) => (
            <div key={group.id} className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</div>
              {group.sections.map((section) => <SectionCard key={section.id} section={section} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionCard({ section }: { section: GuideSection }) {
  return (
    <section id={`guide-${section.id}`} className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white break-inside-avoid-page">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 className="text-base font-semibold">{section.title}</h2>
        {section.menu && (
          <Link to={section.menu.to} className="no-print rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50">
            Buka {section.menu.label}
          </Link>
        )}
      </header>
      <div className="space-y-4 p-5">
        {section.blocks.map((block, index) => <Block key={index} block={block} />)}
      </div>
    </section>
  );
}

function BlockTitle({ title }: { title?: string }) {
  return title ? <h3 className="mb-1.5 text-sm font-semibold text-slate-900">{title}</h3> : null;
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case 'steps':
      return (
        <div>
          <BlockTitle title={block.title} />
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800 marker:font-medium marker:text-slate-500">
            {block.items.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </div>
      );
    case 'list':
      return (
        <div>
          <BlockTitle title={block.title} />
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800 marker:text-slate-400">
            {block.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      );
    case 'table':
      return (
        <div>
          <BlockTitle title={block.title} />
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>{block.head.map((cell) => <th key={cell} className="px-3 py-2 font-medium">{cell}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {block.rows.map((row) => (
                  <tr key={row.join('|')}>
                    {row.map((cell, index) => (
                      <td key={index} className={`px-3 py-2 align-top ${index === 0 ? 'font-medium text-slate-900' : 'text-slate-700'}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case 'note':
      return <p role="note" className={`rounded-md border px-3 py-2 text-sm ${NOTE_CLS[block.tone]}`}>{block.text}</p>;
  }
}
