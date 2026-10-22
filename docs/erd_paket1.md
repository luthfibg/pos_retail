# POS Retail SMK — ERD Paket 1 (MVP), v0.5 draft

Diagram menampilkan relasi dan kolom kunci saja. Definisi lengkap ada di `schema_paket1.sql`.
Dibagi per domain agar terbaca; tabel penghubung antar domain muncul di lebih dari satu diagram.

## 1. Akses, master data, dan pelanggan

```mermaid
erDiagram
  stores ||--o{ user_roles : "assignment"
  users ||--o{ user_roles : has
  roles ||--o{ user_roles : grants
  roles ||--o{ role_permissions : has
  permissions ||--o{ role_permissions : in
  users ||--o{ user_permissions : "override"
  users ||--o{ audit_logs : actor
  users ||--o{ notifications : receives
  categories ||--o{ categories : parent
  categories ||--o{ products : groups
  products ||--o{ price_history : logs
  products ||--o{ discounts : "target (product/category)"
  stores ||--o{ locations : has
  locations ||--o{ shelves : has
  shelves ||--o{ shelf_positions : has
  customers ||--o{ customer_credit_limits : "limit history"
  users ||--o{ customers : "created_by / verified_by"
  products { varchar sku UK; varchar barcode UK; enum status; bool track_expiry; decimal avg_cost }
  customers { varchar customer_no UK; enum status }
  customer_credit_limits { decimal limit_amount; datetime effective_from }
```

## 2. Pembelian dan inventory

```mermaid
erDiagram
  purchase_requisitions ||--|{ purchase_requisition_items : has
  purchase_requisitions ||--o{ pr_approvals : "finance_check / owner_auth"
  purchase_requisitions ||--o{ purchase_orders : "PO wajib dari PR"
  suppliers ||--o{ purchase_orders : supplies
  purchase_orders ||--|{ purchase_order_items : has
  purchase_orders ||--o{ goods_receipts : "penerimaan wajib dari PO"
  goods_receipts ||--|{ goods_receipt_items : has
  purchase_order_items ||--o{ goods_receipt_items : fulfils
  goods_receipt_items ||--o| product_batches : creates
  products ||--o{ product_batches : "expiry per batch"
  products ||--o{ inventory_balances : stock
  locations ||--o{ inventory_balances : at
  shelf_positions ||--o{ inventory_balances : at
  product_batches ||--o{ inventory_balances : of
  products ||--o{ inventory_movements : history
  product_batches ||--o{ inventory_movements : of
  stock_transfers ||--|{ stock_transfer_items : has
  stock_adjustments ||--|{ stock_adjustment_items : has
  inventory_balances { bigint product_id; bigint location_id; bigint shelf_position_id; bigint batch_id; decimal qty_sellable }
  inventory_movements { enum movement_type; varchar ref_type; bigint ref_id; decimal qty }
```

## 3. Penjualan, shift, setoran, tagihan

```mermaid
erDiagram
  registers ||--o{ cash_shifts : opens
  users ||--o{ cash_shifts : cashier
  cash_shifts ||--o{ sales : contains
  cash_shifts ||--o{ cash_movements : has
  cash_shifts ||--o{ cash_deposits : "partial / final"
  customers ||--o{ sales : "payroll_credit"
  sales ||--|{ sale_items : has
  sale_items ||--o{ sale_item_batches : "FEFO allocation"
  product_batches ||--o{ sale_item_batches : from
  sales ||--o| payments : "cash only"
  sales ||--o| sale_voids : voided
  sales ||--o{ receipt_print_logs : "original / copy"
  billing_periods ||--o{ sales : "period (credit)"
  billing_periods ||--o| receivable_invoices : "1 invoice per period"
  receivable_invoices ||--|{ receivable_invoice_lines : has
  sales ||--o| receivable_invoice_lines : "billed once"
  receivable_invoices ||--o{ invoice_payments : "paid by HRD"
  fund_accounts ||--o{ fund_ledger_entries : ledger
  fund_accounts ||--o{ cash_deposits : "source / destination"
  float_policies ||--o{ cash_deposits : applied
  sales { enum payment_mode; enum billing_status; bool over_limit_flag; char idempotency_key UK }
  cash_deposits { enum kind; decimal counted_amount; decimal float_kept; decimal deposit_amount }
```

## Catatan desain yang tercermin di skema

- **Satu shift terbuka per register** — kolom generated `open_register_key` + unique.
- **Satu periode tagihan terbuka per toko** — kolom generated `open_store_key` + unique.
- **Satu struk hanya ditagih sekali** — `receivable_invoice_lines.sale_id` unik.
- **Barcode unik permanen**, produk tidak boleh `active` tanpa harga jual (CHECK).
- **PO wajib dari PR, penerimaan wajib dari PO** — kolom `pr_id` dan `po_id` NOT NULL.
- **Kredit karyawan tanpa baris `payments`**; kredit wajib punya `customer_id` (CHECK).
- **Saldo stok dapat direkonsiliasi** dari `inventory_movements`; unik saldo memakai kolom generated agar NULL posisi/batch tidak menduplikasi baris.
