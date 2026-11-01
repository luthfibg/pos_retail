import { describe, expect, it } from 'vitest';
import type { AdminModelOption, AdminModelSetting } from '@/lib/api/types';
import { buildChecklist, conversionLine, convertsCurrentUser, modelErrorMessages } from './adminModelLogic';

function role(name: string, active: number) {
  return { name, description: null, assignable: true, total_users: active, active_users: active };
}

const setting: AdminModelSetting = {
  model: 'simple',
  controlling_role: 'Admin',
  assignable_roles: ['Admin', 'Kasir'],
  roles: [role('Admin', 2), role('Kasir', 1), role('Finance', 0), role('Purchasing', 1), role('Accounting', 0)],
  options: [],
};

const standard: AdminModelOption = {
  model: 'standard',
  label: 'Standar retail',
  current: false,
  can_switch: false,
  blockers: [
    { code: 'role_missing', role: 'Finance', message: 'Buat minimal satu akun aktif dengan role Finance sebelum beralih ke model standar retail.' },
    { code: 'role_missing', role: 'Accounting', message: 'Buat minimal satu akun aktif dengan role Accounting sebelum beralih ke model standar retail.' },
  ],
  conversions: [{
    from: 'Admin',
    to: 'Owner',
    users: [
      { id: 1, name: 'Budi', username: 'budi', is_active: true },
      { id: 2, name: 'Sari', username: 'sari', is_active: false },
    ],
  }],
};

describe('adminModelLogic', () => {
  it('daftar periksa menandai role yang belum punya akun aktif', () => {
    const rows = buildChecklist(setting, standard);
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));

    expect(byLabel['Admin menjadi Owner']?.ok).toBe(true);
    expect(byLabel['Akun aktif Kasir']?.ok).toBe(true);
    expect(byLabel['Akun aktif Purchasing']?.ok).toBe(true);
    expect(byLabel['Akun aktif Finance']?.ok).toBe(false);
    expect(byLabel['Akun aktif Finance']?.message).toContain('Finance');
    expect(byLabel['Akun aktif Accounting']?.ok).toBe(false);
    expect(byLabel['Akun aktif Finance']?.activeUsers).toBe(0);
  });

  it('penghalang pengendali ikut pada baris konversi', () => {
    const blocked: AdminModelOption = {
      ...standard,
      blockers: [{ code: 'role_missing', role: 'Admin', message: 'Belum ada akun aktif dengan role Admin yang dapat menjadi Owner.' }],
    };
    const rows = buildChecklist(setting, blocked);
    expect(rows[0]?.ok).toBe(false);
    expect(rows[0]?.message).toContain('Admin');
  });

  it('penghalang tak dikenal tetap ditampilkan', () => {
    const odd: AdminModelOption = {
      ...standard,
      blockers: [{ code: 'other', role: 'Gudang', message: 'Penghalang baru dari backend.' }],
    };
    const rows = buildChecklist(setting, odd);
    expect(rows.some((row) => row.message === 'Penghalang baru dari backend.' && !row.ok)).toBe(true);
  });

  it('kembali ke simple tidak menuntut akun operasional', () => {
    const simple: AdminModelOption = {
      model: 'simple', label: 'Simple', current: false, can_switch: true, blockers: [],
      conversions: [{ from: 'Owner', to: 'Admin', users: [{ id: 3, name: 'Tia', username: 'tia', is_active: true }] }],
    };
    const rows = buildChecklist({ ...setting, model: 'standard', roles: [role('Owner', 1)] }, simple);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Owner menjadi Admin');
    expect(rows[0]?.ok).toBe(true);
  });

  it('merangkum konversi dan mengenali akun sendiri', () => {
    const conversion = standard.conversions[0];
    expect(conversion && conversionLine(conversion)).toBe('Admin → Owner: Budi (budi), Sari (sari) — nonaktif');
    expect(convertsCurrentUser(standard, 1)).toBe(true);
    expect(convertsCurrentUser(standard, 99)).toBe(false);
    expect(convertsCurrentUser(standard, undefined)).toBe(false);
  });

  it('mengambil semua pesan galat model', () => {
    expect(modelErrorMessages({ model: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(modelErrorMessages({ confirm: ['x'] })).toEqual([]);
    expect(modelErrorMessages(undefined)).toEqual([]);
  });
});
