import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { databaseConfig, databaseDialect } from '../db';
import {
  ensureBackupDir as ensurePgBackupDir,
  parsePgUrl,
  recreateDatabase,
  resolvePgBinary,
  runCommand,
  terminateDbConnections,
} from '../../scripts/_pgTools';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, appendAudit, buildPartyStatement, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, fs, path, getResolvedDbPath, rawSqlite, closeDb, bcrypt, server, getLocalIp } = ctx as any;

const getBackupDir = () => {
  if (databaseDialect === 'postgres') {
    return ensurePgBackupDir();
  }
  const dbFilePath = getResolvedDbPath();
  const baseDir = path.dirname(dbFilePath);
  const backupDir = path.join(baseDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
};

const defaultBackupCollections = [
  'clients', 'invoices', 'inventory', 'warehouses', 'categories', 'units',
  'cash-boxes', 'vouchers', 'party-transactions', 'expenses', 'partners',
  'partner-transactions', 'employees', 'payroll/transactions', 'biometric-devices',
  'attendance-records', 'users', 'settings',
  'agents', 'agent-inventory', 'agent-transfers', 'agent-transfer-lines', 'agent-inventory-movements'
];

const restoreInsertOrder = [
  'settings',
  'users',
  'categories',
  'sub-categories',
  'units',
  'branches',
  'remote-branches',
  'warehouses',
  'cash-boxes',
  'clients',
  'parties',
  'partners',
  'employees',
  'inventory',
  'items',
  'invoices',
  'expenses',
  'vouchers',
  'party-transactions',
  'partner-transactions',
  'payroll/transactions',
  'biometric-devices',
  'attendance-records',
  'inventory/transfers',
  'parties/transfers',
  'agents',
  'agent-inventory',
  'agent-transfers',
  'agent-transfer-lines',
  'agent-inventory-movements',
  'item-groups',
  'item-group-items',
  'item-serials',
  'item-barcodes',
  'promotions',
  'reconciliation-marks'
];

const restoreDeleteOrder = [...restoreInsertOrder].reverse();

const orderCollectionsForRestore = (collections: string[]) => {
  const unique = Array.from(new Set(collections));
  const known = restoreInsertOrder.filter((name) => unique.includes(name));
  const unknown = unique.filter((name) => !restoreInsertOrder.includes(name)).sort();
  return [...known, ...unknown];
};

const orderCollectionsForDelete = (collections: string[]) => {
  const unique = Array.from(new Set(collections));
  const known = restoreDeleteOrder.filter((name) => unique.includes(name));
  const unknown = unique.filter((name) => !restoreDeleteOrder.includes(name)).sort().reverse();
  return [...known, ...unknown];
};

const checkpointWal = () => {
  if (databaseDialect !== 'sqlite') return;
  try {
    rawSqlite?.pragma?.('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    console.warn('[backups] WAL checkpoint failed:', (error as any)?.message || error);
  }
};

const createDbSnapshot = async (targetPath: string) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  if (databaseDialect === 'postgres') {
    const databaseUrl = databaseConfig.databaseUrl;
    if (!databaseUrl) throw new Error('DATABASE_URL is missing for PostgreSQL backup.');
    const parsed = parsePgUrl(databaseUrl);
    const source = new URL(parsed.connectionString);
    await runCommand(
      resolvePgBinary('pg_dump'),
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--host', source.hostname,
        '--port', source.port || '5432',
        '--username', decodeURIComponent(source.username),
        '--dbname', parsed.dbName,
        '--file', targetPath,
      ],
      { PGPASSWORD: decodeURIComponent(source.password) },
    );
    return;
  }
  if (typeof rawSqlite?.backup === 'function') {
    await rawSqlite.backup(targetPath);
    return;
  }
  checkpointWal();
  fs.copyFileSync(getResolvedDbPath(), targetPath);
};

const validateDbFile = (filePath: string) => {
  if (databaseDialect === 'postgres') {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 1024) {
      throw new Error('ملف نسخة PostgreSQL غير صالح أو فارغ.');
    }
    if (!filePath.toLowerCase().endsWith('.dump')) {
      throw new Error('ملف النسخة يجب أن يكون من نوع .dump');
    }
    return;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 1024) {
    throw new Error('ملف قاعدة البيانات غير صالح أو فارغ.');
  }
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(16);
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);
  const header = buffer.toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('الملف المحدد ليس قاعدة SQLite صالحة.');
  }
};

const normalizeBackupPayload = (input: any) => {
  if (!input || typeof input !== 'object') return null;
  if (input.data && typeof input.data === 'object') return input.data;
  return input;
};

const prepareInsertData = (collection: string, row: any) => {
  const insertData = { ...row };
  if (collection === 'invoices' && insertData.items) {
    insertData.items = stringifyOrEmpty(insertData.items);
  }
  if (collection === 'settings' && insertData.value !== undefined) {
    insertData.value = typeof insertData.value === 'string' ? insertData.value : JSON.stringify(insertData.value);
  }
  if (!insertData.id && collection !== 'settings') {
    insertData.id = `${collection.charAt(0)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
  return insertData;
};

const clearCollections = async (collections: string[]) => {
  for (const collection of orderCollectionsForDelete(collections)) {
    const table = TABLE_MAP[collection];
    if (!table) continue;
    try {
      await db.delete(table).run();
    } catch (error) {
      console.warn(`[backups] clear failed for ${collection}:`, (error as any)?.message || error);
    }
  }
};

const restoreJsonPayload = async (payload: any, options?: { replaceExisting?: boolean }) => {
  const normalized = normalizeBackupPayload(payload);
  if (!normalized || typeof normalized !== 'object') {
    throw new Error('صيغة النسخة الاحتياطية غير صحيحة.');
  }

  const collections = Object.entries(normalized)
    .filter(([, rows]) => Array.isArray(rows))
    .map(([collection]) => collection);

  if (collections.length === 0) {
    throw new Error('النسخة الاحتياطية لا تحتوي على بيانات قابلة للاستعادة.');
  }

  if (options?.replaceExisting !== false) {
    await clearCollections(collections);
  }

  const results: Record<string, any> = {};
  for (const collection of orderCollectionsForRestore(collections)) {
    const rows = normalized[collection];
    if (!Array.isArray(rows)) continue;

    const table = TABLE_MAP[collection];
    if (!table) {
      results[collection] = { success: false, error: 'Table not found' };
      continue;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const row of rows as any[]) {
      try {
        const insertData = prepareInsertData(collection, row);
        await db.insert(table).values(insertData).run();
        successCount++;
      } catch (error: any) {
        errorCount++;
        if (errors.length < 5) errors.push(error?.message || 'restore failed');
      }
    }

    results[collection] = { success: errorCount === 0, successCount, errorCount, errors };
  }

  return { success: true, results, restoredCollections: collections };
};

const buildBackupPayload = async (collections: string[], meta: any) => {
  const backup: any = {};
  for (const collection of collections) {
    const table = TABLE_MAP[collection];
    if (!table) continue;
    try {
      const rows = await db.select().from(table).all();
      if (collection === 'invoices') {
        backup[collection] = rows.map((r: any) => ({ ...r, items: safeJsonParse(r.items, []) }));
      } else if (collection === 'settings') {
        backup[collection] = rows.map((r: any) => ({ ...r, value: safeJsonParse(r.value, r.value) }));
      } else {
        backup[collection] = rows;
      }
    } catch (e) {
      console.error(`Backup error for ${collection}:`, e);
      backup[collection] = [];
    }
  }
  return { metadata: meta, data: backup };
};


api.get('/backups/list', async () => {
  try {
    const dir = getBackupDir();
    const files = fs.readdirSync(dir);
    const result: any[] = [];
    for (const file of files) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      const ext = path.extname(file).toLowerCase();
      if (ext !== '.json' && ext !== '.db' && ext !== '.dump') continue;
      let meta: any = {};
      if (ext === '.json') {
        try {
          const json = JSON.parse(fs.readFileSync(full, 'utf-8'));
          meta = json?.metadata || {};
        } catch {}
      }
      result.push({
        name: file,
        type: ext === '.json' ? 'json' : 'db',
        size: stat.size,
        createdAt: meta.createdAt || new Date(stat.mtimeMs).toISOString(),
        createdBy: meta.createdBy || '',
        scope: meta.scope || []
      });
    }
    return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
});


api.post('/backups/create/json', async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const scope = Array.isArray(body.scope) && body.scope.length ? body.scope : defaultBackupCollections;
    const createdBy = String(body.createdBy || '').trim();
    const name = String(body.name || '').trim();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = (name || 'backup').replace(/[^\w\u0600-\u06FF-]/g, '_');
    const safeUser = createdBy ? createdBy.replace(/[^\w\u0600-\u06FF-]/g, '_') : 'system';
    const fileName = `${safeName}_${stamp}_${safeUser}.json`;
    const meta = { createdAt: new Date().toISOString(), createdBy, scope, type: 'json' };
    const payload = await buildBackupPayload(scope, meta);
    const dir = getBackupDir();
    fs.writeFileSync(path.join(dir, fileName), JSON.stringify(payload, null, 2), 'utf-8');
    return { success: true, name: fileName };
  } catch (e: any) {
    return reply.status(500).send({ success: false, error: e?.message || 'Failed to create backup' });
  }
});


api.post('/backups/create/db', async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const createdBy = String(body.createdBy || '').trim();
    const name = String(body.name || '').trim();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = (name || 'db-backup').replace(/[^\w\u0600-\u06FF-]/g, '_');
    const safeUser = createdBy ? createdBy.replace(/[^\w\u0600-\u06FF-]/g, '_') : 'system';
    const fileName = `${safeName}_${stamp}_${safeUser}.${databaseDialect === 'postgres' ? 'dump' : 'db'}`;
    const dir = getBackupDir();
    await createDbSnapshot(path.join(dir, fileName));
    return { success: true, name: fileName };
  } catch (e: any) {
    return reply.status(500).send({ success: false, error: e?.message || 'Failed to create backup' });
  }
});


api.get('/backups/export/json', async (req, reply) => {
  try {
    const meta = { createdAt: new Date().toISOString(), createdBy: 'export', scope: defaultBackupCollections, type: 'json' };
    const payload = await buildBackupPayload(defaultBackupCollections, meta);

    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="backup-${new Date().toISOString().split('T')[0]}.json"`);
    return payload;
  } catch (e: any) {
    console.error('Backup export error:', e);
    return reply.status(500).send({ error: 'Failed to create backup' });
  }
});


api.get('/backups/export/db', async (req, reply) => {
  try {
    const dir = getBackupDir();
    const tempName = `.export-${Date.now()}.${databaseDialect === 'postgres' ? 'dump' : 'db'}`;
    const tempPath = path.join(dir, tempName);
    await createDbSnapshot(tempPath);
    const dbBuffer = fs.readFileSync(tempPath);
    try { fs.unlinkSync(tempPath); } catch {}
    if (!dbBuffer || dbBuffer.length === 0) {
      return reply.status(500).send({ error: 'Database file is empty' });
    }
    const fileName = `shamel-${new Date().toISOString().split('T')[0]}.${databaseDialect === 'postgres' ? 'dump' : 'db'}`;

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    reply.header('Content-Length', dbBuffer.length);

    return reply.send(dbBuffer);
  } catch (e: any) {
    console.error('Database backup error:', e);
    return reply.status(500).send({ error: 'Failed to export database' });
  }
});


api.post('/backups/restore/json', async (req, reply) => {
  try {
    const data = req.body as any;
    return await restoreJsonPayload(data, { replaceExisting: data?.replaceExisting !== false });
  } catch (e: any) {
    console.error('Restore error:', e);
    return reply.status(500).send({ error: e?.message || 'Failed to restore backup' });
  }
});


api.post('/backups/restore/from-backup', async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const name = path.basename(String(body.name || ''));
    if (!name.endsWith('.json')) return reply.status(400).send({ error: 'Only JSON backups can be restored.' });
    const dir = getBackupDir();
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) return reply.status(404).send({ error: 'Backup not found' });
    const json = JSON.parse(fs.readFileSync(full, 'utf-8'));
    return await restoreJsonPayload(json, { replaceExisting: true });
  } catch (e: any) {
    return reply.status(500).send({ error: e?.message || 'Failed to restore backup' });
  }
});


api.post('/backups/restore/db-upload', async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const expectedExt = databaseDialect === 'postgres' ? '.dump' : '.db';
    const fileName = path.basename(String(body.name || `uploaded-${Date.now()}${expectedExt}`));
    const base64 = String(body.base64 || '');
    if (!fileName.toLowerCase().endsWith(expectedExt)) {
      return reply.status(400).send({ error: databaseDialect === 'postgres' ? 'Only PostgreSQL .dump backups can be uploaded.' : 'Only DB backups can be uploaded.' });
    }
    if (!base64) {
      return reply.status(400).send({ error: 'Uploaded DB content is empty.' });
    }

    const dir = getBackupDir();
    const tempPath = path.join(dir, `.upload-${Date.now()}-${fileName}`);
    fs.writeFileSync(tempPath, Buffer.from(base64, 'base64'));
    validateDbFile(tempPath);

    const finalName = `${path.parse(fileName).name}_${new Date().toISOString().replace(/[:.]/g, '-')}${expectedExt}`;
    const finalPath = path.join(dir, finalName);
    fs.renameSync(tempPath, finalPath);

    return { success: true, name: finalName };
  } catch (e: any) {
    return reply.status(500).send({ error: e?.message || 'Failed to upload DB backup' });
  }
});


api.post('/backups/restore/db-from-backup', async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const name = path.basename(String(body.name || ''));
    const expectedExt = databaseDialect === 'postgres' ? '.dump' : '.db';
    if (!name.endsWith(expectedExt)) {
      return reply.status(400).send({ error: databaseDialect === 'postgres' ? 'Only PostgreSQL .dump backups can be restored.' : 'Only DB backups can be restored.' });
    }
    const dir = getBackupDir();
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) return reply.status(404).send({ error: 'Backup not found' });
    validateDbFile(full);

    if (databaseDialect === 'postgres') {
      const databaseUrl = databaseConfig.databaseUrl;
      if (!databaseUrl) throw new Error('DATABASE_URL is missing for PostgreSQL restore.');
      const parsed = parsePgUrl(databaseUrl);
      const source = new URL(parsed.connectionString);
      const backupCurrent = path.join(dir, `${parsed.dbName}.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
      try { await createDbSnapshot(backupCurrent); } catch {}

      await closeDb();
      await terminateDbConnections(parsed.adminConnectionString, parsed.dbName).catch(() => {});
      await recreateDatabase(parsed.adminConnectionString, parsed.dbName);
      await runCommand(
        resolvePgBinary('pg_restore'),
        [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-privileges',
          '--host', source.hostname,
          '--port', source.port || '5432',
          '--username', decodeURIComponent(source.username),
          '--dbname', parsed.dbName,
          full,
        ],
        { PGPASSWORD: decodeURIComponent(source.password) },
      );

      setTimeout(() => {
        try { process.exit(0); } catch {}
      }, 300);

      return { success: true, message: 'تمت استعادة نسخة PostgreSQL. الرجاء إعادة تشغيل التطبيق.' };
    }

    const dbPath = getResolvedDbPath ? getResolvedDbPath() : path.join(__dirname, '../data/shamel.db');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupCurrent = `${dbPath}.pre-restore-${stamp}`;
    try { await createDbSnapshot(backupCurrent); } catch {}

    closeDb();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
    try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
    fs.copyFileSync(full, dbPath);

    setTimeout(() => {
      try { process.exit(0); } catch {}
    }, 300);

    return { success: true, message: 'تم استبدال قاعدة البيانات. الرجاء إعادة تشغيل التطبيق.' };
  } catch (e: any) {
    return reply.status(500).send({ error: e?.message || 'Failed to restore DB backup' });
  }
});
}
