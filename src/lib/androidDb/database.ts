import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { applyAndroidDbMigrations } from './migrations';
import { applyAndroidSqlitePragmas } from './sqlitePragmas';

export const ANDROID_DB_NAME = 'shamel_android_offline';
const ANDROID_DB_VERSION = 1;

const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbPromise: Promise<SQLiteDBConnection> | null = null;

export const isAndroidRuntime = () => Capacitor.getPlatform() === 'android';

export const getAndroidDb = async () => {
  if (!isAndroidRuntime()) {
    throw new Error('Android SQLite runtime is only available when running on Android via Capacitor.');
  }

  if (!dbPromise) {
    dbPromise = (async () => {
      const consistency = await sqlite.checkConnectionsConsistency();
      const hasConnection = await sqlite.isConnection(ANDROID_DB_NAME, false);
      const db = consistency.result && hasConnection.result
        ? await sqlite.retrieveConnection(ANDROID_DB_NAME, false)
        : await sqlite.createConnection(ANDROID_DB_NAME, false, 'no-encryption', ANDROID_DB_VERSION, false);

      const isOpen = await db.isDBOpen();
      if (!isOpen.result) {
        await db.open();
      }

      await applyAndroidSqlitePragmas(db);
      await applyAndroidDbMigrations(db);
      return db;
    })();
  }

  return dbPromise;
};

export const withAndroidDb = async <T>(fn: (db: SQLiteDBConnection) => Promise<T>) => {
  const db = await getAndroidDb();
  return fn(db);
};
