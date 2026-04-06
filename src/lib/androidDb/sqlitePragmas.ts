import type { SQLiteDBConnection } from '@capacitor-community/sqlite';

const PRAGMA_SQL = [
  'PRAGMA foreign_keys = ON;',
  'PRAGMA journal_mode = WAL;',
  'PRAGMA synchronous = NORMAL;',
  'PRAGMA temp_store = MEMORY;'
];

export const applyAndroidSqlitePragmas = async (db: SQLiteDBConnection) => {
  for (const statement of PRAGMA_SQL) {
    await db.execute(statement, false);
  }
};
