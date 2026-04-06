import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { Client } from 'pg';

export const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg';

type ParsedPgUrl = {
  connectionString: string;
  dbName: string;
  adminConnectionString: string;
};

const candidateBinRoots = () => {
  const configured = String(process.env.PG_BIN_DIR || '').trim();
  return [
    configured,
    'C:\\Program Files\\PostgreSQL\\16\\bin',
    'C:\\Program Files\\PostgreSQL\\15\\bin',
  ].filter(Boolean);
};

export const resolvePgBinary = (binaryName: 'pg_dump' | 'pg_restore' | 'psql') => {
  const executable = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
  for (const root of candidateBinRoots()) {
    const full = path.join(root, executable);
    if (fs.existsSync(full)) return full;
  }
  return executable;
};

export const parsePgUrl = (connectionString = DEFAULT_DATABASE_URL): ParsedPgUrl => {
  const url = new URL(connectionString);
  const dbName = String(url.pathname || '').replace(/^\//, '').trim() || 'postgres';
  const admin = new URL(connectionString);
  admin.pathname = '/postgres';
  return {
    connectionString,
    dbName,
    adminConnectionString: admin.toString(),
  };
};

export const timestamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

export const ensureBackupDir = () => {
  const configured = String(process.env.PG_BACKUP_DIR || '').trim();
  const backupDir = configured || path.join(process.cwd(), 'data', 'pg-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
};

export const runCommand = (command: string, args: string[], extraEnv: Record<string, string> = {}) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
    child.on('error', reject);
  });

export const terminateDbConnections = async (adminConnectionString: string, dbName: string) => {
  const client = new Client({ connectionString: adminConnectionString });
  await client.connect();
  try {
    await client.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [dbName],
    );
  } finally {
    await client.end();
  }
};

export const recreateDatabase = async (adminConnectionString: string, dbName: string) => {
  const client = new Client({ connectionString: adminConnectionString });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName.replace(/"/g, '""')}"`);
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
};

export const sanityQuery = async (connectionString: string) => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM invoices) AS invoices,
        (SELECT COUNT(*)::int FROM vouchers) AS vouchers,
        (SELECT COUNT(*)::int FROM journal_entries) AS journal_entries
    `);
    return result.rows[0] || {};
  } finally {
    await client.end();
  }
};

export const findLanIpv4 = () => {
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('192.168.')) {
        return iface.address;
      }
    }
  }
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
};
