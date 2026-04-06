/**
 * Documentation-only: regenerates docs/database-schema*.json from backend/db/schema.ts
 * (Drizzle getTableConfig). Not imported by the application runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import type { ForeignKey } from "drizzle-orm/sqlite-core/foreign-keys";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core/columns";
import * as schema from "../backend/db/schema";

const Cardinality = { MANY_TO_ONE: "many_to_one" } as const;

type ColJson = {
  name: string;
  sqliteType: string;
  primaryKey: boolean;
  nullable: boolean;
  hasDefault: boolean;
  autoIncrement: boolean;
  unique: boolean;
  uniqueName?: string;
  default?: string;
};

function serializeDefault(def: unknown): string | undefined {
  if (def === undefined || def === null) return undefined;
  if (typeof def === "boolean" || typeof def === "number") return String(def);
  if (typeof def === "string") return def;
  const s = String(def);
  if (s.includes("CURRENT_TIMESTAMP")) return "CURRENT_TIMESTAMP";
  if (typeof def === "object" && def !== null && "queryChunks" in def) return "CURRENT_TIMESTAMP";
  try {
    return JSON.stringify(def);
  } catch {
    return "[unserializable]";
  }
}

function colToJson(c: SQLiteColumn): ColJson {
  const def = c.default;
  const j: ColJson = {
    name: c.name,
    sqliteType: c.getSQLType(),
    primaryKey: c.primary,
    nullable: !c.notNull,
    hasDefault: c.hasDefault,
    autoIncrement: !!(c as SQLiteColumn & { autoIncrement?: boolean }).autoIncrement,
    unique: c.isUnique,
  };
  if (c.isUnique && c.uniqueName) j.uniqueName = c.uniqueName;
  if (c.hasDefault && def !== undefined) j.default = serializeDefault(def);
  return j;
}

function fkToJson(fk: ForeignKey) {
  const ref = fk.reference();
  const ft = ref.foreignTable as SQLiteTable;
  const fcfg = getTableConfig(ft);
  return {
    columns: ref.columns.map((c) => c.name),
    referencedTable: fcfg.name,
    referencedColumns: ref.foreignColumns.map((c) => c.name),
    onUpdate: fk.onUpdate,
    onDelete: fk.onDelete,
  };
}

const tablesRaw: {
  exportName: string;
  tableName: string;
  columns: ColJson[];
  foreignKeys: ReturnType<typeof fkToJson>[];
  indexes: { name?: string; unique?: boolean; columns: string[] }[];
  uniqueConstraints: { name?: string; columns: string[] }[];
}[] = [];

for (const [exportName, table] of Object.entries(schema)) {
  if (!is(table, SQLiteTable)) continue;
  const cfg = getTableConfig(table);
  tablesRaw.push({
    exportName,
    tableName: cfg.name,
    columns: cfg.columns.map(colToJson),
    foreignKeys: cfg.foreignKeys.map(fkToJson),
    indexes: cfg.indexes.map((ix) => ({
      name: ix.config.name,
      unique: ix.config.unique,
      columns: ix.config.columns.map((c) =>
        typeof (c as SQLiteColumn).name === "string" ? (c as SQLiteColumn).name : "[expression]",
      ),
    })),
    uniqueConstraints: cfg.uniqueConstraints.map((u) => ({
      name: u.getName?.() ?? u.name,
      columns: u.columns.map((c) => c.name),
    })),
  });
}

tablesRaw.sort((a, b) => a.tableName.localeCompare(b.tableName));

const rawPayload = {
  meta: {
    sourceFile: "backend/db/schema.ts",
    dialect: "sqlite",
    generatedBy: "scripts/export-database-schema-drawdb.ts (Drizzle getTableConfig)",
  },
  tables: tablesRaw,
};

function sqlTypeToDrawDb(t: string): string {
  const u = t.toLowerCase();
  if (u === "integer") return "INTEGER";
  if (u === "real") return "REAL";
  if (u === "text") return "TEXT";
  if (u === "blob") return "BLOB";
  if (u === "numeric") return "NUMERIC";
  return t.toUpperCase();
}

const junctionTables = new Set([
  "item_group_items",
  "user_branch_access",
  "user_company_access",
  "consignment_settlement_lines",
  "consignment_document_lines",
]);

const logicalRelationships: {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  note: string;
}[] = [];

const scopePairs: [string, string, string][] = [
  ["company_id", "companies", "id"],
  ["branch_id", "branches", "id"],
];

for (const tbl of tablesRaw) {
  for (const col of tbl.columns) {
    for (const [colName, refTable, refCol] of scopePairs) {
      if (col.name === colName && refTable !== tbl.tableName) {
        logicalRelationships.push({
          fromTable: tbl.tableName,
          fromColumn: col.name,
          toTable: refTable,
          toColumn: refCol,
          note: "Logical scoping reference (not declared as Drizzle/SQLite FK in schema.ts)",
        });
      }
    }
  }
}

const normalizedOut = {
  ...rawPayload.meta,
  exportVersion: 1,
  notes: [
    "Authoritative source: backend/db/schema.ts (Drizzle ORM).",
    "Foreign keys and indexes reflect Drizzle getTableConfig(); logical references (e.g. company_id → companies) are listed separately where not enforced as SQLite FK.",
  ],
  tableCount: tablesRaw.length,
  junctionOrPivotTables: [...junctionTables].filter((t) => tablesRaw.some((x) => x.tableName === t)),
  tables: tablesRaw.map((t) => ({
    name: t.tableName,
    exportName: t.exportName,
    isJunctionOrPivot: junctionTables.has(t.tableName),
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.sqliteType.toUpperCase(),
      primaryKey: c.primaryKey,
      nullable: c.nullable,
      autoIncrement: c.autoIncrement,
      unique: !!c.unique,
      uniqueName: c.uniqueName,
      default: c.hasDefault ? c.default : undefined,
      hasDefault: c.hasDefault,
    })),
    foreignKeys: t.foreignKeys.map((fk) => ({
      columns: fk.columns,
      references: {
        table: fk.referencedTable,
        columns: fk.referencedColumns,
      },
      onUpdate: fk.onUpdate,
      onDelete: fk.onDelete,
    })),
    indexes: t.indexes,
    uniqueConstraints: t.uniqueConstraints,
  })),
  relationshipsInferred: logicalRelationships,
};

const tableByName = new Map(tablesRaw.map((t, i) => [t.tableName, { t, i }]));

const drawTables: unknown[] = [];
const drawRels: unknown[] = [];

let gridPos = 0;
const gridCols = 6;
const cellW = 280;
const cellH = 120;

tablesRaw.forEach((t, ti) => {
  const x = (gridPos % gridCols) * cellW;
  const y = Math.floor(gridPos / gridCols) * cellH;
  gridPos++;

  const fields = t.columns.map((c, fi) => {
    const rawDef = c.default ?? "";
    const defaultValue: string | number | boolean =
      typeof rawDef === "number" || typeof rawDef === "boolean" ? rawDef : String(rawDef);
    return {
      name: c.name,
      type: sqlTypeToDrawDb(c.sqliteType),
      default: defaultValue,
      check: "",
      primary: c.primaryKey,
      unique: !!c.unique,
      notNull: !c.nullable,
      increment: c.autoIncrement,
      comment: "",
      id: fi,
    };
  });

  drawTables.push({
    id: ti,
    name: t.tableName,
    x,
    y,
    locked: false,
    fields,
    comment: t.exportName !== t.tableName ? `export: ${t.exportName}` : "",
    indices: t.indexes.map((ix) => ({
      name: ix.name ?? "",
      unique: !!ix.unique,
      fields: ix.columns,
    })),
    color: "#175e7a",
  });
});

let relId = 0;
for (const tbl of tablesRaw) {
  const childTi = tableByName.get(tbl.tableName)?.i;
  if (childTi === undefined) continue;
  const childFields = tbl.columns;

  for (const fk of tbl.foreignKeys) {
    const parentEntry = tableByName.get(fk.referencedTable);
    if (!parentEntry) continue;
    const parentTi = parentEntry.i;
    const parentTbl = parentEntry.t;

    fk.columns.forEach((fromCol, idx) => {
      const toCol = fk.referencedColumns[idx] ?? fk.referencedColumns[0];
      const startFieldId = childFields.findIndex((c) => c.name === fromCol);
      const endFieldId = parentTbl.columns.findIndex((c) => c.name === toCol);
      if (startFieldId < 0 || endFieldId < 0) return;

      drawRels.push({
        id: relId++,
        name: `${tbl.tableName}_${fromCol}_fk`,
        cardinality: Cardinality.MANY_TO_ONE,
        updateConstraint: fk.onUpdate ?? "No action",
        deleteConstraint: fk.onDelete ?? "No action",
        startTableId: childTi,
        startFieldId,
        endTableId: parentTi,
        endFieldId,
      });
    });
  }
}

/**
 * drawDB rejects import when `database` !== the editor’s selected DB (see ImportDiagram.jsx).
 * New diagrams usually use `generic`; use that here so import works without changing the dropdown.
 * (Runtime DB is still SQLite — this is only for the diagram tool.)
 */
const drawdb = {
  tables: drawTables,
  relationships: drawRels,
  notes: [],
  subjectAreas: [],
  database: "generic",
  title: "Hajar ERP — schema (from Drizzle)",
  types: [],
};

const report = {
  generated: new Date().toISOString(),
  source: "backend/db/schema.ts (Drizzle) via getTableConfig",
  tableCount: tablesRaw.length,
  relationshipCountExplicitFk: drawRels.length,
  relationshipCountLogicalScoping: logicalRelationships.length,
  junctionPivotTablesDocumented: [...junctionTables],
  unclearTables: [] as string[],
  inferredVsConfirmed: {
    confirmedForeignKeys: "Drizzle foreignKeys in schema (SQLite FK constraints)",
    inferredLogicalRelationships:
      "company_id → companies.id, branch_id → branches.id where columns exist (not enforced as FK in schema)",
  },
  notes: [
    "journal_entry_lines.party_id is integer in schema while parties.id is text — type mismatch; no FK in Drizzle.",
    "vouchers.journal_entry_id is text in schema; journal_entries.id is integer — no FK in Drizzle.",
  ],
};

const docsDir = path.join(process.cwd(), "docs");
fs.mkdirSync(docsDir, { recursive: true });

fs.writeFileSync(path.join(docsDir, "database-schema.normalized.json"), JSON.stringify(normalizedOut, null, 2), "utf8");
fs.writeFileSync(path.join(docsDir, "database-schema.drawdb.json"), JSON.stringify(drawdb, null, 2), "utf8");
fs.writeFileSync(path.join(docsDir, "database-schema-export-report.json"), JSON.stringify(report, null, 2), "utf8");

const reportMd = `# Database schema export report

Generated: ${report.generated}

## Summary

| Metric | Value |
|--------|-------|
| Tables exported | ${report.tableCount} |
| DrawDB relationships (Drizzle FKs only) | ${report.relationshipCountExplicitFk} |
| Logical scoping edges (company/branch) in normalized JSON | ${report.relationshipCountLogicalScoping} |

## Source

- **Canonical schema:** \`backend/db/schema.ts\` (Drizzle ORM, SQLite)
- **Generator:** \`scripts/export-database-schema-drawdb.ts\`

## Deliverables

| File | Purpose |
|------|---------|
| \`docs/database-schema.normalized.json\` | Full normalized schema + logical scoping relationships |
| \`docs/database-schema.drawdb.json\` | drawDB **Import JSON** — shape matches [drawDB \`jsonSchema\`](https://github.com/drawdb-io/drawdb/blob/main/src/data/schemas.js): required keys \`tables\`, \`relationships\`, \`notes\`, \`subjectAreas\`; each table index uses \`fields\` (not \`columns\`). Uses \`database: \"generic\"\` so it matches drawDB’s default canvas; if your diagram is set to SQLite/MySQL/etc., either switch the dropdown to **Generic** or change that one field to match. |
| \`docs/database-schema-export-report.json\` | Machine-readable report |

## Junction / pivot tables (labeled in normalized JSON)

${report.junctionPivotTablesDocumented.map((t) => `- \`${t}\``).join("\n")}

## Inferred vs confirmed

- **Confirmed:** Foreign keys defined in Drizzle (SQLite).
- **Inferred:** \`company_id\` / \`branch_id\` scoping in \`relationshipsInferred\` (not SQLite FKs in schema).

## Caveats / unclear typing

${report.notes.map((n) => `- ${n}`).join("\n")}

## Regeneration

\`\`\`bash
npx tsx scripts/export-database-schema-drawdb.ts
\`\`\`
`;

fs.writeFileSync(path.join(docsDir, "database-schema-export-report.md"), reportMd, "utf8");

console.log(
  `Wrote docs/database-schema.normalized.json, docs/database-schema.drawdb.json, docs/database-schema-export-report.* (${tablesRaw.length} tables, ${drawRels.length} FK edges)`,
);
