const TOKEN_KEY = 'pos.token';
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** Galat dari API. `errors` terisi untuk validasi 422 ({ field: [pesan] }). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  firstError(field?: string): string {
    if (field && this.errors?.[field]?.[0]) return this.errors[field][0];
    const first = this.errors ? Object.values(this.errors)[0]?.[0] : undefined;
    return first ?? this.message;
  }
}

let onUnauthorized: (() => void) | null = null;
/** Didaftarkan AuthProvider: dipanggil saat token ditolak (401) pada sesi yang sedang berjalan. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Header tambahan. (Kunci idempotensi penjualan dikirim di body `idempotency_key`, bukan header.) */
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: Query): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {
    Accept: 'application/json', // wajib: tanpa ini Laravel bisa membalas redirect HTML
    ...opts.headers,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi atau pastikan backend berjalan.');
  }

  const payload: unknown = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const p = (payload ?? {}) as { message?: string; errors?: Record<string, string[]> };
    // 401 pada request ber-token = sesi habis. Login yang salah membalas 422, bukan 401.
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, p.message ?? `Permintaan gagal (${res.status}).`, p.errors);
  }

  return payload as T;
}
