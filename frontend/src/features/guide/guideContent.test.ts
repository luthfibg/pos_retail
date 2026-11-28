import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, getVisibleNavGroups } from '@/components/layout/nav';
import { SECTIONS } from '@/features/settings/settingsSections';
import {
  GUIDE_GROUPS, GUIDE_ROLES, GUIDES, groupSections, guideForRoles, sectionFromHash, sectionMatches,
  type GuideBlock,
} from './guideContent';

const admin = GUIDES.Admin!;

function textsOf(block: GuideBlock): string[] {
  const own = 'title' in block && block.title ? [block.title] : [];
  if (block.kind === 'steps' || block.kind === 'list') return [...own, ...block.items];
  if (block.kind === 'table') return [...own, ...block.head, ...block.rows.flat()];
  return [block.text];
}

const allTexts = admin.sections.flatMap((section) => [section.title, ...section.blocks.flatMap(textsOf)]);

describe('struktur panduan Admin', () => {
  it('id bagian unik dan grup valid', () => {
    const ids = admin.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GUIDE_GROUPS.map((group) => group.id));
    for (const section of admin.sections) expect(groups.has(section.group)).toBe(true);
  });

  it('setiap bagian punya isi dan tidak ada baris kosong atau ganda', () => {
    for (const section of admin.sections) {
      expect(section.blocks.length, section.id).toBeGreaterThan(0);
      for (const block of section.blocks) {
        if (block.kind === 'steps' || block.kind === 'list') {
          expect(block.items.length, section.id).toBeGreaterThan(0);
          expect(new Set(block.items).size, `${section.id}: item ganda`).toBe(block.items.length);
          for (const item of block.items) expect(item.trim(), section.id).not.toBe('');
        }
        if (block.kind === 'table') {
          const keys = block.rows.map((row) => row.join('|'));
          expect(new Set(keys).size, `${section.id}: baris ganda`).toBe(keys.length);
          for (const row of block.rows) expect(row.length, `${section.id}: ${row[0]}`).toBe(block.head.length);
        }
      }
    }
  });

  it('teks tetap singkat (tanpa kalimat deskriptif panjang)', () => {
    for (const text of allTexts) expect(text.length, text).toBeLessThanOrEqual(160);
  });

  it('memakai istilah “stok produk”, bukan “saldo produk”', () => {
    for (const text of allTexts) expect(text.toLowerCase(), text).not.toContain('saldo produk');
  });
});

describe('sinkron dengan aplikasi', () => {
  const navPaths = new Set(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to)));
  const settingsIds = new Set<string>(SECTIONS.map((section) => section.id));

  it('setiap tautan menu mengarah ke menu yang ada di sidebar', () => {
    for (const section of admin.sections) {
      if (!section.menu) continue;
      const [path] = section.menu.to.split('#');
      expect(navPaths.has(path ?? ''), `${section.id}: ${section.menu.to}`).toBe(true);
    }
  });

  it('tautan bagian Pengaturan memakai id bagian yang ada', () => {
    for (const section of admin.sections) {
      const hash = section.menu?.to.split('#')[1];
      if (hash) expect(settingsIds.has(hash), `${section.id}: #${hash}`).toBe(true);
    }
  });

  it('setiap menu sidebar Admin dijelaskan oleh satu bagian panduan', () => {
    const visible = getVisibleNavGroups(
      () => true, true, { show_opening_balance: true, show_stock_transfer: true }, ['Admin'],
    ).flatMap((group) => group.items.map((item) => item.to)).filter((path) => path !== '/guide');
    const documented = new Set(admin.sections.flatMap((section) => (section.menu ? [section.menu.to.split('#')[0]] : [])));
    for (const path of visible) expect(documented.has(path), path).toBe(true);
  });

  it('setiap bagian layar Pengaturan tercantum di panduan', () => {
    const overview = admin.sections.find((section) => section.id === 'pengaturan');
    const rows = overview?.blocks.flatMap((block) => (block.kind === 'table' ? block.rows.map((row) => row[0]?.toLowerCase()) : [])) ?? [];
    for (const section of SECTIONS) expect(rows, section.title).toContain(section.title.toLowerCase());
  });
});

describe('akses dan pencarian', () => {
  it('role yang punya panduan dikenali, role lain tidak', () => {
    expect(GUIDE_ROLES).toContain('Admin');
    expect(guideForRoles(['Kasir', 'Admin'])?.role).toBe('Admin');
    expect(guideForRoles(['Kasir'])).toBeNull();
    expect(guideForRoles([])).toBeNull();
  });

  it('pencarian mencocokkan judul, kata kunci, dan isi; kosong = semua', () => {
    const opname = admin.sections.find((section) => section.id === 'stok-opname')!;
    expect(sectionMatches(opname, '')).toBe(true);
    expect(sectionMatches(opname, 'OPNAME')).toBe(true);
    expect(sectionMatches(opname, 'pemutihan')).toBe(true);
    expect(sectionMatches(opname, 'invoice')).toBe(false);
  });

  it('pencarian “invoice” menemukan Laporan Piutang', () => {
    const hits = admin.sections.filter((section) => sectionMatches(section, 'invoice')).map((section) => section.id);
    expect(hits).toContain('laporan-piutang');
  });

  it('pengelompokan mengikuti urutan grup dan membuang grup kosong', () => {
    const groups = groupSections(admin.sections.filter((section) => section.group === 'keuangan'));
    expect(groups.map((group) => group.id)).toEqual(['keuangan']);
    expect(groupSections(admin.sections).map((group) => group.id)).toEqual(GUIDE_GROUPS.map((group) => group.id));
  });

  it('hash bagian hanya valid untuk id yang ada', () => {
    expect(sectionFromHash('#stok-opname', admin.sections)).toBe('stok-opname');
    expect(sectionFromHash('#tidak-ada', admin.sections)).toBeNull();
    expect(sectionFromHash('', admin.sections)).toBeNull();
  });
});
