import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { ProductPicker } from '@/features/products/ProductPicker';
import { ApiError } from '@/lib/api/client';
import { adjustmentApi } from '@/lib/api/endpoints';
import type {
  Adjustment,
  AdjustmentMeta,
  AdjustmentReasonCode,
  AdjustmentType,
  Product,
} from '@/lib/api/types';
import { formatDateTime, formatQty } from '@/lib/format';
import type { ProductOption } from './openingForm';
import { previewAdjustmentStock, validateAdjustment } from './adjustmentForm';

const PER_PAGE = 25;
type ManualReasonCode = Exclude<AdjustmentReasonCode, 'opname_result'>;

interface Filters {
  q: string;
  type: AdjustmentType | '';
  reason_code: AdjustmentReasonCode | '';
  date_from: string;
  date_to: string;
}

const EMPTY_FILTERS: Filters = { q: '', type: '', reason_code: '', date_from: '', date_to: '' };

function isManualReason(reason: AdjustmentMeta['reasons'][number]): reason is AdjustmentMeta['reasons'][number] & { code: ManualReasonCode } {
  return reason.selectable && reason.code !== 'opname_result';
}

function apiFieldError(error: unknown, field: string): string | undefined {
  return error instanceof ApiError ? error.errors?.[field]?.[0] : undefined;
}

function typeLabel(type: AdjustmentType): string {
  return type === 'increase' ? 'Tambah' : 'Kurang';
}

function typeSign(type: AdjustmentType): string {
  return type === 'increase' ? '+' : '−';
}

export function AdjustmentsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterDraft, setFilterDraft] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [mobileRows, setMobileRows] = useState<Adjustment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [successNumber, setSuccessNumber] = useState<string | null>(null);
  const appendNextPage = useRef(false);

  const meta = useQuery({
    queryKey: ['inventory', 'adjustment-meta'],
    queryFn: adjustmentApi.meta,
  });
  const list = useQuery({
    queryKey: ['inventory', 'adjustments', filters, page],
    queryFn: () => adjustmentApi.list({
      ...filters,
      source: 'manual',
      page,
      per_page: PER_PAGE,
    }),
  });

  useEffect(() => {
    if (!list.data) return;
    setMobileRows((current) => appendNextPage.current
      ? [...current, ...list.data.data]
      : list.data.data);
    appendNextPage.current = false;
  }, [list.data]);

  function applyFilters(event?: FormEvent) {
    event?.preventDefault();
    appendNextPage.current = false;
    setMobileRows([]);
    setFilters({ ...filterDraft, q: filterDraft.q.trim() });
    setPage(1);
    setFilterPanelOpen(false);
    setSuccessNumber(null);
  }

  function clearFilters() {
    setFilterDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setMobileRows([]);
    setPage(1);
    appendNextPage.current = false;
  }

  function changeFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilterDraft((current) => ({ ...current, [key]: value }));
  }

  function removeFilter(key: keyof Filters) {
    const next = { ...filters, [key]: '' } as Filters;
    setFilters(next);
    setFilterDraft(next);
    setMobileRows([]);
    setPage(1);
    appendNextPage.current = false;
  }

  const activeFilters = [
    filters.type && { key: 'type' as const, label: typeLabel(filters.type) },
    filters.reason_code && { key: 'reason_code' as const, label: meta.data?.reasons.find((item) => item.code === filters.reason_code)?.label ?? filters.reason_code },
    filters.date_from && { key: 'date_from' as const, label: `Dari ${filters.date_from}` },
    filters.date_to && { key: 'date_to' as const, label: `Sampai ${filters.date_to}` },
    filters.q && { key: 'q' as const, label: `Cari: ${filters.q}` },
  ].filter((item): item is { key: keyof Filters; label: string } => Boolean(item));
  const selectableReasons = meta.data?.reasons.filter(isManualReason) ?? [];
  function loadMore() {
    if (!list.data || list.isFetching || list.data.current_page >= list.data.last_page) return;
    appendNextPage.current = true;
    setPage(list.data.current_page + 1);
  }

  return (
    <div className="min-w-0 space-y-4">
      {successNumber && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <span>Adjustment {successNumber} berhasil disimpan dan stok telah diperbarui.</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setCreateOpen(true)} className="min-h-11 font-medium underline">Tambah lagi</button>
            <button type="button" onClick={() => setSuccessNumber(null)} aria-label="Tutup notifikasi" className="min-h-11 px-2">Tutup</button>
          </div>
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Daftar adjustment</h2>
          <p className="mt-1 text-sm text-slate-600">Perubahan stok langsung dicatat beserta stok sebelum dan sesudah.</p>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className="hidden min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 md:inline-flex md:items-center">
          Buat adjustment
        </button>
      </header>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 md:p-4">
        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Field label="Cari adjustment">
              <input
                className={`${inputCls} min-h-11 w-full`}
                value={filterDraft.q}
                onChange={(event) => changeFilter('q', event.target.value)}
                placeholder="Nomor, nama produk, atau barcode"
              />
            </Field>
          </div>
          <button type="submit" className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium">Cari</button>
          <button
            type="button"
            onClick={() => setFilterPanelOpen(true)}
            className="relative min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium md:hidden"
          >
            Filter{activeFilters.length > 0 ? ` (${activeFilters.length})` : ''}
          </button>
          <div className="hidden w-full flex-wrap items-end gap-3 md:flex">
            <FilterFields filters={filterDraft} reasons={selectableReasons} onChange={changeFilter} />
            <button type="submit" className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium">Terapkan filter</button>
          </div>
        </form>

        {activeFilters.length > 0 && (
          <div aria-label="Filter aktif" className="flex flex-wrap gap-2">
            {activeFilters.map((filter) => (
              <button
                type="button"
                key={filter.key}
                onClick={() => removeFilter(filter.key)}
                className="min-h-9 rounded-full bg-slate-100 px-3 text-xs text-slate-700"
                aria-label={`Hapus filter ${filter.label}`}
              >
                {filter.label} <span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" onClick={clearFilters} className="min-h-9 px-2 text-xs underline">Hapus semua</button>
          </div>
        )}

        {meta.error && <ErrorNotice error={meta.error} />}
        {list.error && (
          <div className="space-y-2">
            <ErrorNotice error={list.error} />
            <button type="button" onClick={() => void list.refetch()} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm">Coba lagi</button>
          </div>
        )}

        {list.isLoading && (
          <div aria-label="Memuat adjustment" aria-busy="true" className="space-y-2">
            {[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-md bg-slate-100 md:h-12" />)}
          </div>
        )}

        {!list.isLoading && !list.error && list.data?.total === 0 && (
          <div className="rounded-md bg-slate-50 p-5 text-center">
            <p className="font-medium">Belum ada adjustment yang cocok.</p>
            <p className="mt-1 text-sm text-slate-600">Buat adjustment untuk mencatat perubahan stok secara langsung.</p>
          </div>
        )}

        {!list.isLoading && list.data && list.data.total > 0 && (
          <>
            <div className="space-y-2 md:hidden">
              {mobileRows.map((item) => <AdjustmentCard key={item.id} item={item} onClick={() => setSelectedId(item.id)} />)}
              {mobileRows.length < list.data.total && (
                <button type="button" disabled={list.isFetching} onClick={loadMore} className="min-h-11 w-full rounded-md border border-slate-300 text-sm font-medium disabled:opacity-60">
                  {list.isFetching ? 'Memuat…' : 'Muat lagi'}
                </button>
              )}
            </div>

            <div className="hidden overflow-hidden md:block">
              <table className="w-full table-fixed text-left text-xs lg:text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="w-[15%] px-2 py-3 font-medium">Tanggal</th>
                    <th className="w-[15%] px-2 py-3 font-medium">Nomor</th>
                    <th className="w-[25%] px-2 py-3 font-medium">Produk</th>
                    <th className="w-[12%] px-2 py-3 font-medium">Tipe</th>
                    <th className="w-[10%] px-2 py-3 font-medium">Jumlah</th>
                    <th className="w-[15%] px-2 py-3 font-medium">Alasan</th>
                    <th className="hidden w-[15%] px-2 py-3 font-medium lg:table-cell">Oleh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.data.map((item) => (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      onClick={() => setSelectedId(item.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.id); } }}
                      className="cursor-pointer hover:bg-slate-50 focus:bg-slate-50"
                    >
                      <td className="truncate px-2 py-3">{formatDateTime(item.created_at)}</td>
                      <td className="truncate px-2 py-3 font-mono">{item.number}</td>
                      <td className="truncate px-2 py-3">{item.product.name}<span className="block truncate text-[11px] text-slate-500">{item.product.barcode}</span></td>
                      <td className="px-2 py-3">{typeLabel(item.type)}</td>
                      <td className="px-2 py-3 tabular-nums">{typeSign(item.type)}{formatQty(String(item.quantity))}</td>
                      <td className="truncate px-2 py-3">{item.reason_label}</td>
                      <td className="hidden truncate px-2 py-3 lg:table-cell">{item.created_by.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="hidden items-center justify-between border-t border-slate-100 pt-3 text-sm md:flex">
              <p className="text-slate-600">
                {list.data.from ?? 0}–{list.data.to ?? 0} dari {list.data.total}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={list.data.current_page <= 1 || list.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-11 rounded-md border border-slate-300 px-3 disabled:opacity-50">Sebelumnya</button>
                <span className="flex min-h-11 items-center px-2">Halaman {list.data.current_page} / {list.data.last_page}</span>
                <button type="button" disabled={list.data.current_page >= list.data.last_page || list.isFetching} onClick={() => setPage((current) => current + 1)} className="min-h-11 rounded-md border border-slate-300 px-3 disabled:opacity-50">Berikutnya</button>
              </div>
            </div>
          </>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <button type="button" onClick={() => setCreateOpen(true)} className="min-h-12 w-full rounded-md bg-slate-900 text-sm font-semibold text-white">Buat adjustment</button>
      </div>

      {filterPanelOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-900/40 md:hidden" onClick={() => setFilterPanelOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="adjustment-filter-title"
            className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 id="adjustment-filter-title" className="text-base font-semibold">Filter adjustment</h3>
              <button type="button" onClick={() => setFilterPanelOpen(false)} className="min-h-11 px-3">Tutup</button>
            </div>
            <div className="mt-3 space-y-3">
              <FilterFields filters={filterDraft} reasons={selectableReasons} onChange={changeFilter} />
              <div className="flex gap-2 border-t border-slate-100 pt-3">
                <button type="button" onClick={clearFilters} className="min-h-11 flex-1 rounded-md border border-slate-300 text-sm">Hapus filter</button>
                <button type="button" onClick={() => applyFilters()} className="min-h-11 flex-1 rounded-md bg-slate-900 text-sm font-medium text-white">Terapkan</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {createOpen && (
        <AdjustmentForm
          meta={meta.data}
          metaError={meta.error}
          onRetryMeta={() => void meta.refetch()}
          onClose={() => setCreateOpen(false)}
          onCreated={(number) => {
            setCreateOpen(false);
            setSelectedId(null);
            setSuccessNumber(number);
            setPage(1);
            setMobileRows([]);
            appendNextPage.current = false;
            void list.refetch();
          }}
        />
      )}
      {selectedId !== null && <AdjustmentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function FilterFields({
  filters,
  reasons,
  onChange,
}: {
  filters: Filters;
  reasons: AdjustmentMeta['reasons'];
  onChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
}) {
  return (
    <>
      <Field label="Tipe">
        <select className={`${inputCls} min-h-11 w-full md:w-36`} value={filters.type} onChange={(event) => onChange('type', event.target.value as Filters['type'])}>
          <option value="">Semua tipe</option>
          <option value="increase">Tambah</option>
          <option value="decrease">Kurang</option>
        </select>
      </Field>
      <Field label="Alasan">
        <select className={`${inputCls} min-h-11 w-full md:w-48`} value={filters.reason_code} onChange={(event) => onChange('reason_code', event.target.value as Filters['reason_code'])}>
          <option value="">Semua alasan</option>
          {reasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.label}</option>)}
        </select>
      </Field>
      <Field label="Dari tanggal">
        <input type="date" className={`${inputCls} min-h-11 w-full md:w-40`} value={filters.date_from} onChange={(event) => onChange('date_from', event.target.value)} />
      </Field>
      <Field label="Sampai tanggal">
        <input type="date" className={`${inputCls} min-h-11 w-full md:w-40`} value={filters.date_to} onChange={(event) => onChange('date_to', event.target.value)} />
      </Field>
    </>
  );
}

function AdjustmentCard({ item, onClick }: { item: Adjustment; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.product.name}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{item.number} · {item.product.barcode}</p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs">{typeLabel(item.type)} {typeSign(item.type)}{formatQty(String(item.quantity))}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-600">
        <span>{item.reason_label}</span>
        <span>{formatDateTime(item.created_at)}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">Oleh {item.created_by.name}</p>
    </button>
  );
}

function AdjustmentForm({
  meta,
  metaError,
  onRetryMeta,
  onClose,
  onCreated,
}: {
  meta?: AdjustmentMeta;
  metaError: unknown;
  onRetryMeta: () => void;
  onClose: () => void;
  onCreated: (number: string) => void;
}) {
  const queryClient = useQueryClient();
  const [productOption, setProductOption] = useState<ProductOption | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [type, setType] = useState<AdjustmentType>('increase');
  const [quantity, setQuantity] = useState('');
  const [reasonCode, setReasonCode] = useState<ManualReasonCode | ''>('');
  const [notes, setNotes] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const reason = meta?.reasons.find((item) => item.code === reasonCode && item.selectable) ?? null;
  const values = { product, type, quantity, reason, notes, expiryDate };
  const errors = validateAdjustment(values);
  const previewStock = previewAdjustmentStock(values);
  const currentStock = product?.store_floor_stock_sellable;
  const valid = Object.keys(errors).length === 0;
  const create = useMutation({
    mutationFn: () => {
      if (!product || !reasonCode || !valid) throw new Error('Lengkapi data adjustment yang valid.');
      return adjustmentApi.create({
        product_id: product.id,
        type,
        quantity: Number(quantity),
        reason_code: reasonCode,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(expiryDate ? { expiry_date: expiryDate } : {}),
        client_request_id: requestId.current,
      });
    },
    onSuccess: async (adjustment) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inventory', 'adjustments'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
      onCreated(adjustment.number);
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !create.isPending) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [create.isPending, onClose]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || create.isPending) return;
    create.mutate();
  }

  const buttonClass = 'min-h-11 rounded-md px-4 text-sm font-medium';
  return (
    <div className="fixed inset-0 z-50 bg-white md:flex md:items-center md:justify-center md:bg-slate-900/50 md:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="adjustment-title" className="flex h-dvh w-full flex-col bg-white md:h-auto md:max-h-[90dvh] md:max-w-xl md:rounded-xl md:shadow-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 md:px-5">
          <h2 id="adjustment-title" className="text-base font-semibold">Buat adjustment</h2>
          <button type="button" disabled={create.isPending} onClick={onClose} aria-label="Tutup form" className="min-h-11 min-w-11 rounded-md text-slate-600 disabled:opacity-50">✕</button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
            <Field label="Produk">
              <ProductPicker
                value={productOption}
                onChange={(value) => {
                  setProductOption(value);
                  if (!value) setProduct(null);
                }}
                onSelect={(selected) => { setProduct(selected); setReasonCode(''); }}
                placeholder="Cari nama, SKU, atau scan barcode"
                autoFocus
                disabled={create.isPending}
              />
              {errors.product && <p className="mt-1 text-xs text-red-700">{errors.product}</p>}
              {apiFieldError(create.error, 'product_id') && <p role="alert" className="mt-1 text-xs text-red-700">{apiFieldError(create.error, 'product_id')}</p>}
            </Field>

            {product && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium">{product.name}</p>
                <p className="mt-1 text-slate-600">
                  Stok saat ini: <span className="font-semibold tabular-nums">{formatQty(currentStock)} {product.unit_name}</span>
                </p>
                {currentStock === undefined && <p role="alert" className="mt-1 text-xs text-red-700">Stok toko belum dapat dimuat. Pilih ulang produk atau coba lagi.</p>}
              </div>
            )}

            <fieldset disabled={create.isPending} className="space-y-2">
              <legend className="text-sm font-medium">Tipe</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipe adjustment">
                {(['increase', 'decrease'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={type === value}
                    onClick={() => setType(value)}
                    className={`min-h-12 rounded-md border px-3 text-sm font-medium ${type === value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}
                  >
                    {value === 'increase' ? 'Tambah stok' : 'Kurangi stok'}
                  </button>
                ))}
              </div>
            </fieldset>

            <Field label="Jumlah">
              <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] gap-2">
                <button type="button" disabled={create.isPending} aria-label="Kurangi jumlah" onClick={() => setQuantity((current) => String(Math.max(1, (Number(current) || 1) - 1)))} className="min-h-12 rounded-md border border-slate-300 text-xl disabled:opacity-50">−</button>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="999999999"
                  step="1"
                  className={`${inputCls} min-h-12 text-center text-lg tabular-nums`}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={create.isPending}
                  aria-describedby="adjustment-quantity-hint"
                />
                <button type="button" disabled={create.isPending} aria-label="Tambah jumlah" onClick={() => setQuantity((current) => String((Number(current) || 0) + 1))} className="min-h-12 rounded-md border border-slate-300 text-xl disabled:opacity-50">+</button>
              </div>
              <p id="adjustment-quantity-hint" className="mt-1 text-xs text-slate-500">Gunakan bilangan bulat.</p>
              {(errors.quantity || apiFieldError(create.error, 'quantity')) && <p role="alert" className="mt-1 text-xs text-red-700">{errors.quantity ?? apiFieldError(create.error, 'quantity')}</p>}
            </Field>

            <fieldset disabled={create.isPending || !meta} className="space-y-2">
              <legend className="text-sm font-medium">Alasan</legend>
              <div role="radiogroup" aria-label="Alasan adjustment" className="grid gap-2 sm:grid-cols-2">
                {(meta?.reasons.filter(isManualReason) ?? []).map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    role="radio"
                    aria-checked={reasonCode === item.code}
                    onClick={() => setReasonCode(item.code)}
                    className={`min-h-12 rounded-md border px-3 text-left text-sm ${reasonCode === item.code ? 'border-slate-900 bg-slate-50 font-medium' : 'border-slate-300'}`}
                  >
                    {item.label}{item.requires_notes ? ' *' : ''}
                  </button>
                ))}
              </div>
              {errors.reason && <p role="alert" className="text-xs text-red-700">{errors.reason}</p>}
              {apiFieldError(create.error, 'reason_code') && <p role="alert" className="text-xs text-red-700">{apiFieldError(create.error, 'reason_code')}</p>}
            </fieldset>

            {metaError != null && (
              <div className="space-y-2">
                <ErrorNotice error={metaError} />
                <button type="button" onClick={onRetryMeta} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm">Muat alasan lagi</button>
              </div>
            )}

            {product?.track_expiry && type === 'increase' && (
              <Field label="Tanggal kedaluwarsa">
                <input type="date" className={`${inputCls} min-h-11`} value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} disabled={create.isPending} />
                {(errors.expiryDate || apiFieldError(create.error, 'expiry_date')) && <p role="alert" className="mt-1 text-xs text-red-700">{errors.expiryDate ?? apiFieldError(create.error, 'expiry_date')}</p>}
              </Field>
            )}

            <Field label={reason?.requires_notes ? 'Catatan *' : 'Catatan (opsional)'}>
              <textarea className={`${inputCls} min-h-24`} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={create.isPending} />
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>{(errors.notes || apiFieldError(create.error, 'notes')) && <span role="alert" className="text-red-700">{errors.notes ?? apiFieldError(create.error, 'notes')}</span>}</span>
                <span>{notes.length}/500</span>
              </div>
            </Field>

            {previewStock !== null && product && (
              <p role="status" className="rounded-md bg-slate-50 p-3 text-sm">
                Stok akan menjadi <strong className="tabular-nums">{formatQty(previewStock)} {product.unit_name}</strong>.
                <span className="ml-1 text-xs text-slate-500">Perkiraan; saldo final ditentukan server.</span>
              </p>
            )}

            {create.error && (
              <div className="space-y-2">
                <ErrorNotice error={create.error} />
                {create.error instanceof ApiError && create.error.status !== 422 && (
                  <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm">
                    Coba lagi
                  </button>
                )}
              </div>
            )}
          </div>

          <footer className="flex shrink-0 gap-2 border-t border-slate-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:justify-end md:px-5 md:py-4">
            <button type="button" disabled={create.isPending} onClick={onClose} className={`${buttonClass} flex-1 border border-slate-300 md:flex-none`}>Batal</button>
            <button type="submit" disabled={!valid || create.isPending || !meta} className={`${buttonClass} flex-1 bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-50 md:flex-none`}>
              {create.isPending ? 'Menyimpan…' : 'Simpan adjustment'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function AdjustmentDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['inventory', 'adjustment', id],
    queryFn: () => adjustmentApi.get(id),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const item = detail.data;
  return (
    <div className="fixed inset-0 z-50 bg-white md:flex md:items-center md:justify-center md:bg-slate-900/50 md:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="adjustment-detail-title" className="flex h-dvh w-full flex-col bg-white md:h-auto md:max-h-[85dvh] md:max-w-lg md:rounded-xl md:shadow-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 id="adjustment-detail-title" className="text-base font-semibold">Detail adjustment</h2>
          <button type="button" onClick={onClose} aria-label="Tutup detail" className="min-h-11 min-w-11 text-slate-600">✕</button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {detail.isLoading && <p role="status" className="text-sm text-slate-500">Memuat detail…</p>}
          {detail.error && (
            <div className="space-y-2">
              <ErrorNotice error={detail.error} />
              <button type="button" onClick={() => void detail.refetch()} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm">Coba lagi</button>
            </div>
          )}
          {item && (
            <>
              <div>
                <p className="font-mono text-sm font-semibold">{item.number}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(item.created_at)}</p>
              </div>
              <dl className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.2fr)] gap-x-3 gap-y-3 text-sm">
                <dt className="text-slate-500">Produk</dt><dd className="break-words font-medium">{item.product.name}</dd>
                <dt className="text-slate-500">Barcode</dt><dd className="break-all font-mono text-xs">{item.product.barcode}</dd>
                <dt className="text-slate-500">Tipe</dt><dd>{typeLabel(item.type)}</dd>
                <dt className="text-slate-500">Jumlah</dt><dd>{formatQty(String(item.quantity))}</dd>
                <dt className="text-slate-500">Alasan</dt><dd>{item.reason_label}</dd>
                <dt className="text-slate-500">Stok sebelum</dt><dd>{formatQty(item.stock_before)}</dd>
                <dt className="text-slate-500">Stok sesudah</dt><dd>{formatQty(item.stock_after)}</dd>
                <dt className="text-slate-500">Dibuat oleh</dt><dd>{item.created_by.name}</dd>
                <dt className="text-slate-500">Sumber</dt><dd>{item.source === 'manual' ? 'Manual' : 'Opname'}</dd>
                {item.opname_session_id !== null && <><dt className="text-slate-500">Sesi opname</dt><dd>{item.opname_session_id}</dd></>}
                <dt className="text-slate-500">Movement</dt><dd>{item.stock_movement_ids?.join(', ') || item.stock_movement_id || '—'}</dd>
              </dl>
              <div className="rounded-md bg-slate-50 p-3 text-sm">
                <p className="text-xs font-medium text-slate-500">Catatan</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{item.notes || 'Tidak ada catatan.'}</p>
              </div>
            </>
          )}
        </div>
        <footer className="shrink-0 border-t border-slate-200 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
          <button type="button" onClick={onClose} className="min-h-11 w-full rounded-md border border-slate-300 text-sm md:w-auto md:px-5">Tutup</button>
        </footer>
      </section>
    </div>
  );
}
