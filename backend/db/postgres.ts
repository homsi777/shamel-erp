import fs from 'fs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.pg';
import { databaseConfig } from './config';
import { ensureBootstrapFoundation } from './bootstrapFoundation';

const REQUIRED_MIGRATION_TABLE = '__backend_pg_migrations';

if (!databaseConfig.databaseUrl) {
  throw new Error('[db] PostgreSQL runtime requested without DATABASE_URL.');
}

fs.mkdirSync(databaseConfig.localStateDir, { recursive: true });

const pool = new Pool({
  connectionString: databaseConfig.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle(pool, { schema });
export const rawSqlite = null;
export const pgPool = pool;

export const getResolvedDbPath = () =>
  databaseConfig.databaseUrlRedacted || databaseConfig.databaseUrl || 'postgresql://unknown';

export const getDatabaseStateDir = () => databaseConfig.localStateDir;

export const verifyDatabaseConnectivity = async () => {
  const client = await pool.connect();
  try {
    const result = await client.query<{ current_database: string }>('select current_database()');
    return {
      ok: true,
      dialect: 'postgres',
      target: result.rows[0]?.current_database || 'unknown',
    };
  } finally {
    client.release();
  }
};

export const ensureDatabaseReady = async () => {
  const client = await pool.connect();
  try {
    const migrationResult = await client.query<{ exists: string | null }>(
      "select to_regclass('public.__backend_pg_migrations') as exists",
    );
    if (!migrationResult.rows[0]?.exists) {
      throw new Error(
        `[db] PostgreSQL schema is not initialized. Run the local PostgreSQL baseline workflow before starting the server. Expected migration table: ${REQUIRED_MIGRATION_TABLE}.`,
      );
    }

    const usersResult = await client.query<{ exists: string | null }>(
      "select to_regclass('public.users') as exists",
    );
    if (!usersResult.rows[0]?.exists) {
      throw new Error('[db] PostgreSQL baseline applied partially: expected core table "users" is missing.');
    }

    const bootstrap = await ensureBootstrapFoundation(client);
    if (bootstrap.insertedCodes > 0 || bootstrap.insertedSuperAdmin > 0) {
      console.log(
        `[db] PostgreSQL bootstrap ensured: activationCodes+${bootstrap.insertedCodes}, superAdmins+${bootstrap.insertedSuperAdmin}`,
      );
    }
  } finally {
    client.release();
  }
};

export const closeDb = async () => {
  await pool.end();
};
