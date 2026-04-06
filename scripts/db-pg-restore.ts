import fs from 'fs';
import path from 'path';
import {
  DEFAULT_DATABASE_URL,
  ensureBackupDir,
  parsePgUrl,
  recreateDatabase,
  resolvePgBinary,
  runCommand,
  sanityQuery,
  terminateDbConnections,
  timestamp,
} from './_pgTools';

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};

const hasFlag = (flag: string) => process.argv.includes(flag);

const main = async () => {
  const parsed = parsePgUrl(DEFAULT_DATABASE_URL);
  const backupDir = ensureBackupDir();
  const requestedSource = argValue('--source');
  const verifyTemp = hasFlag('--verify-temp');
  const requestedTarget = argValue('--target-db');
  const restoreBinary = resolvePgBinary('pg_restore');

  const sourceFile = requestedSource
    ? path.resolve(requestedSource)
    : (() => {
        const entries = fs.readdirSync(backupDir)
          .filter((name) => name.endsWith('.dump'))
          .sort()
          .reverse();
        if (!entries.length) throw new Error(`No .dump backups found in ${backupDir}`);
        return path.join(backupDir, entries[0]);
      })();

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Backup file not found: ${sourceFile}`);
  }

  const targetDb = requestedTarget
    ? String(requestedTarget).trim()
    : verifyTemp
      ? `${parsed.dbName}_restore_verify_${timestamp()}`
      : parsed.dbName;

  await terminateDbConnections(parsed.adminConnectionString, targetDb).catch(() => {});
  await recreateDatabase(parsed.adminConnectionString, targetDb);

  const targetUrl = new URL(parsed.connectionString);
  targetUrl.pathname = `/${targetDb}`;

  try {
    await runCommand(
      restoreBinary,
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--host', targetUrl.hostname,
        '--port', targetUrl.port || '5432',
        '--username', decodeURIComponent(targetUrl.username),
        '--dbname', targetDb,
        sourceFile,
      ],
      { PGPASSWORD: decodeURIComponent(targetUrl.password) },
    );

    const sanity = await sanityQuery(targetUrl.toString());
    console.log(JSON.stringify({
      success: true,
      sourceFile,
      targetDb,
      verifyTemp,
      sanity,
    }, null, 2));
  } finally {
    if (verifyTemp) {
      await terminateDbConnections(parsed.adminConnectionString, targetDb).catch(() => {});
      const adminClient = await (async () => {
        const { Client } = await import('pg');
        const client = new Client({ connectionString: parsed.adminConnectionString });
        await client.connect();
        return client;
      })();
      try {
        await adminClient.query(`DROP DATABASE IF EXISTS "${targetDb.replace(/"/g, '""')}"`);
      } finally {
        await adminClient.end();
      }
    }
  }
};

main().catch((error) => {
  console.error('[db:pg:restore] failed:', error?.message || error);
  process.exit(1);
});
