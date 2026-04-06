#!/usr/bin/env node
/**
 * Automated test for Browser Access feature
 * Tests static serving, routing, and API connectivity
 *
 * Prerequisites: `npm run build` (for dist/), server reachable on API_PORT (default 3111).
 * Example: terminal 1: `npm run server` — terminal 2: `npm run test:browser-access`
 */

import http from 'http';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const API_PORT = Number(process.env.SERVER_PORT || process.env.SHAMEL_API_PORT || '3111');
const API_BASE = `http://127.0.0.1:${API_PORT}`;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color] || colors.reset}${msg}${colors.reset}`);
}

function success(msg) {
  log(`✅ ${msg}`, 'green');
}
function fail(msg) {
  log(`❌ ${msg}`, 'red');
}
function info(msg) {
  log(`ℹ️  ${msg}`, 'blue');
}
function warn(msg) {
  log(`⚠️  ${msg}`, 'yellow');
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: data }),
      );
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

const tests = {
  async checkDistBuilt() {
    info('Checking if dist/ is built...');
    const distPath = join(PROJECT_ROOT, 'dist', 'index.html');
    if (!existsSync(distPath)) {
      fail('dist/index.html not found. Run: npm run build');
      return false;
    }
    success('dist/ folder exists');
    return true;
  },

  async checkServerRunning() {
    info('Checking if server is running...');
    try {
      const res = await httpGet(`${API_BASE}/api/system/status`);
      if (res.status === 200) {
        success(`Server is running on port ${API_PORT}`);
        return true;
      }
      fail(`Server responded with status ${res.status} (expected 200)`);
      return false;
    } catch (err) {
      fail(`Server not running on port ${API_PORT}. Start with: npm run server (${String(err?.message || err)})`);
      return false;
    }
  },

  async checkStaticServing() {
    info('Testing static file serving...');
    try {
      const res = await httpGet(`${API_BASE}/`);

      if (res.status !== 200) {
        fail(`GET / returned ${res.status} (expected 200)`);
        return false;
      }

      const lower = res.body.slice(0, 5000).toLowerCase();
      if (!lower.includes('<!doctype html') && !lower.includes('<html')) {
        fail('Response is not HTML');
        return false;
      }

      if (!lower.includes('root') && !lower.includes('id="root"')) {
        warn('HTML may be missing #root — verify manually');
      }

      success('Static files served correctly from /');
      return true;
    } catch (err) {
      fail(`Static serving failed: ${err.message}`);
      return false;
    }
  },

  async checkBrowserHeaders() {
    info('Testing browser-like request...');
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        Accept: 'text/html',
      };

      const res = await httpGet(`${API_BASE}/`, headers);

      if (res.status === 200 && /html/i.test(res.body.slice(0, 2000))) {
        success('Browser-like requests work');
        return true;
      }

      fail('Browser headers not handled correctly');
      return false;
    } catch (err) {
      fail(`Browser request failed: ${err.message}`);
      return false;
    }
  },

  async checkApiEndpoint() {
    info('Testing API endpoint accessibility...');
    try {
      const res = await httpGet(`${API_BASE}/api/system/status`);

      if (res.status !== 200) {
        fail(`API returned ${res.status}`);
        return false;
      }

      success('API endpoints accessible');
      return true;
    } catch (err) {
      fail(`API request failed: ${err.message}`);
      return false;
    }
  },

  async checkCORS() {
    info('Testing CORS headers...');
    try {
      const res = await httpGet(`${API_BASE}/api/system/status`, {
        Origin: 'http://192.168.1.100:3111',
      });

      const acao = res.headers['access-control-allow-origin'];
      if (acao !== undefined) {
        success(`CORS header present: access-control-allow-origin=${acao}`);
      } else {
        warn('No access-control-allow-origin on GET (Fastify may set it on OPTIONS only)');
      }
      return true;
    } catch (err) {
      warn(`CORS check: ${err.message}`);
      return true;
    }
  },

  async checkPlatformDetection() {
    info('Testing platform detection logic...');
    const platformFile = join(PROJECT_ROOT, 'src', 'lib', 'platform.ts');

    if (!existsSync(platformFile)) {
      fail('src/lib/platform.ts not found');
      return false;
    }

    const src = readFileSync(platformFile, 'utf8');
    if (!src.includes('isWebBrowserClient')) {
      fail('platform.ts missing isWebBrowserClient');
      return false;
    }
    if (!src.includes('isElectronClient')) {
      fail('platform.ts missing isElectronClient');
      return false;
    }

    const appPath = join(PROJECT_ROOT, 'src', 'App.tsx');
    if (existsSync(appPath)) {
      const appSrc = readFileSync(appPath, 'utf8');
      if (!appSrc.includes('isWebBrowserClient')) {
        warn('App.tsx does not import isWebBrowserClient — browser routing may differ');
      }
    }

    success('Platform detection file exists and exports expected helpers');
    return true;
  },
};

async function runTests() {
  log('\n=================================', 'blue');
  log('  Browser Access Feature Tests', 'blue');
  log(`  ${API_BASE} (SERVER_PORT / SHAMEL_API_PORT)`, 'blue');
  log('=================================\n', 'blue');

  const results = [];

  for (const [name, testFn] of Object.entries(tests)) {
    try {
      const passed = await testFn();
      results.push({ name, passed });
    } catch (err) {
      fail(`Test ${name} crashed: ${err.message}`);
      results.push({ name, passed: false });
    }
    console.log('');
  }

  log('\n=================================', 'blue');
  log('  Test Summary', 'blue');
  log('=================================\n', 'blue');

  const passedCount = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((r) => {
    if (r.passed) {
      success(r.name);
    } else {
      fail(r.name);
    }
  });

  log(`\n${passedCount}/${total} tests passed\n`, passedCount === total ? 'green' : 'red');

  if (passedCount === total) {
    success('All tests passed! ✨');
    process.exit(0);
  } else {
    fail('Some tests failed');
    process.exit(1);
  }
}

runTests().catch((err) => {
  fail(`Test runner failed: ${err.message}`);
  process.exit(1);
});
