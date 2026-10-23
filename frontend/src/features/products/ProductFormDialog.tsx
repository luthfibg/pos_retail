import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { categoryApi, productApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Product, ProductStatus } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { formatRupiah } from '@/lib/format';
import {
  buildCreatePayload, buildUpdatePayload, emptyValues, valuesFromProduct, validateProduct,
  type FormErrors, type ProductFormValues, type UpdatePayload,
} from './productForm';

type Job =
  | { kind: 'create'; input: ReturnType<typeof buildCreatePayload> }
  | { kind: 'update'; id: number; input: UpdatePayload };

const STATUS_LABEL: Record<ProductStatus, string> = {
  active: 'Aktif',
  pending_price: 'Menunggu harga',
  inactive: 'Nonaktif',
};

interface Props {
  /** undefined = produk baru */
  product?: Product;
  onClose: () => void;
}

export function ProductFormDialog({ product, onClose }: Props) {
  const mode = product ? 'edit' : 'create';
  const { can } = useAuth();
  const qc = useQueryClient();
  const caps = { canSetPrice: can('price.change'), canActivate: can('product.activate') };

  const [values, setValues] = useState<ProductFormValues>(() => (product ? valuesFromProduct(product) : emptyValues()));
  const [errors, setErrors] = useState<FormErrors>({});
  const [created, setCreated] = useState<Product | null>(null);

  const categories = useQuery({ queryKey: ['categories', 'active'], queryFn: () => categoryApi.list(true) });

  const mutation = useMutation({
    mutationFn: (job: Job) =>
      job.kind === 'create' ? productApi.create(job.input) : productApi.update(job.id, job.input),
    onSuccess: (saved, job) => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['categories'] });
      if (job.kind === 'create') setCreated(saved);
      else onClose();
    },
  });

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // Pesan dari server (422) per kolom, bila ada; kesalahan klien didahulukan.
  const serverErrors: FormErrors = {};
  if (mutation.error instanceof ApiError && mutation.error.status === 422) {
    for (const [k, msgs] of Object.entries(mutation.error.errors ?? {})) {
      (serverErrors as Record<string, string>)[k] = msgs[0] ?? '';
    }
  }
  const err = (k: keyof FormErrors) => errors[k] ?? serverErrors[k];
  const showTopError = !(mutation.error instanceof ApiError && mutation.error.status === 422);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return; // cegah kirim ganda
    mutation.reset();

    const found = validateProduct(values, mode, caps, product);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    if (product) {
      const input = buildUpdatePayload(values, product, caps);
      if (Object.keys(input).length === 0) { onClose(); return; }
      mutation.mutate({ kind: 'update', id: product.id, input });
    } else {
      mutation.mutate({ kind: 'create', input: buildCreatePayload(values, caps) });
    }
  }

  function addAnother() {
    setCreated(null);
    setValues(emptyValues());
    setErrors({});
    mutation.reset();
  }

  if (created) {
    return (
      <Modal title="Produk dibuat" onClose={onClose}>
        <div className="space-y-3 p-5 text-sm">
          <p><span className="font-medium">{created.name}</span> berhasil disimpan.</p>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1 rounded-md bg-slate-50 p-3">
            <dt className="text-slate-500">SKU</dt><dd className="font-mono">{created.sku}</dd>
            <dt className="text-slate-500">Barcode</dt><dd className="font-mono">{created.barcode}</dd>
            <dt className="text-slate-500">Status</dt><dd>{STATUS_LABEL[created.status]}</dd>
          </dl>
          {created.status === 'pending_price' && (
            <p className="text-slate-600">Produk belum bisa dijual sampai Admin menetapkan harga dan mengaktifkannya.</p>
          )}
          <p className="text-slate-500">SKU dan barcode tidak dapat diubah setelah dibuat.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={addAnother} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Tambah lagi</button>
          <button type="button" onClick={onClose} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Selesai</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={product ? `Ubah produk — ${product.sku}` : 'Produk baru'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <div className="space-y-4 p-5">
          {showTopError && <ErrorNotice error={mutation.error} />}

          <Field label="Nama produk" error={err('name')}>
            <input className={inputCls} value={values.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" error={err('sku')} hint={mode === 'create' ? 'Kosongkan untuk otomatis.' : 'Tidak dapat diubah.'}>
              <input
                className={`${inputCls} font-mono`}
                value={values.sku}
                placeholder={mode === 'create' ? 'Otomatis' : undefined}
                disabled={mode === 'edit'}
                onChange={(e) => set('sku', e.target.value)}
              />
            </Field>
            <Field label="Barcode" error={err('barcode')} hint={mode === 'create' ? 'Kosongkan untuk dibuat otomatis (EAN-13).' : 'Tidak dapat diubah.'}>
              <input
                className={`${inputCls} font-mono`}
                value={values.barcode}
                placeholder={mode === 'create' ? 'Otomatis' : undefined}
                disabled={mode === 'edit'}
                onChange={(e) => set('barcode', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategori" error={err('category_id')}>
              <select className={inputCls} value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Tanpa kategori</option>
                {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Satuan" error={err('unit_name')}>
              <input className={inputCls} value={values.unitName} onChange={(e) => set('unitName', e.target.value)} />
            </Field>
          </div>

          {caps.canSetPrice ? (
            <Field label="Harga jual (Rp)" error={err('sell_price')} hint={mode === 'create' ? 'Kosongkan bila harga belum ditetapkan.' : undefined}>
              <input
                className={`${inputCls} tabular-nums`}
                inputMode="decimal"
                value={values.sellPrice}
                onChange={(e) => set('sellPrice', e.target.value)}
              />
            </Field>
          ) : (
            <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              {mode === 'create'
                ? 'Harga ditetapkan oleh Admin. Produk baru berstatus "Menunggu harga" dan belum bisa dijual.'
                : <>Harga jual: <span className="font-medium">{formatRupiah(product?.sell_price)}</span> (hanya Admin yang dapat mengubah).</>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Batas minimum" error={err('min_stock')} hint="Status “Hampir habis” bila stok ≤ batas ini.">
              <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.minStock} onChange={(e) => set('minStock', e.target.value)} />
            </Field>
            <Field label="Batas kritis" error={err('critical_stock')} hint="Status “Kritis” bila stok di bawah batas ini.">
              <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.criticalStock} onChange={(e) => set('criticalStock', e.target.value)} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={values.trackExpiry} onChange={(e) => set('trackExpiry', e.target.checked)} />
            Lacak tanggal kadaluarsa (penjualan memakai FEFO)
          </label>

          {mode === 'edit' && caps.canActivate && (
            <Field label="Status" error={err('status')} hint="Produk yang masih memiliki stok tidak dapat dinonaktifkan.">
              <select className={inputCls} value={values.status} onChange={(e) => set('status', e.target.value as ProductStatus)}>
                {product?.status === 'pending_price' && <option value="pending_price" disabled>{STATUS_LABEL.pending_price}</option>}
                <option value="active">{STATUS_LABEL.active}</option>
                <option value="inactive">{STATUS_LABEL.inactive}</option>
              </select>
            </Field>
          )}

          {mode === 'edit' && (
            <Field label="Alasan perubahan (opsional)" hint="Tercatat di audit log.">
              <input className={inputCls} value={values.reason} onChange={(e) => set('reason', e.target.value)} maxLength={500} />
            </Field>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
          <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
