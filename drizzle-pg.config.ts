import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg';

export default defineConfig({
  schema: './backend/db/schema.pg.ts',
  out: './backend/drizzle-pg',
  driver: 'pg',
  dbCredentials: {
    connectionString: databaseUrl,
  },
  verbose: true,
  strict: false,
} as any);
