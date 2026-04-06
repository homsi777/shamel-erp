import type { SQLiteDBConnection } from '@capacitor-community/sqlite';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS runtime_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  pos_warehouse_id TEXT,
  pos_warehouse_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sub_categories (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  manager TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  manager TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cashboxes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  currency TEXT,
  balance REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  phone TEXT,
  balance REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  warehouse_id TEXT,
  warehouse_name TEXT,
  category_id TEXT,
  sub_category_id TEXT,
  unit_id TEXT,
  unit_name TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_number TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT,
  client_id TEXT,
  client_name TEXT,
  date TEXT NOT NULL,
  payment_type TEXT,
  currency TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL DEFAULT 0,
  target_warehouse_id TEXT,
  target_warehouse_name TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_id TEXT NOT NULL,
  item_id TEXT,
  item_name TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT,
  item_name TEXT,
  transaction_type TEXT NOT NULL,
  reference_id TEXT,
  reference_type TEXT,
  quantity_delta REAL NOT NULL DEFAULT 0,
  warehouse_id TEXT,
  warehouse_name TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  status TEXT,
  date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  cashbox_id TEXT,
  client_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS party_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  party_id TEXT NOT NULL,
  party_name TEXT,
  reference_type TEXT,
  reference_id TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  from_warehouse_id TEXT,
  to_warehouse_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS party_transfers (
  id TEXT PRIMARY KEY NOT NULL,
  from_party_id TEXT,
  to_party_id TEXT,
  amount REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_marks (
  id TEXT PRIMARY KEY NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  mark_at TEXT NOT NULL,
  row_ref_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  percentage REAL NOT NULL DEFAULT 0,
  capital_amount REAL NOT NULL DEFAULT 0,
  current_balance REAL NOT NULL DEFAULT 0,
  linked_client_id TEXT,
  status TEXT NOT NULL,
  join_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partner_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  partner_id TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  related_voucher_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  position TEXT,
  currency TEXT,
  base_salary REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  join_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS salary_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  type TEXT NOT NULL,
  period TEXT,
  cash_box_id TEXT,
  date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  payment_type TEXT NOT NULL,
  cash_box_id TEXT,
  warehouse_id TEXT,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_lines (
  id TEXT PRIMARY KEY NOT NULL,
  expense_id TEXT NOT NULL,
  account_id TEXT,
  account_name TEXT,
  amount REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  parent_id INTEGER,
  level INTEGER NOT NULL DEFAULT 1,
  account_type TEXT NOT NULL,
  account_nature TEXT NOT NULL,
  is_parent INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY NOT NULL,
  account_id INTEGER,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  description TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_warehouse_id ON items (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices (date);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_party_transactions_party_id ON party_transactions (party_id);
CREATE INDEX IF NOT EXISTS idx_partner_transactions_partner_id ON partner_transactions (partner_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item_id ON inventory_transactions (item_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_marks_scope ON reconciliation_marks (scope_type, scope_id, report_type, is_active);
CREATE INDEX IF NOT EXISTS idx_salary_transactions_employee_id ON salary_transactions (employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date);
`;

export const runLocalDbMigrations = async (db: SQLiteDBConnection) => {
  await db.execute(MIGRATION_SQL, false);
};
