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

export type FloatFlag = 'no_policy' | 'below_minimum' | 'nothing_to_deposit';
export type DepositStatus = 'draft' | 'submitted' | 'received' | 'discrepancy' | 'corrected';
export type DepositKind = 'partial' | 'final';

export interface CashDeposit {
  id: number;
  doc_number: string;
  kind: DepositKind;
  shift_id: number;
  shift_doc_number: string;
  status: DepositStatus;
  counted_amount: Decimal;
  float_kept: Decimal;
  deposit_amount: Decimal;
  received_amount: Decimal | null;
  difference: Decimal | null;
  received_by_name: string | null;
  received_at: string | null;
  note: string | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

export type FundAccountType = 'petty_cash' | 'main_cash';

export interface FundAccount {
  id: number;
  type: FundAccountType;
  name: string;
  register_id: number | null;
  balance: Decimal;
}

/** Setoran akhir shift (kind=final). Dibuat otomatis saat tutup shift bila ada yang harus disetor. */
export interface ShiftDeposit {
  id: number;
  doc_number: string;
  status: DepositStatus;
  deposit_amount: Decimal;
  float_kept: Decimal;
}

export type FloatPolicyScope = 'petty_cash' | 'main_cash';
export type FloatPolicyMode = 'fixed' | 'percent';
export type FloatPolicyPercentBase = 'cash_sales_shift' | 'cash_on_hand';

export interface FloatPolicy {
  id: number;
  scope: FloatPolicyScope;
  mode: FloatPolicyMode;
  fixed_amount: Decimal | null;
  percent: Decimal | null;
  percent_base: FloatPolicyPercentBase | null;
  min_amount: Decimal | null;
  max_amount: Decimal | null;
  rounding_unit: number;
  effective_from: string;
  set_by: number;
}

export interface FloatPolicies {
  petty_cash: FloatPolicy | null;
  main_cash: FloatPolicy | null;
}

export type CashMovementType = 'in' | 'out';

export interface CashMovement {
  id: number;
  shift_id: number;
  type: CashMovementType;
  amount: Decimal;
  reason: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

export type FloatPolicyInput =
  | {
      mode: 'fixed';
      fixed_amount: Decimal;
      min_amount?: Decimal;
      max_amount?: Decimal;
      rounding_unit?: number;
      reason?: string;
    }
  | {
      mode: 'percent';
      percent: Decimal;
      percent_base: FloatPolicyPercentBase;
      min_amount?: Decimal;
      max_amount?: Decimal;
      rounding_unit?: number;
      reason?: string;
    };

export interface ShiftSummary {
  cash_sales_count: number;
  cash_sales_total: Decimal;
  credit_sales_count: number;
  credit_sales_total: Decimal;
  cash_in: Decimal;
  cash_out: Decimal;
  /** Setoran parsial yang sudah diserahkan; mengurangi kas diharapkan. */
  partial_deposits: Decimal;
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
  /** Setoran akhir (null bila belum ada / tidak ada yang disetor). Shift berikutnya baru bisa dibuka setelah status bukan `draft`. */
  deposit: ShiftDeposit | null;
  /** Hanya pada respons `POST /shifts/{id}/close`. */
  float_flags?: FloatFlag[];
}

// ---------------------------------------------------------------- penjualan (POS)

export type PaymentMode = 'cash' | 'payroll_credit';
export type SaleStatus = 'posted' | 'voided';
export type BillingStatus = 'not_applicable' | 'unbilled' | 'invoiced' | 'paid';

export interface SaleItemInput {
  product_id: number;
  qty: Decimal;
}

/** Diketik Admin sendiri di dialog; jangan pernah disimpan di state yang bertahan. */
export interface CreditExceptionInput {
  approver_username: string;
  approver_password: string;
  note: string;
}

/** `idempotency_key` (UUID) ada di BODY, bukan header. Satu kunci per keranjang. */
export interface SaleInput {
  idempotency_key: string;
  payment_mode: PaymentMode;
  customer_id?: number | null;
  amount_tendered?: Decimal;
  credit_exception?: CreditExceptionInput;
  items: SaleItemInput[];
}

export interface SaleLine {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  qty: Decimal;
  unit_price: Decimal;
  discount_amount: Decimal;
  line_total: Decimal;
}

export interface SalePayment {
  method: 'cash';
  amount_tendered: Decimal;
  change_given: Decimal;
  amount_applied: Decimal;
}

export interface SaleReceiptInfo {
  store_name: string | null;
  is_copy: boolean;
  copy_label: string | null;
  note: string | null;
  is_void: boolean;
  void_label: string | null;
}

/** Bentuk baris pada `GET /sales` (tanpa item). */
export interface SaleSummary {
  id: number;
  doc_number: string;
  shift_id: number;
  cashier_id: number;
  cashier_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_no: string | null;
  payment_mode: PaymentMode;
  subtotal: Decimal;
  discount_total: Decimal;
  tax_rate: Decimal | null;
  tax_amount: Decimal;
  total: Decimal;
  status: SaleStatus;
  billing_status: BillingStatus;
  over_limit: boolean;
  posted_at: string | null; // UTC
}

/** Struk lengkap (`POST /sales`, `GET /sales/{id}`, reprint, void). */
export interface Sale extends SaleSummary {
  items: SaleLine[];
  payment: SalePayment | null;
  receipt: SaleReceiptInfo;
}

/** 201 = struk baru; 200 + `replayed: true` = permintaan ulang dengan kunci yang sama (struk lama, tidak ganda). */
export interface PostSaleResponse {
  data: Sale;
  replayed: boolean;
}

// ---- KONTRAK DIUSULKAN (docs/FRONTEND_REQUESTS.md FR-01). Belum ada di backend sampai statusnya Selesai.

export interface SalePreviewInput {
  payment_mode: PaymentMode;
  customer_id?: number | null;
  items: SaleItemInput[];
}

export interface SalePreviewLine {
  index: number;
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  qty: Decimal;
  unit_price: Decimal;
  gross: Decimal;
  discount_amount: Decimal;
  discount_name: string | null;
  line_total: Decimal;
  stock_available: Decimal;
  stock_sufficient: boolean;
}

export interface SalePreviewCredit {
  customer_id: number;
  remaining_before: Decimal;
  remaining_after: Decimal;
  exceeds_limit: boolean;
}

export interface SalePreview {
  payment_mode: PaymentMode;
  lines: SalePreviewLine[];
  subtotal: Decimal;
  discount_total: Decimal;
  tax_rate: Decimal | null;
  tax_amount: Decimal;
  total: Decimal;
  credit: SalePreviewCredit | null;
  computed_at: string; // UTC
}

// ---------------------------------------------------------------- diskon dan PPN (Admin)

export type DiscountTarget = 'product' | 'category';
export type DiscountType = 'percent' | 'amount';
export type DiscountStatus = 'active' | 'scheduled' | 'expired' | 'inactive';

/** `starts_at`/`ends_at` = batas hari WIB yang disimpan UTC; tampilkan lewat toWibDate. `amount` = potongan per unit. */
export interface Discount {
  id: number;
  name: string;
  target_type: DiscountTarget;
  target_id: number;
  target_name: string | null;
  discount_type: DiscountType;
  value: Decimal;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  status: DiscountStatus;
}

export interface DiscountInput {
  name: string;
  target_type: DiscountTarget;
  target_id: number;
  discount_type: DiscountType;
  value: Decimal;
  starts_at?: string; // YYYY-MM-DD (WIB); kosong = mulai sekarang
  ends_at?: string; // YYYY-MM-DD (WIB); kosong = tanpa akhir
}

/** Target tidak dapat diubah. `starts_at` tidak boleh dikosongkan; `ends_at: null` = tanpa akhir. */
export interface DiscountUpdate {
  name?: string;
  discount_type?: DiscountType;
  value?: Decimal;
  starts_at?: string;
  ends_at?: string | null;
  is_active?: boolean;
}

export interface VatSetting {
  enabled: boolean;
  rate: Decimal | null;
  price_includes_tax: boolean | null;
  effective_from: string | null; // YYYY-MM-DD
}

export interface VatInput {
  enabled: boolean;
  rate?: Decimal;
  price_includes_tax?: boolean;
}
