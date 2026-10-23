import { api } from './client';
import type {
  Category, CategoryInput, CreditLimitRecord, Customer, CustomerInput, CustomerStatus, LoginResponse, Me, Movement, MovementType, NotificationList, OpeningBalanceInput,
  OpeningBalanceResult, Paginated, ProductStock, Product, ProductInput, ProductStatus, Supplier, SupplierInput,
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
