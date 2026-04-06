# PostgreSQL 16 Phase 0 / Phase 1 Implementation

## Scope Boundary

### In scope in this phase

- Backend/server runtime only.
- Dialect-aware backend DB bootstrap.
- Local PostgreSQL 16 connection, schema baseline, and migration workflow.
- PostgreSQL-safe backend startup path.
- Temporary SQLite fallback for backend development comparison only.

### Explicitly excluded in this phase

- Android/Capacitor/local embedded SQLite.
- Mobile offline/local runtime.
- Any refactor of `src/lib/localDb/**`.
- Any refactor of `src/lib/localRuntime.ts`.
- Any change under `android/**`.
- Google Cloud SQL migration/cutover.

This implementation intentionally does **not** treat Android/local SQLite as a blocker for backend PostgreSQL Phase 0 / Phase 1.

## Local PostgreSQL Choice

- Local database name chosen: `shamel_erp_pg`
- Local admin connection used for create/reset scripts: `postgresql://postgres:12345678@127.0.0.1:5432/postgres`
- Local backend runtime connection used for PostgreSQL path: `postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg`

## What Changed

### 1. Backend DB dialect switching was introduced

- New backend config authority: [config.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/config.ts)
- Active backend dialect is now controlled by `DB_DIALECT`.
- Supported values for this phase:
  - `DB_DIALECT=postgres`
  - `DB_DIALECT=sqlite`
- `DATABASE_URL` is now required when `DB_DIALECT=postgres`.
- SQLite fallback remains available, but only as a temporary backend comparison path.

### 2. Backend runtime bootstrap was split by dialect

- New PostgreSQL runtime: [postgres.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/postgres.ts)
- Legacy SQLite fallback isolated in: [sqlite.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/sqlite.ts)
- Runtime selector now lives in: [index.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/index.ts)

The backend no longer hard-wires `better-sqlite3` directly through the shared `backend/db/index.ts` entrypoint.

### 3. Canonical PostgreSQL schema path was introduced

- SQLite schema preserved as fallback: [schema.sqlite.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/schema.sqlite.ts)
- PostgreSQL schema introduced: [schema.pg.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/schema.pg.ts)
- Runtime schema facade preserved for existing imports: [schema.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/schema.ts)
- Generator used to fork/update the PostgreSQL schema path: [generate-pg-backend-schema.mjs](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/generate-pg-backend-schema.mjs)

### 4. PostgreSQL baseline migration chain was introduced

- PostgreSQL Drizzle config: [drizzle-pg.config.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/drizzle-pg.config.ts)
- Generated PostgreSQL baseline migration directory: [backend/drizzle-pg](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/drizzle-pg)
- First baseline migration generated:
  - [0000_blue_forgotten_one.sql](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/drizzle-pg/0000_blue_forgotten_one.sql)
- Applied migration tracking table in PostgreSQL:
  - `__backend_pg_migrations`

Historical SQLite migration files under `backend/drizzle/**` were **not** replayed against PostgreSQL.

### 5. PostgreSQL-safe backend startup gating was added

- Backend startup now verifies PostgreSQL connectivity and readiness before boot.
- PostgreSQL startup fails fast if the baseline migration table is missing.
- PostgreSQL startup now skips SQLite-only startup mutation and repair paths.

### 6. Local PostgreSQL developer workflow was added

New scripts:

- `npm run db:pg:create`
- `npm run db:pg:reset`
- `npm run db:pg:sync-schema`
- `npm run db:pg:generate`
- `npm run db:pg:check`
- `npm run db:pg:migrate`
- `npm run db:pg:status`
- `npm run db:pg:boot-check`
- `npm run server:pg`
- `npm run server:sqlite`

## Files Added / Updated

### Added

- [config.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/config.ts)
- [postgres.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/postgres.ts)
- [schema.pg.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/schema.pg.ts)
- [schema.sqlite.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/schema.sqlite.ts)
- [drizzle-pg.config.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/drizzle-pg.config.ts)
- [db-pg-create.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/db-pg-create.ts)
- [db-pg-reset.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/db-pg-reset.ts)
- [db-pg-migrate.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/db-pg-migrate.ts)
- [db-pg-status.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/db-pg-status.ts)
- [db-pg-boot-check.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/db-pg-boot-check.ts)
- [generate-pg-backend-schema.mjs](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/generate-pg-backend-schema.mjs)
- [0000_blue_forgotten_one.sql](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/drizzle-pg/0000_blue_forgotten_one.sql)

### Updated

- [index.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/index.ts)
- [schema.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/schema.ts)
- [sqlite.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/sqlite.ts)
- [server.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/server.ts)
- [serverConfig.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/lib/serverConfig.ts)
- [package.json](/c:/Users/Homsi/Desktop/PostgreSQL%2016/package.json)
- [package-lock.json](/c:/Users/Homsi/Desktop/PostgreSQL%2016/package-lock.json)

## Backend SQLite Couplings Isolated In This Phase

### Isolated successfully for the PostgreSQL path

- `better-sqlite3` hard-wiring in the shared backend DB entrypoint.
- SQLite path resolution as the only backend configuration model.
- SQLite bootstrap assumptions in shared startup.
- `PRAGMA` / SQLite file bootstrap from the PostgreSQL runtime path.
- Runtime schema mutation on PostgreSQL startup.
- Reuse of SQLite historical migration SQL for PostgreSQL.

### Specifically disabled on PostgreSQL startup

- `ensureDatabaseColumns(...)` from [seed-accounts.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/seed-accounts.ts)
- `seedAccounts(...)`
- `seedDefaultCashBox(...)`
- `seedDefaultWarehouse(...)`
- `seedDefaultParties(...)`
- `ensureAllPartyAccountLinks(...)`
- `fixPartyOpeningBalanceJournalEntries(...)`
- `backfillJournalLinePartnerRefs(...)`
- `backfillInvoiceClientNames(...)`
- `backfillPurchaseDerivedItemPricing(...)`
- `seedActivationCodes(...)`
- SQLite file-size / row-count startup probe
- `ensureReportingIndexes(rawSqlite)`
- `ensurePrintJobsAuditColumnsOnce()`
- `startConsistencyGuards()`

These are still technical debt, but they are no longer part of the PostgreSQL bootstrap path.

## PostgreSQL Schema Direction Established

The new PostgreSQL schema baseline reflects the intended direction for the backend server path:

- Financial and quantity values now map to PostgreSQL `numeric(18, 6)` instead of SQLite `REAL`.
- Boolean flags now map to native PostgreSQL `boolean`.
- Audit/event timestamps now map to `timestamp with time zone`.
- Business dates now map toward PostgreSQL `date`.
- Integer auto-increment keys on accounting tables now map to PostgreSQL `serial`.

This is the schema direction for PostgreSQL work going forward.

## Exact Env / Config Expected Now

### PostgreSQL backend path

```env
DB_DIALECT=postgres
DATABASE_URL=postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg
JWT_SECRET=0123456789abcdef0123456789abcdef
QR_MENU_PORT=0
```

### SQLite backend fallback path

```env
DB_DIALECT=sqlite
DB_PATH=./data/shamel.db
```

## Exact Commands Used And Validated

### Database creation

```powershell
npm run db:pg:create
```

Observed result:

- `shamel_erp_pg` created successfully.

### PostgreSQL baseline generation

```powershell
npm run db:pg:generate
```

Observed result:

- Generated baseline migration in `backend/drizzle-pg/0000_blue_forgotten_one.sql`

### PostgreSQL baseline apply

```powershell
npm run db:pg:migrate
```

Observed result:

- Baseline migration applied successfully to `shamel_erp_pg`

### Migration chain validation

```powershell
npm run db:pg:check
```

Observed result:

- `Everything's fine`

### PostgreSQL status verification

```powershell
npm run db:pg:status
```

Observed result:

- dialect: `postgres`
- database: `shamel_erp_pg`
- migration table present: `__backend_pg_migrations`
- public table count observed: `78`

### Backend boot validation against PostgreSQL

```powershell
npm run db:pg:boot-check
```

Observed result:

- Backend started against PostgreSQL.
- PostgreSQL readiness check passed.
- Server closed cleanly after boot check.

### Negative-path validation

A clean PostgreSQL database without the baseline migration was checked separately.

Observed result:

- Startup readiness failed with:
  - `PostgreSQL schema is not initialized. Run the local PostgreSQL baseline workflow before starting the server. Expected migration table: __backend_pg_migrations.`

## Local Developer Workflow Now

### Fresh local PostgreSQL baseline

```powershell
npm run db:pg:create
npm run db:pg:sync-schema
npm run db:pg:migrate
npm run db:pg:check
npm run db:pg:status
npm run db:pg:boot-check
```

### Reset local PostgreSQL database

```powershell
npm run db:pg:reset
npm run db:pg:migrate
npm run db:pg:boot-check
```

### Start backend against PostgreSQL

```powershell
npm run server:pg
```

### Fall back temporarily to backend SQLite

```powershell
npm run server:sqlite
```

## What Remains Blocked For The Next Phase

### Critical Phase 2 blocker

The backend query surface is still largely written against the synchronous SQLite Drizzle API:

- `.get()`
- `.all()`
- `.run()`

This pattern exists broadly across backend routes and services and is not yet PostgreSQL-compatible. PostgreSQL boot now works, but full request execution does **not** yet have parity.

### Major remaining backend blockers

- [seed-accounts.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/seed-accounts.ts) still contains extensive SQLite-only runtime DDL and raw `PRAGMA` usage.
- Backup/restore flows remain SQLite-file oriented.
- Reporting/trusted reporting paths still rely on `rawSqlite` assumptions.
- Print-job audit hardening still assumes SQLite column self-repair.
- Consistency guards are still SQLite/raw-SQL oriented.
- Server route handlers and services still need async PostgreSQL Drizzle adaptation.

## Phase 0 / Phase 1 Acceptance Status

### Achieved

- Backend/server can boot against local PostgreSQL 16.
- PostgreSQL connection is real and was validated locally.
- PostgreSQL startup path no longer depends on SQLite `PRAGMA`/runtime repair behavior.
- PostgreSQL migration baseline path exists and was applied locally.
- Android/local embedded SQLite was excluded from implementation and validation.
- Historical SQLite migration files were not reused for PostgreSQL.

### Not achieved yet

- Full backend request compatibility on PostgreSQL.
- PostgreSQL replacements for the legacy SQLite startup repair/backfill toolchain.
- PostgreSQL-safe replacements for SQLite-file backup/restore routes.

## Explicit Android Exclusion Confirmation

This phase did **not** modify or migrate:

- [database.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/lib/localDb/database.ts)
- [migrations.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/lib/localDb/migrations.ts)
- [localRuntime.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/lib/localRuntime.ts)
- [capacitor.config.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/capacitor.config.ts)
- `android/**`

Those paths remain out of scope for backend PostgreSQL Phase 0 / Phase 1.
