import type { AdminModelId, AdminModelOption, AdminModelSetting } from '@/lib/api/types';

export const MODEL_TITLE: Record<AdminModelId, string> = {
  simple: 'Simple',
  standard: 'Standar retail',
};

export const MODEL_SUMMARY: Record<AdminModelId, { roles: string; text: string }> = {
  simple: {
    roles: 'Admin dan Kasir',
    text: 'Admin memegang semua fungsi bisnis, Kasir menjalankan operasional toko. Cocok untuk toko dengan staf sedikit.',
  },
  standard: {
    roles: 'Kasir, Finance, Purchasing, Accounting, dan Owner',
    text: 'Tugas dipisah per peran. Owner fokus pada persetujuan, kebijakan, dan pengawasan; setiap pengguna hanya melihat menu perannya.',
  },
};

/** Role operasional yang wajib punya akun aktif sebelum model standar. Backend tetap penentu lewat `blockers`. */
export const STANDARD_REQUIRED_ROLES = ['Kasir', 'Finance', 'Purchasing', 'Accounting'] as const;

export interface ChecklistRow {
  key: string;
  label: string;
  activeUsers: number;
  ok: boolean;
  message: string | null;
}

/**
 * Daftar periksa kesiapan peralihan. `ok` mengikuti `blockers` dari backend (sumber kebenaran);
 * jumlah akun hanya untuk tampilan.
 */
export function buildChecklist(setting: AdminModelSetting, option: AdminModelOption): ChecklistRow[] {
  const messages = new Map(option.blockers.map((blocker) => [blocker.role, blocker.message]));
  const active = (role: string): number => setting.roles.find((item) => item.name === role)?.active_users ?? 0;
  const rows: ChecklistRow[] = [];

  const conversion = option.conversions[0];
  if (conversion) {
    rows.push({
      key: `convert-${conversion.from}`,
      label: `${conversion.from} menjadi ${conversion.to}`,
      activeUsers: active(conversion.from),
      ok: !messages.has(conversion.from),
      message: messages.get(conversion.from) ?? null,
    });
  }

  if (option.model === 'standard') {
    for (const role of STANDARD_REQUIRED_ROLES) {
      rows.push({
        key: `role-${role}`,
        label: `Akun aktif ${role}`,
        activeUsers: active(role),
        ok: !messages.has(role),
        message: messages.get(role) ?? null,
      });
    }
  }

  // Penghalang yang tidak termasuk baris di atas tetap ditampilkan agar tidak ada yang tersembunyi.
  const covered = new Set(rows.flatMap((row) => (row.message ? [row.message] : [])));
  for (const blocker of option.blockers) {
    if (!covered.has(blocker.message)) {
      rows.push({ key: `blocker-${blocker.role}-${rows.length}`, label: blocker.role, activeUsers: active(blocker.role), ok: false, message: blocker.message });
    }
  }
  return rows;
}

export function conversionLine(conversion: AdminModelOption['conversions'][number]): string {
  const names = conversion.users.map((user) => `${user.name} (${user.username})${user.is_active ? '' : ' — nonaktif'}`);
  return `${conversion.from} → ${conversion.to}: ${names.join(', ')}`;
}

export function convertsCurrentUser(option: AdminModelOption, userId: number | undefined): boolean {
  if (userId === undefined) return false;
  return option.conversions.some((conversion) => conversion.users.some((user) => user.id === userId));
}

/** Semua pesan galat `errors.model` (backend mengirim satu pesan per penghalang). */
export function modelErrorMessages(errors: Record<string, string[]> | undefined): string[] {
  return errors?.model ?? [];
}
