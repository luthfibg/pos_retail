import { api } from './client';
import type {
  Category, CategoryInput, CashDeposit, CashMovement, CashMovementType, CreditLimitRecord, Customer, CustomerInput, CustomerStatus, DepositKind, DepositStatus, LoginResponse, Me, Movement, MovementType, NotificationList, OpeningBalanceInput,
  FloatPolicies, FloatPolicyInput, FloatPolicyScope, OpeningBalanceResult, Paginated, ProductStock, Product, ProductInput, ProductStatus, Shift, ShiftStatus, Supplier, SupplierInput,
  PaymentMode, PostSaleResponse, Sale, SaleInput, SalePreview, SalePreviewInput, SaleStatus, SaleSummary,
  Discount, DiscountInput, DiscountTarget, DiscountUpdate, VatInput, VatSetting,
} from './types';

export const authApi = {
  login: (username: string, password: string) =>
    api<LoginResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => api<{ message: string }>('/auth/logout', { method: 'POST' }),
  me: () => api<Me>('/auth/me'),
};

export interface ProductFilters {
  q?: string;
  category_id?: number;
  status?: ProductStatus;
  page?: number;
  per_page?: number;
}

export const productApi = {
  list: (f: ProductFilters = {}) => api<Paginated<Product>>('/products', { query: { ...f } }),
  get: (id: number) => api<{ data: Product }>(`/products/${id}`).then((r) => r.data),
  byBarcode: (barcode: string) =>
    api<{ data: Product }>(`/products/by-barcode/${encodeURIComponent(barcode)}`).then((r) => r.data),
  create: (input: ProductInput) =>
    api<{ data: Product }>('/products', { method: 'POST', body: input }).then((r) => r.data),
  update: (
    id: number,
    input: Partial<Omit<ProductInput, 'sku' | 'barcode'>> & { status?: 'active' | 'inactive'; reason?: string },
  ) => api<{ data: Product }>(`/products/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
};

export const categoryApi = {
  create: (input: CategoryInput) =>
    api<{ data: Category }>('/categories', { method: 'POST', body: input }).then((r) => r.data),
  update: (id: number, input: { name?: string; parent_id?: number | null; is_active?: boolean }) =>
    api<{ data: Category }>(`/categories/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
  list: (activeOnly = false) =>
    api<{ data: Category[] }>('/categories', { query: { active_only: activeOnly ? 1 : undefined } }).then((r) => r.data),
};

export const supplierApi = {
  create: (input: SupplierInput) =>
    api<{ data: Supplier }>('/suppliers', { method: 'POST', body: input }).then((r) => r.data),
  update: (
    id: number,
    input: Partial<Omit<SupplierInput, 'code'>> & { is_active?: boolean },
  ) => api<{ data: Supplier }>(`/suppliers/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
  list: (f: { q?: string; active_only?: boolean; page?: number; per_page?: number } = {}) =>
    api<Paginated<Supplier>>('/suppliers', { query: { ...f, active_only: f.active_only ? 1 : undefined } }),
};

export interface MovementFilters {
  product_id?: number;
  movement_type?: MovementType;
  date_from?: string; // YYYY-MM-DD (WIB)
  date_to?: string;
  page?: number;
  per_page?: number;
}

export const inventoryApi = {
  productStock: (productId: number) =>
    api<{ data: ProductStock }>(`/inventory/products/${productId}/stock`).then((r) => r.data),
  movements: (f: MovementFilters = {}) => api<Paginated<Movement>>('/inventory/movements', { query: { ...f } }),
  openingBalance: (input: OpeningBalanceInput) =>
    api<{ data: OpeningBalanceResult }>('/inventory/opening-balances', { method: 'POST', body: input }).then((r) => r.data),
};

export const customerApi = {
  list: (f: { q?: string; status?: CustomerStatus; page?: number; per_page?: number } = {}) =>
    api<Paginated<Customer>>('/customers', { query: { ...f } }),
  get: (id: number) => api<{ data: Customer }>(`/customers/${id}`).then((r) => r.data),
  create: (input: CustomerInput) =>
    api<{ data: Customer }>('/customers', { method: 'POST', body: input }).then((r) => r.data),
  update: (
    id: number,
    input: Partial<CustomerInput> & { status?: 'active' | 'inactive'; reason?: string },
  ) => api<{ data: Customer }>(`/customers/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
  verify: (id: number, input: { credit_limit?: string; note?: string }) =>
    api<{ data: Customer }>(`/customers/${id}/verify`, { method: 'POST', body: input }).then((r) => r.data),
  setLimit: (id: number, input: { limit_amount: string; note?: string }) =>
    api<{ data: Customer }>(`/customers/${id}/credit-limit`, { method: 'PUT', body: input }).then((r) => r.data),
  limitHistory: (id: number) =>
    api<{ data: CreditLimitRecord[] }>(`/customers/${id}/credit-limits`).then((r) => r.data),
};

export const notificationApi = {
  list: (f: { unread?: boolean; page?: number; per_page?: number } = {}) =>
    api<NotificationList>('/notifications', { query: { unread: f.unread ? 1 : undefined, page: f.page, per_page: f.per_page } }),
  read: (id: number) => api<{ data: { id: number; read: boolean } }>(`/notifications/${id}/read`, { method: 'POST' }),
  readAll: () => api<{ data: { marked: number } }>('/notifications/read-all', { method: 'POST' }),
};

export interface ShiftFilters {
  status?: ShiftStatus;
  cashier_id?: number;
  date_from?: string; // YYYY-MM-DD (WIB)
  date_to?: string;
  page?: number;
  per_page?: number;
}

export const shiftApi = {
  /** Shift aktif (open/counting) milik pengguna; data = null bila belum ada. */
  current: () => api<{ data: Shift | null }>('/shifts/current').then((r) => r.data),
  get: (id: number) => api<{ data: Shift }>(`/shifts/${id}`).then((r) => r.data),
  open: (input: { counted_opening_cash?: string }) =>
    api<{ data: Shift }>('/shifts/open', { method: 'POST', body: input }).then((r) => r.data),
  startCount: (id: number) =>
    api<{ data: Shift }>(`/shifts/${id}/start-count`, { method: 'POST' }).then((r) => r.data),
  close: (id: number, input: { counted_cash: string; variance_note?: string }) =>
    api<{ data: Shift }>(`/shifts/${id}/close`, { method: 'POST', body: input }).then((r) => r.data),
  review: (id: number, input: { note?: string }) =>
    api<{ data: Shift }>(`/shifts/${id}/review`, { method: 'POST', body: input }).then((r) => r.data),
  list: (f: ShiftFilters = {}) => api<Paginated<Shift>>('/shifts', { query: { ...f } }),
};

export const cashDepositApi = {
  list: (f: { status?: DepositStatus; kind?: DepositKind; shift_id?: number; per_page?: number } = {}) =>
    api<Paginated<CashDeposit>>('/cash-deposits', { query: { ...f } }),
  get: (id: number) => api<{ data: CashDeposit }>(`/cash-deposits/${id}`).then((r) => r.data),
  submit: (id: number) =>
    api<{ data: CashDeposit }>(`/cash-deposits/${id}/submit`, { method: 'POST' }).then((r) => r.data),
};

export const floatPolicyApi = {
  list: () => api<{ data: FloatPolicies }>('/float-policies').then((r) => r.data),
  update: (scope: FloatPolicyScope, input: FloatPolicyInput) =>
    api<{ data: FloatPolicies['petty_cash'] }>('/float-policies/' + scope, { method: 'PUT', body: input }).then((r) => r.data),
};

export const cashMovementApi = {
  list: (shiftId: number, page = 1, perPage = 25) =>
    api<Paginated<CashMovement>>(`/shifts/${shiftId}/cash-movements`, { query: { page, per_page: perPage } }),
  create: (shiftId: number, input: { type: CashMovementType; amount: string; reason: string }) =>
    api<{ data: CashMovement }>(`/shifts/${shiftId}/cash-movements`, { method: 'POST', body: input }).then((r) => r.data),
};

export interface SaleFilters {
  q?: string; // awalan nomor struk
  shift_id?: number;
  customer_id?: number;
  status?: SaleStatus;
  payment_mode?: PaymentMode;
  date_from?: string; // YYYY-MM-DD (WIB)
  date_to?: string;
  page?: number;
  per_page?: number;
}

export const saleApi = {
  /**
   * Posting penjualan. `idempotency_key` ada di BODY (bukan header) dan dibuat sekali per keranjang;
   * kirim ulang kunci yang SAMA bila hasil tidak diketahui (jaringan putus). 201 = baru, 200 + replayed = ulangan.
   */
  post: (input: SaleInput) => api<PostSaleResponse>('/sales', { method: 'POST', body: input }),
  list: (f: SaleFilters = {}) => api<Paginated<SaleSummary>>('/sales', { query: { ...f } }),
  get: (id: number) => api<{ data: Sale }>(`/sales/${id}`).then((r) => r.data),
  /** Struk sama dengan receipt.is_copy = true (SALINAN); tercatat di log cetak. */
  reprint: (id: number) => api<{ data: Sale }>(`/sales/${id}/reprint`, { method: 'POST' }).then((r) => r.data),
  /** Admin saja (sales.void). Alasan wajib. */
  void: (id: number, reason: string) =>
    api<{ data: Sale }>(`/sales/${id}/void`, { method: 'POST', body: { reason } }).then((r) => r.data),
  /** FR-01: belum ada di backend sampai statusnya Selesai (docs/FRONTEND_REQUESTS.md). Hanya-baca. */
  preview: (input: SalePreviewInput, signal?: AbortSignal) =>
    api<{ data: SalePreview }>('/sales/preview', { method: 'POST', body: input, signal }).then((r) => r.data),
};

export const discountApi = {
  list: (f: { target_type?: DiscountTarget; active_only?: boolean; page?: number; per_page?: number } = {}) =>
    api<Paginated<Discount>>('/discounts', { query: { ...f, active_only: f.active_only ? 1 : undefined } }),
  get: (id: number) => api<{ data: Discount }>(`/discounts/${id}`).then((r) => r.data),
  create: (input: DiscountInput) =>
    api<{ data: Discount }>('/discounts', { method: 'POST', body: input }).then((r) => r.data),
  update: (id: number, input: DiscountUpdate) =>
    api<{ data: Discount }>(`/discounts/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
};

export const settingsApi = {
  vat: () => api<{ data: VatSetting }>('/settings/vat').then((r) => r.data),
  saveVat: (input: VatInput) =>
    api<{ data: VatSetting }>('/settings/vat', { method: 'PUT', body: input }).then((r) => r.data),
};
