import { Client } from 'pg';

const databaseName = process.env.PG_DATABASE_NAME || 'shamel_erp_pg';
const adminUrl = process.env.PG_ADMIN_URL || 'postgresql://postgres:12345678@127.0.0.1:5432/postgres';

const quoteIdentifier = (value: string) => `"${String(value).replace(/"/g, '""')}"`;

const main = async () => {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = await client.query<{ exists: boolean }>(
      'select exists(select 1 from pg_database where datname = $1) as exists',
      [databaseName],
    );

    if (!exists.rows[0]?.exists) {
      await client.query(`create database ${quoteIdentifier(databaseName)}`);
      console.log(`[db:pg:create] created database ${databaseName}`);
    } else {
      console.log(`[db:pg:create] database ${databaseName} already exists`);
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('[db:pg:create] failed:', error?.message || error);
  process.exit(1);
});
