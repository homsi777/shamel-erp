import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { migration0001InitialContractSql } from './v0001_initialContract';

type Migration = {
  version: number;
  name: string;
  sql: string;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '0001_initial_contract',
    sql: migration0001InitialContractSql
  }
];

const ensureMigrationTable = async (db: SQLiteDBConnection) => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `, false);
};

export const applyAndroidDbMigrations = async (db: SQLiteDBConnection) => {
  await ensureMigrationTable(db);

  const existing = await db.query('SELECT version FROM schema_migrations', []);
  const appliedVersions = new Set<number>((existing.values || []).map((row: any) => Number(row.version)));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await db.beginTransaction();
    try {
      await db.execute(migration.sql, false);
      await db.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, new Date().toISOString()]
      );
      await db.commitTransaction();
    } catch (error) {
      await db.rollbackTransaction();
      throw new Error(`Android DB migration failed at v${migration.version} (${migration.name}): ${String(error)}`);
    }
  }
};
