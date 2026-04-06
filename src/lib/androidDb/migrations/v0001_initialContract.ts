export const migration0001InitialContractSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS companies (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  code TEXT,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_number TEXT,
  currency_code TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS branches (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE (company_uid, code)
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role_code TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (company_uid, username)
) STRICT;

CREATE TABLE IF NOT EXISTS app_settings (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  setting_key TEXT NOT NULL,
  setting_value_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE (company_uid, branch_uid, setting_key)
) STRICT;

CREATE TABLE IF NOT EXISTS parties (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  code TEXT,
  name TEXT NOT NULL,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer', 'supplier', 'both')),
  phone TEXT,
  email TEXT,
  tax_number TEXT,
  address TEXT,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  opening_balance_direction TEXT NOT NULL DEFAULT 'debit' CHECK (opening_balance_direction IN ('debit', 'credit')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (company_uid, code)
) STRICT;

CREATE TABLE IF NOT EXISTS item_units (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  symbol TEXT,
  scale_factor_milli INTEGER NOT NULL DEFAULT 1000 CHECK (scale_factor_milli > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE (company_uid, code),
  UNIQUE (company_uid, name)
) STRICT;

CREATE TABLE IF NOT EXISTS item_categories (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  parent_uid TEXT,
  code TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (parent_uid) REFERENCES item_categories(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (company_uid, code)
) STRICT;

CREATE TABLE IF NOT EXISTS warehouses (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  code TEXT,
  name TEXT NOT NULL,
  location TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (company_uid, code)
) STRICT;

CREATE TABLE IF NOT EXISTS items (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  code TEXT,
  name TEXT NOT NULL,
  category_uid TEXT,
  base_unit_uid TEXT NOT NULL,
  barcode TEXT,
  is_service INTEGER NOT NULL DEFAULT 0 CHECK (is_service IN (0,1)),
  purchase_cost_minor INTEGER NOT NULL DEFAULT 0,
  sale_price_minor INTEGER NOT NULL DEFAULT 0,
  tax_rate_milli INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_milli >= 0),
  reorder_level_milli INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level_milli >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY (category_uid) REFERENCES item_categories(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY (base_unit_uid) REFERENCES item_units(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE (company_uid, code),
  UNIQUE (company_uid, barcode)
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_balances (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  warehouse_uid TEXT NOT NULL,
  item_uid TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL DEFAULT 0,
  average_cost_minor INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY (warehouse_uid) REFERENCES warehouses(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (item_uid) REFERENCES items(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE (warehouse_uid, item_uid)
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_movements (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  movement_no TEXT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'purchase', 'sale', 'adjustment_plus', 'adjustment_minus', 'transfer_in', 'transfer_out', 'return_in', 'return_out')),
  reference_uid TEXT,
  reference_type TEXT,
  warehouse_uid TEXT NOT NULL,
  item_uid TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  total_cost_minor INTEGER NOT NULL DEFAULT 0,
  movement_date TEXT NOT NULL,
  notes TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY (warehouse_uid) REFERENCES warehouses(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (item_uid) REFERENCES items(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (created_by_uid) REFERENCES users(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (company_uid, movement_no)
) STRICT;

CREATE TABLE IF NOT EXISTS invoices (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  invoice_no TEXT NOT NULL,
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('sale', 'purchase', 'sale_return', 'purchase_return')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  party_uid TEXT,
  warehouse_uid TEXT,
  currency_code TEXT NOT NULL,
  exchange_rate_milli INTEGER NOT NULL DEFAULT 1000 CHECK (exchange_rate_milli > 0),
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  remaining_minor INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY (party_uid) REFERENCES parties(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY (warehouse_uid) REFERENCES warehouses(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY (created_by_uid) REFERENCES users(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (company_uid, invoice_no)
) STRICT;

CREATE TABLE IF NOT EXISTS invoice_lines (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  invoice_uid TEXT NOT NULL,
  item_uid TEXT NOT NULL,
  unit_uid TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  line_total_minor INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invoice_uid) REFERENCES invoices(uid) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (item_uid) REFERENCES items(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (unit_uid) REFERENCES item_units(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE (invoice_uid, uid)
) STRICT;

CREATE TABLE IF NOT EXISTS print_profiles (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_uid TEXT NOT NULL,
  branch_uid TEXT,
  profile_code TEXT NOT NULL,
  printer_name TEXT NOT NULL,
  printer_type TEXT NOT NULL CHECK (printer_type IN ('thermal', 'a4', 'network', 'bluetooth', 'usb')),
  template_key TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_uid) REFERENCES companies(uid) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (branch_uid) REFERENCES branches(uid) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (company_uid, branch_uid, profile_code)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_branches_company_uid ON branches (company_uid);
CREATE INDEX IF NOT EXISTS idx_users_company_branch ON users (company_uid, branch_uid);
CREATE INDEX IF NOT EXISTS idx_parties_company_type ON parties (company_uid, party_type);
CREATE INDEX IF NOT EXISTS idx_items_company_category ON items (company_uid, category_uid);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_item ON inventory_balances (item_uid);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_date ON inventory_movements (item_uid, movement_date);
CREATE INDEX IF NOT EXISTS idx_invoices_company_issue_date ON invoices (company_uid, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_party_uid ON invoices (party_uid);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_uid ON invoice_lines (invoice_uid);
CREATE INDEX IF NOT EXISTS idx_print_profiles_branch_default ON print_profiles (branch_uid, is_default);
`;
