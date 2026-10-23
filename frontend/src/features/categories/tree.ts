import type { Category } from '@/lib/api/types';

export interface CategoryRow {
  category: Category;
  depth: number;
}

function childrenMap(cats: Category[]): Map<number | null, Category[]> {
  const ids = new Set(cats.map((c) => c.id));
  const map = new Map<number | null, Category[]>();
  for (const c of cats) {
    // induk tidak ada di daftar (mis. tersaring) -> tampil sebagai akar
    const key = c.parent_id !== null && ids.has(c.parent_id) ? c.parent_id : null;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return map;
}

/** Urutan tampil pohon (induk lalu anak-anaknya) beserta kedalaman. */
export function flattenTree(cats: Category[]): CategoryRow[] {
  const map = childrenMap(cats);
  const out: CategoryRow[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const c of map.get(parent) ?? []) {
      if (seen.has(c.id)) continue; // jaga-jaga data berputar
      seen.add(c.id);
      out.push({ category: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Semua turunan (anak, cucu, ...) dari sebuah kategori. */
export function descendantIds(cats: Category[], id: number): Set<number> {
  const map = childrenMap(cats);
  const out = new Set<number>();
  const walk = (parent: number) => {
    for (const c of map.get(parent) ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}
