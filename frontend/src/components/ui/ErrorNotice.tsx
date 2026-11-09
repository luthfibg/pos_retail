import { ApiError } from '@/lib/api/client';

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError
    ? error.code === 'stock_locked_by_opname' && error.lockedProducts?.length
      ? formatStockLockMessage(error.lockedProducts)
      : error.firstError()
    : 'Terjadi kesalahan tak terduga.';
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {msg}
    </div>
  );
}

function formatStockLockMessage(lockedProducts: NonNullable<ApiError['lockedProducts']>): string {
  const grouped = new Map<string, Set<string>>();
  for (const product of lockedProducts) {
    const names = grouped.get(product.session_number) ?? new Set<string>();
    names.add(product.name);
    grouped.set(product.session_number, names);
  }
  const details = [...grouped.entries()]
    .map(([session, names]) => `${[...names].join(', ')} (sesi ${session})`)
    .join('; ');
  return `Transaksi ditolak karena opname mengunci produk berikut: ${details}. Isian Anda tetap tersedia.`;
}
