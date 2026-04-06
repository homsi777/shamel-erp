import path from 'path';
import { DEFAULT_DATABASE_URL, ensureBackupDir, parsePgUrl, resolvePgBinary, runCommand, timestamp } from './_pgTools';

const main = async () => {
  const parsed = parsePgUrl(DEFAULT_DATABASE_URL);
  const backupDir = ensureBackupDir();
  const fileName = `${parsed.dbName}-${timestamp()}.dump`;
  const filePath = path.join(backupDir, fileName);
  const dumpBinary = resolvePgBinary('pg_dump');
  const source = new URL(parsed.connectionString);

  await runCommand(
    dumpBinary,
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--host', source.hostname,
      '--port', source.port || '5432',
      '--username', decodeURIComponent(source.username),
      '--dbname', parsed.dbName,
      '--file', filePath,
    ],
    { PGPASSWORD: decodeURIComponent(source.password) },
  );

  console.log(JSON.stringify({
    success: true,
    backupFile: filePath,
    dbName: parsed.dbName,
  }, null, 2));
};

main().catch((error) => {
  console.error('[db:pg:backup] failed:', error?.message || error);
  process.exit(1);
});
