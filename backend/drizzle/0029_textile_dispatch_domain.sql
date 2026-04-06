ALTER TABLE items ADD COLUMN is_textile integer NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN textile_base_uom text;
ALTER TABLE items ADD COLUMN supports_color_dimension integer NOT NULL DEFAULT 0;

ALTER TABLE inventory_movements ADD COLUMN textile_color_id text;
ALTER TABLE inventory_movements ADD COLUMN textile_roll_delta real DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN textile_length_delta real DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN textile_base_uom text;

CREATE TABLE IF NOT EXISTS textile_colors (
  id text PRIMARY KEY NOT NULL,
  company_id text,
  code text,
  name text NOT NULL,
  normalized_name text NOT NULL,
  is_active integer NOT NULL DEFAULT 1,
  created_at text DEFAULT CURRENT_TIMESTAMP,
  updated_at text DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS textile_stock_balances (
  id text PRIMARY KEY NOT NULL,
  company_id text,
  branch_id text,
  warehouse_id text NOT NULL,
  warehouse_name text,
  item_id text NOT NULL,
  color_id text NOT NULL,
  base_uom text NOT NULL,
  roll_count real NOT NULL DEFAULT 0,
  total_length real NOT NULL DEFAULT 0,
  updated_at text DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS textile_stock_balances_scope_unique
  ON textile_stock_balances(company_id, branch_id, warehouse_id, item_id, color_id, base_uom);

CREATE TABLE IF NOT EXISTS textile_stock_movements (
  id text PRIMARY KEY NOT NULL,
  company_id text,
  branch_id text,
  warehouse_id text NOT NULL,
  warehouse_name text,
  item_id text NOT NULL,
  color_id text NOT NULL,
  base_uom text NOT NULL,
  roll_delta real NOT NULL DEFAULT 0,
  length_delta real NOT NULL DEFAULT 0,
  document_type text NOT NULL,
  document_id text NOT NULL,
  document_number text,
  document_line_id text,
  movement_type text NOT NULL,
  user_id text,
  user_name text,
  notes text,
  created_at text DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouse_dispatch_notices (
  id text PRIMARY KEY NOT NULL,
  company_id text,
  branch_id text,
  warehouse_id text NOT NULL,
  warehouse_name text,
  customer_id text,
  customer_name text,
  source_document_type text,
  source_document_id text,
  dispatch_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  requested_by text,
  requested_by_name text,
  prepared_by text,
  prepared_by_name text,
  approved_by text,
  approved_by_name text,
  rejected_by text,
  rejected_by_name text,
  converted_by text,
  converted_by_name text,
  requested_at text,
  prepared_at text,
  approved_at text,
  rejected_at text,
  converted_at text,
  rejected_reason text,
  notes text,
  print_meta text,
  linked_invoice_id text,
  created_at text DEFAULT CURRENT_TIMESTAMP,
  updated_at text DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouse_dispatch_notice_lines (
  id text PRIMARY KEY NOT NULL,
  notice_id text NOT NULL,
  company_id text,
  branch_id text,
  warehouse_id text,
  item_id text NOT NULL,
  item_name text,
  color_id text NOT NULL,
  color_name text,
  requested_roll_count real NOT NULL DEFAULT 0,
  fulfilled_roll_count real NOT NULL DEFAULT 0,
  fulfilled_total_length real NOT NULL DEFAULT 0,
  base_uom text NOT NULL,
  textile_unit_price_per_length real,
  line_status text NOT NULL DEFAULT 'draft',
  notes text,
  source_invoice_line_id text,
  created_at text DEFAULT CURRENT_TIMESTAMP,
  updated_at text DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouse_dispatch_notice_line_decompositions (
  id text PRIMARY KEY NOT NULL,
  notice_id text NOT NULL,
  line_id text NOT NULL,
  company_id text,
  branch_id text,
  sequence integer NOT NULL,
  length_value real NOT NULL,
  unit text NOT NULL,
  roll_label text,
  created_at text DEFAULT CURRENT_TIMESTAMP,
  updated_at text DEFAULT CURRENT_TIMESTAMP
);
