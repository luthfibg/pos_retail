import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { categoryApi, discountApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Discount, DiscountTarget, DiscountType } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ProductPicker } from '@/features/products/ProductPicker';
import type { ProductOption } from '@/features/inventory/openingForm';
import { flattenTree } from '@/features/categories/tree';
import {
  TARGET_LABEL, TYPE_LABEL, buildDiscountCreate, buildDiscountUpdate, emptyDiscount, validateDiscount, valuesFromDiscount,
  type DiscountErrors, type DiscountFormValues,
} from './discountForm';

interface Props {
  /** undefined = diskon baru */
  discount?: Discount;
  onClose: () => void;
}

export function DiscountFormDialog({ discount, onClose }: Props) {
  const mode = discount ? 'edit' : 'create';
  const qc = useQueryClient();
  const [values, setValues] = useState<DiscountFormValues>(() => (discount ? valuesFromDiscount(discount) : emptyDiscount()));
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [errors, setErrors] = useState<DiscountErrors>({});

  const categories = useQuery({
    queryKey: ['categories', 'active'],
    queryFn: () => categoryApi.list(true),
    enabled: mode === 'create' && values.targetType === 'category',
  });

  const mutation = useMutation({
    mutationFn: () => (discount ? discountApi.update(discount.id, buildDiscountUpdate(values, discount)) : discountApi.create(buildDiscountCreate(values))),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['discounts'] });
      onClose();
    },
  });

  const set = <K extends keyof DiscountFormValues>(k: K, v: DiscountFormValues[K]) => setValues((s) => ({ ...s, [k]: v }));

  const is422 = mutation.error instanceof ApiError && mutation.error.status === 422;
  const serverErrors: DiscountErrors = {};
  if (mutation.error instanceof ApiError && is422) {
    for (const [k, msgs] of Object.entries(mutation.error.errors ?? {})) (serverErrors as Record<string, string>)[k] = msgs[0] ?? '';
  }
  const err = (k: keyof DiscountErrors) => errors[k] ?? serverErrors[k];

  function changeTarget(t: DiscountTarget) {
    setValues((s) => ({ ...s, targetType: t, targetId: null }));
    setProduct(null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const found = validateDiscount(values, mode);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (discount && Object.keys(buildDiscountUpdate(values, discount)).length === 0) { onClose(); return; }
    mutation.mutate();
  }

  const categoryOptions = flattenTree(categories.data ?? []);

  return (
    <Modal title={discount ? 'Ubah diskon' : 'Diskon baru'} onClose={() => { if (!mutation.isPending) onClose(); }}>
      <form onSubmit={onSubmit} noValidate>
        <div className="space-y-4 p-5">
          {!is422 && <ErrorNotice error={mutation.error} />}

          <Field label="Nama diskon" error={err('name')}>
            <input className={inputCls} value={values.name} maxLength={120} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="mis. Promo akhir bulan" />
          </Field>

          {mode === 'create' ? (
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <Field label="Berlaku untuk">
                <select className={inputCls} value={values.targetType} onChange={(e) => changeTarget(e.target.value as DiscountTarget)}>
                  {(Object.keys(TARGET_LABEL) as DiscountTarget[]).map((t) => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
                </select>
              </Field>
              {values.targetType === 'product' ? (
                <div>
                  <span className="mb-1 block text-sm font-medium">Produk</span>
                  <ProductPicker value={product} onChange={(p) => { setProduct(p); set('targetId', p ? p.id : null); }} />
                  {err('target_id') && <p role="alert" className="mt-1 text-xs text-red-700">{err('target_id')}</p>}
                </div>
              ) : (
                <Field label="Kategori" error={err('target_id')} hint="Diskon kategori berlaku untuk produk di kategori itu.">
                  <select className={inputCls} value={values.targetId ?? ''} onChange={(e) => set('targetId', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Pilih kategori</option>
                    {categoryOptions.map(({ category: c, depth }) => <option key={c.id} value={c.id}>{`${'— '.repeat(depth)}${c.name}`}</option>)}
                  </select>
                </Field>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Berlaku untuk {discount ? TARGET_LABEL[discount.target_type].toLowerCase() : ''} <span className="font-medium">{discount?.target_name ?? '—'}</span>.
              Target tidak dapat diubah; buat diskon baru bila perlu.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Jenis potongan" error={err('discount_type')}>
              <select className={inputCls} value={values.discountType} onChange={(e) => set('discountType', e.target.value as DiscountType)}>
                {(Object.keys(TYPE_LABEL) as DiscountType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label={values.discountType === 'percent' ? 'Persen' : 'Nominal per unit (Rp)'} error={err('value')}>
              <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.value} onChange={(e) => set('value', e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mulai (tanggal WIB)" error={err('starts_at')} hint={mode === 'create' ? 'Kosong = mulai sekarang.' : undefined}>
              <input type="date" className={inputCls} value={values.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
            </Field>
            <Field label="Berakhir (tanggal WIB)" error={err('ends_at')} hint="Kosong = tanpa batas akhir. Berlaku sampai akhir hari itu.">
              <input type="date" className={inputCls} value={values.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
            </Field>
          </div>

          {mode === 'edit' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              Diskon aktif
            </label>
          )}
          <p className="text-xs text-slate-500">Bila beberapa diskon berlaku untuk satu produk, kasir otomatis memakai yang potongannya terbesar. Diskon tidak dihapus; nonaktifkan bila tidak dipakai.</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" disabled={mutation.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
          <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
