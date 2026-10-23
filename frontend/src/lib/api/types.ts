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

export type ExpiryStatus = 'none' | 'ok' | 'near_expiry' | 'expired';

export interface StockTotals {
  qty_sellable: Decimal;
  qty_quarantine: Decimal;
  qty_damaged: Decimal;
}

export interface StockBatch {
  balance_id: number;
  batch_id: number | null;
  batch_code: string | null;
  expiry_date: string | null; // YYYY-MM-DD (tanggal WIB)
  expiry_status: ExpiryStatus;
  is_opening: boolean;
  received_at: string | null; // UTC
  location_id: number;
  shelf_position_id: number | null;
  qty_sellable: Decimal;
  qty_quarantine: Decimal;
  qty_damaged: Decimal;
}

/** Urutan `batches` = urutan FEFO (yang dijual lebih dulu di atas). */
export interface ProductStock {
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  track_expiry: boolean;
  avg_cost: Decimal | null; // HPP: hanya tampilkan di layar Admin
  totals: StockTotals;
  batches: StockBatch[];
}

export type MovementType =
  | 'opening_balance' | 'receipt' | 'putaway' | 'transfer' | 'sale' | 'sale_void'
  | 'customer_return' | 'supplier_return_out' | 'supplier_replacement_in' | 'adjustment' | 'write_off';

export interface Movement {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  batch_id: number | null;
  batch_code: string | null;
  expiry_date: string | null;
  movement_type: MovementType;
  qty: Decimal;
  unit_cost: Decimal | null;
  from_location_id: number | null;
  from_bucket: string | null;
  to_location_id: number | null;
  to_bucket: string | null;
  ref_type: string | null;
  ref_id: number | null;
  occurred_at: string; // UTC
  created_by: number | null;
  created_by_name: string | null;
}

export interface OpeningBalanceItemInput {
  product_id: number;
  qty: Decimal;
  unit_cost?: Decimal;
  expiry_date?: string;
  batch_code?: string;
}

export interface OpeningBalanceInput {
  note?: string;
  items: OpeningBalanceItemInput[];
}

export interface OpeningBalanceResult {
  document_no: string;
  items: { product_id: number; batch_id: number; qty: Decimal }[];
}

export type CustomerStatus = 'pending_verification' | 'active' | 'inactive';
export type CreditState = 'not_verified' | 'limit_not_set' | 'available' | 'exhausted' | 'inactive';

/** `credit_limit` dan `credit_used` hanya dikirim ke pengguna dengan izin customer.set_limit (Admin). */
export interface Customer {
  id: number;
  customer_no: string;
  name: string;
  department: string | null;
  status: CustomerStatus;
  credit_state: CreditState;
  credit_remaining: Decimal | null;
  verified_at: string | null;
  credit_limit?: Decimal | null;
  credit_used?: Decimal;
}

export interface CustomerInput {
  customer_no: string;
  name: string;
  department?: string | null;
}

export interface CreditLimitRecord {
  id: number;
  limit_amount: Decimal;
  effective_from: string; // UTC
  set_by: number;
  set_by_name: string | null;
  note: string | null;
}

export interface AppNotification {
  id: number;
  type: string;
  entity_type: string | null;
  entity_id: number | null;
  message: string;
  read_at: string | null;
  created_at: string; // UTC
}

export type NotificationList = Paginated<AppNotification> & { unread_count: number };

export type ShiftStatus = 'open' | 'counting' | 'closed' | 'reviewed';

export interface ShiftSummary {
  cash_sales_count: number;
  cash_sales_total: Decimal;
  credit_sales_count: number;
  credit_sales_total: Decimal;
  cash_in: Decimal;
  cash_out: Decimal;
}

/**
 * Hitung buta: `expected_cash` dan `variance` bernilai null untuk Kasir selama shift berjalan;
 * baru terisi setelah ditutup (Admin dengan shift.review selalu melihatnya).
 */
export interface Shift {
  id: number;
  doc_number: string;
  register_id: number;
  cashier_id: number;
  cashier_name: string;
  status: ShiftStatus;
  opening_balance: Decimal;
  opened_at: string; // UTC
  closed_at: string | null;
  summary: ShiftSummary;
  expected_cash: Decimal | null;
  counted_cash: Decimal | null;
  variance: Decimal | null;
  variance_note: string | null;
  float_kept: Decimal | null;
  reviewed_at: string | null;
}
