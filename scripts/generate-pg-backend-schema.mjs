import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const dbDir = path.join(rootDir, 'backend', 'db');
const sqliteSchemaPath = path.join(dbDir, 'schema.sqlite.ts');
const pgSchemaPath = path.join(dbDir, 'schema.pg.ts');
const runtimeSchemaPath = path.join(dbDir, 'schema.ts');

const source = fs.readFileSync(sqliteSchemaPath, 'utf8');

const exportedNames = Array.from(source.matchAll(/export const (\w+)\s*=/g)).map((match) => match[1]);

const convertTextLine = (line) => {
  const match = line.match(/^(\s*)(\w+): text\('([^']+)'\)(.*)$/);
  if (!match) return line;

  const [, indent, propName, columnName, suffix] = match;
  const trimmedSuffix = suffix.trim();

  const isTimestamp =
    trimmedSuffix.includes(".default(sql`CURRENT_TIMESTAMP`)") ||
    /(?:^|_)(created_at|updated_at|posted_at|opened_at|closed_at|last_activity_at|submitted_at|seen_at|accepted_at|rejected_at|archived_at|resolved_at|printed_at|applied_at|used_at|last_login_at|reopened_at|timestamp)$/.test(columnName) ||
    /(At|Timestamp)$/.test(propName);

  const isDate =
    /(?:^|_)(date|birth_date|join_date|entry_date|start_date|end_date|settlement_date|valuation_date|reversal_date|from_date|to_date)$/.test(columnName) ||
    /Date$/.test(propName);

  if (isTimestamp) {
    const nextSuffix = suffix
      .replace(/\.default\(sql`CURRENT_TIMESTAMP`\)/g, '.defaultNow()');
    return `${indent}${propName}: timestamp('${columnName}', { withTimezone: true, mode: 'string' })${nextSuffix}`;
  }

  if (isDate) {
    return `${indent}${propName}: date('${columnName}', { mode: 'string' })${suffix}`;
  }

  return line;
};

let transformed = source;

transformed = transformed.replace(
  "import { sqliteTable, text, integer, real, AnySQLiteColumn, uniqueIndex } from 'drizzle-orm/sqlite-core';",
  "import { pgTable, text, integer, numeric, date, timestamp, boolean, AnyPgColumn, uniqueIndex, serial } from 'drizzle-orm/pg-core';",
);

transformed = transformed.replace(/sqliteTable\(/g, 'pgTable(');
transformed = transformed.replace(/AnySQLiteColumn/g, 'AnyPgColumn');
transformed = transformed.replace(/integer\('([^']+)',\s*\{\s*mode:\s*'boolean'\s*\}\)/g, "boolean('$1')");
transformed = transformed.replace(/integer\('([^']+)'\)\.primaryKey\(\{\s*autoIncrement:\s*true\s*\}\)/g, "serial('$1').primaryKey()");
transformed = transformed.replace(/real\('([^']+)'\)/g, "numeric('$1', { precision: 18, scale: 6, mode: 'number' })");
transformed = transformed
  .split(/\r?\n/g)
  .map((line) => convertTextLine(line))
  .join('\n');

const runtimeSchema = [
  "import * as sqliteSchema from './schema.sqlite';",
  "import * as pgSchema from './schema.pg';",
  "import { databaseDialect } from './config';",
  '',
  "const activeSchema = databaseDialect === 'postgres' ? pgSchema : sqliteSchema;",
  '',
  ...exportedNames.map((name) => `export const ${name} = activeSchema.${name};`),
  '',
].join('\n');

fs.writeFileSync(pgSchemaPath, transformed, 'utf8');
fs.writeFileSync(runtimeSchemaPath, runtimeSchema, 'utf8');

console.log(`[schema] generated PostgreSQL schema at ${path.relative(rootDir, pgSchemaPath)}`);
console.log(`[schema] generated runtime facade at ${path.relative(rootDir, runtimeSchemaPath)}`);
