import { spawn } from 'child_process';
import path from 'path';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg';
const JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
const TSX_CLI = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

const runValidation = (port: number) =>
  new Promise<{ port: number; durationMs: number; success: boolean; output: string }>((resolve) => {
    const startedAt = Date.now();
    const child = spawn(
      process.execPath,
      [TSX_CLI, 'scripts/postgres-phase2-validation.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DB_DIALECT: 'postgres',
          DATABASE_URL,
          JWT_SECRET,
          QR_MENU_PORT: '0',
          SERVER_PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('close', (code) => {
      resolve({
        port,
        durationMs: Date.now() - startedAt,
        success: code === 0,
        output,
      });
    });
  });

const main = async () => {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const startedAt = Date.now();
    const validations = await Promise.all([3211, 3212, 3213].map(runValidation));
    const reportQueries = [];
    reportQueries.push(await client.query('select count(*) from invoices'));
    reportQueries.push(await client.query('select count(*) from vouchers'));
    reportQueries.push(await client.query('select account_id, sum(debit) as debit, sum(credit) as credit from journal_entry_lines group by account_id order by account_id limit 20'));
    reportQueries.push(await client.query('select item_id, warehouse_id, sum(base_qty) as qty from inventory_movements group by item_id, warehouse_id order by item_id, warehouse_id limit 20'));
    reportQueries.push(await client.query('select party_id, sum(coalesce(delta_base, delta)) as balance from party_transactions group by party_id order by party_id limit 20'));
    const totalDurationMs = Date.now() - startedAt;

    const success = validations.every((entry) => entry.success);
    const report = {
      success,
      totalDurationMs,
      validations: validations.map((entry) => ({
        port: entry.port,
        durationMs: entry.durationMs,
        success: entry.success,
      })),
      reportQueryCount: reportQueries.length,
    };

    console.log(JSON.stringify(report, null, 2));
    if (!success) process.exitCode = 1;
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('[phase4:load-smoke] failed:', error?.message || error);
  process.exit(1);
});
