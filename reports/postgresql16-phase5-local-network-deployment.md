# PostgreSQL 16 Phase 5: Local Network Deployment Readiness

## Executive Summary

Phase 5 was executed for the backend/server ERP only.

Out of scope and untouched:

- Android/Capacitor runtime
- local embedded SQLite/mobile paths
- Google Cloud SQL
- internet-facing deployment

What Phase 5 achieved:

- backend LAN runtime was packaged around local PostgreSQL 16 as the primary data store
- backend host-mode startup now exposes explicit LAN URLs and configurable CORS/origin policy
- frontend/API defaults were corrected so LAN usage does not depend on hidden `localhost` or QR port `3222` assumptions
- operator-grade health/readiness endpoints were added
- PostgreSQL backup and restore-verification tooling was added using native PostgreSQL 16 binaries
- host-side LAN validation succeeded on `http://192.168.1.104:3111`
- authenticated LAN login, voucher creation, reporting read, and centralized print-job persistence all succeeded against PostgreSQL

Current readiness assessment:

- ready for a controlled local-network pilot on the host machine
- not yet fully closed for unconditional technician signoff until:
  - one real second LAN device is tested physically
  - PostgreSQL service is restarted with elevation so the new local-only `listen_addresses` setting takes effect

## Final Local Network Architecture

Host machine role:

- PostgreSQL 16 host
- backend API host
- frontend static host from the same backend process
- centralized print-job persistence host

Client device role:

- browser access from LAN devices to the host machine
- optional local app/browser sessions on the same LAN

Chosen LAN access pattern:

- App URL: `http://192.168.1.104:3111`
- API base: `http://192.168.1.104:3111/api`
- health: `http://192.168.1.104:3111/api/system/healthz`
- readiness: `http://192.168.1.104:3111/api/system/readiness`

Deployment policy:

- backend/UI exposed to LAN on port `3111`
- QR/public restaurant flow configured to use the same host port by default for LAN deployment
- PostgreSQL should remain application-local and not be used directly by LAN clients

## Host Machine Requirements

- Windows host with LAN IP preferred to be stable/static
- PostgreSQL 16 installed as Windows service
- current service observed:
  - `postgresql-x64-16`
  - status: `Running`
  - startup type: `Automatic`
- Node/npm available for source-based local host operation
- PostgreSQL client binaries available at:
  - `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe`
  - `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe`
  - `C:\Program Files\PostgreSQL\16\bin\psql.exe`

## PostgreSQL Local Service Requirements

Application connection policy:

- application connects to PostgreSQL through `127.0.0.1:5432`
- LAN clients do not connect to PostgreSQL directly

Observed live PostgreSQL state during this phase:

- database service reachable and healthy
- `listen_addresses` live value: `*`
- live listener observed on:
  - `0.0.0.0:5432`
  - `:: :5432`

Hardening action completed on disk:

- [postgresql.conf](C:/Program Files/PostgreSQL/16/data/postgresql.conf) was updated from:
  - `listen_addresses = '*'`
- to:
  - `listen_addresses = '127.0.0.1,localhost'`

Important limitation:

- this environment could not restart the Windows PostgreSQL service with elevation
- result:
  - hardening is written to disk
  - hardening is not yet live
  - it will require an elevated service restart or host reboot to apply

`pg_hba.conf` already only allowed local connections during inspection, which reduces immediate remote database access risk even before restart.

## Exact Environment / Config Used

Primary LAN profile packaging:

- [.env.lan.example](/c:/Users/Homsi/Desktop/PostgreSQL%2016/.env.lan.example)

Key runtime variables:

```env
NODE_ENV=production
DB_DIALECT=postgres
DATABASE_URL=postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg
JWT_SECRET=<strong random secret>
SERVER_HOST=0.0.0.0
SERVER_PORT=3111
APP_BASE_URL=http://192.168.1.104:3111
PUBLIC_BASE_URL=http://192.168.1.104:3111
VITE_API_BASE_URL=http://192.168.1.104:3111/api
QR_MENU_PORT=3111
VITE_QR_MENU_PORT=3111
CORS_ALLOWED_ORIGINS=http://192.168.1.104:3111,http://localhost:5173,http://127.0.0.1:5173
PG_BIN_DIR=C:\Program Files\PostgreSQL\16\bin
```

Runtime/config changes introduced:

- [server.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/server.ts)
  - env-driven host/port/base URL support
  - explicit startup LAN URL logging
  - configurable CORS origin allowlist
- [system.routes.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/routes/system.routes.ts)
  - `GET /api/system/healthz`
  - `GET /api/system/readiness`
  - richer `GET /api/system/status`
- [security.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/lib/security.ts)
  - made health/readiness endpoints operator-accessible
- [api.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/lib/api.ts)
  - `VITE_API_BASE_URL` support
- [restaurantPublic.api.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/modules/restaurant/public/restaurantPublic.api.ts)
  - `VITE_API_BASE_URL` support
- [RestaurantQR.tsx](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/modules/restaurant/RestaurantQR.tsx)
- [RestaurantSettings.tsx](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/modules/restaurant/RestaurantSettings.tsx)
- [RestaurantOperationsDashboard.tsx](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/modules/restaurant/RestaurantOperationsDashboard.tsx)
- [App.tsx](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/App.tsx)
  - same-port LAN-safe QR/public defaults

## Ports and Firewall Requirements

Required for LAN pilot:

- `3111/tcp`
  - backend API
  - static frontend
  - same-port QR/public access in the chosen LAN mode

Should remain local-only:

- `5432/tcp`
  - PostgreSQL application-local port only

Observed listening ports during validation:

- `3111` on `0.0.0.0`
- `5432` on `0.0.0.0` and `::` before privileged restart could be performed

Firewall observations:

- no explicit Windows firewall rule was found in this environment for port `3111`
- no explicit PostgreSQL firewall rule was surfaced by the quick rule query

Recommended firewall posture:

- allow inbound `3111/tcp` only on the local/private network profile
- do not create a LAN firewall allow rule for `5432`
- after elevated PostgreSQL service restart, verify `5432` no longer binds to LAN interfaces

## LAN Access URLs

Validated host URLs:

- `http://192.168.1.104:3111`
- `http://192.168.1.104:3111/api/system/status`
- `http://192.168.1.104:3111/api/system/healthz`
- `http://192.168.1.104:3111/api/system/readiness`
- `http://192.168.1.104:3111/api/restaurant/network-ready`

## Startup Procedure

Recommended operator flow:

1. Ensure PostgreSQL 16 Windows service is running.
2. Copy [.env.lan.example](/c:/Users/Homsi/Desktop/PostgreSQL%2016/.env.lan.example) to `.env.lan.local` and set the real host IP and strong `JWT_SECRET`.
3. Build the LAN frontend:

```powershell
$env:VITE_API_BASE_URL='http://192.168.1.104:3111/api'
$env:VITE_QR_MENU_PORT='3111'
npm run build:lan
```

4. Start the host runtime:

```powershell
npm run server:pg:lan
```

5. Confirm readiness:

```powershell
$env:APP_BASE_URL='http://192.168.1.104:3111'
npm run test:lan:host
```

High-value one-command host flow:

```powershell
npm run lan:host:start
```

Important:

- `lan:host:start` assumes LAN profile env values are already available
- it is intended for operator convenience, not for hiding configuration

## Shutdown / Recovery Procedure

Safe shutdown:

1. stop the backend process cleanly
2. leave PostgreSQL service running unless host maintenance requires stopping it

If the host reboots:

1. confirm PostgreSQL service is back in `Running`
2. restart backend with `npm run server:pg:lan`
3. confirm:
   - `/api/system/healthz`
   - `/api/system/readiness`

If backend fails first:

- PostgreSQL should still answer local connection checks
- restart only the backend process

If PostgreSQL fails first:

- `/api/system/readiness` should fail
- backend may remain listening but not ready for operation
- restore PostgreSQL service first, then recheck readiness

## Backup / Restore Procedure

New PostgreSQL-specific tooling:

- [db-pg-backup.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/db-pg-backup.ts)
- [db-pg-restore.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/db-pg-restore.ts)
- [\_pgTools.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/scripts/_pgTools.ts)

NPM commands:

```powershell
npm run db:pg:backup
npm run db:pg:restore:verify
```

Backup behavior:

- uses PostgreSQL native `pg_dump`
- output format: custom dump
- default backup directory: `data/pg-backups`

Real backup executed in this phase:

- `C:\Users\Homsi\Desktop\PostgreSQL 16\data\pg-backups\shamel_erp_pg-20260401-191154.dump`

Real restore verification executed in this phase:

- restored into temp database:
  - `shamel_erp_pg_restore_verify_20260401-191507`
- sanity result:
  - invoices: `184`
  - vouchers: `314`
  - journal_entries: `193`
- temp verification database was dropped automatically after the check

Recommended backup cadence for LAN pilot:

- minimum daily backup
- additional pre-maintenance backup
- additional pre-upgrade backup

## Validation Results

### Host-Side LAN Validation

Validated successfully from the host using the real LAN IP `192.168.1.104`:

- static frontend served from `http://192.168.1.104:3111`
- API status reachable over LAN IP
- health endpoint reachable over LAN IP
- readiness endpoint reachable over LAN IP
- restaurant network-ready endpoint reachable over LAN IP
- browser-access checks passed

Relevant command outputs:

- `npm run test:browser-access`
  - passed `7/7`
- `npm run test:lan:host`
  - success `true`
  - database `shamel_erp_pg`
  - invoices count `184`

### Auth / Session / Business Validation Over LAN URL

Validated over `http://192.168.1.104:3111/api`:

- login as `admin`
- authenticated report read:
  - trial balance returned `88` lines
- authenticated operational write:
  - voucher `lan-v-1775096208869` created successfully
  - persisted as:
    - type `receipt`
    - amount `12.500000`
    - status `POSTED`
- centralized print persistence:
  - print job `pj-1775096228583-mw0clooe` stored successfully with:
    - `print_type=customer_receipt`
    - `document_type=voucher`
    - `printer_id=lan-host-printer`

### Multiple Devices

What was validated in this environment:

- host machine via actual LAN IP path, not only `localhost`

What was not physically validated in this environment:

- a separate second device on the same LAN

Reason:

- this execution environment has no direct control over an external physical client device

Required follow-up before broad site rollout:

- confirm login and one document flow from at least one second LAN device
- recommended validation URL:
  - `http://192.168.1.104:3111`

## Printer / Receipt / Restaurant LAN Readiness

Validated:

- centralized print-job persistence still works when requests hit the host by LAN IP
- restaurant network-ready endpoint works on the LAN URL
- QR/public defaults were corrected so same-port LAN deployments do not silently require `3222`

Pending physical validation:

- actual kitchen/receipt printer device reachability from the deployed host
- actual LAN client to printer operational path

What remains true architecturally:

- print jobs are queued centrally on the host/backend
- LAN browser terminals should not require localhost-based printer addresses
- device-specific local USB printing assumptions still depend on the specific client platform and remain separate from backend LAN readiness

## Commands Executed

```powershell
$env:VITE_API_BASE_URL='http://192.168.1.104:3111/api'
$env:VITE_QR_MENU_PORT='3111'
npm run build:lan

npm run db:pg:backup
npm run db:pg:restore:verify

npm run server:pg:lan

$env:APP_BASE_URL='http://192.168.1.104:3111'
npm run test:lan:host

npm run test:browser-access
```

Additional direct validation used:

- `Invoke-WebRequest http://192.168.1.104:3111/api/system/status`
- `Invoke-WebRequest http://192.168.1.104:3111/api/system/healthz`
- authenticated LAN login + voucher create + trial balance read via the real LAN host URL

## Known Limitations / Pending Items

1. Physical second-device validation is still pending.
2. PostgreSQL local-only bind hardening is written to disk but not live until an elevated service restart or host reboot occurs.
3. Existing SQLite-only backup routes remain in the codebase for the legacy path and are not the authoritative PostgreSQL backup mechanism for LAN deployment.
4. Printer device-path validation was limited to centralized print-job persistence, not end-to-end physical printer output.

## Recommendation

Recommendation for real local-network pilot use:

- conditionally ready

Conditions before pilot signoff:

1. restart PostgreSQL 16 service with elevation so the updated `listen_addresses='127.0.0.1,localhost'` becomes active
2. confirm from one physical second LAN device:
   - login
   - dashboard load
   - one write flow
   - one report read

If those two checks pass, this deployment is ready for a real LAN pilot without cloud dependency.
