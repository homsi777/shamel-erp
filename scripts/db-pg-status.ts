import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg';

const main = async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const info = await client.query<{ current_database: string }>('select current_database()');
    const tables = await client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name asc
    `);

    const migrationTable = await client.query<{ exists: string | null }>(
      "select to_regclass('public.__backend_pg_migrations') as exists",
    );

    console.log(JSON.stringify({
      dialect: 'postgres',
      database: info.rows[0]?.current_database || null,
      migrationTable: migrationTable.rows[0]?.exists || null,
      tableCount: tables.rowCount,
      sampleTables: tables.rows.slice(0, 15).map((row) => row.table_name),
    }, null, 2));
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('[db:pg:status] failed:', error?.message || error);
  process.exit(1);
});
