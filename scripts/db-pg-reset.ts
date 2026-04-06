import { Client } from 'pg';

const databaseName = process.env.PG_DATABASE_NAME || 'shamel_erp_pg';
const adminUrl = process.env.PG_ADMIN_URL || 'postgresql://postgres:12345678@127.0.0.1:5432/postgres';

const quoteIdentifier = (value: string) => `"${String(value).replace(/"/g, '""')}"`;

const main = async () => {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()
    `, [databaseName]);

    await client.query(`drop database if exists ${quoteIdentifier(databaseName)}`);
    await client.query(`create database ${quoteIdentifier(databaseName)}`);
    console.log(`[db:pg:reset] reset database ${databaseName}`);
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('[db:pg:reset] failed:', error?.message || error);
  process.exit(1);
});
