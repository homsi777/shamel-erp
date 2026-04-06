# PostgreSQL 16 Phase 2 Query Compatibility

## Executive Summary

Phase 2 moved the backend from "PostgreSQL can boot" to "core backend request flows execute meaningfully on PostgreSQL".

Implemented in this phase:

- Kept the backend-only scope strict. Android/Capacitor/local embedded SQLite was not modified and remains out of scope.
- Introduced a compatibility layer that lets active backend PostgreSQL query builders expose `.get()`, `.all()`, and `.run()` while internally using PostgreSQL-safe execution.
- Converted the highest-value synchronous SQLite-style transaction paths that were still blocking PostgreSQL request handling:
  - invoice settlement recomputation
  - voucher create/update/delete lifecycle
  - invoice create/rollback stock/accounting flow
  - restaurant QR guest session transaction
  - invoice stock toggle transaction
  - stock transfer transaction
- Added a PostgreSQL-only integration validation script that exercises real Fastify request handlers against local PostgreSQL 16.

Validated successfully on local PostgreSQL 16:

- auth login
- print job persistence
- restaurant table/session open flow
- invoice create with journal posting
- inventory movement creation from invoice flow
- system events read path
- core trial balance report

Net result: PostgreSQL request handling is now partially operational for core ERP flows, but broad route coverage is still incomplete.

## Scope Boundary

In scope in this phase:

- `backend/**`
- backend Drizzle runtime and query execution
- backend Fastify routes and backend business services
- local PostgreSQL 16 only

Explicitly excluded in this phase:

- `android/**`
- `src/lib/localDb/**`
- `src/lib/localRuntime.ts`
- Android/Capacitor/local embedded SQLite runtime
- Google Cloud SQL
- production cutover
- live SQLite data import

## Files Changed

- `backend/db/compat.ts`
- `backend/db/index.ts`
- `backend/accountingService.ts`
- `backend/inventoryService.ts`
- `backend/services/invoiceSettlement.ts`
- `backend/services/voucherLifecycle.ts`
- `backend/services/invoiceLifecycle.ts`
- `backend/services/restaurantService.ts`
- `backend/routes/invoices.routes.ts`
- `backend/routes/inventory.routes.ts`
- `backend/routes/generic.routes.ts`
- `backend/server.ts`
- `package.json`
- `scripts/postgres-phase2-validation.ts`

## What Changed

### 1. Dialect-safe query compatibility wrapper

`backend/db/compat.ts` now wraps backend Drizzle access so PostgreSQL-backed query builders can still satisfy legacy call sites that expect:

- `.get()`
- `.all()`
- `.run()`

This reduced surface-area churn while keeping PostgreSQL as the active backend target.

### 2. Async transaction conversion in critical business flows

The main blocker was not basic reads anymore. It was synchronous transaction callbacks that treated `.get()/.all()/.run()` as immediate values. Those were converted to PostgreSQL-safe async transaction flows in the highest-value backend paths.

Converted in this phase:

- `backend/services/invoiceSettlement.ts`
  - `recomputeInvoiceSettlementTx`
  - `recomputeInvoiceSettlement`
- `backend/services/voucherLifecycle.ts`
  - voucher rollback/restore helpers
  - voucher delete/update transaction paths
- `backend/server.ts`
  - `shouldApplyPartyLedgerForVoucher`
  - `createVoucherWithAccounting`
  - voucher rollback settlement sync
- `backend/services/invoiceLifecycle.ts`
  - invoice rollback transaction
  - invoice create transaction
  - item/unit/serial mutation path inside invoice creation
  - stock movement writes inside invoice creation
- `backend/services/restaurantService.ts`
  - `ensureQrGuestSessionForTable`
- `backend/routes/invoices.routes.ts`
  - invoice update item existence validation
  - purchase apply-stock toggle transaction
- `backend/routes/inventory.routes.ts`
  - warehouse transfer transaction
- `backend/routes/generic.routes.ts`
  - awaited party-ledger decision path

### 3. Query-surface parity fixes

Business-parity-preserving adjustments added during conversion:

- invoice item existence validation no longer relies on a synchronous SQLite predicate; it now preloads item existence asynchronously before validation
- invoice and voucher settlement updates now use awaited transaction writes, preserving previous business sequencing
- party ledger adjustments now await balance recomputation instead of depending on SQLite sync side effects
- invoice rollback now awaits stock reversal and serial status repair instead of assuming synchronous execution

### 4. PostgreSQL-only integration validation

Added `scripts/postgres-phase2-validation.ts`.

It seeds a minimal backend tenant on PostgreSQL and then exercises real backend routes through Fastify:

- `POST /api/login`
- `POST /api/print/jobs`
- `POST /api/restaurant/tables`
- `POST /api/restaurant/tables/:id/open-session`
- `POST /api/invoices`
- `GET /api/system-events`
- `GET /api/reports/trial-balance`

## Query-Surface Blocker Inventory Summary

### Fixed in this phase

| Area | File | SQLite-style blocker | PostgreSQL-safe replacement | Risk |
|---|---|---|---|---|
| Settlement | `backend/services/invoiceSettlement.ts` | sync `tx.select().get()` / `tx.select().all()` / `tx.update().run()` | awaited transaction queries | High |
| Voucher lifecycle | `backend/services/voucherLifecycle.ts` | sync rollback/restore transaction helpers | async transaction helpers with awaited reads/writes | High |
| Voucher accounting | `backend/server.ts` | sync `db.transaction((tx)=>...)` with ledger/cashbox mutations | async transaction callback + awaited settlement recompute | Critical |
| Invoice lifecycle | `backend/services/invoiceLifecycle.ts` | sync invoice create/rollback stock/accounting transaction | async transaction callback + awaited stock/item/serial mutations | Critical |
| Restaurant | `backend/services/restaurantService.ts` | sync QR guest session transaction | async session creation transaction | Medium |
| Invoice route | `backend/routes/invoices.routes.ts` | sync item existence predicate and stock-toggle transaction | async prefetch + awaited transaction | High |
| Inventory route | `backend/routes/inventory.routes.ts` | sync stock transfer transaction | awaited transfer transaction | High |

### Still deferred after this phase

These backend surfaces still contain SQLite-style synchronous transaction assumptions and were not required to get the validated PostgreSQL subset working:

| Group | Representative files | Current blocker | Deferred reason | Risk |
|---|---|---|---|---|
| Consignments | `backend/routes/consignments.routes.ts` | multiple sync transactions | outside Phase 2 core validation path | High |
| Opening flows | `backend/routes/opening.routes.ts` | sync transactions | not required for current PostgreSQL validation set | High |
| Delivery | `backend/routes/delivery.routes.ts` | sync transactions | not needed for current validated flows | Medium |
| Manufacturing | `backend/routes/manufacturing.routes.ts` | sync transactions | deferred business module | Medium |
| Parties | `backend/routes/parties.routes.ts` | sync transaction wrappers and callable transaction idioms | partially masked by compatibility wrapper but not fully migrated | Medium |
| Textile | `backend/routes/textile.routes.ts`, `backend/services/textileService.ts` | sync stock ledger mutation style | module-specific, deferred | High |
| Generic/admin ops | `backend/routes/generic.routes.ts`, `backend/routes/agents.routes.ts`, `backend/routes/biometric.routes.ts` | remaining sync transactions | lower priority to current validation | Medium |
| Reporting engine internals | `backend/services/reportingEngine.ts` | `rowid` ordering and raw-driver assumptions | trusted trial-balance path works, deeper reporting engine migration deferred | High |
| SQLite-only diagnostics/bootstrap | `backend/server.ts`, `backend/db/seed-accounts.ts` | `rawSqlite.prepare`, `PRAGMA`, `sqlite_master`, `last_insert_rowid`, `INSERT OR IGNORE` | SQLite path still retained for fallback/dev tools only | Medium |

## SQLite-Specific Patterns Removed or Isolated in Active PostgreSQL Paths

Removed from active validated PostgreSQL request paths:

- sync `.get()` assumption in transaction callbacks
- sync `.all()` assumption in transaction callbacks
- sync `.run()` assumption in transaction callbacks
- sync party-ledger recomputation side effects
- sync invoice settlement recomputation side effects

Still isolated but not yet broadly removed:

- `rawSqlite.prepare(...)`
- `PRAGMA`
- `sqlite_master`
- `last_insert_rowid()`
- `INSERT OR IGNORE`
- `rowid`

Those remaining patterns are currently confined to:

- SQLite fallback/bootstrap
- SQLite-only repair tools
- consistency guards
- some deferred reporting/admin surfaces

## Business-Parity Decisions

### Preserved behaviors

- invoice duplicate protection by source document remains intact
- cash invoice behavior still posts journal entries and linked voucher behavior in the same logical sequence
- stock application still happens in the same invoice transaction boundary
- voucher delete/update compensation flow still attempts to restore business state on failure
- restaurant session uniqueness per active table remains preserved
- party ledger mutations still occur only when the previous rules would have applied them

### Explicit parity-safe adjustments

- invoice validation now uses an async-preloaded existence set instead of a synchronous DB predicate; validation behavior remains the same
- invoice rollback and voucher rollback now await all DB mutations explicitly, preventing PostgreSQL from observing partially executed callback logic
- settlement recomputation now uses awaited reads/writes instead of SQLite sync assumptions, preserving monetary outcomes

### Known ambiguity surfaced in this phase

- `backend/services/textileService.ts` still uses synchronous transaction-style access internally. Non-textile invoice validation succeeded; textile-backed invoice parity is still a next-phase item.
- PostgreSQL emitted a `pg` deprecation warning about `client.query()` being invoked while a client was already busy during the full Phase 2 validation run. The flows succeeded, but this indicates remaining runtime sequencing pressure that should be cleaned up in the next phase.

## Validated PostgreSQL Flows

Validated with real backend request handlers against local PostgreSQL 16:

- backend startup on PostgreSQL
- login
- print job create
- restaurant table create
- restaurant session open
- invoice create
- journal entry linkage from invoice create
- inventory movement persistence from invoice create
- system events listing
- trial balance report

Validation evidence from `npm run db:pg:phase2-validate`:

- `invoiceJournalEntryId: 1`
- `inventoryMovementCount: 1`
- `restaurantSessionCount: 1`
- `printJobCount: 1`
- `systemEventCount: 2`
- `trialBalanceLineCount: 58`

## Exact Commands Executed

```powershell
npm run db:pg:boot-check
node --import tsx --test tests/print-jobs-hardening.test.ts
node --import tsx --test tests/restaurant-qr-hardening.test.ts
npm run db:pg:phase2-validate
npm run db:pg:boot-check
```

Environment used:

```powershell
DB_DIALECT=postgres
DATABASE_URL=postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg
JWT_SECRET=0123456789abcdef0123456789abcdef
QR_MENU_PORT=0
```

## Whether Backend Request Handling Now Works Meaningfully on PostgreSQL

Yes, for a real and useful subset.

This phase is no longer just a boot/readiness milestone. The backend now performs meaningful request-serving work on PostgreSQL for:

- auth/session establishment
- operational logging
- print job persistence
- restaurant session handling
- invoice creation with accounting
- inventory movement persistence
- basic accounting report retrieval

That is enough to confirm that PostgreSQL is now a viable active backend runtime for core local development and Phase 3 follow-up work.

## Remaining Blockers for Next Phase

1. Remaining sync transaction blocks across deferred modules:
   - consignments
   - opening balances/stock
   - delivery
   - manufacturing
   - textile
   - selected parties/admin/generic routes

2. Raw SQLite-only backend utilities still present:
   - `backend/server.ts` consistency guards
   - `backend/db/seed-accounts.ts` SQLite-only seed/repair paths
   - SQLite fallback bootstrap internals

3. Reporting engine still contains SQLite-specific assumptions:
   - `rowid` ordering
   - raw-driver expectations in `backend/services/reportingEngine.ts`

4. PostgreSQL client sequencing cleanup:
   - the Phase 2 validation run emitted a `pg` deprecation warning about overlapping client query execution
   - no flow failed, but this should be removed before broadening route coverage

5. Textile-specific inventory/accounting path remains unconverted:
   - `backend/services/textileService.ts`
   - textile routes and textile invoice variants

6. Legacy startup/reporting messages and docs should keep being updated as more modules move off SQLite assumptions.

## Conclusion

Phase 2 succeeded for the backend-only PostgreSQL objective.

PostgreSQL is now doing real backend work locally, not just passing a connectivity check. The converted request paths cover the most important business confidence areas for this phase: auth, operational persistence, restaurant session handling, invoice posting, inventory movement creation, system-event visibility, and a core accounting report.

The next phase should focus on the remaining transaction-heavy deferred modules and the remaining SQLite-only reporting/utility surfaces, not on Android, Cloud SQL, or live data migration.
