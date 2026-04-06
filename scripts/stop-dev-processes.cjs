const { spawnSync } = require('child_process');

const isWin = process.platform === 'win32';

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    windowsHide: true,
  });
}

function killImage(imageName) {
  if (!isWin) return;
  run('taskkill', ['/F', '/IM', imageName, '/T']);
}

killImage('Shamel-ERP.exe');
killImage('electron.exe');
