const { spawnSync } = require('child_process');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const outDir = `dist-electron-${stamp()}`;
const args = [
  'electron-builder',
  '--win',
  '--x64',
  `--config.directories.output=${outDir}`,
];

console.log(`\n[electron-build] output: ${outDir}\n`);

const res = spawnSync('npx.cmd', args, { stdio: 'inherit', shell: true });
process.exit(res.status ?? 1);

