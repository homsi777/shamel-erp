const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const dataSrc = path.join(projectRoot, 'data');
const dataDest = path.join(distDir, 'data');

if (!fs.existsSync(distDir)) {
  console.error('dist folder not found. Run build before syncing.');
  process.exit(1);
}

if (!fs.existsSync(dataSrc)) {
  console.warn('data folder not found. Skipping copy.');
  process.exit(0);
}

fs.rmSync(dataDest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dataDest), { recursive: true });
fs.cpSync(dataSrc, dataDest, { recursive: true });

console.log('Copied data -> dist/data');
