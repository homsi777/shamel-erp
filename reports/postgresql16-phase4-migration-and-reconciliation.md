# PostgreSQL 16 Phase 4: Controlled Migration and Reconciliation

## Executive Summary

Phase 4 was executed for the backend/server ERP runtime only. Android/Capacitor/local embedded SQLite was not touched.

The SQLite source dataset in `data/shamel.db` was migrated into local PostgreSQL 16 database `shamel_erp_pg` through a repeatable snapshot pipeline:

1. export SQLite tables to JSON
2. transform rows against PostgreSQL column metadata
3. import into PostgreSQL with ordered transactional upserts
4. reconcile SQLite vs PostgreSQL on counts, accounting totals, party balances, inventory balances, sampled documents, restaurant linkage, and reporting summaries

Final status:

- Migration completed successfully for `77` tables.
- Final reconciliation passed fully.
- Financial totals reconciled exactly: `307343.84` debit and `307343.84` credit in both databases.
- Party balances matched for `29` parties.
- Inventory balances matched for `187` item snapshots.
- Sampled document reconciliation passed.
- Basic PostgreSQL load validation passed with concurrent backend validation runs and no remaining client sequencing warning.

PostgreSQL is now validated as the single trusted local backend runtime for the migrated ERP dataset. SQLite remains only as the legacy source/export archive for now.

## Scope Boundary

In scope:

- backend/server runtime
- local PostgreSQL 16 database `shamel_erp_pg`
- SQLite source database `data/shamel.db`
- migration tooling, reconciliation, and local runtime validation

Explicitly out of scope:

- Android runtime
- Capacitor/local embedded SQLite
- Google Cloud SQL
- production cutover
- incremental sync or dual-write architecture

## Files Added or Updated

- [backend/server.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/server.ts)
- [package.json](/c:/Users/Homsi/Desktop/PostgreSQL%2016/package.json)
- [scripts/sqlite-to-postgres/_shared.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/sqlite-to-postgres/_shared.ts)
- [scripts/sqlite-to-postgres/export-sqlite.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/sqlite-to-postgres/export-sqlite.ts)
- [scripts/sqlite-to-postgres/transform-data.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/sqlite-to-postgres/transform-data.ts)
- [scripts/sqlite-to-postgres/import-postgres.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/sqlite-to-postgres/import-postgres.ts)
- [scripts/sqlite-to-postgres/run-migration.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/sqlite-to-postgres/run-migration.ts)
- [scripts/postgres-phase4-reconciliation.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/postgres-phase4-reconciliation.ts)
- [scripts/postgres-phase4-load-smoke.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/postgres-phase4-load-smoke.ts)

## Migration Strategy Used

The implemented strategy is a full snapshot migration with no incremental sync:

- Source: SQLite `data/shamel.db`
- Target: PostgreSQL `shamel_erp_pg`
- Mode: export -> transform -> import
- Ordering: dependency-aware, with `journal_entries` and `journal_entry_lines` imported before `invoices` and `vouchers`
- Import behavior: per-table transaction, ordered execution, `ON CONFLICT` upsert, post-import sequence reseed
- Re-run safety: supported through full target reset plus repeatable re-import

The import order preserved key referential dependencies and avoided replaying historical SQLite migration SQL against PostgreSQL.

## Tables Migrated

Total migrated tables: `77`

High-value non-zero tables:

| Table | Rows |
|---|---:|
| companies | 1 |
| branches | 1 |
| remote_branches | 5 |
| units | 12 |
| categories | 9 |
| warehouses | 4 |
| cash_boxes | 6 |
| users | 4 |
| system_settings | 18 |
| restaurant_tables | 10 |
| restaurant_menu_items | 7 |
| employees | 43 |
| accounts | 88 |
| account_balances | 7 |
| parties | 29 |
| items | 187 |
| textile_colors | 1 |
| textile_stock_balances | 1 |
| textile_stock_movements | 2 |
| activation_codes | 217 |
| journal_entries | 193 |
| journal_entry_lines | 387 |
| invoices | 184 |
| vouchers | 314 |
| party_transactions | 119 |
| inventory_movements | 12 |
| salary_transactions | 8 |
| expenses | 63 |
| delivery_notices | 1 |
| document_sequences | 4 |
| print_jobs | 3 |
| restaurant_table_sessions | 3 |
| restaurant_table_requests | 1 |
| restaurant_table_request_items | 5 |
| reconciliation_marks | 1 |
| audit_logs | 160 |
| system_events | 38 |

Zero-row but migrated structurally:

- manufacturing_orders
- consignment_documents
- consignment_document_lines
- consignment_settlements
- consignment_settlement_lines
- warehouse_dispatch_notices
- warehouse_dispatch_notice_lines
- warehouse_dispatch_notice_line_decompositions
- stock_transfers
- party_transfers
- fiscal_periods
- fx_revaluation_runs
- fx_revaluation_lines
- attendance_records
- printers
- print_templates

## Reconciliation Results

Final reconciliation run passed fully.

Reference artifact:

- [postgres-phase4-reconciliation.json](/c:/Users/Homsi/Desktop/PostgreSQL%2016/temp/sqlite-to-postgres/reports/postgres-phase4-reconciliation.json)

### 1. Record Counts

Result: pass

- All `77` migrated tables matched exactly between SQLite and PostgreSQL on the final clean snapshot.

### 2. Financial Integrity

Result: pass

- SQLite posted journal totals:
  - debit: `307343.84`
  - credit: `307343.84`
- PostgreSQL posted journal totals:
  - debit: `307343.840000`
  - credit: `307343.840000`
- Account-level trial-balance aggregation mismatches: `0`

### 3. Party Balances

Result: pass

- Compared parties: `29`
- Snapshot balances matched exactly.
- Ledger-derived balances matched exactly.

### 4. Inventory Integrity

Result: pass

- Compared item snapshots: `187`
- Item quantity snapshots matched.
- Movement-derived net quantity matched.

### 5. Document-Level Sampling

Result: pass

Sampled:

- invoices: `5`
- vouchers: `5`
- consignment_documents: `0`
- manufacturing_orders: `0`

Notes:

- An earlier false negative was caused by validator canonicalization differences between SQLite floating-point artifacts and PostgreSQL numeric/date materialization.
- The validator was corrected to normalize PostgreSQL `date` values and numeric precision for business-equivalent comparison.

### 6. Restaurant Consistency

Result: pass

- Compared sessions: `3`
- Preliminary totals, linked final invoice IDs, and final invoice totals matched.

### 7. Reporting Validation

Result: pass

Validated summary parity on:

- top activity accounts
- top activity parties
- top activity inventory items

No mismatches were found in these trusted summary checks.

## Mismatches Found During Execution and Resolutions

### FK Ordering Failure During First Import Attempt

Issue:

- `invoices.journal_entry_id` failed against `journal_entries.id`

Cause:

- invoices were being imported before journal entries

Resolution:

- adjusted table import order so `journal_entries` and `journal_entry_lines` load before `invoices` and `vouchers`

### Legacy Invalid Date Data in SQLite

Issue:

- at least one `journal_entries.entry_date` value in SQLite was invalid (`'1'`)

Cause:

- legacy SQLite tolerated malformed text-date data

Resolution:

- transform layer now validates dates and derives safe fallback values only when PostgreSQL requires a valid non-null date/timestamp
- this was applied in migration tooling only, not by mutating SQLite source data

### Initial Reconciliation False Positives

Issue:

- sampled document comparison initially failed on PostgreSQL `date` materialization and float artifact differences

Resolution:

- reconciliation canonicalization now normalizes:
  - PostgreSQL `Date` objects to `YYYY-MM-DD`
  - numeric values to business-comparable precision

### Load Validation Polluting Snapshot Counts

Issue:

- the load smoke script executes real write flows, which increased row counts and invalidated strict snapshot count reconciliation when run afterward

Resolution:

- final reconciliation was executed after a clean `reset -> migrate -> phase4:migrate`
- this is now the required order for clean reconciliation after any mutating load test

## PostgreSQL Runtime Finalization

Completed in this phase:

- PostgreSQL is validated against the full migrated dataset.
- Load smoke no longer triggers the `pg` client sequencing deprecation warning.
- [backend/server.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/server.ts) no longer eagerly imports the SQLite seeding/repair module on PostgreSQL startup; that module is now loaded only on the SQLite startup path.

Still intentionally isolated, not active on PostgreSQL runtime:

- SQLite repair tooling
- SQLite diagnostics built on `PRAGMA` and `sqlite_master`
- SQLite-only seed/backfill helpers not needed for PostgreSQL request execution

## Commands Executed

Migration and validation commands used in this phase:

```powershell
npm run db:pg:reset
npm run db:pg:migrate
npm run db:pg:phase4:migrate
npm run db:pg:phase4:reconcile
npm run db:pg:phase4:load-smoke
npm run db:pg:boot-check
```

Important operational note:

- `db:pg:phase4:load-smoke` is mutating by design because it executes real backend validation flows.
- After running it, a clean snapshot reconciliation requires:

```powershell
npm run db:pg:reset
npm run db:pg:migrate
npm run db:pg:phase4:migrate
npm run db:pg:phase4:reconcile
```

## Performance and Basic Load Observations

Load smoke result:

- 3 concurrent PostgreSQL validation runs
- ports used: `3211`, `3212`, `3213`
- total duration: about `33.95s`
- all validation runs succeeded
- no remaining PostgreSQL client sequencing warning after script fix

Interpretation:

- local PostgreSQL handled concurrent end-to-end validation flows against the migrated dataset without deadlock or client misuse warning
- this is a basic smoke signal, not a production benchmark

## Known Limitations

- Manufacturing and consignment tables migrated structurally, but the current SQLite snapshot contains `0` rows in those document tables, so Phase 4 could not prove document-content parity for those modules from live source data.
- The load smoke script is intentionally mutating; it is suitable for runtime confidence but not for post-run snapshot-count comparison unless followed by reset and re-import.
- Legacy SQLite data quality issues still exist in the source snapshot. The migration pipeline currently tolerates and normalizes some of them; those source anomalies should still be cataloged before production cutover.

## Readiness Assessment

Current assessment: ready for the next planning phase toward Cloud SQL and controlled production cutover, with local PostgreSQL now validated as the primary backend data store.

What is ready:

- repeatable SQLite -> PostgreSQL migration pipeline
- full-table import for the current ERP dataset
- clean reconciliation across counts, accounting, party balances, inventory, sampled documents, restaurant linkage, and reporting summaries
- PostgreSQL local runtime boot validation on migrated data

What should happen next:

- prepare a production cutover runbook with freeze, backup, dry-run, and rollback steps
- prepare Cloud SQL environment parity and secure deployment workflow
- add deeper module-specific reconciliation for any future non-zero consignment/manufacturing datasets
- decide whether provisioning/setup flows should be reworked to remove the remaining dependency on legacy seed helper code entirely

What should not be done yet:

- do not delete the SQLite source database
- do not move directly to production
- do not start Cloud SQL cutover without repeating reconciliation on the exact production snapshot
