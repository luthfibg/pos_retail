import { api } from './client';
import type {
  Category, LoginResponse, Me, Paginated, Product, ProductInput, ProductStatus, Supplier,
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
  list: (activeOnly = false) =>
    api<{ data: Category[] }>('/categories', { query: { active_only: activeOnly ? 1 : undefined } }).then((r) => r.data),
};

export const supplierApi = {
  list: (f: { q?: string; active_only?: boolean; page?: number; per_page?: number } = {}) =>
    api<Paginated<Supplier>>('/suppliers', { query: { ...f, active_only: f.active_only ? 1 : undefined } }),
};
