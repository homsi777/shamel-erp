# PostgreSQL 16 Import/Export Alignment

## Summary

This pass focused on active import/export paths that matter under the PostgreSQL-first runtime. Android/local embedded SQLite remains out of scope and was not touched.

## Changed

### 1. Inventory item-tree import/export

Updated [Inventory.tsx](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/pages/Inventory.tsx):

- Exported item-tree numeric fields now serialize through PostgreSQL-safe string formatting instead of raw `Number(...)`.
- JSON export now includes metadata:
  - `dialect: "postgres"`
  - `source: "inventory.item-tree"`
- JSON template now uses a structured payload with:
  - `dialect`
  - `template`
  - `generatedAt`
  - `items`
- CSV template numeric fields now ship in clean formatted form instead of raw integer literals.

Reason:
- PostgreSQL numeric values may arrive as strings.
- Export/import templates should preserve clean numeric formatting and explicit source metadata.

### 2. System reset pre-backup

Updated [system.routes.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/routes/system.routes.ts):

- `/system/reset` no longer assumes SQLite file-copy backup under PostgreSQL.
- In PostgreSQL mode it now creates a real `.dump` backup using `pg_dump`.
- In SQLite mode it preserves the legacy `.db` backup flow.

Reason:
- Reset protection must create a database-appropriate backup before destructive operations.
- A PostgreSQL runtime cannot rely on SQLite file-copy semantics.

## Already aligned and verified

These paths were already PostgreSQL-aligned before this pass and were re-checked:

- [backups.routes.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/routes/backups.routes.ts)
  - DB backup/export/restore now uses PostgreSQL `.dump` in PostgreSQL mode.
- [useBackups.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/hooks/useBackups.ts)
  - frontend backup upload/download uses `.dump` in PostgreSQL mode.
- [BackupManager.tsx](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/components/settings/BackupManager.tsx)
  - settings UI now labels DB backups as PostgreSQL dump under PostgreSQL runtime.

## Audited and left unchanged

These export paths were checked and do not depend on SQLite runtime behavior:

- [SystemMonitoringDashboard.tsx](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/modules/system-monitoring/SystemMonitoringDashboard.tsx)
  - exports filtered/all events as JSON/Markdown from API data.
- [report.actions.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/src/modules/reports/report.actions.ts)
  - exports report tables as CSV from already prepared client-side datasets.
- [reports.trusted.ts](/c:/Users/Homsi/Desktop/PostgreSQL%2016/backend/routes/reports.trusted.ts)
  - CSV export is generated from report rows, not from SQLite-only file logic.

These did not require changes in this pass.

## Validation

Executed:

```powershell
npx tsc --noEmit
```

Result:

- TypeScript validation passed with no errors.

## Scope confirmation

Not touched:

- `src/lib/localDb/**`
- `android/**`
- Capacitor/local embedded SQLite runtime

