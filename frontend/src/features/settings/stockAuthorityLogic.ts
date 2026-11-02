import type { StockAuthorityRule, StockAuthorityUpdate } from '@/lib/api/types';

/** Perubahan yang belum disimpan: hanya aturan yang diubah, kunci = `rule.key`, nilai = role terpilih. */
export type StockDraft = Record<string, string[]>;

export const ACTION_TITLE: Record<string, string> = {
  opening_balance: 'Stok awal',
  receipt: 'Penerimaan barang',
  supplier_return: 'Retur supplier',
  transfer: 'Transfer / putaway',
  adjustment_request: 'Ajuan adjustment / opname',
  adjustment_approve: 'Persetujuan adjustment / opname',
};

export function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((role) => set.has(role));
}

export function effectiveRoles(rule: StockAuthorityRule, draft: StockDraft): string[] {
  return draft[rule.key] ?? rule.roles;
}

/** Mencentang atau mencabut satu role. Hasil berurutan mengikuti `assignable` agar tampilan stabil. */
export function toggleRole(rule: StockAuthorityRule, draft: StockDraft, role: string, assignable: readonly string[]): StockDraft {
  const current = new Set(effectiveRoles(rule, draft));
  if (current.has(role)) current.delete(role);
  else current.add(role);
  const next = assignable.filter((name) => current.has(name));
  const result: StockDraft = { ...draft };
  if (sameRoles(next, rule.roles)) delete result[rule.key];
  else result[rule.key] = next;
  return result;
}

export function resetToDefault(rule: StockAuthorityRule, draft: StockDraft): StockDraft {
  const result: StockDraft = { ...draft };
  if (sameRoles(rule.default_roles, rule.roles)) delete result[rule.key];
  else result[rule.key] = [...rule.default_roles];
  return result;
}

export interface StockChange {
  rule: StockAuthorityRule;
  from: string[];
  to: string[];
  /** Hasil akhir sama dengan default model: dikirim `null` agar backend menghapus penyetelan khusus. */
  toDefault: boolean;
}

export function pendingChanges(rules: readonly StockAuthorityRule[], draft: StockDraft): StockChange[] {
  return rules.flatMap((rule) => {
    const to = draft[rule.key];
    if (!to || sameRoles(to, rule.roles)) return [];
    return [{ rule, from: rule.roles, to, toDefault: sameRoles(to, rule.default_roles) }];
  });
}

export function buildPayload(changes: readonly StockChange[]): StockAuthorityUpdate[] {
  return changes.map((change) => ({ key: change.rule.key, roles: change.toDefault ? null : change.to }));
}

/** Aturan yang tidak punya role sama sekali ditolak backend (422); cegah dari sisi UI. */
export function emptyRuleKeys(rules: readonly StockAuthorityRule[], draft: StockDraft): string[] {
  return rules.filter((rule) => effectiveRoles(rule, draft).length === 0).map((rule) => rule.key);
}

export function groupRules(rules: readonly StockAuthorityRule[]): Array<{ action: string; title: string; rules: StockAuthorityRule[] }> {
  const groups: Array<{ action: string; title: string; rules: StockAuthorityRule[] }> = [];
  for (const rule of rules) {
    let group = groups.find((item) => item.action === rule.action);
    if (!group) {
      group = { action: rule.action, title: ACTION_TITLE[rule.action] ?? rule.label, rules: [] };
      groups.push(group);
    }
    group.rules.push(rule);
  }
  return groups;
}

/** Judul baris: aturan berlingkup dibedakan Toko/Gudang, sisanya memakai label dari backend. */
export function rowTitle(rule: StockAuthorityRule): string {
  if (rule.scope === 'warehouse') return 'Lokasi Gudang';
  if (rule.scope === 'store_floor') return 'Lokasi Toko';
  return rule.label;
}

export function formatRoles(roles: readonly string[]): string {
  return roles.length > 0 ? roles.join(', ') : '(tidak ada)';
}

/** Semua pesan galat 422 (kunci seperti `rules.0.roles`) dalam satu daftar tanpa duplikat. */
export function validationMessages(errors: Record<string, string[]> | undefined): string[] {
  return Array.from(new Set(Object.values(errors ?? {}).flat()));
}
