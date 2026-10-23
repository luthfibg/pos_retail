/** Uang dan qty dari API adalah STRING desimal ("3500.00", "12.500"). Jangan diubah jadi float untuk perhitungan. */
export type Decimal = string;

export interface Paginated<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export interface UserSummary {
  id: number;
  name: string;
  username: string;
}

export interface StoreInfo {
  id: number;
  code: string;
  name: string;
  timezone: string;
  currency: string;
}

export interface Me {
  user: UserSummary;
  store: StoreInfo;
  roles: string[];
  permissions: string[];
}

export interface LoginResponse {
  token: string;
  token_type: 'Bearer';
  expires_at: string;
  user: UserSummary;
}

export type ProductStatus = 'pending_price' | 'active' | 'inactive';
export type StockStatus = 'habis' | 'kritis' | 'hampir_habis' | 'aman';

export interface Product {
  id: number;
  sku: string;
  barcode: string;
  name: string;
  category_id: number | null;
  category_name: string | null;
  unit_name: string;
  track_expiry: boolean;
  sell_price: Decimal | null;
  avg_cost: Decimal | null;
  min_stock: Decimal;
  critical_stock: Decimal;
  status: ProductStatus;
  stock_sellable: Decimal;
  stock_status: StockStatus;
}

export interface ProductInput {
  sku?: string;
  barcode?: string;
  name: string;
  category_id?: number | null;
  unit_name?: string;
  track_expiry?: boolean;
  sell_price?: Decimal | null;
  min_stock?: Decimal;
  critical_stock?: Decimal;
}

export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  is_active: boolean;
  products_count: number;
}

export type PaymentTerms = 'prepaid' | 'credit' | 'cod';

export interface Supplier {
  id: number;
  code: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  default_payment_terms: PaymentTerms | null;
  is_active: boolean;
}

export interface CategoryInput {
  name: string;
  parent_id?: number | null;
}

export interface SupplierInput {
  code: string;
  name: string;
  contact_name?: string | null;
  phone?: string | null;
  address?: string | null;
  default_payment_terms?: PaymentTerms;
}
