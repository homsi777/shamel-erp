const { execFileSync } = require('child_process');

const port = Number(process.argv[2] || '3333');

if (!Number.isInteger(port) || port <= 0) {
  console.error(`[port] Invalid port: ${process.argv[2] || ''}`);
  process.exit(1);
}

function listListeningPids(targetPort) {
  try {
    if (process.platform === 'win32') {
      const command = `
        $connections = Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue;
        if (-not $connections) { return }
        $connections | Select-Object -ExpandProperty OwningProcess -Unique
      `;
      const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return output
        .split(/\r?\n/)
        .map((line) => Number(String(line).trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
    }

    const output = execFileSync('bash', ['-lc', `lsof -ti tcp:${targetPort} -sTCP:LISTEN 2>/dev/null || true`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split(/\r?\n/)
      .map((line) => Number(String(line).trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function killPid(pid) {
  if (pid === process.pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/F', '/PID', String(pid), '/T'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return;
    }

    process.kill(pid, 'SIGTERM');
  } catch {}
}

const pids = listListeningPids(port);

if (pids.length === 0) {
  console.log(`[port] ${port} is free.`);
  process.exit(0);
}

console.log(`[port] Releasing ${port} from PID(s): ${pids.join(', ')}`);
for (const pid of pids) {
  killPid(pid);
}

const remaining = listListeningPids(port);
if (remaining.length > 0) {
  console.error(`[port] Failed to release ${port}. Remaining PID(s): ${remaining.join(', ')}`);
  process.exit(1);
}

console.log(`[port] ${port} is free now.`);
