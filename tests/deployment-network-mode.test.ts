import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shamel-deployment-'));
const tempDbPath = path.join(tempRoot, 'deployment-test.db');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'deployment-test-secret';
process.env.DB_PATH = tempDbPath;
delete process.env.DB_PATH_FROM_ELECTRON;
delete process.env.ELECTRON_IS_PACKAGED;

const [{ ensureDatabaseColumns }, deploymentLib, commonLib, dbModule] = await Promise.all([
  import('../backend/db/seed-accounts.ts'),
  import('../backend/lib/deployment.ts'),
  import('../backend/routes/_common.ts'),
  import('../backend/db/index.ts'),
]);

const { resolveDeploymentConfig } = deploymentLib;
const { getNextDocNumber } = commonLib;
const { closeDb } = dbModule;

after(async () => {
  await closeDb?.();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

await ensureDatabaseColumns(null);

test('deployment helper keeps standalone as the safe default', () => {
  delete process.env.SHAMEL_DEPLOYMENT_MODE;
  delete process.env.SHAMEL_DEVICE_ROLE;
  delete process.env.SHAMEL_API_URL;

  const cfg = resolveDeploymentConfig();
  assert.equal(cfg.mode, 'standalone');
  assert.equal(cfg.role, 'standalone');
  assert.equal(cfg.canOwnBackend, true);
  assert.equal(cfg.canOwnDatabase, true);
  assert.equal(cfg.allowLocalUsbPrinting, true);
});

test('deployment helper disables backend ownership for LAN terminals', () => {
  process.env.SHAMEL_DEPLOYMENT_MODE = 'local_network';
  process.env.SHAMEL_DEVICE_ROLE = 'terminal';
  process.env.SHAMEL_API_URL = '192.168.1.10:3111';

  const cfg = resolveDeploymentConfig();
  assert.equal(cfg.mode, 'local_network');
  assert.equal(cfg.role, 'terminal');
  assert.equal(cfg.canOwnBackend, false);
  assert.equal(cfg.canOwnDatabase, false);
  assert.equal(cfg.apiBaseUrl, 'http://192.168.1.10:3111/api');
});

test('document numbers are allocated atomically from persisted sequences', () => {
  const first = getNextDocNumber('pos', { companyId: 'org-main', branchId: 'br-main' });
  const second = getNextDocNumber('pos', { companyId: 'org-main', branchId: 'br-main' });
  const voucherFirst = getNextDocNumber('voucher', { companyId: 'org-main', branchId: 'br-main' });
  const consignmentDoc = getNextDocNumber('consignment_document', { companyId: 'org-main', branchId: 'br-main' });
  const consignmentSettlement = getNextDocNumber('consignment_settlement', { companyId: 'org-main', branchId: 'br-main' });
  const otherCompany = getNextDocNumber('pos', { companyId: 'org-alt', branchId: 'br-main' });

  assert.equal(first, '100000');
  assert.equal(second, '100001');
  assert.equal(voucherFirst, '1000000');
  assert.equal(consignmentDoc, '90000000');
  assert.equal(consignmentSettlement, '95000000');
  assert.equal(otherCompany, '100000');
});
