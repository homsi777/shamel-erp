const path = require('path');
const esbuild = require('esbuild');

const rootDir = path.join(__dirname, '..');
const entry = path.join(rootDir, 'electron', 'main.cjs');
const outfile = path.join(rootDir, 'main.cjs');

esbuild
  .build({
    absWorkingDir: rootDir,
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile,
    external: ['electron'],
    logLevel: 'warning',
  })
  .then(() => {
    console.log('[build:electron-main] wrote', path.relative(rootDir, outfile));
  })
  .catch((err) => {
    console.error('[build:electron-main]', err);
    process.exit(1);
  });
