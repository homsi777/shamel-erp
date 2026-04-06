const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function runNodeCheck() {
  return spawnSync(
    process.execPath,
    [
      '-e',
      `
      try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        console.log('[native] better-sqlite3 is ready.');
      } catch (error) {
        console.error(error && error.stack ? error.stack : String(error));
        process.exit(1);
      }
      `,
    ],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    }
  );
}

function rebuildBetterSqlite() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(
    `[native] Rebuilding better-sqlite3 for Node ${process.version} (modules=${process.versions.modules})...`
  );

  return spawnSync(npmCommand, ['rebuild', 'better-sqlite3'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
}

const initialCheck = runNodeCheck();
if (initialCheck.status === 0) {
  process.exit(0);
}

const rebuild = rebuildBetterSqlite();
if (rebuild.status !== 0) {
  process.exit(rebuild.status || 1);
}

const finalCheck = runNodeCheck();
if (finalCheck.status !== 0) {
  console.error('[native] better-sqlite3 still failed after rebuild.');
  process.exit(finalCheck.status || 1);
}

console.log('[native] better-sqlite3 is synchronized with the current Node runtime.');
