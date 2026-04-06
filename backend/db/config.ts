import os from 'os';
import path from 'path';

export type DatabaseDialect = 'sqlite' | 'postgres';

const getArg = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  return idx > -1 ? process.argv[idx + 1] : null;
};

const resolveDialect = (): DatabaseDialect => {
  const raw = String(process.env.DB_DIALECT || 'sqlite').trim().toLowerCase();
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') return 'postgres';
  return 'sqlite';
};

const resolveSqliteDbPath = (): string => {
  const fromArg = getArg('--dbPath');
  if (fromArg) return fromArg;
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.DB_PATH_FROM_ELECTRON) return process.env.DB_PATH_FROM_ELECTRON;

  const isElectron = Boolean((process.versions as any)?.electron || process.env.ELECTRON_IS_PACKAGED);
  const baseDir = isElectron
    ? path.join(os.homedir(), 'ShamelERP', 'data')
    : path.join(process.cwd(), 'data');

  return path.join(baseDir, 'shamel.db');
};

const redactDatabaseUrl = (value: string) =>
  value.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)([^@\s]+)(@)/i, '$1****$3');

const resolvePostgresUrl = (): string => {
  const value = String(process.env.DATABASE_URL || '').trim();
  if (!value) {
    throw new Error('[db] DATABASE_URL is required when DB_DIALECT=postgres.');
  }
  return value;
};

const resolvePostgresStateDir = (databaseUrl: string): string => {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.replace(/^\//, '') || 'postgres';
    return path.join(process.cwd(), 'data', 'postgres-state', databaseName);
  } catch {
    return path.join(process.cwd(), 'data', 'postgres-state', 'unknown');
  }
};

export const databaseDialect = resolveDialect();

export const databaseConfig = (() => {
  if (databaseDialect === 'postgres') {
    const databaseUrl = resolvePostgresUrl();
    return {
      dialect: 'postgres' as const,
      databaseUrl,
      databaseUrlRedacted: redactDatabaseUrl(databaseUrl),
      sqliteDbPath: null,
      localStateDir: resolvePostgresStateDir(databaseUrl),
    };
  }

  const sqliteDbPath = resolveSqliteDbPath();
  return {
    dialect: 'sqlite' as const,
    databaseUrl: null,
    databaseUrlRedacted: null,
    sqliteDbPath,
    localStateDir: path.dirname(sqliteDbPath),
  };
})();
