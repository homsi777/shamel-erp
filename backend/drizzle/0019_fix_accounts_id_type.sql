-- ============================================================
-- Migration 0019: Fix accounts table - convert id from TEXT to INTEGER
-- CRITICAL: Backup database before running this migration.
-- ============================================================

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- Keep temporary backups for safe remapping.
DROP TABLE IF EXISTS _accounts_backup;
DROP TABLE IF EXISTS _accounts_id_map;
DROP TABLE IF EXISTS _jel_backup;
DROP TABLE IF EXISTS _ab_backup;

CREATE TABLE _accounts_backup AS
SELECT rowid AS _legacy_rowid, *
FROM accounts;

CREATE TABLE _jel_backup AS
SELECT * FROM journal_entry_lines;

CREATE TABLE _ab_backup AS
SELECT * FROM account_balances;

DROP TABLE IF EXISTS journal_entry_lines;
DROP TABLE IF EXISTS account_balances;
DROP TABLE IF EXISTS accounts;

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  parent_id INTEGER REFERENCES accounts(id),
  level INTEGER NOT NULL DEFAULT 1,
  account_type TEXT NOT NULL,
  account_nature TEXT NOT NULL,
  is_parent INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  currency_code TEXT DEFAULT 'SYP',
  branch_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Reinsert legacy accounts by code (when available).
INSERT OR IGNORE INTO accounts (
  code,
  name_ar,
  name_en,
  parent_id,
  level,
  account_type,
  account_nature,
  is_parent,
  is_active,
  is_system,
  currency_code,
  branch_id,
  notes,
  created_at,
  updated_at
)
SELECT
  COALESCE(NULLIF(TRIM(code), ''), 'LEGACY-' || _legacy_rowid) AS code,
  COALESCE(NULLIF(TRIM(name_ar), ''), NULLIF(TRIM(name), ''), 'حساب غير مسمى') AS name_ar,
  NULLIF(TRIM(name_en), '') AS name_en,
  NULL,
  COALESCE(level, 1) AS level,
  CASE
    WHEN LOWER(TRIM(account_type)) IN ('assets', 'liabilities', 'equity', 'revenue', 'expenses') THEN LOWER(TRIM(account_type))
    WHEN LOWER(TRIM(type)) IN ('assets', 'liabilities', 'equity', 'revenue', 'expenses') THEN LOWER(TRIM(type))
    ELSE 'assets'
  END AS account_type,
  CASE
    WHEN LOWER(TRIM(account_nature)) IN ('debit', 'credit') THEN LOWER(TRIM(account_nature))
    WHEN LOWER(TRIM(type)) IN ('liabilities', 'equity', 'revenue') THEN 'credit'
    ELSE 'debit'
  END AS account_nature,
  COALESCE(is_parent, CASE WHEN IFNULL(is_leaf, 1) = 0 THEN 1 ELSE 0 END, 0) AS is_parent,
  COALESCE(is_active, 1) AS is_active,
  COALESCE(is_system, 0) AS is_system,
  COALESCE(NULLIF(TRIM(currency_code), ''), 'SYP') AS currency_code,
  branch_id,
  notes,
  COALESCE(created_at, datetime('now')),
  COALESCE(updated_at, datetime('now'))
FROM _accounts_backup;

CREATE TABLE _accounts_id_map (
  old_id_text TEXT,
  old_rowid INTEGER,
  old_parent_id TEXT,
  code TEXT,
  new_id INTEGER
);

INSERT INTO _accounts_id_map (old_id_text, old_rowid, old_parent_id, code, new_id)
SELECT
  CAST(b.id AS TEXT) AS old_id_text,
  b._legacy_rowid AS old_rowid,
  CAST(b.parent_id AS TEXT) AS old_parent_id,
  COALESCE(NULLIF(TRIM(b.code), ''), 'LEGACY-' || b._legacy_rowid) AS code,
  a.id AS new_id
FROM _accounts_backup b
JOIN accounts a
  ON a.code = COALESCE(NULLIF(TRIM(b.code), ''), 'LEGACY-' || b._legacy_rowid);

-- Restore parent relationships using legacy id, rowid, or parent code.
UPDATE accounts
SET parent_id = (
  SELECT parent_map.new_id
  FROM _accounts_id_map self_map
  JOIN _accounts_id_map parent_map
    ON (
      CAST(self_map.old_parent_id AS TEXT) = CAST(parent_map.old_id_text AS TEXT)
      OR CAST(self_map.old_parent_id AS INTEGER) = parent_map.old_rowid
      OR CAST(self_map.old_parent_id AS TEXT) = parent_map.code
    )
  WHERE self_map.new_id = accounts.id
  LIMIT 1
)
WHERE id IN (
  SELECT new_id
  FROM _accounts_id_map
  WHERE old_parent_id IS NOT NULL AND TRIM(old_parent_id) <> ''
);

CREATE TABLE journal_entry_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  currency_code TEXT DEFAULT 'SYP',
  exchange_rate REAL DEFAULT 1,
  amount_in_currency REAL,
  description TEXT,
  party_id INTEGER,
  cost_center_id INTEGER
);

CREATE TABLE account_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  period_key TEXT NOT NULL,
  debit_total REAL NOT NULL DEFAULT 0,
  credit_total REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  currency_code TEXT DEFAULT 'SYP'
);

-- Restore journal lines with account remapping where possible.
INSERT INTO journal_entry_lines (
  journal_entry_id,
  account_id,
  debit,
  credit,
  currency_code,
  exchange_rate,
  amount_in_currency,
  description,
  party_id,
  cost_center_id
)
SELECT
  CAST(j.journal_entry_id AS INTEGER) AS journal_entry_id,
  COALESCE(map_txt.new_id, map_row.new_id) AS account_id,
  COALESCE(j.debit, 0),
  COALESCE(j.credit, 0),
  COALESCE(NULLIF(TRIM(j.currency_code), ''), 'SYP'),
  COALESCE(j.exchange_rate, 1),
  j.amount_in_currency,
  j.description,
  j.party_id,
  j.cost_center_id
FROM _jel_backup j
LEFT JOIN _accounts_id_map map_txt
  ON CAST(j.account_id AS TEXT) = map_txt.old_id_text
LEFT JOIN _accounts_id_map map_row
  ON CAST(j.account_id AS INTEGER) = map_row.old_rowid
WHERE COALESCE(map_txt.new_id, map_row.new_id) IS NOT NULL
  AND CAST(j.journal_entry_id AS INTEGER) IN (SELECT id FROM journal_entries);

-- Restore balances with account remapping where possible.
INSERT INTO account_balances (
  account_id,
  period_key,
  debit_total,
  credit_total,
  balance,
  currency_code
)
SELECT
  COALESCE(map_txt.new_id, map_row.new_id) AS account_id,
  COALESCE(NULLIF(TRIM(b.period_key), ''), 'opening') AS period_key,
  COALESCE(b.debit_total, 0),
  COALESCE(b.credit_total, 0),
  COALESCE(b.balance, 0),
  COALESCE(NULLIF(TRIM(b.currency_code), ''), 'SYP')
FROM _ab_backup b
LEFT JOIN _accounts_id_map map_txt
  ON CAST(b.account_id AS TEXT) = map_txt.old_id_text
LEFT JOIN _accounts_id_map map_row
  ON CAST(b.account_id AS INTEGER) = map_row.old_rowid
WHERE COALESCE(map_txt.new_id, map_row.new_id) IS NOT NULL;

-- Remap parties account links.
UPDATE parties
SET account_id = (
  SELECT COALESCE(map_txt.new_id, map_row.new_id)
  FROM _accounts_id_map map_txt
  LEFT JOIN _accounts_id_map map_row
    ON CAST(parties.account_id AS INTEGER) = map_row.old_rowid
  WHERE CAST(parties.account_id AS TEXT) = map_txt.old_id_text
     OR CAST(parties.account_id AS INTEGER) = map_row.old_rowid
  LIMIT 1
)
WHERE account_id IS NOT NULL;

UPDATE parties
SET ar_account_id = (
  SELECT CAST(COALESCE(map_txt.new_id, map_row.new_id) AS TEXT)
  FROM _accounts_id_map map_txt
  LEFT JOIN _accounts_id_map map_row
    ON CAST(parties.ar_account_id AS INTEGER) = map_row.old_rowid
  WHERE CAST(parties.ar_account_id AS TEXT) = map_txt.old_id_text
     OR CAST(parties.ar_account_id AS INTEGER) = map_row.old_rowid
  LIMIT 1
)
WHERE ar_account_id IS NOT NULL AND TRIM(ar_account_id) <> '';

UPDATE parties
SET ap_account_id = (
  SELECT CAST(COALESCE(map_txt.new_id, map_row.new_id) AS TEXT)
  FROM _accounts_id_map map_txt
  LEFT JOIN _accounts_id_map map_row
    ON CAST(parties.ap_account_id AS INTEGER) = map_row.old_rowid
  WHERE CAST(parties.ap_account_id AS TEXT) = map_txt.old_id_text
     OR CAST(parties.ap_account_id AS INTEGER) = map_row.old_rowid
  LIMIT 1
)
WHERE ap_account_id IS NOT NULL AND TRIM(ap_account_id) <> '';

-- Cleanup orphan references.
UPDATE parties
SET account_id = NULL
WHERE account_id IS NOT NULL
  AND account_id NOT IN (SELECT id FROM accounts);

UPDATE parties
SET ar_account_id = NULL
WHERE ar_account_id IS NOT NULL
  AND (CAST(ar_account_id AS INTEGER) NOT IN (SELECT id FROM accounts));

UPDATE parties
SET ap_account_id = NULL
WHERE ap_account_id IS NOT NULL
  AND (CAST(ap_account_id AS INTEGER) NOT IN (SELECT id FROM accounts));

UPDATE salary_transactions
SET journal_entry_id = NULL
WHERE journal_entry_id IS NOT NULL
  AND journal_entry_id NOT IN (SELECT id FROM journal_entries);

DROP TABLE IF EXISTS _jel_backup;
DROP TABLE IF EXISTS _ab_backup;
DROP TABLE IF EXISTS _accounts_id_map;
DROP TABLE IF EXISTS _accounts_backup;

COMMIT;
PRAGMA foreign_keys = ON;
