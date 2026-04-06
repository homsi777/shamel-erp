import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg';
const migrationsDir = path.join(process.cwd(), 'backend', 'drizzle-pg');

const main = async () => {
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
    : [];

  if (files.length === 0) {
    throw new Error(`No PostgreSQL migration files found in ${migrationsDir}. Generate the baseline first.`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      create table if not exists __backend_pg_migrations (
        id serial primary key,
        file_name text not null unique,
        applied_at timestamptz not null default now()
      )
    `);

    for (const fileName of files) {
      const alreadyApplied = await client.query('select 1 from __backend_pg_migrations where file_name = $1 limit 1', [fileName]);
      if (alreadyApplied.rowCount) {
        console.log(`[db:pg:migrate] skip ${fileName}`);
        continue;
      }

      const sqlText = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
      await client.query('begin');
      try {
        await client.query(sqlText);
        await client.query('insert into __backend_pg_migrations (file_name) values ($1)', [fileName]);
        await client.query('commit');
        console.log(`[db:pg:migrate] applied ${fileName}`);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('[db:pg:migrate] failed:', error?.message || error);
  process.exit(1);
});
