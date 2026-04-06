# Android SQLite Schema Contract - Initial Implementation (v1)

## Scope and Constraints
- Stack: React + TypeScript + Capacitor Android.
- DB engine: `@capacitor-community/sqlite`.
- Phase 1 goal: full offline local operation on Android.
- This document defines contract-to-schema implementation only.
- Out of scope here: sync, packaging, backend PostgreSQL changes, feature redesign.

## 1) v1 Initial Schema (Must Exist Now)

### Included domains in migration v1
1. `companies`, `branches`, `users`  
   Why now: app shell, access context, and ownership scoping depend on them.
2. `app_settings`  
   Why now: business/app configuration must persist offline in relational contract form. Device-only tiny flags remain in Capacitor Preferences.
3. `parties`  
   Why now: customers/suppliers are core to sales/purchase and invoice flows.
4. `item_units`, `item_categories`, `items`, `warehouses`  
   Why now: core inventory master data baseline.
5. `inventory_balances`, `inventory_movements`  
   Why now: offline stock correctness needs both current balance and auditable movement history.
6. `invoices`, `invoice_lines`  
   Why now: full offline ERP baseline requires transactional sales/purchase records.
7. `print_profiles`  
   Why now: print behavior is operationally required in offline APK.
8. `schema_migrations`  
   Why now: forward-only migration governance.

### Deferred to v2+ (intentional)
1. Session/auth token cache tables  
   Decision: **defer**; use Capacitor Preferences for small auth/session key-values in phase 1.
2. Accounting deep ledger tables (`accounts`, `journal_entries`, `vouchers`, etc.)  
   Decision: **defer**; large domain with additional balancing invariants. Add in v2 migration set with dedicated contract review.
3. Restaurant operational tables (tables/sessions/orders/kitchen tickets)  
   Decision: **defer**; module-specific with many workflow constraints.
4. Delivery notices/approvals specialized tables  
   Decision: **defer**; derive from core movement/invoice references first.
5. `local_outbox`, `sync_queue`, `sync_log`, `sync_conflicts`, `replication_cursor`  
   Decision: **defer**; sync is phase 2 and explicitly out of current scope.
6. `local_print_jobs` audit/history  
   Decision: **defer**; baseline print profile is enough for v1 foundation.
7. Extended lookup/reference catalogs (tax tables, reason codes, etc.)  
   Decision: **defer**; introduce only when first dependent workflow lands.

## 2) Migration v1 SQL Draft (Executable Structure)
- File: `src/lib/androidDb/migrations/0001_initial_contract.sql`
- Runtime source: `src/lib/androidDb/migrations/v0001_initialContract.ts`

### Contract rules applied in v1 SQL
- `snake_case` naming.
- `local_id INTEGER PRIMARY KEY AUTOINCREMENT` for local PK.
- `uid TEXT NOT NULL UNIQUE` for sync-relevant domain tables.
- Money fields use integer minor units (`*_minor`).
- Non-money decimals use scaled integers (`*_milli`, scale = 1000).
- Boolean discipline: `INTEGER` + `CHECK (col IN (0,1))`.
- Timestamps/dates: ISO text fields (`TEXT`) with explicit `created_at`, `updated_at`, `issue_date`, etc.
- Foreign keys and unique constraints are explicit.
- `STRICT` tables used.

## 3) Domain Inclusion/Deferral Decisions

| Domain | Decision | Rationale |
|---|---|---|
| app/device settings | Include (`app_settings`) + Preferences for tiny key-values | relational app settings belong in DB; lightweight device flags stay in Preferences |
| session/auth-local context | Defer table | keep in Preferences in v1 to avoid duplicate state authority |
| companies | Include | tenant root |
| branches | Include | operational scope |
| users | Include | role/access attribution |
| customers/suppliers/partners | Include `parties` now, defer partners split | cover core sales/purchase with minimal schema |
| items/materials | Include | inventory core |
| item units | Include | quantity semantics |
| warehouses | Include | stock location scope |
| inventory balances | Include | current stock state |
| inventory movements | Include | audit trail + stock correctness |
| invoices | Include | transactional core |
| invoice lines | Include | transactional detail |
| statuses/lookups/reference tables | Defer dedicated tables | encode minimal status with CHECK in v1 |
| restaurant operational tables | Defer | module-specific, non-foundational for first contract migration |
| print configuration | Include `print_profiles` | required operationally in offline runtime |
| outbox/sync queue/logs | Defer | phase 2 sync scope only |

## 4) Migration System Structure

### Proposed files
- `src/lib/androidDb/database.ts`  
  Connection bootstrap + migration invocation.
- `src/lib/androidDb/sqlitePragmas.ts`  
  PRAGMA enforcement.
- `src/lib/androidDb/migrations/index.ts`  
  Forward-only migration runner + tracking.
- `src/lib/androidDb/migrations/v0001_initialContract.ts`  
  Runtime SQL for v1.
- `src/lib/androidDb/migrations/0001_initial_contract.sql`  
  Human-readable SQL draft.

### Naming convention
- Migration code file: `vNNNN_description.ts`
- SQL draft file: `NNNN_description.sql`
- Migration record: `schema_migrations.version` integer monotonic.

### Tracking applied versions
- Table `schema_migrations(version, name, applied_at)`.

### App-start bootstrap flow
1. Open SQLite connection.
2. Apply PRAGMA rules (`foreign_keys=ON`, `journal_mode=WAL`, etc.).
3. Ensure migration table exists.
4. Run unapplied migrations in ascending version.
5. Record each migration in `schema_migrations` in same transaction.

### Failure handling
- Each migration runs inside a transaction.
- On any error: rollback and throw explicit failure error.
- No partial migration commit.

### Forward-only discipline
- Never edit already shipped migration versions.
- Any schema change must be a new `vNNNN` migration.

## 5) Canonical Schema Source Strategy
- Source of truth: **single shared domain schema contract document** (contract-first).
- Hand-maintained:
  - Domain naming contract (tables/columns/IDs/enums).
  - SQLite migration files (`vNNNN`).
- Generated or validated:
  - parity checklist against PostgreSQL schema snapshots before merge.
- DB change acceptance gate:
  1. Contract update.
  2. New migration file.
  3. Drift review against PostgreSQL naming/identity rules.

## 6) Proposed Android DB Layer File Structure

```text
src/lib/androidDb/
  index.ts
  database.ts
  sqlitePragmas.ts
  migrations/
    index.ts
    v0001_initialContract.ts
    0001_initial_contract.sql

docs/database/
  android-sqlite-schema-contract-v1.md
```

## 7) Minimal Next Implementation Steps (after approval)
1. Wire `getAndroidDb()` into Android runtime startup path only (no desktop/web behavior change).
2. Add repository layer incrementally over v1 tables (starting with companies/branches/users/items/invoices).
3. Add migration v0002 for next approved domain block (accounting or restaurant), not mixed together.
4. Add CI check: validate no migration gap and no duplicate version numbers.

## 8) Important Design Choices Locked by v1
- Dual-key identity (`local_id` + `uid`) is mandatory for sync-relevant tables.
- Money is stored only as integer minor units.
- Non-money decimal precision uses integer milli scaling.
- No sync tables in v1.

## Codex Suggestions for Discussion
- Must be in v1: tenant scope + core masters + inventory state/movements + invoices/lines + print profile + migration ledger.
- Must be deferred: sync/outbox tables, deep accounting ledger, full restaurant-specific table graph.
- Highest-impact anti-drift decision: enforce `uid` + naming parity contract review before any PostgreSQL or SQLite schema change is merged.
