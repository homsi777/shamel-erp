import { databaseConfig, databaseDialect } from './config';
import { wrapCompatDb } from './compat';

const runtime = databaseDialect === 'postgres'
  ? await import('./postgres')
  : await import('./sqlite');

export { databaseConfig, databaseDialect };

export const db = wrapCompatDb(runtime.db);
export const rawSqlite = runtime.rawSqlite;
export const pgPool = (runtime as any).pgPool ?? null;
export const getResolvedDbPath = runtime.getResolvedDbPath;
export const getDatabaseStateDir = (runtime as any).getDatabaseStateDir;
export const closeDb = runtime.closeDb;
export const verifyDatabaseConnectivity = runtime.verifyDatabaseConnectivity;
export const ensureDatabaseReady = runtime.ensureDatabaseReady;
export const isSqliteDialect = () => databaseDialect === 'sqlite';
export const isPostgresDialect = () => databaseDialect === 'postgres';
