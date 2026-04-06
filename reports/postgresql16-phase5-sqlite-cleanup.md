# PostgreSQL 16 Phase 5: SQLite Legacy Artifact Cleanup

## Executive Summary

This cleanup removed obsolete SQLite-only backend artifacts after the PostgreSQL migration was completed and validated locally.

The removal scope was limited to:

- SQLite-only maintenance scripts
- SQLite-bound migration/reconciliation tooling that was only needed for the SQLite to PostgreSQL cutover
- SQLite-only tests
- package.json script entries that still exposed SQLite-first workflows

The cleanup did **not** touch:

- Android / Capacitor / local embedded SQLite paths under `src/lib/localDb/**`
- `android/**`
- `capacitor.config.ts`
- active backend PostgreSQL runtime code
- backend SQLite fallback/runtime files that are still imported or still needed for controlled legacy isolation

## Files Updated

- [package.json](/c:/Users/Homsi/Desktop/PostgreSQL%2016/package.json)
- [postgresql16-phase5-sqlite-cleanup.md](/c:/Users/Homsi/Desktop/PostgreSQL%2016/reports/postgresql16-phase5-sqlite-cleanup.md)

## Deleted Files

### SQLite-Only Scripts

- `scripts/check-schema.cjs`
- `scripts/db-add-item-columns.cjs`
- `scripts/db-backfill-party-ledger.cjs`
- `scripts/db-backup.cjs`
- `scripts/db-create-party-accounts.cjs`
- `scripts/db-doctor.cjs`
- `scripts/db-fix-vouchers.cjs`
- `scripts/db-migrate.cjs`
- `scripts/db-recompute-party-balances.cjs`
- `scripts/db-status.cjs`
- `scripts/ensure-consignment-accounts.cjs`
- `scripts/consignment-e2e-test.cjs`
- `scripts/consignment-final-e2e.cjs`
- `scripts/recovery-stuck-close.cjs`
- `scripts/generate-db-doc.ts`
- `scripts/detect-landed-cost-corruption.ts`
- `scripts/repair-critical-consistency.ts`
- `scripts/repair-critical-consistency.cjs`
- `scripts/tenant-scope-backfill.ts`

### SQLite-Bound Validation / Simulation Scripts

- `scripts/accounting-assertion-engine.ts`
- `scripts/full-erp-simulation.ts`
- `scripts/postgres-phase4-reconciliation.ts`

### One-Time Migration Tooling No Longer Needed After Cutover

- `scripts/sqlite-to-postgres/_shared.ts`
- `scripts/sqlite-to-postgres/export-sqlite.ts`
- `scripts/sqlite-to-postgres/transform-data.ts`
- `scripts/sqlite-to-postgres/import-postgres.ts`
- `scripts/sqlite-to-postgres/run-migration.ts`

### SQLite-Specific Tests

- `tests/super-admin-control.test.ts`
- `tests/textile-domain.integration.test.ts`
- `tests/accounting.simulation.test.ts`
- `tests/accounting.assertion.test.ts`

## Package Script Cleanup

Removed SQLite-oriented or SQLite-cutover-only npm commands:

- `server:sqlite`
- `db:generate`
- `db:push`
- `db:check`
- `db:backup`
- `db:doctor`
- `db:migrate`
- `db:status`
- `db:fix-vouchers`
- `db:repair-critical`
- `tenant:scope:backfill`
- `tenant:scope:backfill:apply`
- `simulation:reset`
- `simulation:run`
- `accounting:assert`
- `db:pg:phase4:export`
- `db:pg:phase4:transform`
- `db:pg:phase4:import`
- `db:pg:phase4:migrate`
- `db:pg:phase4:reconcile`

Adjusted PostgreSQL-primary entrypoints:

- `server:dev` now starts PostgreSQL by default
- `server` now starts PostgreSQL by default
- `electron:dev` now checks PostgreSQL schema status with `db:pg:check`
- `electron:dev:rebuild` now checks PostgreSQL schema status with `db:pg:check`

## Preserved SQLite Files

The following SQLite-related files were intentionally preserved because deleting them now would risk breaking active imports, controlled fallback behavior, or out-of-scope runtimes:

- [sqlite.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/sqlite.ts)
  - still imported by the backend dialect switch and legacy isolation path
- [schema.sqlite.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/schema.sqlite.ts)
  - still referenced by the backend schema bridge
- [seed-accounts.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/seed-accounts.ts)
  - still imported by active helper paths; contains SQLite-heavy compatibility code that should be refactored separately, not deleted blindly
- `src/lib/localDb/**`
  - explicitly out of scope
- `android/**`
  - explicitly out of scope
- `capacitor.config.ts`
  - explicitly out of scope

## Reports Cleanup Result

No existing files under `reports/` were deleted in this pass.

Reason:

- the remaining report set is now PostgreSQL migration history and operational evidence
- although some reports mention historical SQLite files, the report files themselves are not SQLite runtime artifacts
- preserving them keeps the migration trail auditable

## Validation Performed

### Build

```powershell
npm run build
```

Result:

- passed

### PostgreSQL Boot Check

```powershell
npm run db:pg:boot-check
```

Result:

- passed

### LAN Runtime Start

First attempt:

```powershell
npm run server:pg:lan
```

Observed result:

- failed fast because `NODE_ENV=production` requires `JWT_SECRET`
- this is expected security enforcement, not a SQLite cleanup regression

Validated runtime command:

```powershell
$env:SHAMEL_ENV_PROFILE='lan'
$env:NODE_ENV='production'
$env:DB_DIALECT='postgres'
$env:DATABASE_URL='postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg'
$env:JWT_SECRET='0123456789abcdef0123456789abcdef'
npx tsx backend/server.ts
```

Result:

- LAN-mode PostgreSQL server started successfully
- backend served from `http://0.0.0.0:3111`
- frontend static assets served from `dist`

### Auth + Voucher + Trial Balance Validation

Validated against the running LAN-mode PostgreSQL server:

- login: success
- authenticated receipt voucher create: success
- trial balance read: success

Validation result:

```json
{
  "success": true,
  "login": "admin",
  "receiptId": "cleanup-r-1775097823427",
  "trialBalanceLines": 88
}
```

## Additional Observations

- [ensure-admin-user.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/ensure-admin-user.ts) still triggers noisy SQLite-oriented warnings through [seed-accounts.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/db/seed-accounts.ts) when used on PostgreSQL.
- Those warnings did not block PostgreSQL validation, but they confirm that `seed-accounts.ts` still contains legacy cleanup debt and should be refactored in a separate task.
- Historical docs and reports still reference some deleted scripts. Those references are non-runtime and were left unchanged in this pass.

## Android / Local SQLite Scope Confirmation

Confirmed untouched:

- `src/lib/localDb/**`
- `android/**`
- `capacitor.config.ts`

This cleanup was restricted to backend/server-side SQLite legacy artifacts only.

## Outcome

After this cleanup:

- PostgreSQL remains the effective primary backend runtime
- obsolete SQLite scripts/tests no longer clutter the working backend toolchain
- generic developer startup scripts now point to PostgreSQL rather than silently defaulting to SQLite
- active backend runtime still builds, boots, starts in LAN mode, authenticates, writes a voucher, and reads trial balance successfully
