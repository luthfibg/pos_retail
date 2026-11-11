import { api, apiDownload } from './client';
import type {
  Category, CategoryInput, CashDeposit, CashMovement, CashMovementType, CreditLimitRecord, Customer, CustomerInput, CustomerStatus, DepositKind, DepositStatus, FundAccount, LoginResponse, Me, Movement, MovementType, NotificationList, OpeningBalanceInput,
  FloatPolicies, FloatPolicyInput, FloatPolicyScope, OpeningBalanceResult, Paginated, ProductStock, Product, ProductInput, ProductStatus, Shift, ShiftStatus, Supplier, SupplierInput,
  PaymentMode, PostSaleResponse, Sale, SaleInput, SalePreview, SalePreviewInput, SaleStatus, SaleSummary,
  Discount, DiscountInput, DiscountTarget, DiscountUpdate, VatInput, VatSetting,
  GoodsReceipt, GoodsReceiptAttachment, GoodsReceiptItemInput, GoodsReceiptLocation, GoodsReceiptSummary, PurchaseOrder, PurchaseOrderInput, PurchaseOrderSummary,
  PurchaseOrderRequisitionItem, PurchaseRequisition, PurchaseRequisitionInput, PurchaseRequisitionStatus, PurchaseRequisitionSummary,
  StockTransfer, StockTransferInput, StockTransferStatus, StockTransferSummary,
  DashboardReport, ProfitReport, BillingPeriod, Invoice, InvoiceSummary, InvoiceStatus,
  AnnualReceivableReport, AnnualReceivableReportYears, AnnualReceivableReportSetting,
  ManagedRole, ManagedUser, PlatformStore, PlatformStoreDetail, PlatformTenantInput,
  WarehouseSetting, InventoryMenuSetting, AdminModelId, AdminModelSetting, ApprovalAuthMode, ApprovalAuthSetting, StockMonitoringSetting,
  AuthorizationKeyStatus, AuthorizationKeyType, AuthorizationKeyHolder, StockAuthoritySetting, StockAuthorityUpdate,
  SupplierReturn, SupplierReturnInput, SupplierReturnStatus, SupplierReturnSummary,
  BankAccount, BankAccountSummary,
  AvailableRegister, Register,
  Adjustment, AdjustmentInput, AdjustmentMeta, AdjustmentReasonCode, AdjustmentType,
  OpnameCategoryOption, OpnameReport, OpnameSession, OpnameSessionSummary, OpnameSessionStatus, OpnameScopeType,
  OpnameDisplaySetting, OpnameItem, OpnameProgressTree, PurchaseOrderResetPeriod, PurchaseOrderResetPreview, PurchaseOrderResetResult,
  OpnameCountLog,
  OpnameCountMode,
  OpnameCountResult,
  OpnameBatchCountResult,
  OpnameOfflineIndex,
  OpnameLockStatus,
  OpnameHistoryPeriod,
  OpnamePeriodGroup,
  OpnameFrequentVariance,
  OpnameLastStatus,
} from './types';

export const authApi = {
  login: (username: string, password: string) =>
    api<LoginResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => api<{ message: string }>('/auth/logout', { method: 'POST' }),
  me: () => api<Me>('/auth/me'),
};

export const storeSettingsApi = {
  updateName: (name: string) =>
    api<{ data: { name: string } }>('/settings/store-name', { method: 'PATCH', body: { name } }).then((response) => response.data),
};

export const stockMonitoringApi = {
  get: () => api<{ data: StockMonitoringSetting }>('/settings/inventory/stock-monitoring').then((r) => r.data),
  update: (low_stock_threshold: string) =>
    api<{ data: StockMonitoringSetting }>('/settings/inventory/stock-monitoring', {
      method: 'PUT',
      body: { low_stock_threshold },
    }).then((r) => r.data),
  previewPurchaseOrderReset: (period: PurchaseOrderResetPeriod) =>
    api<{ data: PurchaseOrderResetPreview }>('/settings/inventory/stock-monitoring/purchase-order-reset/preview', {
      method: 'POST',
      body: { period },
    }).then((r) => r.data),
  resetPurchaseOrderWorkflow: (period: PurchaseOrderResetPeriod) =>
    api<{ data: PurchaseOrderResetResult }>('/settings/inventory/stock-monitoring/purchase-order-reset', {
      method: 'POST',
      body: { period },
    }).then((r) => r.data),
};

export const platformCliLoginApi = {
  exchange: (ticket: string, issuedFingerprint: string, clientFingerprint: string) =>
    api<{ token: string; token_type: 'Bearer' }>('/platform/cli-login/exchange', {
      method: 'POST',
      body: {
        ticket,
        issued_fingerprint: issuedFingerprint,
        client_fingerprint: clientFingerprint,
      },
    }),
};

export const platformStoreApi = {
  list: (filters: { q?: string; status?: 'active' | 'inactive'; page?: number; per_page?: number } = {}) =>
    api<Paginated<PlatformStore>>('/platform/stores', { query: { ...filters } }),
  get: (id: number) => api<{ data: PlatformStoreDetail }>(`/platform/stores/${id}`).then((r) => r.data),
  create: (input: PlatformTenantInput) =>
    api<{ data: PlatformStore & { initial_owner: { id: number; name: string; username: string; role: string } } }>(
      '/platform/stores',
      { method: 'POST', body: input },
    ).then((r) => r.data),
  setActive: (id: number, is_active: boolean, reason?: string) =>
    api<{ data: PlatformStore }>(`/platform/stores/${id}/status`, {
      method: 'PATCH',
      body: { is_active, reason },
    }).then((r) => r.data),
};

export const reportApi = {
  dashboard: (filters: { date_from: string; date_to: string; cashier_id?: number }) =>
    api<{ data: DashboardReport }>('/reports/dashboard', { query: filters }).then((r) => r.data),
  profit: (filters: { date_from: string; date_to: string }) =>
    api<{ data: ProfitReport }>('/reports/profit', { query: filters }).then((r) => r.data),
};

export const billingApi = {
  annualReportYears: () =>
    api<{ data: AnnualReceivableReportYears }>('/annual-receivable-reports').then((r) => r.data),
  annualReport: (year: number) =>
    api<{ data: AnnualReceivableReport }>(`/annual-receivable-reports/${year}`).then((r) => r.data),
  annualReportSetting: () =>
    api<{ data: AnnualReceivableReportSetting }>('/settings/annual-receivable-report').then((r) => r.data),
  updateAnnualReportSetting: (print_on: string) =>
    api<{ data: AnnualReceivableReportSetting }>('/settings/annual-receivable-report', {
      method: 'PUT',
      body: { print_on },
    }).then((r) => r.data),
  periods: (page = 1, perPage = 25) =>
    api<Paginated<BillingPeriod>>('/billing-periods', { query: { page, per_page: perPage } }),
  currentPeriod: () => api<{ data: BillingPeriod | null }>('/billing-periods/current').then((r) => r.data),
  period: (id: number) => api<{ data: BillingPeriod }>(`/billing-periods/${id}`).then((r) => r.data),
  openPeriod: (input: { label?: string; scheduled_close_date?: string }) =>
    api<{ data: BillingPeriod }>('/billing-periods', { method: 'POST', body: input }).then((r) => r.data),
  updatePeriod: (id: number, input: { label?: string; period_month?: string; scheduled_close_date?: string | null }) =>
    api<{ data: BillingPeriod }>(`/billing-periods/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
  closePeriod: (id: number) =>
    api<{ data: BillingPeriod }>(`/billing-periods/${id}/close`, { method: 'POST' }).then((r) => r.data),
  cancelPeriod: (id: number, reason: string) =>
    api<{ data: BillingPeriod }>(`/billing-periods/${id}/cancel`, { method: 'POST', body: { reason } }).then((r) => r.data),
  generateInvoice: (periodId: number, input: { bill_to?: string }) =>
    api<{ data: Invoice }>(`/billing-periods/${periodId}/invoice`, { method: 'POST', body: input }).then((r) => r.data),
  invoices: (status: InvoiceStatus | '', page = 1) =>
    api<Paginated<InvoiceSummary>>('/invoices', { query: { status: status || undefined, page, per_page: 25 } }),
  invoice: (id: number) => api<{ data: Invoice }>(`/invoices/${id}`).then((r) => r.data),
  issueInvoice: (id: number) =>
    api<{ data: Invoice }>(`/invoices/${id}/issue`, { method: 'POST' }).then((r) => r.data),
  handOverInvoice: (id: number) =>
    api<{ data: Invoice }>(`/invoices/${id}/hand-over`, { method: 'POST' }).then((r) => r.data),
  recordPayment: (id: number, input: { amount: string; received_on?: string; reference?: string; note?: string }) =>
    api<{ data: Invoice }>(`/invoices/${id}/payments`, { method: 'POST', body: input }).then((r) => r.data),
};

export const userApi = {
  list: (filters: { q?: string; status?: 'active' | 'inactive'; role?: string; page?: number } = {}) =>
    api<Paginated<ManagedUser>>('/users', { query: { ...filters, per_page: 25 } }),
  roles: () => api<{ data: ManagedRole[] }>('/roles').then((r) => r.data),
  create: (input: { name: string; username: string; email?: string; password: string; role: string }) =>
    api<{ data: ManagedUser }>('/users', { method: 'POST', body: input }).then((r) => r.data),
  update: (id: number, input: { name?: string; email?: string | null; is_active?: boolean; role?: string }) =>
    api<{ data: ManagedUser }>(`/users/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
  resetPassword: (id: number, password: string) =>
    api<{ data: ManagedUser }>(`/users/${id}/reset-password`, { method: 'POST', body: { password } }).then((r) => r.data),
  changePassword: (input: { current_password: string; password: string }) =>
    api<{ message: string }>('/auth/change-password', { method: 'POST', body: input }),
};

export const authorizationKeyApi = {
  own: () => api<{ data: AuthorizationKeyStatus }>('/authorization-key').then((r) => r.data),
  setOwn: (input: { current_password: string; type: AuthorizationKeyType; key?: string; generate?: true }) =>
    api<{ data: AuthorizationKeyStatus }>('/authorization-key', { method: 'PUT', body: input }).then((r) => r.data),
  removeOwn: (current_password: string) =>
    api<{ data: AuthorizationKeyStatus }>('/authorization-key', { method: 'DELETE', body: { current_password } }).then((r) => r.data),
  holders: () => api<{ data: AuthorizationKeyHolder[] }>('/authorization-keys').then((r) => r.data),
  revoke: (userId: number, reason: string) =>
    api<{ data: AuthorizationKeyHolder[] }>(`/authorization-keys/${userId}`, { method: 'DELETE', body: { reason } }).then((r) => r.data),
  approvalAuth: () => api<{ data: ApprovalAuthSetting }>('/settings/approval-auth').then((r) => r.data),
  setApprovalAuth: (mode: ApprovalAuthMode, current_password: string) =>
    api<{ data: ApprovalAuthSetting }>('/settings/approval-auth', { method: 'PUT', body: { mode, current_password } }).then((r) => r.data),
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

export const adjustmentApi = {
  meta: () => api<{ data: AdjustmentMeta }>('/inventory/adjustments/meta').then((r) => r.data),
  list: (filters: {
    q?: string;
    type?: AdjustmentType | '';
    reason_code?: AdjustmentReasonCode | '';
    source?: 'manual' | 'opname' | '';
    date_from?: string;
    date_to?: string;
    sort?: 'newest' | 'oldest';
    page?: number;
    per_page?: number;
  } = {}) => api<Paginated<Adjustment>>('/inventory/adjustments', { query: { ...filters } }),
  get: (id: number) => api<{ data: Adjustment }>(`/inventory/adjustments/${id}`).then((r) => r.data),
  create: (input: AdjustmentInput) =>
    api<{ data: Adjustment }>('/inventory/adjustments', { method: 'POST', body: input }).then((r) => r.data),
};

export const opnameApi = {
  list: (filters: {
    q?: string;
    status?: OpnameSessionStatus | '';
    result?: 'clean' | 'variance';
    scope_type?: OpnameScopeType;
    date_from?: string;
    date_to?: string;
    period?: string;
    sort?: 'newest' | 'oldest';
    page?: number;
    per_page?: number;
  } = {}) => api<Paginated<OpnameSessionSummary>>('/stock-opname-sessions', { query: { ...filters } }),
  periods: (filters: {
    group: OpnamePeriodGroup;
    date_from?: string;
    date_to?: string;
    status?: OpnameSessionStatus | '';
    result?: 'clean' | 'variance';
    scope_type?: OpnameScopeType;
    limit?: number;
    cursor?: string;
  }) => api<{ periods: OpnameHistoryPeriod[]; next_cursor?: string }>('/stock-opname-sessions/periods', { query: { ...filters } }),
  frequentVariance: (filters: {
    date_from?: string;
    date_to?: string;
    scope_type?: OpnameScopeType;
    status?: OpnameSessionStatus | '';
    result?: 'clean' | 'variance';
    limit?: number;
  } = {}) => api<{ items: OpnameFrequentVariance[] }>('/stock-opname-sessions/frequent-variance', { query: { ...filters } }),
  lastStatus: () => api<OpnameLastStatus>('/stock-opname/last-status'),
  exportSession: (id: number, part: 'summary' | 'detail', delimiter: 'comma' | 'semicolon') =>
    apiDownload(`/stock-opname-sessions/${id}/export?part=${part}&delimiter=${delimiter}`),
  exportPeriods: (group: OpnamePeriodGroup, delimiter: 'comma' | 'semicolon', date_from?: string, date_to?: string) =>
    apiDownload(`/stock-opname-sessions/periods/export?group=${group}&delimiter=${delimiter}${date_from ? `&date_from=${encodeURIComponent(date_from)}` : ''}${date_to ? `&date_to=${encodeURIComponent(date_to)}` : ''}`),
  get: (id: number) =>
    api<{ data: OpnameSession }>(`/stock-opname-sessions/${id}`).then((r) => r.data),
  report: (id: number) =>
    api<{ data: OpnameReport }>(`/stock-opname-sessions/${id}/report`).then((r) => r.data),
  tree: (id: number) =>
    api<OpnameProgressTree>(`/stock-opname-sessions/${id}/tree`),
  items: (id: number, filters: {
    category_id?: number;
    scope?: 'direct' | 'all';
    q?: string;
    only_uncounted?: boolean;
    only_counted?: boolean;
    sort?: '-counted_at';
    exclude_item_ids?: number[];
    page?: number;
    per_page?: number;
  } = {}) => {
    const { exclude_item_ids, ...query } = filters;
    return api<Paginated<OpnameItem>>(`/stock-opname-sessions/${id}/items`, {
      query: {
        ...query,
        ...(exclude_item_ids ? { 'exclude_item_ids[]': exclude_item_ids } : {}),
      },
    });
  },
  lookup: (id: number, q: string, mode: 'auto' | 'search' = 'auto') =>
    api<{ data: OpnameItem[] }>(`/stock-opname-sessions/${id}/lookup`, { query: { q, mode } }).then((r) => r.data),
  counts: (id: number, limit = 10) =>
    api<{ data: OpnameCountLog[] }>(`/stock-opname-sessions/${id}/counts`, { query: { limit } }).then((r) => r.data),
  storeCount: (id: number, input: { item_id: number; mode: OpnameCountMode; quantity: number; client_request_id: string }) =>
    api<OpnameCountResult>(`/stock-opname-sessions/${id}/counts`, { method: 'POST', body: input }),
  clearCount: (id: number, itemId: number, client_request_id: string) =>
    api<OpnameCountResult>(`/stock-opname-sessions/${id}/counts/${itemId}/clear`, {
      method: 'POST',
      body: { client_request_id },
    }),
  batchCounts: (id: number, operations: Array<{
    client_request_id: string;
    action: 'count' | 'clear';
    item_id: number;
    mode?: OpnameCountMode;
    quantity?: number;
    client_created_at: string;
  }>) => api<OpnameBatchCountResult>(`/stock-opname-sessions/${id}/counts/batch`, {
    method: 'POST',
    body: { operations },
  }),
  offlineIndex: (id: number, page = 1, perPage = 5000, etag?: string, onEtag?: (etag: string | null) => void) =>
    api<OpnameOfflineIndex | null>(`/stock-opname-sessions/${id}/offline-index`, {
      query: { page, per_page: perPage },
      headers: etag ? { 'If-None-Match': etag } : undefined,
      allowNotModified: true,
      onResponseHeaders: (headers) => onEtag?.(headers.get('ETag')),
    }),
  scopeOptions: () =>
    api<{ data: OpnameCategoryOption[]; total_products: number }>('/stock-opname/scope-options'),
  start: (input: {
    scope_type: OpnameScopeType;
    category_ids?: number[];
    name?: string;
    notes?: string;
    client_request_id: string;
  }) => api<{ data: OpnameSessionSummary }>('/stock-opname-sessions', { method: 'POST', body: input }).then((r) => r.data),
  cancel: (id: number, reason: string) =>
    api<{ data: OpnameSession }>(`/stock-opname-sessions/${id}/cancel`, {
      method: 'POST',
      body: { reason },
    }).then((r) => r.data),
  submit: (id: number, input: { client_request_id: string; owner_password?: string }) =>
    api<{ data: OpnameSession }>(`/stock-opname-sessions/${id}/submit`, { method: 'POST', body: input }).then((r) => r.data),
  approve: (id: number, input: { client_request_id: string; owner_password: string }) =>
    api<{ data: OpnameSession }>(`/stock-opname-sessions/${id}/approve`, { method: 'POST', body: input }).then((r) => r.data),
  reject: (id: number, input: { client_request_id: string; owner_password: string; reason: string }) =>
    api<{ data: OpnameSession }>(`/stock-opname-sessions/${id}/reject`, { method: 'POST', body: input }).then((r) => r.data),
};

export const opnameLockApi = {
  status: () => api<OpnameLockStatus>('/stock-opname/lock-status'),
};

export const opnameSettingsApi = {
  get: () => api<{ data: OpnameDisplaySetting }>('/settings/opname').then((r) => r.data),
  update: (input: Partial<OpnameDisplaySetting>) =>
    api<{ data: OpnameDisplaySetting }>('/settings/opname', {
      method: 'PUT',
      body: input,
    }).then((r) => r.data),
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

export const purchaseRequisitionApi = {
  list: (f: { q?: string; status?: PurchaseRequisitionStatus; mine?: boolean; page?: number; per_page?: number } = {}) =>
    api<Paginated<PurchaseRequisitionSummary>>('/purchase-requisitions', {
      query: { ...f, mine: f.mine ? 1 : undefined },
    }),
  get: (id: number) => api<{ data: PurchaseRequisition }>(`/purchase-requisitions/${id}`).then((r) => r.data),
  purchaseOrderItems: (id: number) =>
    api<{ data: { pr_id: number; items: PurchaseOrderRequisitionItem[] } }>(`/purchase-requisitions/${id}/purchase-order-items`).then((r) => r.data),
  create: (input: PurchaseRequisitionInput) =>
    api<{ data: PurchaseRequisition }>('/purchase-requisitions', { method: 'POST', body: input }).then((r) => r.data),
  update: (id: number, input: PurchaseRequisitionInput) =>
    api<{ data: PurchaseRequisition }>(`/purchase-requisitions/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
  submit: (id: number) =>
    api<{ data: PurchaseRequisition }>(`/purchase-requisitions/${id}/submit`, { method: 'POST' }).then((r) => r.data),
  cancel: (id: number, reason?: string) =>
    api<{ data: PurchaseRequisition }>(`/purchase-requisitions/${id}/cancel`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }).then((r) => r.data),
  financeCheck: (id: number, input: { decision: 'pass' | 'return'; note?: string }) =>
    api<{ data: PurchaseRequisition }>(`/purchase-requisitions/${id}/finance-check`, {
      method: 'POST',
      body: input,
    }).then((r) => r.data),
  approve: (id: number, input: {
    decision: 'approve' | 'reject';
    note?: string;
    approver_username: string;
    approver_password: string;
  }) => api<{ data: PurchaseRequisition }>(`/purchase-requisitions/${id}/approve`, {
    method: 'POST',
    body: input,
  }).then((r) => r.data),
};

export const purchaseOrderApi = {
  /** Semua PO untuk pengelola (`purchase_order.create`); peran lain hanya melihat PO yang dapat diterima. */
  list: (f: { q?: string; status?: PurchaseOrderSummary['status']; page?: number; per_page?: number } = {}) =>
    api<Paginated<PurchaseOrderSummary>>('/purchase-orders', { query: { ...f } }),
  receivable: (f: { q?: string; page?: number; per_page?: number } = {}) =>
    api<Paginated<PurchaseOrderSummary>>('/purchase-orders', { query: { ...f, receivable: 1 } }),
  get: (id: number) => api<{ data: PurchaseOrder }>(`/purchase-orders/${id}`).then((r) => r.data),
  create: (input: PurchaseOrderInput) =>
    api<{ data: PurchaseOrder }>('/purchase-orders', { method: 'POST', body: input }).then((r) => r.data),
  submit: (id: number) =>
    api<{ data: PurchaseOrder }>(`/purchase-orders/${id}/submit`, { method: 'POST' }).then((r) => r.data),
  confirm: (id: number, input: {
    approver_username: string;
    approver_password?: string;
    approver_key?: string;
  }) => api<{ data: PurchaseOrder }>(`/purchase-orders/${id}/confirm`, {
    method: 'POST',
    body: input,
  }).then((r) => r.data),
  send: (id: number) =>
    api<{ data: PurchaseOrder }>(`/purchase-orders/${id}/send`, { method: 'POST' }).then((r) => r.data),
};

export const bankAccountApi = {
  list: () => api<{ data: BankAccountSummary[] }>('/bank-accounts').then((r) => r.data),
  listForSettings: () => api<{ data: BankAccount[] }>('/settings/bank-accounts').then((r) => r.data),
  create: (input: {
    bank_name: string;
    account_name: string;
    account_number: string;
  }) => api<{ data: BankAccount }>('/settings/bank-accounts', { method: 'POST', body: input }).then((r) => r.data),
  update: (id: number, input: Partial<Pick<BankAccount, 'bank_name' | 'account_name' | 'account_number' | 'is_active'>>) =>
    api<{ data: BankAccount }>(`/settings/bank-accounts/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
};

export const goodsReceiptApi = {
  receivingLocations: () =>
    api<{ data: GoodsReceiptLocation[] }>('/goods-receipts/receiving-locations').then((r) => r.data),
  list: (f: {
    q?: string;
    document_status?: GoodsReceipt['document_status'];
    page?: number;
    per_page?: number;
  } = {}) =>
    api<Paginated<GoodsReceiptSummary>>('/goods-receipts', { query: { ...f } }),
  get: (id: number) => api<{ data: GoodsReceipt }>(`/goods-receipts/${id}`).then((r) => r.data),
  uploadAttachment: (id: number, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return api<{ data: GoodsReceiptAttachment }>(`/goods-receipts/${id}/attachments`, {
      method: 'POST',
      body,
    }).then((r) => r.data);
  },
  downloadAttachment: (receiptId: number, attachmentId: number) =>
    apiDownload(`/goods-receipts/${receiptId}/attachments/${attachmentId}`),
  create: (input: {
    po_id: number;
    receiving_location_id?: number;
    delivery_note_no?: string;
    invoice_no?: string;
    note?: string;
    post?: boolean;
    complete_po?: boolean;
    items: GoodsReceiptItemInput[];
  }) => api<{ data: GoodsReceipt }>('/goods-receipts', { method: 'POST', body: input }).then((r) => r.data),
  post: (id: number) =>
    api<{ data: GoodsReceipt }>(`/goods-receipts/${id}/post`, { method: 'POST' }).then((r) => r.data),
  cancel: (id: number, reason?: string) =>
    api<{ data: GoodsReceipt }>(`/goods-receipts/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} }).then((r) => r.data),
  verifyDocuments: (id: number, input: { delivery_note_no: string; invoice_no: string }) =>
    api<{ data: GoodsReceipt }>(`/goods-receipts/${id}/verify-documents`, { method: 'POST', body: input }).then((r) => r.data),
};

export const supplierReturnApi = {
  list: (f: { q?: string; status?: SupplierReturnStatus; return_type?: 'incoming' | 'outgoing'; supplier_id?: number; page?: number; per_page?: number } = {}) =>
    api<Paginated<SupplierReturnSummary>>('/supplier-returns', { query: { ...f } }),
  get: (id: number) => api<{ data: SupplierReturn }>(`/supplier-returns/${id}`).then((r) => r.data),
  create: (input: SupplierReturnInput) =>
    api<{ data: SupplierReturn }>('/supplier-returns', { method: 'POST', body: input }).then((r) => r.data),
  merge: (id: number, items: Array<{ product_id: number; qty: string }>) =>
    api<{ data: SupplierReturn }>(`/supplier-returns/${id}/merge`, { method: 'POST', body: { items } }).then((r) => r.data),
  submit: (id: number) =>
    api<{ data: SupplierReturn }>(`/supplier-returns/${id}/submit`, { method: 'POST' }).then((r) => r.data),
  supplierDecision: (id: number, decision: 'accept' | 'reject', note?: string) =>
    api<{ data: SupplierReturn }>(`/supplier-returns/${id}/supplier-decision`, {
      method: 'POST',
      body: { decision, note },
    }).then((r) => r.data),
  receiveReplacement: (id: number, items: Array<{
    return_item_id: number;
    expiry_date?: string;
    batch_code?: string;
    shelf_position_id?: number;
  }>) => api<{ data: SupplierReturn }>(`/supplier-returns/${id}/replacement-receipt`, {
    method: 'POST',
    body: { items },
  }).then((r) => r.data),
  writeOff: (id: number, input: {
    note?: string;
    approver_username: string;
    approver_password?: string;
    approver_key?: string;
  }) => api<{ data: SupplierReturn }>(`/supplier-returns/${id}/write-off`, {
    method: 'POST',
    body: input,
  }).then((r) => r.data),
  cancel: (id: number, reason?: string) =>
    api<{ data: SupplierReturn }>(`/supplier-returns/${id}/cancel`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }).then((r) => r.data),
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
  transfers: (f: {
    status?: StockTransferStatus;
    q?: string;
    page?: number;
    per_page?: number;
  } = {}) => api<Paginated<StockTransferSummary>>('/inventory/transfers', { query: { ...f } }),
  transfer: (id: number) =>
    api<{ data: StockTransfer }>(`/inventory/transfers/${id}`).then((r) => r.data),
  createTransfer: (input: StockTransferInput) =>
    api<{ data: StockTransfer }>('/inventory/transfers', { method: 'POST', body: input }).then((r) => r.data),
  postTransfer: (id: number) =>
    api<{ data: StockTransfer }>(`/inventory/transfers/${id}/post`, { method: 'POST' }).then((r) => r.data),
  cancelTransfer: (id: number, reason?: string) =>
    api<{ data: StockTransfer }>(`/inventory/transfers/${id}/cancel`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }).then((r) => r.data),
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
  open: (input: { register_id: number; counted_opening_cash?: string }) =>
    api<{ data: Shift }>('/shifts/open', { method: 'POST', body: input }).then((r) => r.data),
  availableRegisters: () => api<{ data: AvailableRegister[] }>('/registers/available').then((r) => r.data),
  startCount: (id: number) =>
    api<{ data: Shift }>(`/shifts/${id}/start-count`, { method: 'POST' }).then((r) => r.data),
  close: (id: number, input: { counted_cash: string; variance_note?: string }) =>
    api<{ data: Shift }>(`/shifts/${id}/close`, { method: 'POST', body: input }).then((r) => r.data),
  review: (id: number, input: { note?: string }) =>
    api<{ data: Shift }>(`/shifts/${id}/review`, { method: 'POST', body: input }).then((r) => r.data),
  list: (f: ShiftFilters = {}) => api<Paginated<Shift>>('/shifts', { query: { ...f } }),
};

export const registerApi = {
  list: () => api<{ data: Register[] }>('/registers').then((r) => r.data),
  get: (id: number) => api<{ data: Register }>(`/registers/${id}`).then((r) => r.data),
  create: (name: string) => api<{ data: Register }>('/registers', { method: 'POST', body: { name } }).then((r) => r.data),
  update: (id: number, input: { name?: string; is_active?: boolean; reason?: string }) =>
    api<{ data: Register }>(`/registers/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
  deactivate: (id: number, reason: string) =>
    api<{ data: Register }>(`/registers/${id}`, { method: 'DELETE', body: { reason } }).then((r) => r.data),
};

export const cashDepositApi = {
  list: (f: { status?: DepositStatus; kind?: DepositKind; shift_id?: number; page?: number; per_page?: number } = {}) =>
    api<Paginated<CashDeposit>>('/cash-deposits', { query: { ...f } }),
  get: (id: number) => api<{ data: CashDeposit }>(`/cash-deposits/${id}`).then((r) => r.data),
  createPartial: (shiftId: number, input: { counted_amount: string; note?: string }) =>
    api<{ data: CashDeposit }>(`/shifts/${shiftId}/deposits`, { method: 'POST', body: input }).then((r) => r.data),
  submit: (id: number) =>
    api<{ data: CashDeposit }>(`/cash-deposits/${id}/submit`, { method: 'POST' }).then((r) => r.data),
  cancel: (id: number, reason?: string) =>
    api<{ data: { id: number; cancelled: boolean } }>(`/cash-deposits/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} }).then((r) => r.data),
  receive: (id: number, input: { received_amount: string; note?: string }) =>
    api<{ data: CashDeposit }>(`/cash-deposits/${id}/receive`, { method: 'POST', body: input }).then((r) => r.data),
  correct: (id: number, reason: string) =>
    api<{ data: CashDeposit }>(`/cash-deposits/${id}/correct`, { method: 'POST', body: { reason } }).then((r) => r.data),
  funds: () => api<{ data: FundAccount[] }>('/fund-accounts').then((r) => r.data),
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
  /** Pratinjau read-only: total, diskon, PPN, stok FEFO, dan batas kredit. */
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
  inventoryMenus: () => api<{ data: InventoryMenuSetting }>('/settings/inventory/menus').then((r) => r.data),
  saveInventoryMenus: (input: InventoryMenuSetting) =>
    api<{ data: InventoryMenuSetting }>('/settings/inventory/menus', { method: 'PUT', body: input }).then((r) => r.data),
  vat: () => api<{ data: VatSetting }>('/settings/vat').then((r) => r.data),
  saveVat: (input: VatInput) =>
    api<{ data: VatSetting }>('/settings/vat', { method: 'PUT', body: input }).then((r) => r.data),
  warehouse: () => api<{ data: WarehouseSetting }>('/settings/warehouse').then((r) => r.data),
  saveWarehouse: (enabled: boolean) =>
    api<{ data: WarehouseSetting }>('/settings/warehouse', { method: 'PUT', body: { enabled } }).then((r) => r.data),
  adminModel: () => api<{ data: AdminModelSetting }>('/settings/admin-model').then((r) => r.data),
  /** `confirm: true` wajib (konfirmasi eksplisit); backend menolak tanpa itu. */
  saveAdminModel: (model: AdminModelId) =>
    api<{ data: AdminModelSetting }>('/settings/admin-model', { method: 'PUT', body: { model, confirm: true } }).then((r) => r.data),
  stockAuthority: () => api<{ data: StockAuthoritySetting }>('/settings/stock-authority').then((r) => r.data),
  /** Daftar (bukan objek) karena kunci aturan mengandung titik. Hanya kirim aturan yang berubah. */
  saveStockAuthority: (rules: StockAuthorityUpdate[]) =>
    api<{ data: StockAuthoritySetting }>('/settings/stock-authority', { method: 'PUT', body: { rules } }).then((r) => r.data),
};
