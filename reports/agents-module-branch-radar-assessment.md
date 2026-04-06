# Agents Module (Branch Radar) Deep Assessment Report

Generated: 2026-04-02 (America/New_York)

Scope: “Agents” functionality under/adjacent to the Branch Radar area. Evidence-driven from current codebase. No refactors or implementations performed.

## 0) Executive Summary (Concise)

Current maturity: **Partial / Operational Prototype**

The Agents module exists as a lightweight “mobile warehouse / field agent” feature with basic CRUD, inventory transfer-in, and map visibility. It is **not production-ready** due to missing lifecycle integration (agent stock-out on sales, commission accounting, agent status lifecycle), incomplete security checks, and shallow Branch Radar integration (navigation only). It does not yet behave like a full operational sub-ledger or workflow.

Top 5 weaknesses:

1) **No canonical stock-out from agent inventory on sales** (inventory and accounting drift risk).
2) **Location update route lacks company/branch scoping checks** (cross-tenant edit risk).
3) **Agent inventory schema lacks warehouse linkage + uniqueness constraints** (data integrity risks).
4) **Branch Radar integration is superficial** (navigation only; no shared KPIs).
5) **No complete agent lifecycle or reporting** (activation, assignment, commissions, performance, reconciliation).

Top 5 priorities:

1) Enforce tenant scope checks on all agent routes (especially location update).
2) Define agent inventory movement lifecycle tied to invoices and stock movements.
3) Add schema constraints/indexes for agent_inventory and agent_transfers.
4) Build minimal agent lifecycle operations (create/edit/deactivate, branch assignment).
5) Add Branch Radar KPIs or unified reporting linking agents to branch performance.

Ready for implementation now? **Yes**, but only after clarifying intended business role and lifecycle. Do not refactor unrelated modules.

---

## 1) Current Module Inventory

This section lists everything currently related to Agents with file path, purpose, current behavior, and completeness.

### Backend Routes / Services

1) `backend/routes/agents.routes.ts`

   - Purpose: Agent inventory retrieval, transfer-to-agent, location update.
   - Behavior:
     - `GET /api/agent-inventory?agentId=` returns agent inventory filtered by tenant scope; optional agentId filter.
     - `GET /api/agent-transfers?agentId=` returns transfer history; parses `items` JSON; tenant scoped.
     - `POST /api/agents/:id/location` updates `lastLat`, `lastLng`, `lastSeenAt`.
     - `POST /api/agent-inventory/transfer` transfers stock from warehouse items into `agent_inventory`, writes `agent_transfers`, and logs inventory movement `AGENT_TRANSFER_OUT`.
   - Completeness: **Partial**. No stock-out from agent inventory when sales happen. Location update has no tenant scope check.
2) `backend/routes/generic.routes.ts`

   - Purpose: Generic CRUD for `agents` (not for agent_inventory/agent_transfers).
   - Behavior:
     - `agents` is CRUD enabled; uses `enforcePayloadTenantScope`.
     - `agent-inventory` and `agent-transfers` are read-only in generic route (canonicalOnly).
   - Completeness: **Partial**. `agents` generic CRUD exists; no agent-specific validation.
3) `backend/lib/tenantScope.ts`

   - Purpose: Tenant and branch scoping rules.
   - Behavior:
     - `agents`, `agent-inventory`, `agent-transfers` are **branch scoped**.
     - Branch required prefixes include `/api/agent-inventory` and `/api/agent-transfers`, but **not `/api/agents`**.
   - Completeness: **Partial**. Write scope enforcement exists; `/agents/:id/location` does not validate scope at route level.
4) `backend/lib/security.ts`

   - Purpose: Route-family permission policy.
   - Behavior:
     - `agents.read`/`agents.write` maps to permissions `manage_agents` or `manage_inventory`.
     - `/api/agents`, `/api/agent-inventory`, `/api/agent-transfers` are in the `agents` route family.
   - Completeness: **Partial**. No agent-specific policy granularity or “agent self” permissions.
5) `backend/routes/inventory.routes.ts`

   - Purpose: Item merge touches agent inventory.
   - Behavior:
     - Item merge updates `agent_inventory` to swap item IDs and merge quantities.
   - Completeness: **Partial**. Supports data repair in merge flow.
6) `backend/routes/backups.routes.ts` and `backend/routes/system.routes.ts`

   - Purpose: Include `agents`, `agent_inventory`, `agent_transfers` in backup/export and system wipe.
   - Completeness: **Support** only.

### Database Schema / Tables

1) `backend/db/schema.pg.ts` and `backend/db/schema.sqlite.ts`

   - Tables:
     - `agents`
     - `agent_inventory`
     - `agent_transfers`
   - Completeness: **Partial**. No foreign keys, minimal constraints.
2) `backend/drizzle-pg/0000_blue_forgotten_one.sql`

   - Confirms table definitions, no FK constraints, no unique indexes.
   - Completeness: **Partial**.

### UI Screens / Components

1) `src/pages/Agents.tsx`

   - Purpose: Agents management UI.
   - Behavior:
     - Agent list with stats (sales totals, paid, remaining, sold qty).
     - Agent inventory totals computed by multiple API requests per agent.
     - Map showing agent locations, sale invoice geolocations, and party markers.
     - Actions: create agent (creates user + agent), transfer inventory, update location, add party from map.
   - Completeness: **Partial**. No edit/deactivate, no branch assignment, no agent lifecycle actions, no reporting exports.
2) `src/pages/Branches.tsx` (Branch Radar)

   - Purpose: Branch Radar monitoring UI.
   - Behavior:
     - Shows remote branches and live metrics.
     - Includes a button that navigates to `agents` tab.
   - Completeness: **Partial / Superficial** integration with Agents.
3) `src/App.tsx`

   - Purpose: App navigation + data fetch.
   - Behavior:
     - Fetches `agents` alongside core data.
     - Renders Agents page as a tab.
     - Back navigation maps `agents` to `branches_radar`.
   - Completeness: **Operational**, but no explicit Branch Radar dependency on Agents data.
4) `src/lib/systemModules.ts`

   - Purpose: Module definitions and access control.
   - Behavior:
     - Agents is its own module and also appears under “Parties”.
     - Branch Radar is under Dashboard.
   - Completeness: **Operational**.
5) `src/components/settings/UserManager.tsx`

   - Purpose: User role setup.
   - Behavior:
     - Has “agent” role label for user management.
   - Completeness: **Partial**. No agent-specific permission tuning in UI.

### Local Runtime / Offline

1) `src/lib/localRuntime.ts`
   - Purpose: Local runtime supports agents in offline mode.
   - Behavior:
     - CRUD for `agents` via generic local store.
     - `agents/:id/location` updates last location locally.
     - `agent_inventory/transfer` mutates local item stock and agent inventory lines (includes a `warehouseId` field not in server schema).
   - Completeness: **Partial**. Schema mismatch vs server (warehouseId in local agent_inventory lines).

### Tests

1) `tests/project-profile-specialization.test.ts`
   - Purpose: Ensures profile hides Agents in restaurant profile.
   - Completeness: **Minimal**. No agent-specific functional tests.

---

## 2) Business Purpose Analysis (Evidence-Based)

Observed purpose indicators:

1) Schema comment: “Agents (Mobile Warehouses)” in `schema.pg.ts`/`schema.sqlite.ts`.
2) UI text in `src/pages/Agents.tsx` indicates “mobile stock and tracking sales and locations”.
3) `agent_inventory` + transfer logic implies field agents carry stock (van stock).
4) Commission fields exist on Agent (rate + currency).
5) Location tracking exists via `agents/:id/location`.
6) Invoice list uses `createdByRole === 'agent'` and map displays invoices by agent.

Likely business representation (evidence-supported):

- **Sales agent / distributor / field operator** who carries stock and sells in the field.
- Agent may represent a mobile warehouse with its own stock bucket.

Unclear / assumptions (explicitly marked):

- Whether agents can belong to **multiple branches** (no join table; single `branch_id` field suggests **one branch**).
- Whether agents are **financially settled** (no commission or settlement accounting implementation).
- Whether agents are **collectors** (no vouchers or cashbox integration).
- Whether agent performance reports are required (no reporting endpoints found).

---

## 3) Branch Radar Integration Analysis

Findings:

1) Branch Radar UI is `src/pages/Branches.tsx` and is focused on remote branch monitoring.
2) Agents are not rendered inside Branch Radar; integration is a navigation button to the Agents tab.
3) `src/App.tsx` sets the parent tab for `agents` as `branches_radar` to provide contextual back navigation.

Conclusion:

- **Integration is superficial.** Branch Radar does not display any agent data, KPIs, or filters.
- There is no cross-branch agent analytics (by remote branch or performance).
- No shared summary data structures between Branch Radar and Agents.

Expected (but currently missing) if the module is truly “inside Branch Radar”:

- Agent counts by branch / status
- Agent location clustering by branch
- Agent inventory / sales per branch
- Alerts on inactive / offline agents by branch

---

## 4) Database and Model Review

### Tables and Columns (Postgres schema)

1) `agents`

   - `id` (PK, text)
   - `company_id` (text, nullable)
   - `branch_id` (text, nullable)
   - `user_id` (text, nullable)
   - `name` (text, required)
   - `phone`, `vehicle`, `vehicle_image`, `certificate_image`, `notes`
   - `is_active` (boolean, default true)
   - `commission_rate` (numeric 18,6 default 0)
   - `commission_currency` (text default 'USD')
   - `last_lat`, `last_lng`, `last_seen_at`
   - `created_at`
2) `agent_inventory`

   - `id` (PK, text)
   - `company_id`, `branch_id` (nullable)
   - `agent_id` (required)
   - `item_id` (required)
   - `item_name`, `unit_name`
   - `quantity` numeric default 0
   - `updated_at`
3) `agent_transfers`

   - `id` (PK, text)
   - `company_id`, `branch_id` (nullable)
   - `agent_id` (required)
   - `agent_name` (text)
   - `warehouse_id`, `warehouse_name`
   - `items` (text JSON)
   - `notes`
   - `created_at`

### Relationships (Current)

- No foreign keys declared (agent_id, item_id, warehouse_id, user_id are not FK constrained).
- No uniqueness constraint for `(agent_id, item_id)` in `agent_inventory`.
- No index on `(company_id, branch_id, agent_id)` for `agent_inventory` or `agent_transfers`.

### Tenant / Branch Scope Risks

- `company_id` and `branch_id` are nullable.
- Scope is enforced at API level, not at DB level.
- Potential risk: orphan agent_inventory rows with null branch/company.

### Missing or weak schema elements

1) **No warehouse linkage** in `agent_inventory` despite local runtime storing `warehouseId`.
2) **No status/lifecycle** on transfers (e.g., pending/posted/reversed).
3) **No audit fields** (`created_by`, `updated_by`, `updated_at` for agents).
4) **No constraint** to prevent duplicate agent/item lines.
5) **No soft-delete** or deactivation timestamp.

---

## 5) UI/UX Review

### What exists

- Agent list with stats and commission estimate.
- Create agent (creates user + agent).
- Transfer inventory to agent.
- Map:
  - Agent locations
  - Sale invoices by geolocation
  - Party markers (customers/suppliers)
- “Sync interval” setting.

### What is missing

- **Edit / deactivate agent** UI
- **Agent details** view with history
- **Agent inventory reconciliation** or stock-out flows
- **Filter/sort/search** for agents (by branch, status, online, sales)
- **Branch context visibility** in UI (no explicit branch shown)
- **Branch-aware dashboards** or KPIs
- **Mobile/field workflow** for agent to see own inventory and tasks

UX maturity: **Operational prototype**, not enterprise-ready.

---

## 6) Security and Permissions Review

### Existing permissions

- `manage_agents` permission exists.
- `agents.read`/`agents.write` mapped to `manage_agents` or `manage_inventory`.
- `agents` CRUD in generic route requires `manage_agents`.

### Observed risks / gaps

1) `POST /api/agents/:id/location` updates agents **without company/branch checks**. If an ID is known, cross-tenant update is possible (permissions aside).
2) Agent users do **not** have `manage_agents` by default (`DEFAULT_ROLE_PERMISSIONS.agent` only includes view_inventory + create_sale_invoice). Therefore, agent self location updates will be blocked by auth unless granted extra permissions.
3) No “agent self” permission model (e.g., agent can update only their location).

Conclusion: **Security posture is partial**. Needs explicit scoping and agent-self rules.

---

## 7) Operational Workflow Review

### Workflow: Create agent

Current:

- UI creates a `users` entry and an `agents` entry with same id.
- Branch/company assigned via tenant enforcement in generic route.
  Missing:
- Branch assignment selection (implicit only).
- Role-specific profile, device binding, or onboarding.
  Maturity: **Partial**

### Workflow: Assign agent to branch

Current:

- `agents.branch_id` exists; no explicit UI to set.
  Missing:
- Branch assignment UI and validation.
  Maturity: **Missing**

### Workflow: Transfer inventory to agent

Current:

- `POST /agent-inventory/transfer` reduces warehouse item stock and creates agent inventory lines.
  Missing:
- Transfer approval, audit, reversal/return flow.
- Agent inventory linkage to warehouse or transfer doc lifecycle.
  Maturity: **Partial**

### Workflow: Agent sells inventory

Current:

- Invoices use `createdByRole` and `createdById` for agent attribution.
  Missing:
- Reduction of agent_inventory on sale.
- Accounting for commission or settlements.
  Maturity: **Missing**

### Workflow: Track agent activity/location

Current:

- Location update route; map shows online status.
  Missing:
- Agent-side permission for location updates.
- Data retention policy, location history.
  Maturity: **Partial**

### Workflow: Reporting by agent

Current:

- UI computes summary stats from invoices (client-side).
  Missing:
- Dedicated reports, exports, server-side aggregation.
  Maturity: **Partial**

### Workflow: Deactivate/reactivate agent

Current:

- `is_active` exists in schema.
  Missing:
- UI for activation status and enforcement in queries.
  Maturity: **Missing**

---

## 8) Accounting / Document Impact Review

Current:

- Agent sales are regular invoices with `createdByRole = 'agent'`.
- Agent commission is **calculated client-side only** in the UI (no accounting or persistence).
- Agent inventory transfer logs stock movement `AGENT_TRANSFER_OUT` but **no corresponding financial entry**.

Missing:

- Commission posting (journal entries).
- Agent settlement / cash collection workflow.
- Reconciliation of agent inventory vs sales.

Conclusion: **No real accounting integration yet.**

---

## 9) Gap Analysis (High-Level)

See detailed gap matrix in `reports/agents-module-gap-matrix.md`.

---

## 10) Production-Readiness Assessment

Is it production-ready? **No**.

Why not:

1) No end-to-end inventory lifecycle (transfer in only).
2) Security gaps on location update and agent self permissions.
3) Weak schema constraints and missing relationships.
4) No agent lifecycle management (activation/deactivation/edit).
5) Branch Radar integration is superficial; reporting is shallow.

Top blockers:

- Missing agent inventory sales depletion and reconciliation.
- Missing/incorrect permission model for agent self operations.
- Lack of tenant scoping checks on location update.

Top risks:

- Inventory/accounting drift.
- Cross-tenant data manipulation via location updates.
- Operational confusion about branch/agent ownership.

What should be built first:

1) Scope enforcement + agent-self policy for location updates.
2) Canonical agent inventory decrement on sales.
3) Schema hardening and indexes.

What should not be changed yet:

- Do not refactor global inventory or accounting services until agent lifecycle decisions are clear.
- Avoid altering invoice lifecycle unless agent inventory behavior is explicitly defined.

---

## 11) Recommended Roadmap (Summary)

See detailed roadmap in `reports/agents-module-recommended-roadmap.md`.

---

## 12) Executive Summary (Required Final Section)

Current maturity level: **Partial / Prototype**

Top 5 weaknesses:

1) No agent stock-out on sales
2) Location update lacks tenant scope enforcement
3) Missing schema constraints and warehouse linkage
4) Branch Radar integration is navigation-only
5) No agent lifecycle workflows (deactivate/edit/assign)

Top 5 priorities:

1) Enforce tenant and agent-self scope on location updates
2) Link sales invoices to agent inventory depletion
3) Add schema constraints/indexes and warehouse linkage
4) Implement basic agent lifecycle UI (edit, deactivate, assign)
5) Add Branch Radar KPIs / aggregated agent reporting

Ready for implementation work now? **Yes**, but only after clarifying agent business role and inventory lifecycle expectations.


# Agents Module Recommended Roadmap

Generated: 2026-04-02

## Phase 1: Critical Structural Fixes

1) Enforce tenant scoping on location update

   - Purpose: prevent cross-company/branch updates.
   - Impacted modules: `backend/routes/agents.routes.ts`, `backend/lib/tenantScope.ts`
   - Priority: P0
   - Difficulty: Low
   - Dependencies: None
2) Define “agent-self” permission policy

   - Purpose: allow agents to update only their own location without manage_agents.
   - Impacted modules: `backend/lib/security.ts`, `backend/routes/agents.routes.ts`
   - Priority: P0
   - Difficulty: Medium
   - Dependencies: user identity + agent link (userId)
3) Schema constraints and indexes

   - Purpose: enforce integrity and performance.
   - Impacted modules: `backend/db/schema.pg.ts`, `backend/db/schema.sqlite.ts`, migrations
   - Priority: P0
   - Difficulty: Medium
   - Dependencies: confirm intended FK behavior
4) Align local runtime agent_inventory schema

   - Purpose: avoid divergence between offline and server.
   - Impacted modules: `src/lib/localRuntime.ts`, DB schemas
   - Priority: P1
   - Difficulty: Medium
   - Dependencies: decision on warehouse linkage

## Phase 2: Operational Completion

1) Agent stock-out on sales

   - Purpose: reduce agent inventory when agent sells.
   - Impacted modules: `backend/services/invoiceLifecycle.ts`, `backend/routes/invoices.routes.ts`, `agent_inventory`
   - Priority: P0
   - Difficulty: High
   - Dependencies: clear business rule for which warehouse is used for agent sale
2) Agent inventory reconciliation and returns

   - Purpose: support returning stock to warehouse and reconcile discrepancies.
   - Impacted modules: `backend/routes/agents.routes.ts`, inventory services
   - Priority: P1
   - Difficulty: Medium
   - Dependencies: inventory movement policy
3) Agent lifecycle UI

   - Purpose: edit, deactivate/reactivate, branch assignment.
   - Impacted modules: `src/pages/Agents.tsx`, `backend/routes/generic.routes.ts`
   - Priority: P1
   - Difficulty: Medium
   - Dependencies: permissions model

## Phase 3: Analytics / Reporting / Polish

1) Agent performance reports

   - Purpose: sales, collections, inventory turnover per agent.
   - Impacted modules: `backend/routes/reports.routes.ts`, `src/pages/Reports.tsx`
   - Priority: P2
   - Difficulty: Medium
   - Dependencies: invoice + agent inventory linkage
2) Branch Radar KPIs for agents

   - Purpose: show agent metrics per branch in Branch Radar.
   - Impacted modules: `src/pages/Branches.tsx`, reporting data provider
   - Priority: P2
   - Difficulty: Medium
   - Dependencies: reporting endpoints
3) Commission accounting

   - Purpose: post commission as expense or liability.
   - Impacted modules: accounting services, new ledger logic
   - Priority: P2
   - Difficulty: High
   - Dependencies: commission policy definition

   # Agents Module Gap Matrix (Branch Radar Context)

   Generated: 2026-04-02

   Legend:


   - Existing/Good
   - Existing/Incomplete
   - Missing/Expected
   - Risky/Inconsistent
   - Legacy/Dead

   ## Existing/Good

   1) Agent base entities exist (`agents`, `agent_inventory`, `agent_transfers`).
   2) Inventory transfer-in workflow exists (`POST /api/agent-inventory/transfer`).
   3) UI provides basic list, stats, map, and transfer dialog.
   4) Tenant scope utilities exist and are used for reads.
   5) Permissions mapped in `security.ts` and module definitions exist.

   ## Existing/Incomplete

   1) Agents CRUD via generic route lacks validation and lifecycle logic.
   2) Agent map depends on invoice geo data but has no server-side aggregation.
   3) Commission is displayed but not persisted or accounted.
   4) Branch Radar integration is only a navigation button.
   5) Local runtime supports agents but diverges from server schema (warehouseId field).

   ## Missing/Expected

   1) Agent stock-out on sales (inventory and accounting).
   2) Agent lifecycle workflows (edit, deactivate/reactivate).
   3) Branch assignment management UI and constraints.
   4) Reporting and exports by agent.
   5) Agent financial settlement or commission posting.
   6) Audit fields on agents and transfers.
   7) Agent performance KPIs in Branch Radar.

   ## Risky/Inconsistent

   1) `POST /api/agents/:id/location` lacks company/branch scope validation.
   2) Missing foreign keys and uniqueness constraints for agent_inventory.
   3) `agent_inventory` has no warehouse linkage; local runtime uses `warehouseId`.
   4) Agent role lacks permissions to update its own location (likely blocked).

   ## Legacy/Dead

   1) No confirmed dead code specific to Agents, but limited features suggest partial implementation.

   # Agents Module Dependencies

   Generated: 2026-04-02

   ## Core Backend Dependencies

   1) Tenant/Branch scoping:
      - `backend/lib/tenantScope.ts`
   2) Permissions and route policy:
      - `backend/lib/security.ts`
      - `backend/routes/generic.routes.ts`
   3) Inventory movement:
      - `backend/inventoryService.ts` (stock movement helper used in transfer)
   4) Warehouse data:
      - `warehouses` table and access checks

   ## Core Frontend Dependencies

   1) Data loading:
      - `src/App.tsx` fetches `agents` alongside core data
   2) Maps:
      - `react-leaflet`, OpenStreetMap tiles
   3) Invoices for KPI:
      - `src/pages/Agents.tsx` uses invoice data for agent sales stats

   ## Data Model Dependencies

   1) `agents` table
   2) `agent_inventory` table
   3) `agent_transfers` table
   4) `users` table (agent is tied to userId)

   ## Related Modules

   1) Inventory module (warehouse stock and movements)
   2) Invoice lifecycle (sales attribution)
   3) Branch Radar (navigation context only)
   4) Reports (currently no agent reports; report filters reference agent role)

   ## External/Operational Dependencies

   1) Map tile provider (OpenStreetMap)
   2) Browser geolocation (agent location updates)
