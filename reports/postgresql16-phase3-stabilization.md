# PostgreSQL 16 Phase 3 Stabilization

## Executive Summary

Phase 3 moved the backend PostgreSQL path from "core subset works" to "major backend runtime modules execute on PostgreSQL with async-safe transaction flow". The main implementation focus was removing remaining synchronous SQLite-style transaction assumptions from active request-serving backend code, fixing document-number sequencing for PostgreSQL transactions, and stabilizing write ordering across transaction-heavy modules.

Android/Capacitor/local embedded SQLite was intentionally excluded and was not touched in this phase.

## What Phase 3 Achieved

- Converted shared document sequencing to an async PostgreSQL-safe transaction path.
- Removed remaining non-async `db.transaction(...)` usage from active backend request routes.
- Converted deferred transaction-heavy modules to `await db.transaction(async (tx) => ...)` patterns.
- Replaced active `rowid` ordering in the reporting engine with deterministic `id` ordering.
- Re-validated PostgreSQL boot and core backend validation flow on local PostgreSQL 16.
- Kept SQLite-only repair/seed/diagnostic logic isolated outside the PostgreSQL runtime path.

## Modules Converted In This Phase

### Fully converted active transaction/request paths

- `backend/routes/consignments.routes.ts`
- `backend/routes/opening.routes.ts`
- `backend/routes/delivery.routes.ts`
- `backend/routes/manufacturing.routes.ts`
- `backend/routes/textile.routes.ts`
- `backend/routes/parties.routes.ts`
- `backend/routes/generic.routes.ts`
- `backend/routes/agents.routes.ts`
- `backend/routes/inventory.routes.ts`
- `backend/routes/biometric.routes.ts`

### Shared/backend support updated

- `backend/routes/_common.ts`
- `backend/services/invoiceLifecycle.ts`
- `backend/services/reportingEngine.ts`
- `backend/server.ts`

## Files Changed In This Phase

- `backend/routes/_common.ts`
- `backend/routes/agents.routes.ts`
- `backend/routes/biometric.routes.ts`
- `backend/routes/consignments.routes.ts`
- `backend/routes/delivery.routes.ts`
- `backend/routes/generic.routes.ts`
- `backend/routes/inventory.routes.ts`
- `backend/routes/invoices.routes.ts`
- `backend/routes/manufacturing.routes.ts`
- `backend/routes/opening.routes.ts`
- `backend/routes/parties.routes.ts`
- `backend/routes/textile.routes.ts`
- `backend/services/invoiceLifecycle.ts`
- `backend/services/reportingEngine.ts`
- `backend/server.ts`

## Transaction Integrity Improvements

### 1. Shared document sequencing

`getNextDocNumber()` in `backend/routes/_common.ts` was still synchronous and unsafe for PostgreSQL transaction execution. It is now async and all active callers were updated to `await` it:

- invoices
- opening
- textile dispatch/invoice conversion
- consignments
- invoice-linked voucher creation

This removes one of the main PostgreSQL client sequencing hazards from the request path.

### 2. Async-safe transaction callbacks

Active request handlers no longer depend on SQLite-style synchronous transaction callbacks. The converted routes now use:

```ts
await db.transaction(async (tx) => {
  // awaited reads/writes
})
```

This was applied across:

- consignments document create/update/post/cancel
- consignment settlement create/update/post/cancel
- opening receivables and opening party balance persistence
- delivery confirm and rollback compensation
- manufacturing process posting
- textile preparation
- party balance recomputation
- generic opening-balance side effects
- agent transfer / party transfer / biometric ingest

### 3. Remaining document recomputation inside transactions

Consignment remaining-quantity recomputation previously relied on a sync helper tailored for SQLite callbacks. It was replaced with an async transaction-safe helper:

- `computeDocumentRemainingInTx(...)`

This keeps consignment document/settlement balance updates inside PostgreSQL transaction boundaries without relying on SQLite callback behavior.

## Reporting Engine Changes

The active SQLite-only `rowid` ordering in `backend/services/reportingEngine.ts` was removed:

- `ORDER BY created_at ASC, rowid ASC`
- replaced with `ORDER BY created_at ASC, id ASC`

This was applied to:

- party ledger detail ordering
- stock movement ordering

This removes an explicit SQLite-only ordering dependency from active report internals.

## PostgreSQL Client Sequencing Fixes

The main sequencing risk in Phase 2 was overlapping or un-awaited work inside transaction callbacks. The phase addressed that by:

- converting transaction callbacks to async
- awaiting `tx.select(...).get()`
- awaiting `tx.select(...).all()`
- awaiting `tx.insert(...).run()`
- awaiting `tx.update(...).run()`
- awaiting `tx.delete(...).run()`
- awaiting transactional service calls such as:
  - `applyPartyTransaction(...)`
  - `recomputePartyBalance(...)`
  - `adjustItemStockWithMovement(...)`

Validation runs after these changes completed without the earlier PostgreSQL sequencing warning surfacing.

## SQLite-Specific Patterns Removed Or Isolated

### Removed from active backend request execution

- synchronous `db.transaction((tx) => ...)` usage in active routes
- synchronous document-number reservation
- active `rowid` ordering in reporting internals

### Still present, but isolated outside PostgreSQL runtime

- `rawSqlite.prepare(...)` in `backend/server.ts`
  - PostgreSQL startup path already skips these consistency guards
- SQLite DDL/bootstrap internals in `backend/db/sqlite.ts`
  - SQLite-only fallback path
- SQLite-heavy seed/repair logic in `backend/db/seed-accounts.ts`
  - not used by PostgreSQL runtime

## Validation Executed

### PostgreSQL boot

Command:

```powershell
npm run db:pg:boot-check
```

Result:

- server booted successfully on PostgreSQL
- PostgreSQL bootstrap path validated

### PostgreSQL runtime validation

Command used to avoid an occupied dev port:

```powershell
$env:DB_DIALECT='postgres'
$env:DATABASE_URL='postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg'
$env:JWT_SECRET='0123456789abcdef0123456789abcdef'
$env:QR_MENU_PORT='0'
$env:SERVER_PORT='3211'
npx tsx scripts/postgres-phase2-validation.ts
```

Result:

- success: `true`
- invoice journal entry created
- inventory movement recorded
- restaurant session recorded
- print job recorded
- system events returned
- trial balance returned non-empty rows

Observed output snapshot:

```json
{
  "success": true,
  "invoiceJournalEntryId": 3,
  "inventoryMovementCount": 1,
  "restaurantSessionCount": 1,
  "printJobCount": 1,
  "systemEventCount": 2,
  "trialBalanceLineCount": 58
}
```

## Remaining SQLite Dependencies

These still exist in the repository, but are not part of the active PostgreSQL runtime path:

- `backend/server.ts`
  - SQLite-specific diagnostics / consistency guards using `rawSqlite.prepare(...)`
- `backend/db/seed-accounts.ts`
  - SQLite-only seed/repair logic using:
    - `PRAGMA`
    - `sqlite_master`
    - `last_insert_rowid()`
    - `INSERT OR IGNORE`
    - `rowid`
- `backend/db/sqlite.ts`
  - SQLite-only bootstrap and schema helpers

## Behavior Differences / Notes

- The main backend runtime now treats PostgreSQL as the intended primary backend execution path.
- A validation run initially failed due to port `3111` already being in use. Re-running on `SERVER_PORT=3211` succeeded; this was operational, not a database compatibility failure.
- Startup messaging was updated to reflect that the main backend runtime now runs on PostgreSQL, while SQLite-only diagnostics/repair tooling remain isolated.

## Remaining Blockers For Next Phase

### 1. Reporting engine still needs deeper PostgreSQL cleanup

`backend/services/reportingEngine.ts` still contains older raw SQL / `db.prepare(...)` style internals in some report functions. Trial balance is validated, but broader party/inventory report coverage should be completed in the next phase.

### 2. SQLite-only seed/repair tooling remains to be split cleanly

`backend/db/seed-accounts.ts` is still SQLite-oriented and should be explicitly separated into:

- SQLite-only utilities
- PostgreSQL-safe migration-time diagnostics / setup utilities

### 3. SQLite diagnostics in startup remain intentionally isolated, not migrated

`backend/server.ts` still contains SQLite-specific integrity checks. They are already skipped in PostgreSQL mode, but the next phase should decide whether to:

- port them to PostgreSQL-safe diagnostics
- or retire them entirely

### 4. Broader PostgreSQL report-path validation still needed

Phase 3 validated:

- boot
- auth-adjacent request flow
- invoice + accounting
- inventory movement
- restaurant session
- print jobs
- system events
- trial balance

Next phase should extend validation to:

- consignment create/post/settlement/cancel
- opening receivables / opening balances
- delivery confirm
- manufacturing process
- textile dispatch prepare/convert
- additional report routes

## Scope Confirmation

This phase was backend/server only.

Explicitly out of scope and untouched:

- `android/**`
- Android/Capacitor/local embedded SQLite runtime
- Cloud SQL / Google Cloud deployment work
- live SQLite data migration/import
- production cutover
