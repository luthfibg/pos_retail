-- =====================================================================
-- POS Retail SMK -- Skema MySQL 8.0.16+ (Paket 1 / MVP)  v0.5 (DRAFT)
-- Konvensi:
--   * Uang DECIMAL(18,2); qty DECIMAL(18,3); HPP rata-rata DECIMAL(18,4)
--   * Waktu DATETIME(3) disimpan dalam UTC; tampil sesuai stores.timezone (WIB)
--   * Dokumen terposting tidak dihapus: pembatalan/reversal/koreksi
--   * FK memakai RESTRICT (default). Tidak ada ON DELETE CASCADE pada data transaksi.
--   * Skema ini BELUM dijalankan terhadap server MySQL; validasi lewat migration Laravel
--     dan test di Tahap 1. Urutan CREATE aman karena FOREIGN_KEY_CHECKS=0.
--   * Paket 2/3 (saldo pembelian, pembayaran supplier, bank, expenses, retur,
--     rekonsiliasi, credit note) sengaja belum dimasukkan; dirancang pada tahapnya.
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. IDENTITY & SISTEM
-- ---------------------------------------------------------------------
CREATE TABLE stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(150) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stores_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  username VARCHAR(60) NOT NULL,
  email VARCHAR(190) NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(60) NOT NULL,
  description VARCHAR(255) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(80) NOT NULL,
  module VARCHAR(40) NOT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id, store_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_ur_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Override permission per user (opsional, untuk delegasi fungsi tanpa membuat role baru)
CREATE TABLE user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  effect ENUM('allow','deny') NOT NULL DEFAULT 'allow',
  PRIMARY KEY (user_id, permission_id, store_id),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_up_perm FOREIGN KEY (permission_id) REFERENCES permissions (id),
  CONSTRAINT fk_up_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSON NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_settings (store_id, setting_key),
  CONSTRAINT fk_settings_store FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason VARCHAR(500) NULL,
  is_self_approval TINYINT(1) NOT NULL DEFAULT 0,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(60) NOT NULL,            -- contoh: customer.limit_needed
  entity_type VARCHAR(60) NULL,
  entity_id BIGINT UNSIGNED NULL,
  message VARCHAR(500) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id, read_at, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_att_entity (entity_type, entity_id),
  CONSTRAINT fk_att_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Penomoran dokumen: dikunci dengan SELECT ... FOR UPDATE dalam transaksi
CREATE TABLE number_sequences (
  store_id BIGINT UNSIGNED NOT NULL,
  doc_type VARCHAR(30) NOT NULL,        -- SALE, PR, PO, GR, SHIFT, INV, ...
  period_key VARCHAR(10) NOT NULL,      -- contoh: 202610
  last_number BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, doc_type, period_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tarif PPN: R-04 ditunda; price_includes_tax NULL = belum diputuskan
CREATE TABLE tax_rates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  rate DECIMAL(5,2) NOT NULL,
  price_includes_tax TINYINT(1) NULL,
  effective_from DATE NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_tax_effective (store_id, effective_from),
  CONSTRAINT fk_tax_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. MASTER DATA
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_cat_parent (parent_id),
  CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suppliers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(150) NOT NULL,
  contact_name VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  address VARCHAR(255) NULL,
  default_payment_terms ENUM('prepaid','credit','cod') NOT NULL DEFAULT 'prepaid',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_code (store_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Satu produk = satu barcode, satuan terkecil (pcs). Barcode unik permanen
-- (produk nonaktif tetap memegang barcode; baris tidak dihapus).
CREATE TABLE products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  sku VARCHAR(40) NOT NULL,
  barcode VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  unit_name VARCHAR(20) NOT NULL DEFAULT 'pcs',
  track_expiry TINYINT(1) NOT NULL DEFAULT 0,
  sell_price DECIMAL(18,2) NULL,                    -- NULL selama status pending_price
  avg_cost DECIMAL(18,4) NOT NULL DEFAULT 0,        -- HPP rata-rata bergerak
  last_cost DECIMAL(18,2) NULL,
  min_stock DECIMAL(18,3) NOT NULL DEFAULT 0,
  critical_stock DECIMAL(18,3) NOT NULL DEFAULT 0,
  status ENUM('pending_price','active','inactive') NOT NULL DEFAULT 'pending_price',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (store_id, sku),
  UNIQUE KEY uq_products_barcode (barcode),
  KEY idx_products_name (name),
  KEY idx_products_category (category_id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT chk_products_active_price CHECK (status <> 'active' OR sell_price IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE price_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  old_price DECIMAL(18,2) NULL,
  new_price DECIMAL(18,2) NOT NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ph_product (product_id, changed_at),
  CONSTRAINT fk_ph_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_ph_user FOREIGN KEY (changed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Diskon hanya ditetapkan Admin; kasir tidak dapat memberi diskon manual
CREATE TABLE discounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  target_type ENUM('product','category') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  discount_type ENUM('percent','amount') NOT NULL,
  value DECIMAL(18,2) NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_disc_target (target_type, target_id, is_active),
  CONSTRAINT fk_disc_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE locations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  type ENUM('warehouse','store_floor') NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  CONSTRAINT fk_loc_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE shelves (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  location_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  layout_x SMALLINT NOT NULL DEFAULT 0,
  layout_y SMALLINT NOT NULL DEFAULT 0,
  layout_w SMALLINT NOT NULL DEFAULT 1,
  layout_h SMALLINT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shelves_code (location_id, code),
  CONSTRAINT fk_shelves_loc FOREIGN KEY (location_id) REFERENCES locations (id),
  CONSTRAINT fk_shelves_cat FOREIGN KEY (category_id) REFERENCES categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE shelf_positions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shelf_id BIGINT UNSIGNED NOT NULL,
  level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  slot SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shelf_pos (shelf_id, level, slot),
  CONSTRAINT fk_sp_shelf FOREIGN KEY (shelf_id) REFERENCES shelves (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Karyawan pabrik sebagai pelanggan. Kasir boleh membuat (pending_verification);
-- Admin memverifikasi dan menetapkan batas kredit.
CREATE TABLE customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  customer_no VARCHAR(40) NOT NULL,                 -- nomor induk karyawan
  name VARCHAR(150) NOT NULL,
  department VARCHAR(100) NULL,
  status ENUM('pending_verification','active','inactive') NOT NULL DEFAULT 'pending_verification',
  created_by BIGINT UNSIGNED NOT NULL,
  verified_by BIGINT UNSIGNED NULL,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_no (store_id, customer_no),
  KEY idx_customers_name (name),
  CONSTRAINT fk_cust_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_cust_verifier FOREIGN KEY (verified_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Batas kredit bulanan (riwayat). Tidak ada baris = belum ada batas (kredit tertahan).
CREATE TABLE customer_credit_limits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  limit_amount DECIMAL(18,2) NOT NULL,
  effective_from DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  set_by BIGINT UNSIGNED NOT NULL,
  note VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_ccl_customer (customer_id, effective_from),
  CONSTRAINT fk_ccl_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_ccl_user FOREIGN KEY (set_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. PEMBELIAN (PR -> PO -> Penerimaan)
-- ---------------------------------------------------------------------
CREATE TABLE purchase_requisitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NULL,
  est_total DECIMAL(18,2) NOT NULL DEFAULT 0,
  status ENUM('draft','submitted','finance_checked','approved','rejected','returned','converted','cancelled') NOT NULL DEFAULT 'draft',
  submitted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pr_number (store_id, doc_number),
  KEY idx_pr_status (status),
  CONSTRAINT fk_pr_user FOREIGN KEY (requested_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_requisition_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pr_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(18,3) NOT NULL,
  est_price DECIMAL(18,2) NULL,
  note VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_pri_pr (pr_id),
  CONSTRAINT fk_pri_pr FOREIGN KEY (pr_id) REFERENCES purchase_requisitions (id),
  CONSTRAINT fk_pri_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_pri_qty CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pr_approvals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pr_id BIGINT UNSIGNED NOT NULL,
  step ENUM('finance_check','owner_auth') NOT NULL,
  decision ENUM('approved','rejected','returned') NOT NULL,
  decided_by BIGINT UNSIGNED NOT NULL,
  note VARCHAR(500) NULL,
  reauth_at DATETIME(3) NULL,                       -- waktu autentikasi ulang Owner
  is_self_approval TINYINT(1) NOT NULL DEFAULT 0,
  decided_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pra_pr (pr_id),
  CONSTRAINT fk_pra_pr FOREIGN KEY (pr_id) REFERENCES purchase_requisitions (id),
  CONSTRAINT fk_pra_user FOREIGN KEY (decided_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PO wajib berasal dari PR (pr_id NOT NULL). Status dokumen, penerimaan, pembayaran dipisah.
CREATE TABLE purchase_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  pr_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  payment_terms ENUM('prepaid','credit','cod') NOT NULL,
  total DECIMAL(18,2) NOT NULL DEFAULT 0,
  status ENUM('draft','pending_confirmation','approved','sent','partially_received','received','cancelled') NOT NULL DEFAULT 'draft',
  receipt_status ENUM('none','partial','complete') NOT NULL DEFAULT 'none',
  payment_status ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'unpaid',
  order_date DATE NOT NULL,
  expected_date DATE NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_po_number (store_id, doc_number),
  KEY idx_po_status (status),
  CONSTRAINT fk_po_pr FOREIGN KEY (pr_id) REFERENCES purchase_requisitions (id),
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_po_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  po_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty_ordered DECIMAL(18,3) NOT NULL,
  qty_received DECIMAL(18,3) NOT NULL DEFAULT 0,
  unit_price DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_poi_po (po_id),
  CONSTRAINT fk_poi_po FOREIGN KEY (po_id) REFERENCES purchase_orders (id),
  CONSTRAINT fk_poi_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_poi_qty CHECK (qty_ordered > 0 AND qty_received >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Penerimaan wajib dari PO (po_id NOT NULL). Tanggal kadaluarsa diisi per item
-- untuk produk dengan track_expiry = 1.
CREATE TABLE goods_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  po_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  delivery_note_no VARCHAR(60) NULL,
  invoice_no VARCHAR(60) NULL,
  receiving_location_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','checked','posted','cancelled') NOT NULL DEFAULT 'draft',
  document_status ENUM('pending','verified') NOT NULL DEFAULT 'pending',
  received_by BIGINT UNSIGNED NOT NULL,
  posted_at DATETIME(3) NULL,
  verified_by BIGINT UNSIGNED NULL,
  verified_at DATETIME(3) NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_gr_number (store_id, doc_number),
  KEY idx_gr_po (po_id),
  CONSTRAINT fk_gr_po FOREIGN KEY (po_id) REFERENCES purchase_orders (id),
  CONSTRAINT fk_gr_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_gr_loc FOREIGN KEY (receiving_location_id) REFERENCES locations (id),
  CONSTRAINT fk_gr_receiver FOREIGN KEY (received_by) REFERENCES users (id),
  CONSTRAINT fk_gr_verifier FOREIGN KEY (verified_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE goods_receipt_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gr_id BIGINT UNSIGNED NOT NULL,
  po_item_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty_ordered DECIMAL(18,3) NOT NULL,
  qty_received DECIMAL(18,3) NOT NULL,              -- diterima layak jual
  qty_damaged DECIMAL(18,3) NOT NULL DEFAULT 0,
  qty_short DECIMAL(18,3) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(18,2) NOT NULL,
  expiry_date DATE NULL,
  batch_code VARCHAR(60) NULL,
  shelf_position_id BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_gri_gr (gr_id),
  CONSTRAINT fk_gri_gr FOREIGN KEY (gr_id) REFERENCES goods_receipts (id),
  CONSTRAINT fk_gri_poi FOREIGN KEY (po_item_id) REFERENCES purchase_order_items (id),
  CONSTRAINT fk_gri_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_gri_pos FOREIGN KEY (shelf_position_id) REFERENCES shelf_positions (id),
  CONSTRAINT chk_gri_qty CHECK (qty_received >= 0 AND qty_damaged >= 0 AND qty_short >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. INVENTORY (batch, saldo, pergerakan)
-- ---------------------------------------------------------------------
CREATE TABLE product_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  goods_receipt_item_id BIGINT UNSIGNED NULL,       -- NULL untuk stok awal migrasi
  batch_code VARCHAR(60) NULL,
  expiry_date DATE NULL,                            -- NULL = tanpa kadaluarsa / belum diketahui
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  is_opening TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_batch_fefo (product_id, expiry_date, received_at),
  CONSTRAINT fk_batch_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_batch_gri FOREIGN KEY (goods_receipt_item_id) REFERENCES goods_receipt_items (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saldo turunan dari inventory_movements. Kunci unik memakai kolom generated agar NULL
-- (tanpa posisi / tanpa batch) tidak lolos dari unique.
CREATE TABLE inventory_balances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  shelf_position_id BIGINT UNSIGNED NULL,
  batch_id BIGINT UNSIGNED NULL,
  qty_sellable DECIMAL(18,3) NOT NULL DEFAULT 0,
  qty_quarantine DECIMAL(18,3) NOT NULL DEFAULT 0,
  qty_damaged DECIMAL(18,3) NOT NULL DEFAULT 0,
  position_key BIGINT UNSIGNED GENERATED ALWAYS AS (IFNULL(shelf_position_id, 0)) STORED,
  batch_key BIGINT UNSIGNED GENERATED ALWAYS AS (IFNULL(batch_id, 0)) STORED,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_balance (product_id, location_id, position_key, batch_key),
  KEY idx_bal_location (location_id, shelf_position_id),
  CONSTRAINT fk_bal_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_bal_location FOREIGN KEY (location_id) REFERENCES locations (id),
  CONSTRAINT fk_bal_pos FOREIGN KEY (shelf_position_id) REFERENCES shelf_positions (id),
  CONSTRAINT fk_bal_batch FOREIGN KEY (batch_id) REFERENCES product_batches (id),
  CONSTRAINT chk_bal_nonneg CHECK (qty_sellable >= 0 AND qty_quarantine >= 0 AND qty_damaged >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sumber kebenaran stok; append-only (tidak ada UPDATE/DELETE dari aplikasi)
CREATE TABLE inventory_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NULL,
  from_location_id BIGINT UNSIGNED NULL,
  from_position_id BIGINT UNSIGNED NULL,
  from_bucket ENUM('sellable','quarantine','damaged') NULL,
  to_location_id BIGINT UNSIGNED NULL,
  to_position_id BIGINT UNSIGNED NULL,
  to_bucket ENUM('sellable','quarantine','damaged') NULL,
  qty DECIMAL(18,3) NOT NULL,
  movement_type ENUM('opening_balance','receipt','putaway','transfer','sale','sale_void',
                     'customer_return','supplier_return_out','supplier_replacement_in',
                     'adjustment','write_off') NOT NULL,
  unit_cost DECIMAL(18,4) NULL,
  ref_type VARCHAR(40) NOT NULL,
  ref_id BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mov_product (product_id, occurred_at),
  KEY idx_mov_ref (ref_type, ref_id),
  CONSTRAINT fk_mov_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_mov_batch FOREIGN KEY (batch_id) REFERENCES product_batches (id),
  CONSTRAINT fk_mov_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_mov_qty CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Transfer (gudang -> rak, antar-rak). Bukan adjustment.
CREATE TABLE stock_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  from_location_id BIGINT UNSIGNED NOT NULL,
  to_location_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','posted','cancelled') NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED NOT NULL,
  posted_by BIGINT UNSIGNED NULL,
  posted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_st_number (store_id, doc_number),
  CONSTRAINT fk_st_from FOREIGN KEY (from_location_id) REFERENCES locations (id),
  CONSTRAINT fk_st_to FOREIGN KEY (to_location_id) REFERENCES locations (id),
  CONSTRAINT fk_st_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_st_poster FOREIGN KEY (posted_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_transfer_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transfer_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NULL,
  from_position_id BIGINT UNSIGNED NULL,
  to_position_id BIGINT UNSIGNED NULL,
  qty DECIMAL(18,3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sti_transfer (transfer_id),
  CONSTRAINT fk_sti_transfer FOREIGN KEY (transfer_id) REFERENCES stock_transfers (id),
  CONSTRAINT fk_sti_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_sti_batch FOREIGN KEY (batch_id) REFERENCES product_batches (id),
  CONSTRAINT chk_sti_qty CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Adjustment (opname, kehilangan, rusak, kadaluarsa). Kasir hanya mengajukan.
CREATE TABLE stock_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  reason ENUM('opname','loss','damage','expired','other') NOT NULL,
  status ENUM('draft','requested','approved','posted','rejected','cancelled') NOT NULL DEFAULT 'draft',
  requested_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME(3) NULL,
  reauth_at DATETIME(3) NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sa_number (store_id, doc_number),
  CONSTRAINT fk_sa_requester FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_sa_approver FOREIGN KEY (approved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_adjustment_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  adjustment_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  shelf_position_id BIGINT UNSIGNED NULL,
  qty_before DECIMAL(18,3) NOT NULL,
  qty_counted DECIMAL(18,3) NOT NULL,
  qty_diff DECIMAL(18,3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sai_adj (adjustment_id),
  CONSTRAINT fk_sai_adj FOREIGN KEY (adjustment_id) REFERENCES stock_adjustments (id),
  CONSTRAINT fk_sai_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_sai_batch FOREIGN KEY (batch_id) REFERENCES product_batches (id),
  CONSTRAINT fk_sai_loc FOREIGN KEY (location_id) REFERENCES locations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. DANA & KAS (kas kecil, kas besar, endapan, setoran)
--    purchase_fund dipakai mulai Paket 2; baris akunnya sudah boleh dibuat.
-- ---------------------------------------------------------------------
CREATE TABLE registers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  CONSTRAINT fk_reg_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fund_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  type ENUM('petty_cash','main_cash','purchase_fund') NOT NULL,
  name VARCHAR(100) NOT NULL,
  register_id BIGINT UNSIGNED NULL,
  holder_user_id BIGINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  CONSTRAINT fk_fa_store FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT fk_fa_register FOREIGN KEY (register_id) REFERENCES registers (id),
  CONSTRAINT fk_fa_holder FOREIGN KEY (holder_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ledger append-only; saldo = SUM(amount). amount bertanda (+/-).
CREATE TABLE fund_ledger_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fund_account_id BIGINT UNSIGNED NOT NULL,
  entry_type VARCHAR(30) NOT NULL,                  -- opening, deposit_out, deposit_in, ...
  amount DECIMAL(18,2) NOT NULL,
  ref_type VARCHAR(40) NOT NULL,
  ref_id BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_fle_account (fund_account_id, occurred_at),
  KEY idx_fle_ref (ref_type, ref_id),
  CONSTRAINT fk_fle_account FOREIGN KEY (fund_account_id) REFERENCES fund_accounts (id),
  CONSTRAINT fk_fle_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE float_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  scope ENUM('petty_cash','main_cash') NOT NULL,
  mode ENUM('fixed','percent') NOT NULL,
  fixed_amount DECIMAL(18,2) NULL,
  percent DECIMAL(5,2) NULL,
  percent_base ENUM('cash_sales_shift','cash_on_hand') NULL,
  min_amount DECIMAL(18,2) NULL,                    -- NULL = tanpa batas
  max_amount DECIMAL(18,2) NULL,
  rounding_unit INT UNSIGNED NOT NULL DEFAULT 1000, -- pembulatan setoran ke bawah
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  set_by BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_fp_scope (store_id, scope, is_active),
  CONSTRAINT fk_fp_user FOREIGN KEY (set_by) REFERENCES users (id),
  CONSTRAINT chk_fp_mode CHECK ((mode = 'fixed' AND fixed_amount IS NOT NULL)
                             OR (mode = 'percent' AND percent IS NOT NULL AND percent_base IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE float_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  scope ENUM('petty_cash','main_cash') NOT NULL,
  proposed_by BIGINT UNSIGNED NOT NULL,
  mode ENUM('fixed','percent') NOT NULL,
  fixed_amount DECIMAL(18,2) NULL,
  percent DECIMAL(5,2) NULL,
  percent_base ENUM('cash_sales_shift','cash_on_hand') NULL,
  reason VARCHAR(500) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  decided_by BIGINT UNSIGNED NULL,
  decided_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_fprop_proposer FOREIGN KEY (proposed_by) REFERENCES users (id),
  CONSTRAINT fk_fprop_decider FOREIGN KEY (decided_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. PERIODE TAGIHAN & INVOICE (dibuat sebelum sales karena sales merujuknya)
-- ---------------------------------------------------------------------
-- Penutupan periode = aksi eksplisit Admin pada hari gaji (closed_at). Transaksi kredit
-- setelah closed_at otomatis masuk periode berikutnya.
CREATE TABLE billing_periods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(40) NOT NULL,
  scheduled_close_date DATE NULL,                   -- tanggal gaji dari HRD (dapat berubah tiap bulan)
  starts_at DATETIME(3) NOT NULL,
  closed_at DATETIME(3) NULL,
  status ENUM('open','closed','invoiced') NOT NULL DEFAULT 'open',
  closed_by BIGINT UNSIGNED NULL,
  open_store_key BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'open' THEN store_id ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bp_one_open (open_store_key),
  CONSTRAINT fk_bp_user FOREIGN KEY (closed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Satu invoice gabungan per periode untuk HRD, rincian per karyawan
CREATE TABLE receivable_invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  billing_period_id BIGINT UNSIGNED NOT NULL,
  bill_to VARCHAR(150) NOT NULL,
  subtotal DECIMAL(18,2) NOT NULL,
  tax_rate_snapshot DECIMAL(5,2) NULL,              -- NULL selama PPN belum dikonfigurasi (R-04)
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  total DECIMAL(18,2) NOT NULL,
  amount_paid DECIMAL(18,2) NOT NULL DEFAULT 0,
  status ENUM('draft','issued','handed_to_hr','partially_paid','paid','cancelled') NOT NULL DEFAULT 'draft',
  issued_at DATETIME(3) NULL,
  handed_at DATETIME(3) NULL,
  due_date DATE NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_inv_number (store_id, doc_number),
  UNIQUE KEY uq_inv_period (billing_period_id),
  CONSTRAINT fk_inv_period FOREIGN KEY (billing_period_id) REFERENCES billing_periods (id),
  CONSTRAINT fk_inv_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invoice_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  reference VARCHAR(100) NULL,
  note VARCHAR(255) NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ip_invoice (invoice_id),
  CONSTRAINT fk_ip_invoice FOREIGN KEY (invoice_id) REFERENCES receivable_invoices (id),
  CONSTRAINT fk_ip_user FOREIGN KEY (recorded_by) REFERENCES users (id),
  CONSTRAINT chk_ip_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. SHIFT & PENJUALAN
-- ---------------------------------------------------------------------
CREATE TABLE cash_shifts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  register_id BIGINT UNSIGNED NOT NULL,
  cashier_id BIGINT UNSIGNED NOT NULL,
  opening_balance DECIMAL(18,2) NOT NULL DEFAULT 0, -- = endapan shift/setoran sebelumnya
  expected_cash DECIMAL(18,2) NULL,
  counted_cash DECIMAL(18,2) NULL,
  variance DECIMAL(18,2) NULL,
  variance_note VARCHAR(500) NULL,
  float_kept DECIMAL(18,2) NULL,
  status ENUM('open','counting','closed','reviewed') NOT NULL DEFAULT 'open',
  opened_at DATETIME(3) NOT NULL,
  closed_at DATETIME(3) NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  open_register_key BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status IN ('open','counting') THEN register_id ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shift_number (store_id, doc_number),
  UNIQUE KEY uq_shift_one_open (open_register_key),
  KEY idx_shift_cashier (cashier_id, opened_at),
  CONSTRAINT fk_shift_register FOREIGN KEY (register_id) REFERENCES registers (id),
  CONSTRAINT fk_shift_cashier FOREIGN KEY (cashier_id) REFERENCES users (id),
  CONSTRAINT fk_shift_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cash_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shift_id BIGINT UNSIGNED NOT NULL,
  type ENUM('in','out') NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_cm_shift (shift_id),
  CONSTRAINT fk_cm_shift FOREIGN KEY (shift_id) REFERENCES cash_shifts (id),
  CONSTRAINT fk_cm_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_cm_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Satu jenis penjualan (K1/K2 lama tidak dimodelkan); kasir tercatat per transaksi.
CREATE TABLE sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  shift_id BIGINT UNSIGNED NOT NULL,
  cashier_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  payment_mode ENUM('cash','payroll_credit') NOT NULL,
  subtotal DECIMAL(18,2) NOT NULL DEFAULT 0,
  discount_total DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_rate_snapshot DECIMAL(5,2) NULL,              -- hanya untuk mode cash (bila PPN aktif)
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  total DECIMAL(18,2) NOT NULL DEFAULT 0,
  status ENUM('draft','posted','voided') NOT NULL DEFAULT 'draft',
  billing_status ENUM('not_applicable','unbilled','invoiced','paid') NOT NULL DEFAULT 'not_applicable',
  billing_period_id BIGINT UNSIGNED NULL,
  invoice_id BIGINT UNSIGNED NULL,
  over_limit_flag TINYINT(1) NOT NULL DEFAULT 0,    -- label "melebihi batas"
  credit_exception_by BIGINT UNSIGNED NULL,
  credit_exception_note VARCHAR(255) NULL,
  idempotency_key CHAR(36) NOT NULL,
  posted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_number (store_id, doc_number),
  UNIQUE KEY uq_sales_idem (idempotency_key),
  KEY idx_sales_shift (shift_id),
  KEY idx_sales_customer (customer_id, billing_status),
  KEY idx_sales_period (billing_period_id),
  KEY idx_sales_posted (posted_at),
  CONSTRAINT fk_sales_shift FOREIGN KEY (shift_id) REFERENCES cash_shifts (id),
  CONSTRAINT fk_sales_cashier FOREIGN KEY (cashier_id) REFERENCES users (id),
  CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_sales_period FOREIGN KEY (billing_period_id) REFERENCES billing_periods (id),
  CONSTRAINT fk_sales_invoice FOREIGN KEY (invoice_id) REFERENCES receivable_invoices (id),
  CONSTRAINT fk_sales_exc FOREIGN KEY (credit_exception_by) REFERENCES users (id),
  CONSTRAINT chk_sales_credit_customer CHECK (payment_mode <> 'payroll_credit' OR customer_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(18,3) NOT NULL,
  unit_price DECIMAL(18,2) NOT NULL,                -- snapshot harga saat transaksi
  discount_id BIGINT UNSIGNED NULL,
  discount_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(18,2) NOT NULL,
  cost_snapshot DECIMAL(18,4) NOT NULL,             -- HPP rata-rata saat transaksi
  PRIMARY KEY (id),
  KEY idx_si_sale (sale_id),
  KEY idx_si_product (product_id),
  CONSTRAINT fk_si_sale FOREIGN KEY (sale_id) REFERENCES sales (id),
  CONSTRAINT fk_si_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_si_discount FOREIGN KEY (discount_id) REFERENCES discounts (id),
  CONSTRAINT chk_si_qty CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Alokasi FEFO: satu baris item dapat dipecah ke beberapa batch
CREATE TABLE sale_item_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_item_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NULL,
  shelf_position_id BIGINT UNSIGNED NULL,
  qty DECIMAL(18,3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sib_item (sale_item_id),
  CONSTRAINT fk_sib_item FOREIGN KEY (sale_item_id) REFERENCES sale_items (id),
  CONSTRAINT fk_sib_batch FOREIGN KEY (batch_id) REFERENCES product_batches (id),
  CONSTRAINT chk_sib_qty CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hanya untuk mode cash; mode payroll_credit tidak memiliki baris payment
CREATE TABLE payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NOT NULL,
  shift_id BIGINT UNSIGNED NOT NULL,
  method ENUM('cash') NOT NULL DEFAULT 'cash',
  amount_tendered DECIMAL(18,2) NOT NULL,
  change_given DECIMAL(18,2) NOT NULL DEFAULT 0,
  amount_applied DECIMAL(18,2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_sale (sale_id),
  KEY idx_payments_shift (shift_id),
  CONSTRAINT fk_pay_sale FOREIGN KEY (sale_id) REFERENCES sales (id),
  CONSTRAINT fk_pay_shift FOREIGN KEY (shift_id) REFERENCES cash_shifts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_voids (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sv_sale (sale_id),
  CONSTRAINT fk_sv_sale FOREIGN KEY (sale_id) REFERENCES sales (id),
  CONSTRAINT fk_sv_req FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_sv_app FOREIGN KEY (approved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Arsip struk tetap di sistem; cetak ulang berlabel SALINAN dan tercatat
CREATE TABLE receipt_print_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NULL,
  invoice_id BIGINT UNSIGNED NULL,
  print_type ENUM('original','copy') NOT NULL,
  printed_by BIGINT UNSIGNED NOT NULL,
  printed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_rpl_sale (sale_id),
  KEY idx_rpl_invoice (invoice_id),
  CONSTRAINT fk_rpl_sale FOREIGN KEY (sale_id) REFERENCES sales (id),
  CONSTRAINT fk_rpl_invoice FOREIGN KEY (invoice_id) REFERENCES receivable_invoices (id),
  CONSTRAINT fk_rpl_user FOREIGN KEY (printed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE receivable_invoice_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  sale_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ril_sale (sale_id),                 -- satu struk hanya boleh ditagih sekali
  KEY idx_ril_invoice (invoice_id, customer_id),
  CONSTRAINT fk_ril_invoice FOREIGN KEY (invoice_id) REFERENCES receivable_invoices (id),
  CONSTRAINT fk_ril_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_ril_sale FOREIGN KEY (sale_id) REFERENCES sales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 8. SETORAN KASIR -> KAS BESAR (setoran bank masuk Paket 2)
-- ---------------------------------------------------------------------
CREATE TABLE cash_deposits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  doc_number VARCHAR(30) NOT NULL,
  kind ENUM('partial','final') NOT NULL,
  shift_id BIGINT UNSIGNED NOT NULL,
  source_fund_id BIGINT UNSIGNED NOT NULL,
  destination_fund_id BIGINT UNSIGNED NOT NULL,
  counted_amount DECIMAL(18,2) NOT NULL,            -- kas fisik terhitung saat setoran
  float_kept DECIMAL(18,2) NOT NULL,                -- endapan yang tinggal di laci
  deposit_amount DECIMAL(18,2) NOT NULL,            -- dibulatkan ke bawah (rounding_unit)
  policy_id BIGINT UNSIGNED NULL,
  status ENUM('draft','submitted','received','discrepancy','corrected') NOT NULL DEFAULT 'draft',
  received_amount DECIMAL(18,2) NULL,
  received_by BIGINT UNSIGNED NULL,
  received_at DATETIME(3) NULL,
  note VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cd_number (store_id, doc_number),
  KEY idx_cd_shift (shift_id),
  CONSTRAINT fk_cd_shift FOREIGN KEY (shift_id) REFERENCES cash_shifts (id),
  CONSTRAINT fk_cd_source FOREIGN KEY (source_fund_id) REFERENCES fund_accounts (id),
  CONSTRAINT fk_cd_dest FOREIGN KEY (destination_fund_id) REFERENCES fund_accounts (id),
  CONSTRAINT fk_cd_policy FOREIGN KEY (policy_id) REFERENCES float_policies (id),
  CONSTRAINT fk_cd_receiver FOREIGN KEY (received_by) REFERENCES users (id),
  CONSTRAINT fk_cd_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_cd_amounts CHECK (counted_amount >= 0 AND float_kept >= 0 AND deposit_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
