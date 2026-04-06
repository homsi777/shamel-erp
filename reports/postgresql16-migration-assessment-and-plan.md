# PostgreSQL 16 Migration Assessment And Plan

Assessment date: 2026-04-01

Target path:

1. Local PostgreSQL 16 first
2. Google Cloud SQL for PostgreSQL 16 later

Scope of this document:

- Evidence-driven assessment only
- No broad code migration started
- No broad schema rewrite started
- No cloud cutover performed

## 1. Executive summary

Recommended migration strategy: `PostgreSQL-first cutover with one-time migration tooling`, executed in phases, after a bounded hardening period on local PostgreSQL 16.

Why this is recommended:

- The codebase is deeply SQLite-coupled, but not in a way that justifies a long dual-write period.
- Dual-support at runtime would materially increase risk in accounting, inventory, restaurant queueing, and printing flows.
- The current migration history and operational tooling are SQLite-specific enough that PostgreSQL needs its own clean baseline and import path.
- Existing tests and business simulations are already rich enough to validate a controlled cutover once the DB abstraction and schema are prepared.

What should be done first:

1. Freeze runtime schema mutation and identify one canonical schema authority.
2. Build a PostgreSQL 16-compatible schema baseline and local bootstrap path.
3. Normalize critical type mismatches, especially accounting amounts and journal-link IDs.
4. Stand up a PostgreSQL-backed integration test path and run accounting, restaurant, monitoring, and printing regressions against it.

What should explicitly **not** be done yet:

- Do not attempt a production or Cloud SQL cutover.
- Do not try to replay existing SQLite SQL migrations directly against PostgreSQL.
- Do not introduce a long-lived dual-write system.
- Do not mass-add foreign keys and strict constraints before data cleanup and reconciliation rules are defined.

## 2. Assessment method and evidence base

This assessment was produced by inspecting the live repository and the current SQLite database state.

Primary evidence reviewed:

- `backend/db/index.ts`
- `backend/db/schema.ts`
- `drizzle.config.ts`
- `backend/server.ts`
- `backend/services/reportingEngine.ts`
- `backend/services/invoiceLifecycle.ts`
- `backend/inventoryService.ts`
- `backend/services/companyProvisioningService.ts`
- `backend/services/queueService.ts`
- `backend/services/printJobService.ts`
- `backend/db/seed-accounts.ts`
- `backend/drizzle/*.sql`
- `src/lib/localDb/*`
- `src/lib/localRuntime.ts`
- test suites under `tests/`

Runtime evidence from `data/shamel.db`:

- `PRAGMA integrity_check` returned `ok`
- `PRAGMA foreign_key_check` returned `0` violations
- Approximate current row counts:
  - `invoices`: 184
  - `vouchers`: 314
  - `journal_entries`: 193
  - `journal_entry_lines`: 387
  - `items`: 187
  - `inventory_movements`: 12
  - `system_events`: 38
  - `restaurant_table_sessions`: 3
  - `print_jobs`: 3
- Operational drift checks on current data:
  - stock drift rows: `0`
  - party balance drift rows: `0`
  - non-zero invoices missing journal link: `0`
  - non-zero vouchers missing journal link: `308`

That last point matters. SQLite engine integrity is currently clean, but business-rule strictness is not yet where PostgreSQL should become the enforcement boundary.

## 3. Current architecture summary

The backend is a Node/Fastify application using Drizzle ORM on top of `better-sqlite3`. The current deployment model is local-first and file-based. The system also contains a second SQLite persistence model for Android via Capacitor.

Important architectural properties:

- There is not one DB model, but at least three:
  - canonical backend Drizzle schema in `backend/db/schema.ts`
  - runtime bootstrap/schema repair logic in `backend/db/index.ts`
  - large runtime DDL/column-addition logic in `backend/db/seed-accounts.ts`
- Operational tooling, backup tooling, doctor tooling, and schema exports are all SQLite-specific.
- Reporting mixes Drizzle and raw SQL, with multiple queries written directly against SQLite behavior.
- Accounting, inventory, provisioning, restaurant, printing, and monitoring all persist directly to the same backend SQLite file.
- Android local runtime is separately SQLite-backed and highly denormalized.

Conclusion: this is a serious migration, but still an evolutionary migration, not a rewrite.

## 4. Current database coupling inventory

The full detailed inventory is in:

- `reports/postgresql16-query-risk-register.md`
- `reports/postgresql16-schema-compatibility-matrix.md`

The most important coupling categories are summarized below.

### 4.1 ORM and connection bootstrap

Evidence:

- `backend/db/index.ts:2-56`
- `drizzle.config.ts:1-10`
- `package.json:27-31`

Findings:

- Runtime is hard-bound to `better-sqlite3`.
- DB resolution is file-path based, not DSN based.
- Startup depends on SQLite pragmas:
  - `journal_mode = WAL`
  - `foreign_keys = ON`
- Drizzle generation/check/push are SQLite-specific.

Risk: `Critical`

PostgreSQL approach:

- introduce explicit database dialect configuration
- use a PostgreSQL driver and PostgreSQL Drizzle config
- replace SQLite pragmas with PostgreSQL-native configuration and migrations

### 4.2 Schema authority fragmentation

Evidence:

- `backend/db/schema.ts`
- `backend/db/index.ts:80-1024`
- `backend/db/seed-accounts.ts:427-2247`
- `backend/services/printJobService.ts:34-56`

Findings:

- The system has more than one schema authority.
- Tables and columns are created or altered at runtime.
- The application repairs schema drift while serving requests.
- `print_jobs` columns are auto-added from application code if missing.

Risk: `Critical`

PostgreSQL approach:

- one canonical schema source
- no runtime `ALTER TABLE` in application logic
- start-up must fail fast if migrations are not applied

### 4.3 SQLite-specific migration history

Evidence:

- `backend/drizzle/0019_fix_accounts_id_type.sql`
- `backend/drizzle/0021_fix_journal_entry_lines_fk_cleanup_old_push.sql`
- `backend/drizzle/0022_fix_invoices_journal_fk.sql`

Findings:

- migration files use:
  - `PRAGMA foreign_keys`
  - `rowid`
  - `AUTOINCREMENT`
  - `INSERT OR IGNORE`
- early migration history includes many SQLite-generated drop/rebuild patterns

Risk: `Critical`

PostgreSQL approach:

- do not replay SQLite migration history on PostgreSQL
- create a clean PostgreSQL baseline migration
- create separate one-time import/fix scripts for legacy data normalization

### 4.4 Raw SQL coupling

Evidence:

- `backend/server.ts:299,337-471,550-560,1330-1340`
- `backend/services/reportingEngine.ts:187-873`
- `backend/db/seed-accounts.ts:2346,2467,2498`

Findings:

- raw SQL assumes SQLite string/date behavior
- `rowid` is used for deterministic ordering
- `PRAGMA table_info` is used for runtime capability detection
- `last_insert_rowid()` is used in accounting seeding
- `coalesce(...), trim(cast(... as text))` is used to hide type inconsistencies

Risk: `High` to `Critical`

PostgreSQL approach:

- replace raw SQLite SQL with PostgreSQL-safe SQL or Drizzle expressions
- replace `rowid` ordering with stable explicit keys
- replace `last_insert_rowid()` with `RETURNING`

### 4.5 Data-type coupling

Evidence:

- `backend/db/schema.ts` wide use of `real(...)`, `text(...)`, integer booleans
- live schema shows `vouchers.journal_entry_id` is `TEXT`, `journal_entries.id` is `INTEGER`

Findings:

- money is stored in float
- quantities are stored in float
- business dates and timestamps are stored as text
- some relationship keys are type-mismatched

Risk: `Critical`

PostgreSQL approach:

- use `numeric` for money and quantities
- use `date` for business dates
- use `timestamptz` for audit/event times
- normalize mismatched FK types before enforcing constraints

### 4.6 JSON and payload storage

Evidence:

- `backend/db/schema.ts:468,588,640,739,1176`
- `backend/routes/reports.routes.ts`
- `backend/server.ts`
- `src/lib/localRuntime.ts`

Findings:

- structured business data is often stored as text JSON
- application frequently parses JSON at runtime
- malformed or shape-drifting JSON is tolerated in multiple places

Risk: `High`

PostgreSQL approach:

- classify JSON fields
- migrate queryable fields to `jsonb`
- keep opaque blobs as text only where truly archival
- add validation around import and writes

### 4.7 Android/local embedded SQLite runtime

Evidence:

- `src/lib/localDb/database.ts:2-31`
- `src/lib/localDb/migrations.ts`
- `src/lib/localRuntime.ts:2826`

Findings:

- there is a separate mobile/local SQLite subsystem
- it uses `INSERT OR REPLACE`
- it has a denormalized payload-json model
- it is explicitly identified as a local SQLite runtime

Risk: `Critical` if included in “fully leave SQLite behind”; otherwise `Out-of-scope for server cutover`

PostgreSQL-compatible approach:

- separate decision required:
  - either de-scope Android/offline SQLite from this project phase
  - or treat it as a second migration project

## 5. SQLite vs PostgreSQL 16 compatibility gap analysis

### 5.1 SQL dialect differences

Current patterns:

- `PRAGMA`
- `sqlite_master`
- `INSERT OR REPLACE`
- `INSERT OR IGNORE`
- `AUTOINCREMENT`
- `rowid`
- `last_insert_rowid()`

Assessment:

- safe as-is: almost none
- requires adaptation: most raw/admin/tooling SQL
- dangerous: migration history replay, operational doctor/backup scripts

### 5.2 NULL semantics and empty strings

Current behavior:

- many checks treat `NULL`, `''`, and type-cast empty text interchangeably
- example: `trim(cast(journal_entry_id as text)) = ''`

PostgreSQL behavior:

- stricter typing
- `NULL` remains distinct from empty string

Risk:

- hidden linkage defects will become visible

Required action:

- normalize import data
- define per-field nullability rules

### 5.3 Type coercion

Current behavior:

- SQLite accepts mixed text/integer joins and filters more permissively
- example: `vouchers.journal_entry_id` text vs journal entry integer PK

PostgreSQL behavior:

- explicit cast or matching type required

Risk: `Critical`

### 5.4 Integer vs bigint

Current behavior:

- core accounting integer IDs are SQLite rowid-style integers

PostgreSQL recommendation:

- use `bigint identity` for growth safety on core ledgers

Risk: `Medium`

### 5.5 Decimal and floating-point precision

Current behavior:

- `real` is used for:
  - invoice totals
  - voucher amounts
  - journal debits/credits
  - FX rates
  - quantities
  - manufacturing and textile values

PostgreSQL behavior:

- keeping float would preserve technical portability but not accounting safety

Risk: `Critical`

Recommendation:

- money: `numeric(18,4)` or stricter per currency policy
- exchange rates: `numeric(18,8)`
- stock/textile/manufacturing quantities: `numeric(18,4)` or `numeric(18,6)`

### 5.6 Timestamp and timezone behavior

Current behavior:

- mixed storage:
  - business dates as strings
  - audit timestamps as text
  - many writes use `new Date().toISOString()`
  - many defaults use `CURRENT_TIMESTAMP`
- reports compare text via `SUBSTR`

PostgreSQL recommendation:

- `date` for business dates
- `timestamptz` for audit and operational timestamps
- UTC at persistence boundary

Risk: `High`

### 5.7 Text comparison, case sensitivity, and collation

Current behavior:

- normalization often implemented in application or via `lower(trim(...))`
- no strong collation strategy is visible

PostgreSQL behavior:

- `LIKE` is case-sensitive by default
- `ILIKE` exists for case-insensitive matching

Risk: `Medium`

### 5.8 JSON storage and querying

Current behavior:

- JSON as `TEXT`
- parse-on-read

PostgreSQL opportunity:

- `jsonb` with validation, indexing, and path ops

Risk:

- not a blocker for cutover if left as text initially
- but query-heavy JSON should not remain opaque if used operationally

### 5.9 Transaction isolation and locking

Current behavior:

- SQLite single-writer model
- several transactional workflows assume local serialized writes
- queue allocation uses read-then-update counter logic

PostgreSQL behavior:

- MVCC
- row-level locking
- deadlocks possible if write order is inconsistent

High-risk areas:

- invoice creation/posting
- voucher lifecycle
- queue counters
- provisioning
- reconciliation/session close flows

Risk: `High`

### 5.10 Conflict/upsert behavior

Current behavior:

- `INSERT OR REPLACE`
- `INSERT OR IGNORE`

PostgreSQL behavior:

- `ON CONFLICT DO NOTHING`
- `ON CONFLICT DO UPDATE`

Risk: `Critical`

### 5.11 `RETURNING` opportunities

Current state:

- some services already use `.returning()`
- other areas still use `last_insert_rowid()`

Assessment:

- this is an opportunity, not a problem, if standardized

### 5.12 Strictness of foreign keys and constraints

Current state:

- SQLite data currently passes engine FK checks
- but many logical relationships are not enforced

PostgreSQL effect:

- stronger enforcement will surface orphaned or inconsistent business references once added

Risk: `High`

### 5.13 Index behavior and partial indexes

Current state:

- indexing is selective and relatively light
- reporting queries rely on small current volumes

PostgreSQL recommendation:

- add covering/composite indexes after baseline cutover
- consider partial indexes for:
  - open sessions
  - unresolved system events
  - active print jobs
  - open invoices / non-zero remaining balances

## 6. Accounting and business-critical risk review

### 6.1 Invoices

Evidence:

- `backend/services/invoiceLifecycle.ts`
- `backend/db/schema.ts:631-695`

Risks:

- monetary precision is float-based
- invoice line items are stored as JSON text
- stock, party ledger, journal, and print side effects are coordinated inside one workflow
- restaurant sale invoices use source-document idempotency checks

### 6.2 Journal entries and ledger reporting

Evidence:

- `backend/accountingService.ts`
- `backend/services/reportingEngine.ts`

Risks:

- `real` for debit/credit
- text dates in reporting
- reporting uses `rowid` tie-breakers

### 6.3 Receivables and payables

Evidence:

- `party_transactions`
- `invoiceSettlement`
- party balance recomputation logic

Risks:

- snapshot balances and canonical transaction sums must remain aligned
- current data shows no party drift, which is good
- but float precision and type normalization still matter

### 6.4 Stock-affecting transactions

Evidence:

- `backend/inventoryService.ts`
- `backend/services/invoiceLifecycle.ts`
- `inventory_movements`

Risks:

- snapshot quantity plus ledger quantity dual-model
- strict ledger mode
- synthetic baseline generation
- serial-number side effects

Current live data:

- no stock drift was detected in current DB

### 6.5 Restaurant checkout/session linkage

Evidence:

- `backend/services/queueService.ts`
- `backend/services/restaurantService.ts`
- `backend/services/invoiceLifecycle.ts`

Risks:

- queue counters are concurrency-sensitive
- session-to-invoice idempotency must survive cutover
- customer/kitchen printed timestamps should remain consistent

### 6.6 Source document linkage

Evidence:

- invoice source document fields
- textile dispatch conversion
- restaurant session conversion

Risks:

- many source-document relationships are logical, not FK-backed

### 6.7 Monitoring center event persistence

Evidence:

- `system_events`
- consistency guards in `backend/server.ts`

Risks:

- metadata stored as text JSON
- operational filtering likely to grow

### 6.8 Multi-company / branch scoping

Evidence:

- schema-wide `company_id`, `branch_id`
- `tenantScope` utilities
- provisioning flow

Risks:

- scope columns are nullable in many places
- some uniqueness may be globally enforced when business meaning is tenant-scoped

### 6.9 Security-related persistence assumptions

Evidence:

- users, branch/company access, system super admins

Risks:

- mostly not PostgreSQL blockers
- storage normalization would still improve consistency

### 6.10 Setup/provisioning flows

Evidence:

- `backend/services/companyProvisioningService.ts`

Risks:

- creates multiple records and settings in one transaction
- relies on application-generated identifiers and cleanup helpers

## 7. Schema review for PostgreSQL 16

### 7.1 What should remain

- String IDs for operational entities where application-generated IDs are already stable
- Overall table structure and business modules
- Ledger-centered accounting model
- Separate canonical ledgers for party transactions and inventory movements
- Queue/session/print event append-only style

### 7.2 What should evolve

- IDs:
  - keep string IDs for operational entities
  - use `bigint identity` for accounting internals
- Money and quantities:
  - use `numeric`
- JSON:
  - use `jsonb` where operationally queried
- Time:
  - use `date` for business dates
  - use `timestamptz` for audit/event times
- Booleans:
  - use native boolean
- FK policy:
  - first wave on accounting lineage, restaurant lineage, access-control lineage
- Index strategy:
  - add tenant/date, tenant/status, and append-mostly indexes
- Uniqueness:
  - re-evaluate global vs tenant-scoped uniqueness

## 8. Migration strategy options

### Option A: Big bang migration

- advantages:
  - simplest target architecture
  - shortest migration code lifetime
- disadvantages:
  - highest cutover risk
  - hardest rollback
- recommendation:
  - not recommended

### Option B: Dual-support transitional phase

- advantages:
  - earlier PostgreSQL testing
- disadvantages:
  - highest code complexity
  - dangerous for accounting if dual-write or divergent behavior appears
- recommendation:
  - not recommended as a production operating model

### Option C: PostgreSQL-first cutover with one-time migration tooling

- advantages:
  - best balance of safety and complexity
  - avoids long-lived dual support
  - aligns with local PostgreSQL first, cloud later
- disadvantages:
  - requires disciplined import tooling and validation
- recommendation:
  - recommended

## 9. Recommended phased execution plan

### Phase 0: discovery and hardening

- objective:
  - remove ambiguity and stabilize the current SQLite world
- concrete tasks:
  - declare one schema authority
  - freeze runtime DDL mutations
  - classify voucher journal-link exceptions
  - define target PostgreSQL type policy
- dependencies:
  - none
- risks:
  - valid business exceptions may be mistaken for data debt
- exit criteria:
  - signed-off compatibility matrix and type policy
- rollback:
  - no runtime impact

### Phase 1: local PostgreSQL 16 enablement

- objective:
  - make the backend boot and migrate against local PostgreSQL 16
- concrete tasks:
  - add PostgreSQL driver and config
  - add DB dialect/env selection
  - add local bootstrap scripts
- dependencies:
  - Phase 0
- risks:
  - accidental mixed bootstrap behavior
- exit criteria:
  - backend starts against clean local PostgreSQL
- rollback:
  - keep SQLite default for comparison during development

### Phase 2: schema and migration adaptation

- objective:
  - produce PostgreSQL-native schema baseline and migration chain
- concrete tasks:
  - port `sqlite-core` schema to `pg-core`
  - create PostgreSQL baseline migration
  - normalize critical type mismatches
  - remove runtime schema mutation
- dependencies:
  - Phase 1
- risks:
  - schema drift between current runtime and intended baseline
- exit criteria:
  - PostgreSQL schema builds from migrations only
- rollback:
  - continue using SQLite in dev while baseline is corrected

### Phase 3: query compatibility fixes

- objective:
  - eliminate SQLite-only query assumptions
- concrete tasks:
  - replace `PRAGMA`, `sqlite_master`, `rowid`, `last_insert_rowid()`
  - replace `INSERT OR ...` patterns
  - update raw reporting SQL
- dependencies:
  - Phase 2
- risks:
  - reporting/order differences
- exit criteria:
  - PostgreSQL path has no SQLite-only SQL
- rollback:
  - retain SQLite comparison path temporarily in development

### Phase 4: integration and regression testing

- objective:
  - prove business parity on PostgreSQL locally
- concrete tasks:
  - run accounting, hardening, restaurant, printing, period-closing tests on PostgreSQL
  - add migration-specific reconciliation tests
  - add concurrency tests
- dependencies:
  - Phase 3
- risks:
  - hidden coverage gaps
- exit criteria:
  - critical regression suite passes on PostgreSQL
- rollback:
  - continue parity work before cutover

### Phase 5: local cutover validation

- objective:
  - validate full SQLite -> PostgreSQL import and local operational use
- concrete tasks:
  - run one-time import
  - reseed identities
  - run reconciliation reports
  - execute smoke tests
- dependencies:
  - Phase 4
- risks:
  - import ordering and hidden duplicates
- exit criteria:
  - imported PostgreSQL data reconciles to source SQLite
- rollback:
  - rebuild local PostgreSQL DB and retry

### Phase 6: cloud readiness for Google Cloud SQL

- objective:
  - make the local PostgreSQL solution production-deployable on Cloud SQL
- concrete tasks:
  - environment separation
  - secret management
  - connection security
  - migration/deploy pipeline
  - pooling and backup strategy
- dependencies:
  - Phase 5
- risks:
  - underestimating operational constraints
- exit criteria:
  - Cloud SQL runbook approved
- rollback:
  - keep local PostgreSQL as validated fallback environment

### Phase 7: cloud deployment and controlled rollout

- objective:
  - deploy to Cloud SQL safely
- concrete tasks:
  - pre-cutover backup
  - controlled migration execution
  - smoke tests
  - limited rollout
  - post-cutover monitoring
- dependencies:
  - Phase 6
- risks:
  - runtime config mistakes, connection pressure
- exit criteria:
  - stable production operations on Cloud SQL
- rollback:
  - use defined rollback plan and source snapshot

## 10. Local PostgreSQL 16 first

Recommended environment model:

```env
DB_DIALECT=postgres
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/shamel_erp
DB_SSL_MODE=disable
```

Keep legacy SQLite env only for fallback/comparison during migration work:

```env
DB_PATH=data/shamel.db
```

Recommended local flow:

1. Create local PostgreSQL DB.
2. Run PostgreSQL migrations.
3. Optionally import SQLite snapshot for parity validation.
4. Run PostgreSQL-backed integration tests.

Developer ergonomics needed:

- one-command local DB start/reset
- clear `.env.local` example for PostgreSQL
- deterministic SQLite -> PostgreSQL import script
- quick reconciliation command

Feature-parity validation should at minimum cover:

- accounting simulation and assertion
- hardening integration
- restaurant QR and operational tests
- print job tests
- period-closing tests

## 11. Future Google Cloud SQL PostgreSQL 16 readiness

Planning only. Do not cut over to cloud yet.

Prepare for:

- separate local/staging/production connection strings
- secure connection strategy
- TLS expectations
- secret-manager based credentials
- explicit network/connectivity design
- migration/deploy workflow separate from app startup
- automated backup and restore validation
- query/performance observability
- connection pooling
- cost-aware sizing
- production rollback runbook

## 12. Data migration plan

Recommended approach:

1. Export from SQLite table-by-table with deterministic ordering.
2. Preserve existing IDs exactly.
3. Transform:
  - booleans
  - text/integer mismatches
  - timestamps/dates
  - float-to-numeric mappings
  - malformed JSON where promoted to `jsonb`
4. Load parent/master tables first.
5. Load ledgers and dependent tables after parents.
6. Reseed identities.
7. Run reconciliation checks.

Business-equivalence proof should compare:

- trial balance totals
- open AR/AP balances
- stock balances by item/warehouse
- invoice totals and remaining balances
- journal-link coverage
- restaurant open sessions and queue counters
- recent system events and print jobs

## 13. Test strategy

Highest-value suites to run before and after cutover:

- `tests/hardening.integration.test.ts`
- `tests/accounting.simulation.test.ts`
- `tests/accounting.assertion.test.ts`
- `tests/restaurant-qr-hardening.test.ts`
- `tests/print-jobs-hardening.test.ts`
- `tests/period-closing.test.ts`

Add PostgreSQL-specific tests for:

- schema/migration bootstrap
- import validation
- accounting parity
- concurrency on queueing/posting
- rollback/idempotency
- tenant-scope integrity
- performance smoke checks

## 14. Risk register

| Risk ID | Description | Impacted area | Likelihood | Severity | Mitigation | Detection | Rollback / contingency |
|---|---|---|---|---|---|---|---|
| R-01 | Monetary float precision causes accounting mismatch after cutover | accounting, invoices, vouchers, FX | High | Critical | migrate financial columns to `numeric`; run reconciliation suite | trial balance and invoice balance diffs | discard imported DB and fix mapping before retry |
| R-02 | Mixed-type journal links fail under PostgreSQL strict typing | vouchers, journals | High | Critical | normalize `journal_entry_id` typing and repair invalid rows | import/type validation, orphan queries | keep SQLite authoritative until repaired |
| R-03 | Runtime schema mutation causes unpredictable PostgreSQL environments | startup, printing, seeding | High | Critical | remove runtime DDL; use migrations only | boot-time migration checks | fail start and roll back deployment |
| R-04 | Replaying SQLite migrations on PostgreSQL fails or corrupts schema | schema migration | High | Critical | create clean PostgreSQL baseline | migration dry runs | rebuild schema from baseline |
| R-05 | Date/text semantics change report outputs | reporting, period controls | Medium | High | convert to typed dates and revalidate reports | regression reports | fix queries, rerun import |
| R-06 | Queue allocation races under PostgreSQL concurrency | restaurant ops | Medium | High | use atomic `ON CONFLICT ... DO UPDATE ... RETURNING` | concurrency tests | disable queue issuance temporarily or revert |
| R-07 | Hidden orphan references surface when FKs are added | multi-module | Medium | High | defer FK rollout until after orphan audit | FK validation queries | postpone specific constraints |
| R-08 | Voucher journal policy is unclear for current data | accounting | High | High | classify voucher types and expected journal behavior | reconciliation report | leave constraint unenforced until rule is defined |
| R-09 | Android/local SQLite path is mistaken as covered by server migration | mobile/offline | High | High | explicitly scope it as separate workstream | architecture review | keep Android SQLite path isolated |
| R-10 | Reporting raw SQL remains SQLite-specific in hidden paths | reporting | Medium | High | inventory and rewrite raw SQL | PostgreSQL integration tests | keep report route disabled until fixed |

## 15. Task breakdown for future implementation

### Prerequisite tasks

- Define canonical schema authority
- Freeze runtime schema mutation
- Define PostgreSQL type policy
- Classify voucher journal-link rules

### Schema tasks

- Port Drizzle schema to `pg-core`
- Create PostgreSQL baseline migration
- Normalize journal-link types
- Re-type money and quantity fields
- Add first-wave FKs and indexes

### Query adaptation tasks

- Replace SQLite bootstrap logic
- Rewrite raw reporting SQL
- Remove `PRAGMA` and `sqlite_master` usage
- Replace `last_insert_rowid()` and `INSERT OR ...`
- Make queue allocation atomic on PostgreSQL

### Migration tooling tasks

- Build SQLite export/import tool
- Add reconciliation tooling
- Add sequence reseed tooling
- Replace SQLite operational scripts

### Test tasks

- Add PostgreSQL integration harness
- Add accounting parity suite
- Add concurrency tests
- Add import verification suite

### Local cutover tasks

- Add local PostgreSQL env/bootstrap docs
- Run local import dry-run
- Execute local ERP smoke run on PostgreSQL

### Cloud readiness tasks

- Define Cloud SQL connectivity pattern
- Add secret-managed runtime config
- Design migration/deploy pipeline
- Add Cloud SQL observability and rollback runbooks

## 16. Unknowns and explicit blockers

Known unknowns:

- Whether all non-zero vouchers are supposed to journalize.
- Whether global uniqueness on some business keys is intentional.
- Whether Android embedded SQLite is in scope for the near-term “leave SQLite behind” statement.
- Which JSON text columns must become queryable.

Explicit blockers before real migration execution:

1. No canonical PostgreSQL schema/migration path exists yet.
2. Runtime schema mutation must be removed from request/startup flows.
3. Critical type mismatches must be resolved, especially voucher journal linkage and float-based accounting fields.
4. SQLite-specific operational scripts cannot be reused for PostgreSQL cutover.

## 17. Final recommendation

This project should migrate in a controlled PostgreSQL-first path, starting locally, not through a dual-write architecture and not through direct replay of the existing SQLite migration history.

The backend ERP migration is hard but manageable. The dominant risk is not PostgreSQL itself. The dominant risk is the current mixture of:

- SQLite-specific bootstrap behavior
- runtime schema self-repair
- float-based accounting values
- inconsistent FK typing
- operational tooling coupled to file-based SQLite assumptions

If those are addressed in order, the migration is realistic.

The first actual implementation step should be to establish a PostgreSQL-native schema baseline and remove runtime DDL from the application path.

What should not be done yet:

- no Cloud SQL cutover
- no production migration
- no broad dual-support runtime
- no massive refactor unrelated to DB migration

Supporting evidence files:

- `reports/postgresql16-query-risk-register.md`
- `reports/postgresql16-schema-compatibility-matrix.md`
