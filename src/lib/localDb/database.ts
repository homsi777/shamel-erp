import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { runLocalDbMigrations } from './migrations';

export const LOCAL_DB_NAME = 'shamel_local';
const LOCAL_DB_VERSION = 1;

const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbPromise: Promise<SQLiteDBConnection> | null = null;

export const isAndroidLocalDbRuntime = () => Capacitor.getPlatform() === 'android';

export const getLocalDb = async () => {
  if (!isAndroidLocalDbRuntime()) {
    throw new Error('Local SQLite runtime is only available on Android.');
  }

  if (!dbPromise) {
    dbPromise = (async () => {
      const consistency = await sqlite.checkConnectionsConsistency();
      const hasConnection = await sqlite.isConnection(LOCAL_DB_NAME, false);
      const db = consistency.result && hasConnection.result
        ? await sqlite.retrieveConnection(LOCAL_DB_NAME, false)
        : await sqlite.createConnection(LOCAL_DB_NAME, false, 'no-encryption', LOCAL_DB_VERSION, false);

      const isOpen = await db.isDBOpen();
      if (!isOpen.result) {
        await db.open();
      }

      await runLocalDbMigrations(db);
      return db;
    })();
  }

  return dbPromise;
};

export const withLocalDb = async <T>(fn: (db: SQLiteDBConnection) => Promise<T>) => {
  const db = await getLocalDb();
  return fn(db);
};

export const runStatement = async (statement: string, values: any[] = []) => {
  return withLocalDb((db) => db.run(statement, values));
};

export const runStatements = async (statements: string) => {
  return withLocalDb((db) => db.execute(statements, false));
};

export const queryRows = async <T = any>(statement: string, values: any[] = []) => {
  const result = await withLocalDb((db) => db.query(statement, values));
  return (result.values || []) as T[];
};

export const runInTransaction = async <T>(fn: (db: SQLiteDBConnection) => Promise<T>) => {
  return withLocalDb(async (db) => {
    await db.beginTransaction();
    try {
      const result = await fn(db);
      await db.commitTransaction();
      return result;
    } catch (error) {
      await db.rollbackTransaction();
      throw error;
    }
  });
};

export const resetLocalDb = async () => {
  await runStatements(`
    DELETE FROM reconciliation_marks;
    DELETE FROM sync_queue;
    DELETE FROM journal_entries;
    DELETE FROM inventory_transactions;
    DELETE FROM invoice_items;
    DELETE FROM invoices;
    DELETE FROM vouchers;
    DELETE FROM party_transactions;
    DELETE FROM party_transfers;
    DELETE FROM stock_transfers;
    DELETE FROM expenses;
    DELETE FROM expense_lines;
    DELETE FROM salary_transactions;
    DELETE FROM employees;
    DELETE FROM partner_transactions;
    DELETE FROM partners;
    DELETE FROM parties;
    DELETE FROM items;
    DELETE FROM cashboxes;
    DELETE FROM warehouses;
    DELETE FROM branches;
    DELETE FROM categories;
    DELETE FROM sub_categories;
    DELETE FROM units;
    DELETE FROM accounts;
    DELETE FROM users;
    DELETE FROM settings;
    DELETE FROM runtime_meta;
  `);
};
