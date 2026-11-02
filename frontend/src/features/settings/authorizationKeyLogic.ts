import type { AuthorizationKeyType } from '@/lib/api/types';

export function normalizeAuthorizationKey(type: AuthorizationKeyType, value: string): string {
  const trimmed = value.trim();
  return type === 'code' ? trimmed.toUpperCase() : trimmed.replace(/\s+/g, ' ');
}

export function validateAuthorizationKey(type: AuthorizationKeyType, value: string): string | undefined {
  const normalized = normalizeAuthorizationKey(type, value);
  if (type === 'code') {
    if (!/^[A-Z0-9]{6}$/.test(normalized)) return 'Kode harus tepat 6 karakter huruf atau angka.';
    if (/^(.)\1{5}$/.test(normalized)) return 'Kode tidak boleh berupa satu karakter yang diulang.';
    return undefined;
  }

  const words = normalized.split(' ').filter(Boolean);
  if (normalized.length < 16 || normalized.length > 100 || words.length < 3) {
    return 'Kalimat rahasia minimal 16 karakter dan 3 kata (maksimal 100 karakter).';
  }
  return undefined;
}

export function validateGeneratedKeyChoice(type: AuthorizationKeyType, generate: boolean): string | undefined {
  return generate && type !== 'code' ? 'Pembuatan otomatis hanya tersedia untuk kode.' : undefined;
}
