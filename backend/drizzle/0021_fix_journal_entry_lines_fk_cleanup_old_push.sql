PRAGMA foreign_keys = OFF;

-- 1) Ensure any rows that still live in __old_push_journal_entries exist in journal_entries
INSERT OR IGNORE INTO journal_entries (
  id,
  entry_number,
  entry_date,
  description,
  reference_type,
  reference_id,
  total_debit,
  total_credit,
  currency_code,
  exchange_rate,
  status,
  branch_id,
  created_by,
  posted_at,
  created_at
)
SELECT
  o.id,
  o.entry_number,
  o.entry_date,
  o.description,
  o.reference_type,
  o.reference_id,
  o.total_debit,
  o.total_credit,
  o.currency_code,
  o.exchange_rate,
  o.status,
  o.branch_id,
  o.created_by,
  o.posted_at,
  o.created_at
FROM __old_push_journal_entries o;

-- 2) Rebuild journal_entry_lines with correct FK -> journal_entries(id)
CREATE TABLE journal_entry_lines__new (
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

INSERT INTO journal_entry_lines__new (
  id,
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
  id,
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
FROM journal_entry_lines;

DROP TABLE journal_entry_lines;
ALTER TABLE journal_entry_lines__new RENAME TO journal_entry_lines;

-- 3) Drop stale temp table left by previous push
DROP TABLE IF EXISTS __old_push_journal_entries;

PRAGMA foreign_keys = ON;
