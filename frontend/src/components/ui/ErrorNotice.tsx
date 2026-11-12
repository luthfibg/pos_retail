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
  const names = [...new Set(lockedProducts.map((product) => product.name))];
  return `Sedang opname: ${names.join(', ')}`;
}