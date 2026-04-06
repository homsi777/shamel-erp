-- Agents hardening + operational tables (PostgreSQL)
BEGIN;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE agents ALTER COLUMN company_id SET DEFAULT NULL;
ALTER TABLE agents ALTER COLUMN branch_id SET DEFAULT NULL;

ALTER TABLE agent_inventory ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE agent_transfers ADD COLUMN IF NOT EXISTS transfer_type text DEFAULT 'transfer';
ALTER TABLE agent_transfers ADD COLUMN IF NOT EXISTS status text DEFAULT 'posted';
ALTER TABLE agent_transfers ADD COLUMN IF NOT EXISTS created_by_id text;
ALTER TABLE agent_transfers ADD COLUMN IF NOT EXISTS created_by_name text;
ALTER TABLE agent_transfers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS agent_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS agent_name text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS agent_user_id text;

-- Backfill tenant scope for agents + agent inventory/transfers
UPDATE agents a
SET company_id = c.id
FROM (SELECT id FROM companies ORDER BY created_at NULLS LAST LIMIT 1) c
WHERE a.company_id IS NULL;

UPDATE agents a
SET branch_id = b.id
FROM (SELECT id FROM branches ORDER BY created_at NULLS LAST LIMIT 1) b
WHERE a.branch_id IS NULL;

UPDATE agent_inventory ai
SET company_id = a.company_id,
    branch_id = a.branch_id
FROM agents a
WHERE ai.agent_id = a.id
  AND (ai.company_id IS NULL OR ai.branch_id IS NULL);

UPDATE agent_transfers at
SET company_id = a.company_id,
    branch_id = a.branch_id
FROM agents a
WHERE at.agent_id = a.id
  AND (at.company_id IS NULL OR at.branch_id IS NULL);

UPDATE agent_inventory ai
SET company_id = c.id
FROM (SELECT id FROM companies ORDER BY created_at NULLS LAST LIMIT 1) c
WHERE ai.company_id IS NULL;

UPDATE agent_inventory ai
SET branch_id = b.id
FROM (SELECT id FROM branches ORDER BY created_at NULLS LAST LIMIT 1) b
WHERE ai.branch_id IS NULL;

UPDATE agent_transfers at
SET company_id = c.id
FROM (SELECT id FROM companies ORDER BY created_at NULLS LAST LIMIT 1) c
WHERE at.company_id IS NULL;

UPDATE agent_transfers at
SET branch_id = b.id
FROM (SELECT id FROM branches ORDER BY created_at NULLS LAST LIMIT 1) b
WHERE at.branch_id IS NULL;

ALTER TABLE agents ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE agents ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE agent_inventory ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE agent_inventory ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE agent_transfers ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE agent_transfers ALTER COLUMN branch_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS agent_transfer_lines (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  branch_id text NOT NULL,
  transfer_id text NOT NULL,
  agent_id text NOT NULL,
  warehouse_id text,
  warehouse_name text,
  item_id text NOT NULL,
  item_name text,
  unit_name text,
  quantity numeric(18,6) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_inventory_movements (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  branch_id text NOT NULL,
  agent_id text NOT NULL,
  item_id text NOT NULL,
  item_name text,
  unit_name text,
  qty numeric(18,6) NOT NULL,
  base_qty numeric(18,6) NOT NULL,
  movement_type text NOT NULL,
  document_type text NOT NULL,
  document_id text NOT NULL,
  document_number text,
  document_line_id text,
  warehouse_id text,
  warehouse_name text,
  user_id text,
  user_name text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_inventory_scope_unique
  ON agent_inventory(company_id, branch_id, agent_id, item_id);

CREATE INDEX IF NOT EXISTS agent_inventory_scope_lookup
  ON agent_inventory(company_id, branch_id, agent_id);

CREATE INDEX IF NOT EXISTS agent_transfers_scope_lookup
  ON agent_transfers(company_id, branch_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_transfer_lines_scope_lookup
  ON agent_transfer_lines(company_id, branch_id, agent_id, transfer_id);

CREATE INDEX IF NOT EXISTS agent_inventory_movements_scope_lookup
  ON agent_inventory_movements(company_id, branch_id, agent_id, item_id, created_at DESC);

COMMIT;
