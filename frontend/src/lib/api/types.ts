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
  store: StoreInfo | null;
  roles: string[];
  permissions: string[];
  platform_operator: boolean;
  /** Model administrasi toko aktif (`simple` bila belum diatur). Tidak ada untuk operator platform. */
  admin_model?: AdminModelId;
  approval_auth_mode?: ApprovalAuthMode;
  authorization_key?: Pick<AuthorizationKeyStatus, 'eligible' | 'has_key' | 'type' | 'locked'>;
  /** Wewenang stok pengguna ini per aturan, mis. `{ "receipt.warehouse": false }`. Untuk menyaring pilihan lokasi di form stok. */
  stock_authority?: Record<string, boolean>;
}

export type AuthorizationKeyType = 'code' | 'passphrase';
export type ApprovalAuthMode = 'password' | 'key' | 'password_and_key';

export interface AuthorizationKeyStatus {
  eligible: boolean;
  has_key: boolean;
  type: AuthorizationKeyType | null;
  locked: boolean;
  created_at: string | null;
  rotated_at: string | null;
  last_used_at: string | null;
  mode: ApprovalAuthMode;
  generated_key?: string;
}

export interface AuthorizationKeyHolder {
  user_id: number;
  name: string;
  username: string;
  has_key: boolean;
  type: AuthorizationKeyType | null;
  locked: boolean;
  last_used_at: string | null;
  rotated_at: string | null;
}

export type ApprovalAuthBlockerCode = 'key_missing' | 'key_locked' | 'no_approver';

export interface ApprovalAuthBlocker {
  code: ApprovalAuthBlockerCode;
  user_id: number | null;
  username: string | null;
  message: string;
}

export interface ApprovalAuthModeOption {
  mode: ApprovalAuthMode;
  label: string;
  can_switch: boolean;
  blockers: ApprovalAuthBlocker[];
}

export interface ApprovalAuthSetting {
  mode: ApprovalAuthMode;
  modes: ApprovalAuthModeOption[];
  holders: AuthorizationKeyHolder[];
}

export interface LoginResponse {
  token: string;
  token_type: 'Bearer';
  expires_at: string;
  user: UserSummary;
  platform_operator: boolean;
}

export interface PlatformStore {
  id: number;
  code: string;
  name: string;
  timezone: string;
  currency: string;
  is_active: boolean;
  created_at: string;
}

export interface PlatformStoreDetail extends PlatformStore {
  admin_users: Array<{
    id: number;
    name: string;
    username: string;
    email: string | null;
    is_active: boolean;
  }>;
  user_count: number;
}

export interface PlatformTenantInput {
  code: string;
  name: string;
  timezone: string;
  currency: string;
  owner: {
    name: string;
    username: string;
    email?: string;
    password: string;
  };
}

export interface WarehouseSetting {
  enabled: boolean;
  locations: Array<{
    id: number;
    name: string;
    is_active: boolean;
  }>;
}

export interface InventoryMenuSetting {
  show_opening_balance: boolean;
  show_stock_transfer: boolean;
}

export interface ManagedUser {
  id: number;
  name: string;
  username: string;
  cashier_number: string | null;
  email: string | null;
  is_active: boolean;
  roles: string[];
  last_login_at: string | null;
}

export type AdminModelId = 'simple' | 'standard';

export interface AdminModelRole {
  name: string;
  description: string | null;
  assignable: boolean;
  total_users: number;
  active_users: number;
}

export interface AdminModelBlocker {
  code: string;
  role: string;
  message: string;
}

export interface AdminModelConversion {
  from: string;
  to: string;
  users: Array<{ id: number; name: string; username: string; is_active: boolean }>;
}

export interface AdminModelOption {
  model: AdminModelId;
  label: string;
  current: boolean;
  can_switch: boolean;
  blockers: AdminModelBlocker[];
  conversions: AdminModelConversion[];
}

export interface AdminModelSetting {
  model: AdminModelId;
  controlling_role: string;
  assignable_roles: string[];
  roles: AdminModelRole[];
  options: AdminModelOption[];
}

export interface StockAuthorityWarning {
  code: string;
  message: string;
}

export interface StockAuthorityRule {
  key: string;
  action: string;
  scope: 'store_floor' | 'warehouse' | null;
  permission: string;
  label: string;
  description: string;
  roles: string[];
  default_roles: string[];
  customized: boolean;
  active_users: number;
  /** false = aturan Gudang saat Gudang nonaktif (tetap bisa disetel). */
  applies: boolean;
  warnings: StockAuthorityWarning[];
}

export interface StockAuthoritySetting {
  admin_model: AdminModelId;
  warehouse_enabled: boolean;
  assignable_roles: string[];
  rules: StockAuthorityRule[];
}

/** `roles: null` mengembalikan aturan ke default model. */
export interface StockAuthorityUpdate {
  key: string;
  roles: string[] | null;
}

export interface ManagedRole {
  id: number;
  name: string;
  description: string | null;
  is_system: boolean;
}

export type BillingPeriodStatus = 'open' | 'closed' | 'invoiced' | 'cancelled';

export interface BillingPeriodCustomer {
  customer_id: number;
  customer_no: string;
  name: string;
  department: string | null;
  sales_count: number;
  total: Decimal;
}

export interface BillingPeriod {
  id: number;
  label: string;
  period_month: string;
  status: BillingPeriodStatus;
  scheduled_close_date: string | null;
  starts_at: string;
  closed_at: string | null;
  sales_count: number;
  sales_total: Decimal;
  invoice_id: number | null;
  customers?: BillingPeriodCustomer[];
}

export type InvoiceStatus = 'draft' | 'issued' | 'handed_to_hr' | 'partially_paid' | 'paid' | 'cancelled';

export interface InvoiceSummary {
  id: number;
  document_no: string;
  billing_period_id: number;
  period_label: string;
  bill_to: string;
  subtotal: Decimal;
  tax_rate: Decimal | null;
  tax_amount: Decimal;
  total: Decimal;
  amount_paid: Decimal;
  amount_remaining: Decimal;
  status: InvoiceStatus;
  issued_at: string | null;
  handed_at: string | null;
  created_at: string;
}

export interface InvoiceCustomer {
  customer_id: number;
  customer_no: string;
  name: string;
  department: string | null;
  subtotal: Decimal;
  sales: Array<{ sale_id: number; doc_number: string; posted_at: string; amount: Decimal }>;
}

export interface InvoicePayment {
  id: number;
  amount: Decimal;
  received_at: string;
  reference: string | null;
  note: string | null;
  recorded_by_name: string;
}

export interface Invoice extends InvoiceSummary {
  customers: InvoiceCustomer[];
  payments: InvoicePayment[];
}

export interface AnnualReceivableReportYear {
  year: number;
  is_current: boolean;
  print_enabled: boolean;
}

export interface AnnualReceivableReportYears {
  current_year: number;
  years: AnnualReceivableReportYear[];
}

export interface AnnualReceivableReportCustomer {
  customer_id: number;
  customer_no: string;
  name: string;
  department: string | null;
  sales_count: number;
  billed: Decimal;
  paid: Decimal;
  outstanding: Decimal;
}

export interface AnnualReceivableReport {
  year: number;
  start_date: string;
  end_date: string;
  as_of: string;
  is_current: boolean;
  print_enabled: boolean;
  totals: {
    billed: Decimal;
    paid: Decimal;
    outstanding: Decimal;
    customers: number;
    sales_count: number;
  };
  customers: AnnualReceivableReportCustomer[];
}

export interface AnnualReceivableReportSetting {
  print_on: string;
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
  unit_cost: Decimal;
  suppliers: ProductSupplier[];
  min_stock: Decimal;
  critical_stock: Decimal;
  restock_quantity: Decimal;
  status: ProductStatus;
  stock_sellable: Decimal;
  store_floor_stock_sellable?: Decimal;
  stock_status: StockStatus;
}

export interface ProductInput {
  sku?: string;
  barcode?: string;
  name: string;
  supplier_ids: number[];
  category_id?: number | null;
  unit_name?: string;
  track_expiry?: boolean;
  sell_price?: Decimal | null;
  unit_cost?: Decimal;
  min_stock?: Decimal;
  critical_stock?: Decimal;
  restock_quantity?: Decimal;
}

export interface ProductSupplier {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  default_payment_terms: PaymentTerms | null;
}

export interface StockMonitoringSetting {
  low_stock_threshold: Decimal;
}

export interface PurchaseOrderSupplierSelectionSetting {
  mode: 'manual' | 'product';
}

export interface PurchaseOrderOwner {
  id: number;
  name: string;
  username: string;
  roles: string[];
}

export interface PurchaseOrderOwnerSetting {
  owner: PurchaseOrderOwner | null;
  owners: PurchaseOrderOwner[];
}

export type PurchaseOrderResetPeriod = 'day' | 'week' | 'month' | 'all_time';

export interface PurchaseOrderResetPreview {
  period: PurchaseOrderResetPeriod;
  total_po_count: number;
  cancel_count: number;
  close_partial_count: number;
  draft_receipts_to_cancel: number;
  skipped_po_count: number;
}

export interface PurchaseOrderResetResult {
  period: PurchaseOrderResetPeriod;
  cancelled_po_count: number;
  closed_partial_po_count: number;
  cancelled_gr_count: number;
  skipped_po_count: number;
}

export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  is_active: boolean;
  products_count: number;
}

export type OpnameScopeType = 'all' | 'categories';
export type OpnameSessionStatus = 'in_progress' | 'pending_approval' | 'posted' | 'cancelled';

export interface OpnameSessionSummary {
  id: number;
  number: string;
  name: string | null;
  scope_type: OpnameScopeType;
  scope_summary: string;
  status: OpnameSessionStatus;
  total_products: number;
  counted_products: number;
  started_at: string;
  created_by: { id: number; name: string };
  submitted_at?: string | null;
  submitted_by?: { id: number; name: string } | null;
  approval_required?: boolean | null;
  approval_reasons?: Array<{ type: string; product_id?: number; product_name?: string }>;
  approved_at?: string | null;
  approved_by?: { id: number; name: string } | null;
  posted_at?: string | null;
  posted_by?: { id: number; name: string } | null;
  rejected_at?: string | null;
  rejected_by?: { id: number; name: string } | null;
  reject_reason?: string | null;
  variance_products?: number | null;
  short_qty?: Decimal | null;
  over_qty?: Decimal | null;
}

export interface OpnameSession extends OpnameSessionSummary {
  notes: string | null;
  scope_categories: Array<{ id: number; name: string }>;
  cancelled_at: string | null;
  cancelled_by: { id: number; name: string } | null;
  cancel_reason: string | null;
}

export type OpnamePeriodGroup = 'month' | 'quarter' | 'year';

export interface OpnameHistoryPeriod {
  period_key: string;
  label: string;
  sessions_total: number;
  sessions_posted: number;
  sessions_clean: number;
  variance_products: number;
  short_qty: Decimal;
  over_qty: Decimal;
  abs_value?: Decimal;
  last_posted_at: string | null;
}

export interface OpnameFrequentVariance {
  product_id: number;
  name: string;
  barcode: string;
  sessions_with_variance: number;
  short_qty: Decimal;
  over_qty: Decimal;
  value?: Decimal;
}

export interface OpnameLastStatus {
  last_posted: {
    id: number;
    number: string;
    posted_at: string;
    scope_type: OpnameScopeType;
    clean: boolean;
    variance_products: number;
  } | null;
  days_since: number | null;
  reminder: {
    enabled: boolean;
    interval_days: number;
    basis: 'all' | 'any';
    due: boolean;
  };
}

export interface OpnameReportLine {
  item_id: number;
  product_id: number;
  name: string;
  barcode: string;
  system_qty: Decimal;
  counted_qty: Decimal;
  diff_qty: Decimal;
  direction: 'short' | 'over';
  value?: Decimal | null;
  cost_missing?: boolean;
  revised: boolean;
}

export interface OpnameReportNode {
  id: number;
  name: string;
  products_counted: number;
  variance_count: number;
  short_qty: Decimal;
  over_qty: Decimal;
  lines: OpnameReportLine[];
  children: OpnameReportNode[];
}

export interface OpnameReport {
  session: { id: number; number?: string; status: OpnameSessionStatus };
  complete: boolean;
  progress?: { products_counted: number; products_total: number };
  provisional?: boolean;
  clean?: boolean;
  totals?: {
    products_counted: number;
    products_total: number;
    variance_products: number;
    short_count: number;
    over_count: number;
    short_qty: Decimal;
    over_qty: Decimal;
    net_qty: Decimal;
    short_value?: Decimal;
    over_value?: Decimal;
    abs_value?: Decimal;
  };
  approval?: {
    required: boolean;
    reasons: Array<{ type: string; product_id?: number; product_name?: string }>;
    thresholds?: { per_product: number; per_session: number };
  };
  categories?: OpnameReportNode[];
}

export type OpnameItemStatus = 'uncounted' | 'counted' | 'matched' | 'variance';
export type OpnameNodeStatus = 'not_started' | 'partial' | 'done';

export interface OpnameProgressNode {
  id: number | string;
  name: string;
  parent_id: number | null;
  depth: number;
  product_count: number;
  counted_count: number;
  status: OpnameNodeStatus;
  direct_product_count: number;
  direct_counted_count: number;
  variance_count?: number;
  children: OpnameProgressNode[];
}

export interface OpnameProgressTree {
  session: Pick<OpnameSessionSummary, 'id' | 'number' | 'status'>;
  display: { reveals_system_qty: boolean };
  summary: { total_products: number; counted_products: number };
  nodes: OpnameProgressNode[];
}

export interface OpnameItem {
  id: number;
  product_id: number;
  category_id: number | null;
  name: string;
  barcode: string;
  category_path: string[];
  status: OpnameItemStatus;
  counted_qty: Decimal | null;
  counted_at: string | null;
  system_qty?: Decimal;
}

export type OpnameCountMode = 'set' | 'add';

export interface OpnameCountResult {
  item: OpnameItem;
  summary: { total_products: number; counted_products: number };
  nodes: Array<Pick<OpnameProgressNode, 'id' | 'counted_count' | 'product_count' | 'status'> & {
    direct_product_count?: number;
    direct_counted_count?: number;
    variance_count?: number;
  }>;
}

export interface OpnameOfflineIndex {
  session: { id: number; number: string; status: 'in_progress' };
  version: string;
  categories: Array<{ id: number; name: string; parent_id: number | null }>;
  items: Array<{
    item_id: number;
    product_id: number;
    name: string;
    barcode: string;
    category_id: number | null;
    counted_qty: number | null;
  }>;
  page: number;
  total_pages: number;
  total: number;
}

export interface OpnameBatchCountResult {
  results: Array<{
    client_request_id: string;
    status: 'ok' | 'duplicate' | 'rejected';
    error?: { code: string; message: string };
    item?: OpnameItem;
  }>;
  summary: { total_products: number; counted_products: number };
}

export interface OpnameCountLog {
  log_id: number;
  item: { id: number; name: string; barcode: string };
  action: OpnameCountMode | 'clear';
  input_qty: number | null;
  counted_after: number | null;
  created_at: string;
  created_by: { id: number; name: string };
}

export interface OpnameLockStatus {
  locked: boolean;
  store_wide: boolean;
  sessions: Array<{ number: string; scope_summary: string }>;
}

export interface OpnameLookupError extends Error {
  code: 'not_in_session' | 'unknown_barcode';
  productName?: string;
}

export interface OpnameDisplaySetting {
  show_system_qty: boolean;
  per_product_threshold?: number;
  per_session_threshold?: number;
  require_first_opname?: boolean;
  reminder_enabled: boolean;
  reminder_interval_days: number;
  reminder_basis: 'all' | 'any';
}

export interface OpnameCategoryOption {
  id: number;
  parent_id: number | null;
  name: string;
  product_count: number;
  locked_by: { id: number; number: string } | null;
  children: OpnameCategoryOption[];
}

export type PaymentTerms = 'prepaid' | 'credit' | 'cod';
export type PurchaseOrderPaymentTerms = 'top' | 'cbd' | 'cod';

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
export type ExpiryProductStatus = ExpiryStatus | 'no_stock' | 'not_tracked';

export interface InventoryExpiryMonitoring {
  warning_days: number;
  alert_counts: { expired: number; near_expiry: number; total: number };
  products: Array<{ product_id: number; expiry_status: ExpiryProductStatus }>;
}

export type FifoType = 'fast_moving' | 'normal' | 'slow_moving' | 'no_stock' | 'unclassified';

export interface InventoryFifoMonitoring {
  products: Array<{ product_id: number; fifo_type: FifoType }>;
}

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

export interface StockCardMovement {
  occurred_at: string;
  reference_no: string;
  reference_type: 'goods_receipt' | 'supplier_return' | 'sale';
  reference_id: number;
  expiry_date: string | null;
  good_in: Decimal;
  damaged_in: Decimal;
  return_out: Decimal;
  sale_out: Decimal;
}

/** Urutan `batches` = urutan FEFO (yang dijual lebih dulu di atas). */
export interface ProductStock {
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  track_expiry: boolean;
  unit_cost: Decimal; // HPP: hanya tampilkan di layar Admin
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
  ref_label?: string | null;
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

export type AdjustmentType = 'increase' | 'decrease';
export type AdjustmentReasonCode =
  | 'damaged'
  | 'expired'
  | 'lost'
  | 'found'
  | 'input_correction'
  | 'own_use'
  | 'sample'
  | 'other'
  | 'opname_result';

export interface AdjustmentReason {
  code: AdjustmentReasonCode;
  label: string;
  requires_notes: boolean;
  selectable: boolean;
}

export interface AdjustmentMeta {
  types: Array<{ code: AdjustmentType; label: string }>;
  reasons: AdjustmentReason[];
}

export interface Adjustment {
  id: number;
  number: string;
  product: { id: number; name: string; barcode: string };
  type: AdjustmentType;
  quantity: number;
  reason_code: AdjustmentReasonCode;
  reason_label: string;
  notes: string | null;
  stock_before: Decimal;
  stock_after: Decimal;
  source: 'manual' | 'opname';
  opname_session_id: number | null;
  stock_movement_id: number | null;
  stock_movement_ids?: number[];
  created_by: { id: number; name: string };
  created_at: string;
}

export type AdjustmentInput = {
  product_id: number;
  reason_code: Exclude<AdjustmentReasonCode, 'opname_result'>;
  notes?: string;
  expiry_date?: string;
  client_request_id: string;
} & (
  | { target_quantity: string; type?: never; quantity?: never }
  | { target_quantity?: never; type: AdjustmentType; quantity: number }
);

export type StockTransferStatus = 'draft' | 'posted' | 'cancelled';

export interface StockTransferSummary {
  id: number;
  doc_number: string;
  from_location_id: number;
  from_location_name: string;
  to_location_id: number;
  to_location_name: string;
  status: StockTransferStatus;
  created_by: number;
  created_by_name: string;
  posted_by: number | null;
  posted_by_name: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface StockTransferItem {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  batch_id: number | null;
  batch_code: string | null;
  expiry_date: string | null;
  from_position_id: number | null;
  from_position: string | null;
  to_position_id: number | null;
  to_position: string | null;
  qty: Decimal;
}

export interface StockTransfer extends StockTransferSummary {
  items: StockTransferItem[];
}

export interface StockTransferInput {
  from_location_id: number;
  to_location_id: number;
  items: Array<{
    product_id: number;
    batch_id?: number;
    from_position_id?: number;
    to_position_id?: number;
    qty: Decimal;
  }>;
}

export type SupplierReturnStatus =
  | 'draft'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'replacement_received'
  | 'written_off'
  | 'cancelled';
export type SupplierReturnBucket = 'sellable' | 'damaged';

export interface SupplierReturnSummary {
  id: number;
  doc_number: string;
  return_type: 'incoming' | 'outgoing';
  supplier_id: number;
  supplier_name: string;
  goods_receipt_id: number | null;
  is_auto_generated: boolean;
  goods_receipt_doc_number: string | null;
  invoice_no: string | null;
  status: SupplierReturnStatus;
  requested_by: number;
  requested_by_name: string;
  submitted_at: string | null;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  loss_amount: Decimal | null;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reauth_at: string | null;
  note: string | null;
  created_at: string;
}

export interface SupplierReturnItem {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  unit_name: string;
  batch_id: number | null;
  batch_code: string | null;
  expiry_date: string | null;
  location_id: number;
  location_name: string;
  shelf_position_id: number | null;
  shelf_position: string | null;
  source_bucket: SupplierReturnBucket;
  disposition: 'direct_return' | 'quarantine' | null;
  goods_receipt_item_id: number | null;
  source_po_item_id: number | null;
  source_po_doc_number: string | null;
  qty_received_safe: Decimal | null;
  qty_damaged_at_receipt: Decimal | null;
  receipt_note: string | null;
  qty: Decimal;
  unit_cost: Decimal | null;
  replacement_batch_id: number | null;
  replacement_batch_code: string | null;
  replacement_expiry_date: string | null;
}

export interface SupplierReturn extends SupplierReturnSummary {
  items: SupplierReturnItem[];
  replacement_goods_receipts?: Array<{ id: number; doc_number: string; po_id: number }>;
}

export interface SupplierReturnInput {
  return_type?: 'incoming' | 'outgoing';
  supplier_id: number;
  goods_receipt_id?: number;
  invoice_no?: string;
  note?: string;
  items?: Array<{
    product_id?: number;
    goods_receipt_item_id?: number;
    disposition?: 'direct_return' | 'quarantine';
    batch_id?: number;
    location_id?: number;
    shelf_position_id?: number;
    source_bucket?: SupplierReturnBucket;
    qty?: Decimal;
  }>;
}

export interface DailySalesReportRow {
  date: string;
  transaction_count: number;
  gross_sales: Decimal;
  discount_total: Decimal;
  tax_amount: Decimal;
  net_sales: Decimal;
}

export interface SalesDailyReport {
  summary: {
    transaction_count: number;
    gross_sales: Decimal;
    discount_total: Decimal;
    tax_amount: Decimal;
    net_sales: Decimal;
  };
  by_payment_mode: {
    cash: { transaction_count: number; net_sales: Decimal };
    payroll_credit: { transaction_count: number; net_sales: Decimal };
  };
  daily: DailySalesReportRow[];
}

export interface LowStockReportItem {
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  qty_sellable: Decimal;
  min_stock: Decimal;
  critical_stock: Decimal;
  status: StockStatus;
}

export interface ExpiringBatchReportItem {
  balance_id: number;
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  batch_id: number;
  batch_code: string | null;
  expiry_date: string;
  days_to_expiry: number;
  qty_sellable: Decimal;
  status: 'kedaluwarsa' | 'hari_ini' | 'akan_kedaluwarsa';
}

export interface InventoryReport {
  warning_days: number;
  low_stock: LowStockReportItem[];
  expiring_batches: ExpiringBatchReportItem[];
  counts: { low_stock: number; expiring_batches: number };
}

export interface CashSummaryReport {
  sales: { transaction_count: number; cash: Decimal; payroll_credit: Decimal };
  movements: { cash_in: Decimal; cash_out: Decimal };
  deposits: { counted_amount: Decimal; settled_amount: Decimal; received_amount: Decimal };
  net_cash_movement: Decimal;
  shift_count: number;
  fund_balances: Array<{
    id: number;
    type: FundAccountType;
    name: string;
    balance: Decimal;
  }>;
}

export interface DashboardReport {
  period: { date_from: string; date_to: string };
  sales: SalesDailyReport;
  inventory: InventoryReport;
  cash: CashSummaryReport;
}

export interface ProfitReport {
  period: { date_from: string; date_to: string };
  basis: string;
  sales_revenue: Decimal;
  cost_of_goods_sold: Decimal;
  total_gross_profit: Decimal;
  valid_profit: Decimal;
  expected_profit: Decimal;
  by_payment_mode: {
    cash: { valid_profit: Decimal };
    payroll_credit: { valid_profit: Decimal; expected_profit: Decimal };
  };
}

export interface FinancialReport {
  period: { date_from: string; date_to: string };
  cash: {
    account_name: string;
    opening_balance: Decimal;
    cash_in: Decimal;
    cash_out: Decimal;
    closing_balance: Decimal;
  };
  profit: {
    gross_profit: Decimal;
    operating_expenses: Decimal;
    payroll_expenses: Decimal;
    approved_return_losses: Decimal;
    net_profit: Decimal;
  };
  supplier_payments: Decimal;
}

export interface FinancialPurchaseOrder {
  id: number;
  doc_number: string;
  status: PurchaseOrderStatus;
  payment_terms: PurchaseOrderPaymentTerms;
  payment_term_days: number | null;
  payment_status: 'unpaid' | 'partial';
  supplier_name: string;
  total: Decimal;
  amount_paid: Decimal;
  amount_remaining: Decimal;
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

export interface Register {
  id: number;
  name: string;
  is_active: boolean;
  fund_account_id: number | null;
  fund_account_name: string | null;
  active_shift: {
    id: number;
    status: ShiftStatus;
    cashier_id: number;
    cashier_name: string;
    cashier_number: string | null;
  } | null;
}

export interface AvailableRegister {
  id: number;
  name: string;
  is_available: boolean;
  unavailable_reason: string | null;
}

/**
 * Hitung buta: `expected_cash` dan `variance` bernilai null untuk Kasir selama shift berjalan;
 * baru terisi setelah ditutup (Admin dengan shift.review selalu melihatnya).
 */
export interface Shift {
  id: number;
  doc_number: string;
  register_id: number;
  register_name: string;
  cashier_id: number;
  cashier_name: string;
  cashier_number: string | null;
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
export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_confirmation'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type PurchaseRequisitionStatus =
  | 'draft'
  | 'submitted'
  | 'finance_checked'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'converted'
  | 'cancelled';

export interface PurchaseRequisitionSummary {
  id: number;
  doc_number: string;
  status: PurchaseRequisitionStatus;
  reason: string | null;
  est_total: Decimal;
  items_count: number;
  requested_by: number;
  requester_name: string;
  is_auto_generated: boolean;
  submitted_at: string | null;
  created_at: string;
}

export interface PurchaseRequisitionItem {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  qty: Decimal;
  est_price: Decimal | null;
  note: string | null;
}

export interface PurchaseOrderRequisitionItem {
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  qty_available: Decimal;
  est_price: Decimal | null;
  suppliers: PurchaseOrderSupplier[];
}

export interface PurchaseOrderSupplier {
  id: number;
  code: string;
  name: string;
  default_payment_terms: PaymentTerms | null;
}

export interface PurchaseRequisition extends PurchaseRequisitionSummary {
  items: PurchaseRequisitionItem[];
  approvals: Array<{
    step: 'finance_check' | 'owner_auth';
    decision: 'approved' | 'returned' | 'rejected';
    decided_by: number;
    decided_by_name: string;
    note: string | null;
    is_self_approval: boolean;
    decided_at: string;
  }>;
  purchase_orders: Array<{
    id: number;
    doc_number: string;
    status: PurchaseOrderStatus;
    total: Decimal | null;
  }>;
}

export interface DeferredPurchaseRequisitionItem {
  requisition: PurchaseRequisition;
  next_requisition: PurchaseRequisition;
}

export interface PurchaseRequisitionInput {
  reason?: string;
  items: Array<{
    product_id: number;
    qty: Decimal;
    est_price?: Decimal;
    note?: string;
  }>;
}

export interface PurchaseOrderSummary {
  id: number;
  doc_number: string;
  status: PurchaseOrderStatus;
  receipt_status: 'none' | 'partial' | 'complete';
  payment_status: string;
  payment_terms: PurchaseOrderPaymentTerms;
  payment_term_days: number | null;
  pr_id: number;
  pr_doc_number: string;
  supplier_id: number;
  supplier_name: string;
  order_date: string;
  expected_date: string | null;
  total: Decimal | null;
  bank_account: BankAccountSummary | null;
  created_at: string;
}

export interface BankAccountSummary {
  id: number;
  bank_name: string;
  account_name: string;
  account_number_masked: string;
  is_active: boolean;
}

export interface BankAccount {
  id: number;
  bank_name: string;
  account_name: string;
  account_number: string;
  is_active: boolean;
}

export interface PurchaseOrderItem {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  qty_ordered: Decimal;
  qty_received: Decimal;
  qty_remaining: Decimal;
  unit_price: Decimal | null;
  line_total: Decimal | null;
}

export interface PurchaseOrder extends PurchaseOrderSummary {
  created_by: number;
  created_by_name: string;
  items: PurchaseOrderItem[];
  receipts: Array<{
    id: number;
    doc_number: string;
    document_status: GoodsReceiptDocumentStatus;
    posted_at: string | null;
  }>;
}

export interface PurchaseOrderInput {
  pr_id: number;
  supplier_id: number;
  bank_account_id: number;
  approver_user_id?: number;
  approver_username?: string;
  approver_password?: string;
  approver_key?: string;
  payment_terms?: PurchaseOrderPaymentTerms;
  payment_term_days?: number;
  order_date?: string;
  expected_date?: string;
  items: Array<{
    product_id: number;
    qty_ordered: Decimal;
    unit_price: Decimal;
  }>;
}

export type GoodsReceiptDocumentStatus = 'pending' | 'verified';
export type GoodsReceiptStatus = 'draft' | 'checked' | 'posted' | 'cancelled';

export interface GoodsReceiptLocation {
  id: number;
  type: 'store_floor' | 'warehouse';
  name: string;
}

export interface GoodsReceiptSummary {
  id: number;
  doc_number: string;
  po_id: number;
  po_doc_number: string;
  supplier_return_id: number | null;
  supplier_return_doc_number: string | null;
  status: GoodsReceiptStatus;
  supplier_name: string;
  receiving_location_id: number;
  receiving_location_name: string;
  document_status: GoodsReceiptDocumentStatus;
  received_by_name: string;
  received_by_cashier_number: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface GoodsReceiptItem {
  id: number;
  po_item_id: number;
  product_id: number;
  sku: string;
  name: string;
  unit_name: string;
  qty_ordered: Decimal;
  qty_received: Decimal;
  qty_damaged: Decimal;
  damage_disposition: 'direct_return' | 'quarantine' | null;
  qty_short: Decimal;
  unit_cost: Decimal | null;
  po_unit_price: Decimal | null;
  price_variance: Decimal | null;
  expiry_date: string | null;
  batch_code: string | null;
  shelf_position_id: number | null;
  note: string | null;
}

export interface GoodsReceiptAttachment {
  id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_name: string;
  created_at: string;
}

export interface GoodsReceipt extends GoodsReceiptSummary {
  po_doc_number: string;
  supplier_id: number;
  delivery_note_no: string | null;
  invoice_no: string | null;
  attachments_open: boolean;
  received_by: number;
  verified_by: number | null;
  verified_by_name: string | null;
  verified_at: string | null;
  note: string | null;
  items: GoodsReceiptItem[];
  attachments: GoodsReceiptAttachment[];
}

export interface GoodsReceiptItemInput {
  po_item_id: number;
  qty_received: Decimal;
  qty_damaged?: Decimal;
  damage_disposition?: 'direct_return' | 'quarantine' | null;
  expiry_date?: string | null;
  batch_code?: string | null;
  shelf_position_id?: number | null;
  note?: string | null;
}

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
  cashier_number: string | null;
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

// ---- Pratinjau penjualan (docs/BACKEND_PROGRESS.md bagian 5).

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
