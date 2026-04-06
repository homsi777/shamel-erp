import { eq } from 'drizzle-orm';
import { db, closeDb, getResolvedDbPath } from '../backend/db';
import * as schema from '../backend/db/schema';
import { repairPersistedSettingsRows } from '../backend/lib/settings';

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--apply');

const main = async () => {
  const result = await repairPersistedSettingsRows(db as any, schema, eq, { dryRun });
  console.log(JSON.stringify({
    ok: true,
    dryRun,
    dbPath: getResolvedDbPath(),
    scanned: result.scanned,
    updated: result.updated,
    changes: result.changes,
    failures: result.failures,
  }, null, 2));
};

try {
  await main();
} catch (error: any) {
  console.error(JSON.stringify({
    ok: false,
    dryRun,
    error: error?.message || 'UNKNOWN',
  }, null, 2));
  process.exitCode = 1;
} finally {
  try { closeDb(); } catch {}
}
