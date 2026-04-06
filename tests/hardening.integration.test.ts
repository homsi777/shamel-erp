import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shamel-hardening-'));
const tempDbPath = path.join(tempRoot, 'hardening-test.db');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'hardening-test-secret';
process.env.DB_PATH = tempDbPath;
delete process.env.DB_PATH_FROM_ELECTRON;
delete process.env.ELECTRON_IS_PACKAGED;

const [{ server }, dbModule, schema, seedModule] = await Promise.all([
  import('../backend/server.ts'),
  import('../backend/db/index.ts'),
  import('../backend/db/schema.ts'),
  import('../backend/db/seed-accounts.ts'),
]);

const { db, closeDb } = dbModule;
const {
  ensureDatabaseColumns,
  seedAccounts,
  seedAccountsForCompany,
  seedDefaultCashBox,
  seedDefaultWarehouse,
} = seedModule;
const companySession = await import('../src/lib/companySession.ts');
const {
  getSelectedCompanyId,
  getStoredToken,
  getStoredUser,
  switchCompanySession,
  validateCompanyBoundSession,
} = companySession;
const TEST_COMPANY_ID = 'org-main';
const TEST_BRANCH_ID = 'br-main';
const ALT_COMPANY_ID = 'org-alt';
const ALT_BRANCH_ID = 'br-alt';
const SECONDARY_BRANCH_ID = 'br-secondary';

const insertUser = async (payload: {
  id: string;
  username: string;
  password: string;
  role?: string;
  permissions?: string[];
  companyId?: string;
  defaultBranchId?: string | null;
  branchScope?: string;
  allowedBranchIds?: string[];
}) => {
  const passwordHash = bcrypt.hashSync(payload.password, bcrypt.genSaltSync(10));
  const defaultBranchId = payload.defaultBranchId === undefined ? TEST_BRANCH_ID : payload.defaultBranchId;
  const allowedBranchIds = Array.isArray(payload.allowedBranchIds)
    ? Array.from(new Set(payload.allowedBranchIds.filter(Boolean)))
    : (defaultBranchId ? [defaultBranchId] : []);
  await db.insert(schema.users).values({
    id: payload.id,
    username: payload.username,
    passwordHash,
    name: payload.username,
    role: payload.role || 'admin',
    permissions: (payload.permissions || ['*']).join(','),
    companyId: payload.companyId || TEST_COMPANY_ID,
    defaultBranchId,
    branchScope: payload.branchScope || (String(payload.role || 'admin').toLowerCase() === 'admin' ? 'company_wide' : 'restricted'),
    isActive: true,
  }).run();
  for (const branchId of allowedBranchIds) {
    await db.insert(schema.userBranchAccess).values({
      id: `uba-${payload.id}-${branchId}`,
      userId: payload.id,
      branchId,
      isDefault: defaultBranchId === branchId,
      isActive: true,
    }).onConflictDoNothing().run();
  }
};

const tokenFor = async (
  id: string,
  role = 'admin',
  companyId = TEST_COMPANY_ID,
  branchId = TEST_BRANCH_ID,
  options?: {
    allowedBranchIds?: string[];
    defaultBranchId?: string | null;
    currentBranchId?: string | null;
    branchScope?: string;
  },
) => {
  await server.ready();
  const allowedBranchIds = options?.allowedBranchIds || [branchId];
  const defaultBranchId = options?.defaultBranchId === undefined ? branchId : options.defaultBranchId;
  const currentBranchId = options?.currentBranchId === undefined ? branchId : options.currentBranchId;
  return server.jwt.sign({
    id,
    role,
    companyId,
    allowedBranchIds,
    defaultBranchId,
    currentBranchId,
    branchScope: options?.branchScope || (String(role).toLowerCase() === 'admin' ? 'company_wide' : 'restricted'),
  });
};

const authHeaders = (token: string, companyId = TEST_COMPANY_ID, branchId = TEST_BRANCH_ID) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'x-active-org': companyId,
  'x-company-id': companyId,
  'x-branch-id': branchId,
});

const insertParty = async (id: string, name: string, type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH' = 'CUSTOMER') => {
  await db.insert(schema.parties).values({
    id,
    companyId: TEST_COMPANY_ID,
    name,
    type,
    isActive: true,
    balance: 0,
  }).run();
};

const insertWarehouse = async (
  id: string,
  name: string,
  options?: {
    companyId?: string;
    branchId?: string;
  },
) => {
  await db.insert(schema.warehouses).values({
    id,
    companyId: options?.companyId || TEST_COMPANY_ID,
    name,
    branchId: options?.branchId || TEST_BRANCH_ID,
    code: id.toUpperCase(),
    isActive: true,
  }).run();
};

const ensureCompany = async (id: string, name: string) => {
  const existing = await db.select().from(schema.companies).where(eq(schema.companies.id, id)).get();
  if (existing) return existing;
  await db.insert(schema.companies).values({
    id,
    name,
    code: id.toUpperCase().slice(0, 10),
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();
  return db.select().from(schema.companies).where(eq(schema.companies.id, id)).get();
};

const ensureBranch = async (payload: {
  id: string;
  companyId: string;
  name: string;
  code?: string;
  isMain?: boolean;
}) => {
  const existing = await db.select().from(schema.branches).where(eq(schema.branches.id, payload.id)).get();
  if (existing) return existing;
  await db.insert(schema.branches).values({
    id: payload.id,
    companyId: payload.companyId,
    name: payload.name,
    code: payload.code || payload.id.toUpperCase().slice(0, 10),
    isMain: payload.isMain ?? false,
    isActive: true,
    location: '',
    manager: '',
    phone: '',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();
  return db.select().from(schema.branches).where(eq(schema.branches.id, payload.id)).get();
};

const ensureCashBox = async (payload: {
  id: string;
  companyId: string;
  branchId: string;
  name: string;
}) => {
  const existing = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, payload.id)).get();
  if (existing) return existing;
  await db.insert(schema.cashBoxes).values({
    id: payload.id,
    companyId: payload.companyId,
    branchId: payload.branchId,
    name: payload.name,
    balance: 0,
    currency: 'USD',
    isActive: true,
  }).run();
  return db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, payload.id)).get();
};

const ensureUserCompanyAccess = async (userId: string, companyId: string, isDefault = false) => {
  await db.insert(schema.userCompanyAccess).values({
    id: `uca-${userId}-${companyId}`,
    userId,
    companyId,
    isDefault,
    isActive: true,
  }).onConflictDoNothing().run();
};

const ensureUserBranchAccess = async (userId: string, branchId: string, isDefault = false) => {
  await db.insert(schema.userBranchAccess).values({
    id: `uba-${userId}-${branchId}`,
    userId,
    branchId,
    isDefault,
    isActive: true,
  }).onConflictDoNothing().run();
};

const findLatestAuditLog = async (operationType: string, needle?: string) => {
  const rows = await db.select().from(schema.auditLogs).all();
  return [...rows].reverse().find((row: any) =>
    String(row?.operationType || '') === operationType
    && (!needle || `${row?.affectedItems || '} ${row?.meta || '}`.includes(needle))
  );
};

const findLatestSystemEvent = async (eventType?: string, needle?: string) => {
  const rows = await db.select().from(schema.systemEvents).all();
  return [...rows].reverse().find((row: any) =>
    (!eventType || String(row?.eventType || '') === eventType)
    && (!needle || `${row?.affectedDocumentId || '} ${row?.metadata || '}`.includes(needle))
  );
};

const insertItem = async (payload: {
  id: string;
  name: string;
  code: string;
  quantity: number;
  warehouseId?: string;
  warehouseName?: string;
  salePrice?: number;
  costPrice?: number;
  serialTracking?: 'none' | 'required';
  companyId?: string;
  branchId?: string;
}) => {
  await db.insert(schema.items).values({
    id: payload.id,
    companyId: payload.companyId || TEST_COMPANY_ID,
    branchId: payload.branchId || TEST_BRANCH_ID,
    name: payload.name,
    code: payload.code,
    quantity: payload.quantity,
    unitName: 'pcs',
    costPrice: payload.costPrice ?? 10,
    costPriceBase: payload.costPrice ?? 10,
    salePrice: payload.salePrice ?? 20,
    salePriceBase: payload.salePrice ?? 20,
    wholesalePrice: payload.salePrice ?? 20,
    wholesalePriceBase: payload.salePrice ?? 20,
    posPrice: payload.salePrice ?? 20,
    posPriceBase: payload.salePrice ?? 20,
    warehouseId: payload.warehouseId || 'wh-main',
    warehouseName: payload.warehouseName || 'Main Warehouse',
    priceCurrency: 'USD',
    serialTracking: payload.serialTracking || 'none',
    itemType: 'STOCK',
    lastUpdated: new Date().toISOString(),
  }).run();
};

before(async () => {
  await server.ready();
  await ensureDatabaseColumns(db);
  await seedAccounts(db);
  await seedDefaultWarehouse(db);
  await seedDefaultCashBox(db);

  await insertUser({ id: 'u-admin', username: 'admin', password: 'admin123', role: 'admin', permissions: ['*'] });
  await insertUser({ id: 'u-viewer', username: 'viewer', password: 'viewer123', role: 'employee', permissions: ['view_reports'] });
  await insertUser({ id: 'u-delivery', username: 'delivery', password: 'delivery123', role: 'employee', permissions: ['manage_delivery_notices'], branchScope: 'restricted' });
  await insertUser({
    id: 'u-branch-invoice',
    username: 'branch.invoice',
    password: 'branch123',
    role: 'employee',
    permissions: ['create_sale_invoice'],
    branchScope: 'restricted',
  });

  await insertParty('party-cust-1', 'Main Customer', 'CUSTOMER');
  await insertItem({ id: 'item-sale-1', name: 'Sale Item', code: 'SALE-1', quantity: 25, salePrice: 30 });
  await insertItem({ id: 'item-delivery-1', name: 'Delivery Item', code: 'DEL-1', quantity: 12, salePrice: 15 });
  await insertItem({ id: 'item-serial-1', name: 'Serial Item', code: 'SER-1', quantity: 1, salePrice: 50, serialTracking: 'required' });
  await db.insert(schema.itemSerials).values({
    id: 'iserial-1',
    companyId: TEST_COMPANY_ID,
    branchId: TEST_BRANCH_ID,
    itemId: 'item-serial-1',
    serialNumber: 'SERIAL-SOLD-1',
    warehouseId: 'wh-main',
    status: 'sold',
    purchaseInvoiceId: 'legacy-purchase',
    salesInvoiceId: 'legacy-sale',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();
});

after(async () => {
  try { await server.close(); } catch {}
  try { closeDb(); } catch {}
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('ERP hardening integration', { concurrency: false }, () => {
  test('login without company is rejected', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/login',
      payload: {
        username: 'admin',
        password: 'admin123',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'COMPANY_REQUIRED');
  });

  test('login with company binds response user and jwt to company context', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/login',
      headers: {
        'x-active-org': TEST_COMPANY_ID,
        'x-company-id': TEST_COMPANY_ID,
      },
      payload: {
        username: 'admin',
        password: 'admin123',
        companyId: TEST_COMPANY_ID,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.user.companyId, TEST_COMPANY_ID);
    const decoded = server.jwt.verify(body.token) as any;
    assert.equal(decoded.companyId, TEST_COMPANY_ID);
  });

  test('accessing protected api without company headers is rejected', async () => {
    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/settings',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, 'NO_COMPANY_CONTEXT');
  });

  test('switching company resets stored session state', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    };
    storage.setItem('shamel_token', 'token-before-switch');
    storage.setItem('shamel_user', JSON.stringify({
      id: 'u-admin',
      username: 'admin',
      name: 'admin',
      role: 'admin',
      permissions: ['*'],
      companyId: 'org-before',
    }));
    storage.setItem('selected_company_id', 'org-before');
    storage.setItem('shamel_active_org', 'org-before');

    switchCompanySession('org-after', storage);

    assert.equal(getSelectedCompanyId(storage), 'org-after');
    assert.equal(getStoredToken(storage), null);
    assert.equal(getStoredUser(storage), null);
    const validation = validateCompanyBoundSession([{ id: 'org-after' }], storage);
    assert.equal(validation.reason, 'missing_token');
  });

  test('login with multiple allowed branches requires explicit branch selection', async () => {
    await ensureCompany(TEST_COMPANY_ID, 'Main Company');
    await ensureBranch({ id: SECONDARY_BRANCH_ID, companyId: TEST_COMPANY_ID, name: 'Secondary Branch', code: 'SEC' });
    await insertUser({
      id: 'u-multi-branch',
      username: 'multi.branch',
      password: 'multi123',
      role: 'employee',
      permissions: ['view_reports'],
      companyId: TEST_COMPANY_ID,
      defaultBranchId: null,
      branchScope: 'restricted',
      allowedBranchIds: [TEST_BRANCH_ID, SECONDARY_BRANCH_ID],
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/login',
      headers: {
        'x-active-org': TEST_COMPANY_ID,
        'x-company-id': TEST_COMPANY_ID,
      },
      payload: {
        username: 'multi.branch',
        password: 'multi123',
        companyId: TEST_COMPANY_ID,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.user.requiresBranchSelection, true);
    assert.equal(body.user.currentBranchId, null);
    const decoded = server.jwt.verify(body.token) as any;
    assert.equal(decoded.currentBranchId, null);
  });

  test('login with a single allowed branch auto-selects it safely', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/login',
      headers: {
        'x-active-org': TEST_COMPANY_ID,
        'x-company-id': TEST_COMPANY_ID,
      },
      payload: {
        username: 'delivery',
        password: 'delivery123',
        companyId: TEST_COMPANY_ID,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.user.requiresBranchSelection, false);
    assert.equal(body.user.currentBranchId, TEST_BRANCH_ID);
  });

  test('branch switch enforces allowed branches and updates current branch on success', async () => {
    const deniedToken = await tokenFor('u-delivery', 'employee', TEST_COMPANY_ID, TEST_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID],
      defaultBranchId: TEST_BRANCH_ID,
      currentBranchId: TEST_BRANCH_ID,
      branchScope: 'restricted',
    });
    const deniedResponse = await server.inject({
      method: 'POST',
      url: '/api/session/branch-context',
      headers: authHeaders(deniedToken),
      payload: { branchId: SECONDARY_BRANCH_ID },
    });
    assert.equal(deniedResponse.statusCode, 403);

    const allowedToken = await tokenFor('u-multi-branch', 'employee', TEST_COMPANY_ID, TEST_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID, SECONDARY_BRANCH_ID],
      defaultBranchId: null,
      currentBranchId: null,
      branchScope: 'restricted',
    });
    const allowedResponse = await server.inject({
      method: 'POST',
      url: '/api/session/branch-context',
      headers: authHeaders(allowedToken),
      payload: { branchId: SECONDARY_BRANCH_ID },
    });
    assert.equal(allowedResponse.statusCode, 200);
    assert.equal(allowedResponse.json().user.currentBranchId, SECONDARY_BRANCH_ID);
  });

  test('user branch assignments reject branches from another company', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(token),
      payload: {
        id: 'u-invalid-branch-assignment',
        username: 'invalid.branch.assignment',
        password: 'invalid123',
        role: 'employee',
        permissions: ['view_reports'],
        allowedBranchIds: [ALT_BRANCH_ID],
        defaultBranchId: ALT_BRANCH_ID,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'INVALID_BRANCH_ASSIGNMENT');
  });

  test('session companies list and live company switch use backend memberships', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await ensureUserCompanyAccess('u-admin', ALT_COMPANY_ID, false);
    await ensureUserBranchAccess('u-admin', ALT_BRANCH_ID, true);

    const token = await tokenFor('u-admin');
    const companiesResponse = await server.inject({
      method: 'GET',
      url: '/api/session/companies',
      headers: authHeaders(token),
    });

    assert.equal(companiesResponse.statusCode, 200);
    const companiesBody = companiesResponse.json();
    assert.ok(Array.isArray(companiesBody.companies));
    assert.ok(companiesBody.allowedCompanyIds.includes(TEST_COMPANY_ID));
    assert.ok(companiesBody.allowedCompanyIds.includes(ALT_COMPANY_ID));

    const switchResponse = await server.inject({
      method: 'POST',
      url: '/api/session/company-context',
      headers: authHeaders(token),
      payload: { companyId: ALT_COMPANY_ID },
    });

    assert.equal(switchResponse.statusCode, 200);
    const switchBody = switchResponse.json();
    assert.equal(switchBody.user.companyId, ALT_COMPANY_ID);
    assert.equal(switchBody.user.currentBranchId, ALT_BRANCH_ID);
    assert.ok(Array.isArray(switchBody.user.allowedCompanyIds));
    assert.ok(switchBody.user.allowedCompanyIds.includes(ALT_COMPANY_ID));
  });

  test('session companies enforce single-company visibility when capability is absent', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await ensureUserCompanyAccess('u-viewer', ALT_COMPANY_ID, false);

    const token = await tokenFor('u-viewer', 'employee', TEST_COMPANY_ID, TEST_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID],
      defaultBranchId: TEST_BRANCH_ID,
      currentBranchId: TEST_BRANCH_ID,
      branchScope: 'restricted',
    });
    const response = await server.inject({
      method: 'GET',
      url: '/api/session/companies',
      headers: authHeaders(token),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(Boolean(body.hasMultiCompanyCapability), false);
    assert.equal(String(body.companyVisibilityMode || ''), 'single');
    assert.deepEqual(body.allowedCompanyIds, [TEST_COMPANY_ID]);
  });

  test('company provisioning creates company defaults and memberships', async () => {
    const token = await tokenFor('u-admin');
    const provisionResponse = await server.inject({
      method: 'POST',
      url: '/api/companies/provision',
      headers: authHeaders(token),
      payload: {
        companyId: 'org-provision-test',
        companyCode: 'PRV1',
        companyName: 'Provision Test Company',
        branchId: 'br-provision-test',
        warehouseId: 'wh-provision-test',
        cashBoxId: 'cb-provision-test',
        primaryCurrency: 'EUR',
      },
    });

    assert.equal(provisionResponse.statusCode, 200);
    const company = await db.select().from(schema.companies).where(eq(schema.companies.id, 'org-provision-test')).get();
    const branch = await db.select().from(schema.branches).where(eq(schema.branches.id, 'br-provision-test')).get();
    const warehouse = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, 'wh-provision-test')).get();
    const cashBox = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-provision-test')).get();
    const companyAccess = await db.select().from(schema.userCompanyAccess).where(eq(schema.userCompanyAccess.id, 'uca-u-admin-org-provision-test')).get();
    const companyAccounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, 'org-provision-test')).all();
    const companySettings = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.companyId, 'org-provision-test')).all();

    assert.ok(company);
    assert.equal(branch?.companyId, 'org-provision-test');
    assert.equal(warehouse?.companyId, 'org-provision-test');
    assert.equal(cashBox?.companyId, 'org-provision-test');
    assert.ok(companyAccess);
    assert.ok(companyAccounts.some((account: any) => String(account.lookupCode || '') === '1110'));
    assert.ok(companySettings.length > 0);
  });

  test('company provisioning rejects invalid currency without leaving partial company rows', async () => {
    const token = await tokenFor('u-admin');
    const provisionResponse = await server.inject({
      method: 'POST',
      url: '/api/companies/provision',
      headers: authHeaders(token),
      payload: {
        companyId: 'org-provision-invalid',
        companyName: 'Provision Invalid Company',
        branchId: 'br-provision-invalid',
        warehouseId: 'wh-provision-invalid',
        cashBoxId: 'cb-provision-invalid',
        primaryCurrency: 'EU',
      },
    });

    assert.equal(provisionResponse.statusCode, 400);
    assert.equal(provisionResponse.json().code, 'INVALID_SETTING_PAYLOAD');

    const company = await db.select().from(schema.companies).where(eq(schema.companies.id, 'org-provision-invalid')).get();
    const branch = await db.select().from(schema.branches).where(eq(schema.branches.id, 'br-provision-invalid')).get();
    const warehouse = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, 'wh-provision-invalid')).get();
    const cashBox = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-provision-invalid')).get();

    assert.ok(!company);
    assert.ok(!branch);
    assert.ok(!warehouse);
    assert.ok(!cashBox);
  });

  test('accounts keep logical codes isolated per company', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await seedAccountsForCompany(db, ALT_COMPANY_ID);
    await ensureUserCompanyAccess('u-admin', ALT_COMPANY_ID, false);
    await ensureUserBranchAccess('u-admin', ALT_BRANCH_ID, true);

    const mainToken = await tokenFor('u-admin', 'admin', TEST_COMPANY_ID, TEST_BRANCH_ID);
    const altToken = await tokenFor('u-admin', 'admin', ALT_COMPANY_ID, ALT_BRANCH_ID, {
      allowedBranchIds: [ALT_BRANCH_ID],
      defaultBranchId: ALT_BRANCH_ID,
      currentBranchId: ALT_BRANCH_ID,
    });

    const mainCreate = await server.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: authHeaders(mainToken),
      payload: {
        code: '7999',
        nameAr: 'Main Scoped Account',
        accountType: 'expenses',
        accountNature: 'debit',
        level: 2,
      },
    });
    assert.equal(mainCreate.statusCode, 200);

    const altCreate = await server.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: authHeaders(altToken, ALT_COMPANY_ID, ALT_BRANCH_ID),
      payload: {
        code: '7999',
        nameAr: 'Alt Scoped Account',
        accountType: 'expenses',
        accountNature: 'debit',
        level: 2,
      },
    });
    assert.equal(altCreate.statusCode, 200);

    const mainAccountsResponse = await server.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: authHeaders(mainToken),
    });
    const altAccountsResponse = await server.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: authHeaders(altToken, ALT_COMPANY_ID, ALT_BRANCH_ID),
    });

    assert.equal(mainAccountsResponse.statusCode, 200);
    assert.equal(altAccountsResponse.statusCode, 200);

    const mainAccount = (mainAccountsResponse.json().accounts || []).find((account: any) => account.code === '7999');
    const altAccount = (altAccountsResponse.json().accounts || []).find((account: any) => account.code === '7999');

    assert.ok(mainAccount);
    assert.ok(altAccount);
    assert.equal(mainAccount.storageCode, '7999');
    assert.equal(altAccount.code, '7999');
    assert.ok(String(altAccount.storageCode || '').startsWith(`${ALT_COMPANY_ID}::`));
  });

  test('blocks unauthenticated invoice creation', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        invoiceNumber: 'INV-UNAUTH-1',
        type: 'sale',
        date: '2026-03-19',
        items: [],
      },
    });

    assert.equal(response.statusCode, 401);
  });

  test('blocks unauthorized invoice creation', async () => {
    const token = await tokenFor('u-viewer', 'employee');
    const response = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-NOPERM-1',
        type: 'sale',
        clientId: 'party-cust-1',
        clientName: 'Main Customer',
        date: '2026-03-19',
        paymentType: 'credit',
        targetWarehouseId: 'wh-main',
        items: [{
          itemId: 'item-sale-1',
          itemName: 'Sale Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 30,
          total: 30,
        }],
      },
    });

    assert.equal(response.statusCode, 403);
  });

  test('branch-restricted users cannot create invoices against another branch warehouse', async () => {
    await insertWarehouse('wh-secondary', 'Secondary Warehouse', { companyId: TEST_COMPANY_ID, branchId: SECONDARY_BRANCH_ID });
    await insertItem({
      id: 'item-secondary-1',
      name: 'Secondary Branch Item',
      code: 'SEC-ITEM-1',
      quantity: 9,
      warehouseId: 'wh-secondary',
      warehouseName: 'Secondary Warehouse',
      companyId: TEST_COMPANY_ID,
      branchId: SECONDARY_BRANCH_ID,
      salePrice: 31,
    });

    const token = await tokenFor('u-branch-invoice', 'employee', TEST_COMPANY_ID, TEST_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID],
      defaultBranchId: TEST_BRANCH_ID,
      currentBranchId: TEST_BRANCH_ID,
      branchScope: 'restricted',
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-BRANCH-DENIED-1',
        type: 'sale',
        clientId: 'party-cust-1',
        clientName: 'Main Customer',
        date: '2026-03-19',
        paymentType: 'credit',
        targetWarehouseId: 'wh-secondary',
        targetWarehouseName: 'Secondary Warehouse',
        items: [{
          itemId: 'item-secondary-1',
          itemName: 'Secondary Branch Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 31,
          total: 31,
        }],
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'BRANCH_ACCESS_DENIED');
  });

  test('branch-scoped invoice posting tags invoice and journal with the effective branch', async () => {
    const token = await tokenFor('u-admin', 'admin', TEST_COMPANY_ID, SECONDARY_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID, SECONDARY_BRANCH_ID],
      defaultBranchId: TEST_BRANCH_ID,
      currentBranchId: SECONDARY_BRANCH_ID,
      branchScope: 'company_wide',
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token, TEST_COMPANY_ID, SECONDARY_BRANCH_ID),
      payload: {
        invoiceNumber: 'INV-BRANCH-TAG-1',
        type: 'sale',
        clientId: 'party-cust-1',
        clientName: 'Main Customer',
        date: '2026-03-21',
        paymentType: 'credit',
        targetWarehouseId: 'wh-secondary',
        targetWarehouseName: 'Secondary Warehouse',
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-secondary-1',
          itemName: 'Secondary Branch Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 31,
          total: 31,
        }],
      },
    });

    assert.equal(response.statusCode, 200);
    const created = response.json();
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, created.id)).get();
    assert.ok(invoice);
    assert.equal(String((invoice as any).companyId || ''), TEST_COMPANY_ID);
    assert.equal(String((invoice as any).branchId || ''), SECONDARY_BRANCH_ID);

    const journalEntry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, Number((invoice as any).journalEntryId))).get();
    assert.ok(journalEntry);
    assert.equal(String((journalEntry as any).companyId || ''), TEST_COMPANY_ID);
    assert.equal(String((journalEntry as any).branchId || ''), SECONDARY_BRANCH_ID);
  });

  test('unmatched sensitive writes no longer fall through to authenticated-only access', async () => {
    const unauthenticated = await server.inject({
      method: 'POST',
      url: '/api/uncovered-sensitive',
      payload: { hello: 'world' },
    });
    assert.equal(unauthenticated.statusCode, 401);

    const token = await tokenFor('u-admin');
    const authenticated = await server.inject({
      method: 'POST',
      url: '/api/uncovered-sensitive',
      headers: authHeaders(token),
      payload: { hello: 'world' },
    });
    assert.equal(authenticated.statusCode, 403);
    assert.equal(authenticated.json().code, 'NO_AUTHORIZATION_POLICY');
  });

  test('covered post-audit prefixes deny writes without permission', async () => {
    const token = await tokenFor('u-viewer', 'employee');
    const response = await server.inject({
      method: 'POST',
      url: '/api/expenses',
      headers: authHeaders(token),
      payload: {
        code: 'EXP-NOAUTH-1',
        date: '2026-03-19',
        description: 'blocked expense',
        totalAmount: 10,
      },
    });

    assert.equal(response.statusCode, 403);
  });

  test('generic routes block canonical-only writes even for admins', async () => {
    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/attendance-records',
      headers: authHeaders(token),
      payload: {
        id: 'attendance-generic-1',
        employeeId: 'emp-generic-1',
        date: '2026-03-19',
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'GENERIC_CANONICAL_ONLY');
  });

  test('generic routes deny writes without collection-specific permission', async () => {
    const token = await tokenFor('u-viewer', 'employee');
    const response = await server.inject({
      method: 'POST',
      url: '/api/units',
      headers: authHeaders(token),
      payload: {
        id: 'unit-noauth-1',
        name: 'Blocked Unit',
      },
    });

    assert.equal(response.statusCode, 403);
  });

  test('security policy coverage verifier covers known families and flags unknown writes', async () => {
    const security = await import('../backend/lib/security.ts');
    const coverage = security.verifySensitiveRoutePolicyCoverage();
    assert.equal(coverage.missing.length, 0);

    const unknown = security.verifySensitiveRoutePolicyCoverage([{ path: '/api/future-sensitive', methods: ['POST'] }]);
    assert.deepEqual(unknown.missing, [{ path: '/api/future-sensitive', method: 'POST' }]);
  });

  test('rejects invalid settings payload and normalizes valid currency rates', async () => {
    const token = await tokenFor('u-admin');

    const invalidResponse = await server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeaders(token),
      payload: {
        key: 'defaultCurrency',
        value: 'abc',
      },
    });
    assert.equal(invalidResponse.statusCode, 400);

    const validResponse = await server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeaders(token),
      payload: {
        key: 'currencyRates',
        value: { SYP: '15000', TRY: '32' },
      },
    });
    assert.equal(validResponse.statusCode, 200);

    const settingsLib = await import('../backend/lib/settings.ts');
    const storedKey = settingsLib.buildScopedSettingKey('currencyRates', { companyId: TEST_COMPANY_ID });
    const stored = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, storedKey)).get();
    assert.ok(stored);
    const parsed = JSON.parse(String(stored.value));
    assert.deepEqual(parsed, { USD: 1, SYP: 15000, TRY: 32 });
  });

  test('settings are isolated per company through scoped storage', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await ensureUserCompanyAccess('u-admin', ALT_COMPANY_ID, false);
    await ensureUserBranchAccess('u-admin', ALT_BRANCH_ID, true);

    const mainToken = await tokenFor('u-admin', 'admin', TEST_COMPANY_ID, TEST_BRANCH_ID);
    const altToken = await tokenFor('u-admin', 'admin', ALT_COMPANY_ID, ALT_BRANCH_ID, {
      allowedBranchIds: [ALT_BRANCH_ID],
      defaultBranchId: ALT_BRANCH_ID,
      currentBranchId: ALT_BRANCH_ID,
      branchScope: 'company_wide',
    });

    const mainWrite = await server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeaders(mainToken),
      payload: { key: 'defaultCurrency', value: 'USD' },
    });
    assert.equal(mainWrite.statusCode, 200);

    const altWrite = await server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeaders(altToken, ALT_COMPANY_ID, ALT_BRANCH_ID),
      payload: { key: 'defaultCurrency', value: 'TRY' },
    });
    assert.equal(altWrite.statusCode, 200);

    const mainRead = await server.inject({
      method: 'GET',
      url: '/api/settings?key=defaultCurrency',
      headers: authHeaders(mainToken),
    });
    const altRead = await server.inject({
      method: 'GET',
      url: '/api/settings?key=defaultCurrency',
      headers: authHeaders(altToken, ALT_COMPANY_ID, ALT_BRANCH_ID),
    });

    assert.equal(mainRead.statusCode, 200);
    assert.equal(altRead.statusCode, 200);
    assert.equal(mainRead.json().value, 'USD');
    assert.equal(altRead.json().value, 'TRY');
  });

  test('opening stock posts through canonical lifecycle and prevents duplicate posting', async () => {
    const token = await tokenFor('u-admin');
    const payload = {
      fiscalYear: '2026',
      warehouseId: 'wh-main',
      currency: 'USD',
      date: '2026-01-01',
      lines: [{
        item_id: 'item-opening-1',
        item_name: 'Opening Item',
        item_code: 'OPEN-1',
        unit: 'pcs',
        quantity: 5,
        cost_price: 10,
      }],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/api/opening-stock/post',
      headers: authHeaders(token),
      payload,
    });

    assert.equal(response.statusCode, 200);
    const result = response.json();
    assert.equal(result.success, true);

    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, result.invoiceId)).get();
    assert.ok(invoice);
    assert.equal(String(invoice.type), 'opening_stock');
    assert.ok(Number((invoice as any).journalEntryId || 0) > 0);

    const item = await db.select().from(schema.items).where(eq(schema.items.id, 'item-opening-1')).get();
    assert.ok(item);
    assert.equal(Number(item.quantity || 0), 5);

    const mark = await db.select().from(schema.reconciliationMarks).where(eq(schema.reconciliationMarks.rowRefId, result.invoiceId)).get();
    assert.ok(mark);

    const duplicateResponse = await server.inject({
      method: 'POST',
      url: '/api/opening-stock/post',
      headers: authHeaders(token),
      payload,
    });
    assert.equal(duplicateResponse.statusCode, 409);
  });

  test('posted invoices cannot be directly edited', async () => {
    const token = await tokenFor('u-admin');
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-POSTED-1',
        type: 'sale',
        clientId: 'party-cust-1',
        clientName: 'Main Customer',
        date: '2026-03-19',
        paymentType: 'credit',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-sale-1',
          itemName: 'Sale Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 30,
          total: 30,
        }],
      },
    });
    assert.equal(createResponse.statusCode, 200);
    const created = createResponse.json();

    const updateResponse = await server.inject({
      method: 'PUT',
      url: `/api/invoices/${created.id}`,
      headers: authHeaders(token),
      payload: {
        notes: 'forbidden edit',
        items: [{
          itemId: 'item-sale-1',
          itemName: 'Sale Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 30,
          total: 30,
        }],
      },
    });

    assert.equal(updateResponse.statusCode, 409);
    assert.equal(updateResponse.json().code, 'POSTED_INVOICE_DIRECT_EDIT_BLOCKED');
  });

  test('delivery confirm requires approve permission', async () => {
    const adminToken = await tokenFor('u-admin');
    const createNotice = await server.inject({
      method: 'POST',
      url: '/api/delivery-notices',
      headers: authHeaders(adminToken),
      payload: {
        id: 'dn-perm-1',
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        receiverType: 'CUSTOMER',
        receiverId: 'party-cust-1',
        receiverName: 'Main Customer',
        items: [{
          itemId: 'item-delivery-1',
          itemName: 'Delivery Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
        }],
        createdById: 'u-admin',
        createdByName: 'admin',
      },
    });
    assert.equal(createNotice.statusCode, 200);

    const submitNotice = await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-perm-1/submit',
      headers: authHeaders(adminToken),
      payload: {
        submittedById: 'u-admin',
        submittedByName: 'admin',
      },
    });
    assert.equal(submitNotice.statusCode, 200);

    const weakToken = await tokenFor('u-delivery', 'employee');
    const confirmResponse = await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-perm-1/confirm',
      headers: authHeaders(weakToken),
      payload: {
        convertToInvoice: false,
        confirmedById: 'u-delivery',
        confirmedByName: 'delivery',
      },
    });

    assert.equal(confirmResponse.statusCode, 403);
  });

  test('delivery confirmation creates canonical linked invoice', async () => {
    const token = await tokenFor('u-admin');

    const createNotice = await server.inject({
      method: 'POST',
      url: '/api/delivery-notices',
      headers: authHeaders(token),
      payload: {
        id: 'dn-canonical-1',
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        receiverType: 'CUSTOMER',
        receiverId: 'party-cust-1',
        receiverName: 'Main Customer',
        items: [{
          itemId: 'item-delivery-1',
          itemName: 'Delivery Item',
          unitName: 'pcs',
          quantity: 2,
          baseQuantity: 2,
        }],
        createdById: 'u-admin',
        createdByName: 'admin',
      },
    });
    assert.equal(createNotice.statusCode, 200);

    const submitNotice = await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-canonical-1/submit',
      headers: authHeaders(token),
      payload: {
        submittedById: 'u-admin',
        submittedByName: 'admin',
      },
    });
    assert.equal(submitNotice.statusCode, 200);

    const confirmResponse = await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-canonical-1/confirm',
      headers: authHeaders(token),
      payload: {
        convertToInvoice: true,
        receiverId: 'party-cust-1',
        receiverName: 'Main Customer',
        invoiceNumber: 'INV-DN-1',
        currency: 'USD',
        confirmedById: 'u-admin',
        confirmedByName: 'admin',
      },
    });
    assert.equal(confirmResponse.statusCode, 200);
    const confirmResult = confirmResponse.json();
    assert.ok(confirmResult.linkedInvoiceId);

    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, confirmResult.linkedInvoiceId)).get();
    assert.ok(invoice);
    assert.equal(String((invoice as any).sourceDocumentType || ''), 'delivery_notice');
    assert.equal(String((invoice as any).sourceDocumentId || ''), 'dn-canonical-1');
    assert.ok(Number((invoice as any).journalEntryId || 0) > 0);

    const parsedItems = JSON.parse(String((invoice as any).items || '[]'));
    assert.equal(parsedItems.length, 1);
    assert.equal(parsedItems[0].itemId, 'item-delivery-1');
  });

  test('serial-tracked sale rejects unavailable serials', async () => {
    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-SERIAL-1',
        type: 'sale',
        clientId: 'party-cust-1',
        clientName: 'Main Customer',
        date: '2026-03-19',
        paymentType: 'credit',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-serial-1',
          itemName: 'Serial Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 50,
          total: 50,
          serialNumbers: ['SERIAL-SOLD-1'],
        }],
      },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, 'SERIAL_NOT_AVAILABLE');
  });

  test('cancel sale invoice restores stock and removes invoice row', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-cancel-stock', 'Cancel Stock Customer', 'CUSTOMER');
    await insertItem({ id: 'item-cancel-stock', name: 'Cancel Stock Item', code: 'CSTK-1', quantity: 9, salePrice: 15 });

    const beforeItem = await db.select().from(schema.items).where(eq(schema.items.id, 'item-cancel-stock')).get();
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-CANCEL-STOCK-1',
        type: 'sale',
        clientId: 'party-cancel-stock',
        clientName: 'Cancel Stock Customer',
        date: '2026-03-19',
        paymentType: 'credit',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-cancel-stock',
          itemName: 'Cancel Stock Item',
          unitName: 'pcs',
          quantity: 2,
          baseQuantity: 2,
          unitPrice: 15,
          total: 30,
        }],
      },
    });
    assert.equal(createResponse.statusCode, 200);
    const invoiceId = createResponse.json().id;

    const reducedItem = await db.select().from(schema.items).where(eq(schema.items.id, 'item-cancel-stock')).get();
    assert.equal(Number(reducedItem?.quantity || 0), Number(beforeItem?.quantity || 0) - 2);

    const cancelResponse = await server.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/cancel`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(cancelResponse.statusCode, 200);

    const afterItem = await db.select().from(schema.items).where(eq(schema.items.id, 'item-cancel-stock')).get();
    const deletedInvoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
    assert.equal(Number(afterItem?.quantity || 0), Number(beforeItem?.quantity || 0));
    assert.equal(deletedInvoice, undefined);
  });

  test('cancel cash invoice reverses linked voucher and cashbox effects', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-cancel-cash', 'Cancel Cash Customer', 'CUSTOMER');
    await insertItem({ id: 'item-cancel-cash', name: 'Cancel Cash Item', code: 'CCSH-1', quantity: 7, salePrice: 20 });

    const cashBoxBefore = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-default')).get();
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-CANCEL-CASH-1',
        type: 'sale',
        clientId: 'party-cancel-cash',
        clientName: 'Cancel Cash Customer',
        date: '2026-03-19',
        paymentType: 'cash',
        cashBoxId: 'cb-default',
        cashBoxName: 'Default Cash',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-cancel-cash',
          itemName: 'Cancel Cash Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 20,
          total: 20,
        }],
      },
    });
    assert.equal(createResponse.statusCode, 200);
    const invoiceId = createResponse.json().id;

    const voucherBeforeCancel = await db.select().from(schema.vouchers).where(eq(schema.vouchers.linkedInvoiceId, invoiceId)).get();
    assert.ok(voucherBeforeCancel);

    const cancelResponse = await server.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/cancel`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(cancelResponse.statusCode, 200);

    const voucherAfterCancel = await db.select().from(schema.vouchers).where(eq(schema.vouchers.linkedInvoiceId, invoiceId)).get();
    const cashBoxAfter = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-default')).get();
    assert.equal(voucherAfterCancel, undefined);
    assert.equal(Number(cashBoxAfter?.balance || 0), Number(cashBoxBefore?.balance || 0));
  });

  test('cancel invoice restores party balance state', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-cancel-balance', 'Cancel Balance Customer', 'CUSTOMER');
    await insertItem({ id: 'item-cancel-balance', name: 'Cancel Balance Item', code: 'CBAL-1', quantity: 4, salePrice: 18 });

    const beforeParty = await db.select().from(schema.parties).where(eq(schema.parties.id, 'party-cancel-balance')).get();
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-CANCEL-BAL-1',
        type: 'sale',
        clientId: 'party-cancel-balance',
        clientName: 'Cancel Balance Customer',
        date: '2026-03-19',
        paymentType: 'credit',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-cancel-balance',
          itemName: 'Cancel Balance Item',
          unitName: 'pcs',
          quantity: 2,
          baseQuantity: 2,
          unitPrice: 18,
          total: 36,
        }],
      },
    });
    assert.equal(createResponse.statusCode, 200);
    const invoiceId = createResponse.json().id;

    const inflatedParty = await db.select().from(schema.parties).where(eq(schema.parties.id, 'party-cancel-balance')).get();
    assert.ok(Number(inflatedParty?.balance || 0) > Number(beforeParty?.balance || 0));

    const cancelResponse = await server.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/cancel`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(cancelResponse.statusCode, 200);

    const afterParty = await db.select().from(schema.parties).where(eq(schema.parties.id, 'party-cancel-balance')).get();
    assert.equal(Number(afterParty?.balance || 0), Number(beforeParty?.balance || 0));
  });

  test('cancel serial-tracked invoice restores serial state', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-cancel-serial', 'Cancel Serial Customer', 'CUSTOMER');
    await insertItem({ id: 'item-cancel-serial', name: 'Cancel Serial Item', code: 'CSER-1', quantity: 1, salePrice: 75, serialTracking: 'required' });
    await db.insert(schema.itemSerials).values({
      id: 'iserial-cancel-serial',
      itemId: 'item-cancel-serial',
      serialNumber: 'SERIAL-CANCEL-1',
      warehouseId: 'wh-main',
      status: 'available',
      purchaseInvoiceId: 'legacy-purchase-cancel',
      salesInvoiceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-CANCEL-SERIAL-1',
        type: 'sale',
        clientId: 'party-cancel-serial',
        clientName: 'Cancel Serial Customer',
        date: '2026-03-19',
        paymentType: 'credit',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-cancel-serial',
          itemName: 'Cancel Serial Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 75,
          total: 75,
          serialNumbers: ['SERIAL-CANCEL-1'],
        }],
      },
    });
    assert.equal(createResponse.statusCode, 200);
    const invoiceId = createResponse.json().id;

    const soldSerial = await db.select().from(schema.itemSerials).where(eq(schema.itemSerials.serialNumber, 'SERIAL-CANCEL-1')).get();
    assert.equal(String(soldSerial?.status || ''), 'sold');

    const cancelResponse = await server.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/cancel`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(cancelResponse.statusCode, 200);

    const restoredSerial = await db.select().from(schema.itemSerials).where(eq(schema.itemSerials.serialNumber, 'SERIAL-CANCEL-1')).get();
    assert.equal(String(restoredSerial?.status || ''), 'available');
    assert.equal(restoredSerial?.salesInvoiceId || null, null);
  });

  test('cancel failure does not leave partial state unnoticed', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-cancel-failure', 'Cancel Failure Customer', 'CUSTOMER');
    await insertItem({ id: 'item-cancel-failure', name: 'Cancel Failure Item', code: 'CFAIL-1', quantity: 3, salePrice: 22 });

    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: 'INV-CANCEL-FAIL-1',
        type: 'sale',
        clientId: 'party-cancel-failure',
        clientName: 'Cancel Failure Customer',
        date: '2026-03-19',
        paymentType: 'cash',
        cashBoxId: 'cb-default',
        cashBoxName: 'Default Cash',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-cancel-failure',
          itemName: 'Cancel Failure Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 22,
          total: 22,
        }],
      },
    });
    assert.equal(createResponse.statusCode, 200);
    const invoiceId = createResponse.json().id;

    const originalInvoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
    const originalVoucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.linkedInvoiceId, invoiceId)).get();
    const stockBeforeFailedCancel = await db.select().from(schema.items).where(eq(schema.items.id, 'item-cancel-failure')).get();
    await db.update(schema.invoices).set({ journalEntryId: 999999 }).where(eq(schema.invoices.id, invoiceId)).run();

    const cancelResponse = await server.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/cancel`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(cancelResponse.statusCode, 500);

    const invoiceAfterFailure = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
    const voucherAfterFailure = await db.select().from(schema.vouchers).where(eq(schema.vouchers.linkedInvoiceId, invoiceId)).get();
    const stockAfterFailure = await db.select().from(schema.items).where(eq(schema.items.id, 'item-cancel-failure')).get();
    assert.ok(invoiceAfterFailure);
    assert.ok(voucherAfterFailure);
    assert.equal(Number(stockAfterFailure?.quantity || 0), Number(stockBeforeFailedCancel?.quantity || 0));

    await db.update(schema.invoices).set({ journalEntryId: (originalInvoice as any)?.journalEntryId || null }).where(eq(schema.invoices.id, invoiceId)).run();
    assert.equal(String(voucherAfterFailure?.id || ''), String(originalVoucher?.id || ''));
  });

  test('posted voucher update is blocked and preserves financial consistency', async () => {
    const token = await tokenFor('u-admin');
    const balanceBefore = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-default')).get();

    const createVoucherResponse = await server.inject({
      method: 'POST',
      url: '/api/vouchers',
      headers: authHeaders(token),
      payload: {
        id: 'v-update-ok-1',
        type: 'payment',
        date: '2026-03-19',
        amount: 10,
        currency: 'USD',
        cashBoxId: 'cb-default',
        cashBoxName: 'Default Cash',
        description: 'update success seed',
      },
    });
    assert.equal(createVoucherResponse.statusCode, 200);

    const updateResponse = await server.inject({
      method: 'PUT',
      url: '/api/vouchers/v-update-ok-1',
      headers: authHeaders(token),
      payload: {
        amount: 25,
        description: 'update success final',
      },
    });
    assert.equal(updateResponse.statusCode, 409);
    assert.equal(updateResponse.json().code, 'POSTED_VOUCHER_EDIT_BLOCKED');

    const voucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, 'v-update-ok-1')).get();
    const balanceAfter = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-default')).get();
    assert.equal(Number(voucher?.amount || 0), 10);
    assert.equal(Number(balanceAfter?.balance || 0), Number(balanceBefore?.balance || 0) - 10);
  });

  test('voucher update failure leaves original voucher intact', async () => {
    const token = await tokenFor('u-admin');
    const balanceBefore = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-default')).get();

    const createVoucherResponse = await server.inject({
      method: 'POST',
      url: '/api/vouchers',
      headers: authHeaders(token),
      payload: {
        id: 'v-update-fail-1',
        type: 'payment',
        date: '2026-03-19',
        amount: 12,
        currency: 'USD',
        cashBoxId: 'cb-default',
        cashBoxName: 'Default Cash',
        description: 'update failure seed',
      },
    });
    assert.equal(createVoucherResponse.statusCode, 200);

    const updateResponse = await server.inject({
      method: 'PUT',
      url: '/api/vouchers/v-update-fail-1',
      headers: authHeaders(token),
      payload: {
        cashBoxId: 'cb-missing',
        amount: 30,
      },
    });
    assert.equal(updateResponse.statusCode, 404);
    assert.equal(updateResponse.json().code, 'CASH_BOX_NOT_FOUND');

    const voucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, 'v-update-fail-1')).get();
    const balanceAfter = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-default')).get();
    assert.equal(Number(voucher?.amount || 0), 12);
    assert.equal(String(voucher?.cashBoxId || ''), 'cb-default');
    assert.equal(Number(balanceAfter?.balance || 0), Number(balanceBefore?.balance || 0) - 12);
  });

  test('voucher delete failure returns explicit error and keeps original intact', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-voucher-delete-failure', 'Voucher Delete Failure Party', 'CUSTOMER');

    const createVoucherResponse = await server.inject({
      method: 'POST',
      url: '/api/vouchers',
      headers: authHeaders(token),
      payload: {
        id: 'v-delete-fail-1',
        type: 'receipt',
        date: '2026-03-19',
        amount: 14,
        currency: 'USD',
        cashBoxId: 'cb-default',
        cashBoxName: 'Default Cash',
        clientId: 'party-voucher-delete-failure',
        clientName: 'Voucher Delete Failure Party',
        description: 'delete failure seed',
      },
    });
    assert.equal(createVoucherResponse.statusCode, 200);

    await db.update(schema.vouchers).set({ journalEntryId: '999999' }).where(eq(schema.vouchers.id, 'v-delete-fail-1')).run();

    const deleteResponse = await server.inject({
      method: 'DELETE',
      url: '/api/vouchers/v-delete-fail-1',
      headers: authHeaders(token),
    });
    assert.equal(deleteResponse.statusCode, 500);
    assert.equal(deleteResponse.json().code, 'VOUCHER_REVERSE_FAILED');

    const voucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, 'v-delete-fail-1')).get();
    assert.ok(voucher);
  });

  test('posted voucher update does not write false success audit trail', async () => {
    const auditRow = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.operationType, 'voucher.update')).get();
    assert.equal(auditRow ?? null, null);
  });

  test('localRuntime blocks business writes in strict production mode', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousStrict = process.env.ERP_STRICT_MODE;
    const previousDisable = process.env.DISABLE_LOCAL_BUSINESS_WRITES;

    process.env.NODE_ENV = 'production';
    process.env.ERP_STRICT_MODE = 'true';
    process.env.DISABLE_LOCAL_BUSINESS_WRITES = 'true';

    try {
      const localRuntime = await import('../src/lib/localRuntime.ts');
      assert.equal(localRuntime.isStrictLocalBusinessWriteMode(), true);

      await assert.rejects(
        () => localRuntime.localRuntimeRequest('invoices', {
          method: 'POST',
          body: {
            id: 'lr-invoice-1',
            invoiceNumber: 'LR-INV-1',
          },
        }),
        (error: any) => error?.code === 'LOCAL_BUSINESS_WRITES_DISABLED' && error?.status === 403,
      );

      await assert.rejects(
        () => localRuntime.localRuntimeRequest('vouchers', {
          method: 'POST',
          body: {
            id: 'lr-voucher-1',
            amount: 10,
          },
        }),
        (error: any) => error?.code === 'LOCAL_BUSINESS_WRITES_DISABLED' && error?.status === 403,
      );

      await assert.rejects(
        () => localRuntime.localRuntimeRequest('items/item-local-1', {
          method: 'PUT',
          body: {
            quantity: 5,
          },
        }),
        (error: any) => error?.code === 'LOCAL_BUSINESS_WRITES_DISABLED' && error?.status === 403,
      );
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousStrict === undefined) delete process.env.ERP_STRICT_MODE;
      else process.env.ERP_STRICT_MODE = previousStrict;
      if (previousDisable === undefined) delete process.env.DISABLE_LOCAL_BUSINESS_WRITES;
      else process.env.DISABLE_LOCAL_BUSINESS_WRITES = previousDisable;
    }
  });

  test('expense posting fails when journal creation fails', async () => {
    const token = await tokenFor('u-admin');
    const createExpenseResponse = await server.inject({
      method: 'POST',
      url: '/api/expenses',
      headers: authHeaders(token),
      payload: {
        id: 'exp-journal-fail-1',
        code: 'EXP-JF-1',
        date: '2026-03-19',
        description: 'expense journal fail',
        totalAmount: 50,
        paymentType: 'CASH',
        cashBoxId: 'cb-default',
        cashBoxName: 'Default Cash',
        lines: [{ amount: 50, accountId: 999999 }],
      },
    });
    assert.equal(createExpenseResponse.statusCode, 200);

    const postResponse = await server.inject({
      method: 'POST',
      url: '/api/expenses/exp-journal-fail-1/post',
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(postResponse.statusCode, 500);

    const expense = await db.select().from(schema.expenses).where(eq(schema.expenses.id, 'exp-journal-fail-1')).get();
    assert.equal(String(expense?.status || ''), 'DRAFT');
  });

  test('mandatory audit failure compensates invoice creation', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-audit-fail', 'Audit Failure Customer', 'CUSTOMER');
    await insertItem({ id: 'item-audit-fail', name: 'Audit Failure Item', code: 'AUD-1', quantity: 5, salePrice: 11 });
    const beforeItem = await db.select().from(schema.items).where(eq(schema.items.id, 'item-audit-fail')).get();

    process.env.AUDIT_FAIL_OPERATIONS = 'invoice.create';
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/invoices',
        headers: authHeaders(token),
        payload: {
          invoiceNumber: 'INV-AUDIT-FAIL-1',
          type: 'sale',
          clientId: 'party-audit-fail',
          clientName: 'Audit Failure Customer',
          date: '2026-03-19',
          paymentType: 'credit',
          targetWarehouseId: 'wh-main',
          targetWarehouseName: 'Main Warehouse',
          createdById: 'u-admin',
          createdByName: 'admin',
          items: [{
            itemId: 'item-audit-fail',
            itemName: 'Audit Failure Item',
            unitName: 'pcs',
            quantity: 1,
            baseQuantity: 1,
            unitPrice: 11,
            total: 11,
          }],
        },
      });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json().code, 'MANDATORY_AUDIT_FAILED');
    } finally {
      delete process.env.AUDIT_FAIL_OPERATIONS;
    }

    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.invoiceNumber, 'INV-AUDIT-FAIL-1')).get();
    const afterItem = await db.select().from(schema.items).where(eq(schema.items.id, 'item-audit-fail')).get();
    assert.equal(invoice, undefined);
    assert.equal(Number(afterItem?.quantity || 0), Number(beforeItem?.quantity || 0));
  });

  test('consignment auto invoice failure returns explicit partial-success status', async () => {
    const token = await tokenFor('u-admin');
    await insertWarehouse('wh-cons-auto', 'Consignment Warehouse');
    await insertParty('party-consignment-auto', 'Consignment Auto Customer', 'CUSTOMER');
    await insertItem({ id: 'item-consignment-auto', name: 'Consignment Auto Item', code: 'CONS-AUTO-1', quantity: 1, salePrice: 40, serialTracking: 'required' });
    await db.insert(schema.itemSerials).values({
      id: 'iserial-consignment-auto',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      itemId: 'item-consignment-auto',
      serialNumber: 'SERIAL-CONS-AUTO-1',
      warehouseId: 'wh-main',
      status: 'available',
      purchaseInvoiceId: 'legacy-cons-auto',
      salesInvoiceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    const createDoc = await server.inject({
      method: 'POST',
      url: '/api/consignments',
      headers: authHeaders(token),
      payload: {
        id: 'cons-auto-doc-1',
        documentNumber: 'CONS-AUTO-1',
        direction: 'OUT_CUSTOMER',
        partyId: 'party-consignment-auto',
        sourceWarehouseId: 'wh-main',
        consignmentWarehouseId: 'wh-cons-auto',
        issueDate: '2026-03-19',
        createdBy: 'u-admin',
        lines: [{
          id: 'cons-auto-line-1',
          itemId: 'item-consignment-auto',
          qty: 1,
          unitId: null,
          unitName: 'pcs',
          serialNumbers: ['SERIAL-CONS-AUTO-1'],
        }],
      },
    });
    assert.equal(createDoc.statusCode, 200);

    const postDoc = await server.inject({
      method: 'POST',
      url: '/api/consignments/cons-auto-doc-1/post',
      headers: authHeaders(token),
      payload: { userId: 'u-admin', userName: 'admin' },
    });
    assert.equal(postDoc.statusCode, 200);

    const docLine = await db.select().from(schema.consignmentDocumentLines).where(eq(schema.consignmentDocumentLines.documentId, 'cons-auto-doc-1')).get();
    assert.ok(docLine);

    const createSettlement = await server.inject({
      method: 'POST',
      url: '/api/consignment-settlements',
      headers: authHeaders(token),
      payload: {
        id: 'cons-auto-settlement-1',
        settlementNumber: 'CSET-AUTO-1',
        documentId: 'cons-auto-doc-1',
        settlementDate: '2026-03-19',
        createdBy: 'u-admin',
        lines: [{
          id: 'cons-auto-settlement-line-1',
          documentLineId: docLine?.id,
          actionType: 'SOLD',
          qty: 1,
          unitName: 'pcs',
        }],
      },
    });
    assert.equal(createSettlement.statusCode, 200);

    const postSettlement = await server.inject({
      method: 'POST',
      url: '/api/consignment-settlements/cons-auto-settlement-1/post',
      headers: authHeaders(token),
      payload: { userId: 'u-admin', userName: 'admin' },
    });
    assert.equal(postSettlement.statusCode, 207);
    assert.equal(postSettlement.json().partialSuccess, true);
    assert.equal(postSettlement.json().settlementPosted, true);
  });

  test('delivery confirm compensates when audit fails after invoice creation', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-delivery-comp', 'Delivery Compensation Customer', 'CUSTOMER');
    await insertItem({ id: 'item-delivery-comp', name: 'Delivery Compensation Item', code: 'DLC-1', quantity: 6, salePrice: 19 });

    const createNotice = await server.inject({
      method: 'POST',
      url: '/api/delivery-notices',
      headers: authHeaders(token),
      payload: {
        id: 'dn-comp-1',
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        receiverType: 'CUSTOMER',
        receiverId: 'party-delivery-comp',
        receiverName: 'Delivery Compensation Customer',
        items: [{
          itemId: 'item-delivery-comp',
          itemName: 'Delivery Compensation Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
        }],
        createdById: 'u-admin',
        createdByName: 'admin',
      },
    });
    assert.equal(createNotice.statusCode, 200);

    const submitNotice = await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-comp-1/submit',
      headers: authHeaders(token),
      payload: {
        submittedById: 'u-admin',
        submittedByName: 'admin',
      },
    });
    assert.equal(submitNotice.statusCode, 200);

    process.env.AUDIT_FAIL_OPERATIONS = 'delivery.confirm';
    try {
      const confirmResponse = await server.inject({
        method: 'POST',
        url: '/api/delivery-notices/dn-comp-1/confirm',
        headers: authHeaders(token),
        payload: {
          convertToInvoice: true,
          receiverId: 'party-delivery-comp',
          receiverName: 'Delivery Compensation Customer',
          invoiceNumber: 'INV-DLCOMP-1',
          confirmedById: 'u-admin',
          confirmedByName: 'admin',
        },
      });
      assert.equal(confirmResponse.statusCode, 500);
    } finally {
      delete process.env.AUDIT_FAIL_OPERATIONS;
    }

    const notice = await db.select().from(schema.deliveryNotices).where(eq(schema.deliveryNotices.id, 'dn-comp-1')).get();
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.sourceDocumentId, 'dn-comp-1')).get();
    const item = await db.select().from(schema.items).where(eq(schema.items.id, 'item-delivery-comp')).get();
    assert.equal(String(notice?.status || ''), 'SUBMITTED');
    assert.equal(invoice, undefined);
    assert.equal(Number(item?.quantity || 0), 6);
  });

  test('delivery compensation exposes notice restore failure while invoice cancel succeeds', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-delivery-comp-restore', 'Delivery Restore Failure Customer', 'CUSTOMER');
    await insertItem({ id: 'item-delivery-comp-restore', name: 'Delivery Restore Failure Item', code: 'DLR-1', quantity: 5, salePrice: 23 });

    await server.inject({
      method: 'POST',
      url: '/api/delivery-notices',
      headers: authHeaders(token),
      payload: {
        id: 'dn-comp-restore-1',
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        receiverType: 'CUSTOMER',
        receiverId: 'party-delivery-comp-restore',
        receiverName: 'Delivery Restore Failure Customer',
        items: [{
          itemId: 'item-delivery-comp-restore',
          itemName: 'Delivery Restore Failure Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
        }],
        createdById: 'u-admin',
        createdByName: 'admin',
      },
    });
    await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-comp-restore-1/submit',
      headers: authHeaders(token),
      payload: { submittedById: 'u-admin', submittedByName: 'admin' },
    });

    process.env.AUDIT_FAIL_OPERATIONS = 'delivery.confirm';
    process.env.COMPENSATION_FAIL_STEPS = 'delivery.notice_restore';
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery-notices/dn-comp-restore-1/confirm',
        headers: authHeaders(token),
        payload: {
          convertToInvoice: true,
          receiverId: 'party-delivery-comp-restore',
          receiverName: 'Delivery Restore Failure Customer',
          invoiceNumber: 'INV-DL-RESTORE-1',
          confirmedById: 'u-admin',
          confirmedByName: 'admin',
        },
      });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json().code, 'DELIVERY_CONFIRM_COMPENSATION_FAILED');
      assert.equal(response.json().details.requires_manual_review, true);
      assert.equal(response.json().details.notice_restore_status, 'failed');
      assert.equal(response.json().details.invoice_cancel_status, 'succeeded');
    } finally {
      delete process.env.AUDIT_FAIL_OPERATIONS;
      delete process.env.COMPENSATION_FAIL_STEPS;
    }

    const notice = await db.select().from(schema.deliveryNotices).where(eq(schema.deliveryNotices.id, 'dn-comp-restore-1')).get();
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.sourceDocumentId, 'dn-comp-restore-1')).get();
    const auditRow = await findLatestAuditLog('delivery.confirm.compensation.failed', 'dn-comp-restore-1');
    assert.equal(String(notice?.status || ''), 'CONFIRMED');
    assert.equal(invoice, undefined);
    assert.ok(auditRow);
  });

  test('delivery compensation exposes invoice cancel failure', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-delivery-comp-cancel', 'Delivery Cancel Failure Customer', 'CUSTOMER');
    await insertItem({ id: 'item-delivery-comp-cancel', name: 'Delivery Cancel Failure Item', code: 'DLCF-1', quantity: 5, salePrice: 24 });

    await server.inject({
      method: 'POST',
      url: '/api/delivery-notices',
      headers: authHeaders(token),
      payload: {
        id: 'dn-comp-cancel-1',
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        receiverType: 'CUSTOMER',
        receiverId: 'party-delivery-comp-cancel',
        receiverName: 'Delivery Cancel Failure Customer',
        items: [{
          itemId: 'item-delivery-comp-cancel',
          itemName: 'Delivery Cancel Failure Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
        }],
        createdById: 'u-admin',
        createdByName: 'admin',
      },
    });
    await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-comp-cancel-1/submit',
      headers: authHeaders(token),
      payload: { submittedById: 'u-admin', submittedByName: 'admin' },
    });

    process.env.AUDIT_FAIL_OPERATIONS = 'delivery.confirm';
    process.env.COMPENSATION_FAIL_STEPS = 'delivery.invoice_cancel';
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery-notices/dn-comp-cancel-1/confirm',
        headers: authHeaders(token),
        payload: {
          convertToInvoice: true,
          receiverId: 'party-delivery-comp-cancel',
          receiverName: 'Delivery Cancel Failure Customer',
          invoiceNumber: 'INV-DL-CANCEL-1',
          confirmedById: 'u-admin',
          confirmedByName: 'admin',
        },
      });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json().code, 'DELIVERY_CONFIRM_COMPENSATION_FAILED');
      assert.equal(response.json().details.notice_restore_status, 'succeeded');
      assert.equal(response.json().details.invoice_cancel_status, 'failed');
      assert.equal(response.json().details.requires_manual_review, true);
    } finally {
      delete process.env.AUDIT_FAIL_OPERATIONS;
      delete process.env.COMPENSATION_FAIL_STEPS;
    }

    const notice = await db.select().from(schema.deliveryNotices).where(eq(schema.deliveryNotices.id, 'dn-comp-cancel-1')).get();
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.sourceDocumentId, 'dn-comp-cancel-1')).get();
    assert.equal(String(notice?.status || ''), 'SUBMITTED');
    assert.ok(invoice);
  });

  test('delivery non-invoice stock compensation failure is observable', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-delivery-stock-comp', 'Delivery Stock Compensation Customer', 'CUSTOMER');
    await insertItem({ id: 'item-delivery-stock-comp', name: 'Delivery Stock Compensation Item', code: 'DLS-1', quantity: 4, salePrice: 17 });

    await server.inject({
      method: 'POST',
      url: '/api/delivery-notices',
      headers: authHeaders(token),
      payload: {
        id: 'dn-stock-comp-1',
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        receiverType: 'CUSTOMER',
        receiverId: 'party-delivery-stock-comp',
        receiverName: 'Delivery Stock Compensation Customer',
        items: [{
          itemId: 'item-delivery-stock-comp',
          itemName: 'Delivery Stock Compensation Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
        }],
        createdById: 'u-admin',
        createdByName: 'admin',
      },
    });
    await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-stock-comp-1/submit',
      headers: authHeaders(token),
      payload: { submittedById: 'u-admin', submittedByName: 'admin' },
    });

    process.env.AUDIT_FAIL_OPERATIONS = 'delivery.confirm';
    process.env.COMPENSATION_FAIL_STEPS = 'delivery.stock_rollback';
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery-notices/dn-stock-comp-1/confirm',
        headers: authHeaders(token),
        payload: {
          convertToInvoice: false,
          confirmedById: 'u-admin',
          confirmedByName: 'admin',
        },
      });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json().code, 'DELIVERY_CONFIRM_COMPENSATION_FAILED');
      assert.equal(response.json().details.stock_rollback_status, 'failed');
      assert.equal(response.json().details.notice_restore_status, 'succeeded');
      assert.equal(response.json().details.requires_manual_review, true);
    } finally {
      delete process.env.AUDIT_FAIL_OPERATIONS;
      delete process.env.COMPENSATION_FAIL_STEPS;
    }

    const notice = await db.select().from(schema.deliveryNotices).where(eq(schema.deliveryNotices.id, 'dn-stock-comp-1')).get();
    const item = await db.select().from(schema.items).where(eq(schema.items.id, 'item-delivery-stock-comp')).get();
    assert.equal(String(notice?.status || ''), 'SUBMITTED');
    assert.equal(Number(item?.quantity || 0), 3);
  });

  test('voucher update rejects cross-company cashbox changes before replacement', async () => {
    const token = await tokenFor('u-admin');
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await ensureCashBox({ id: 'cb-alt-update', companyId: ALT_COMPANY_ID, branchId: ALT_BRANCH_ID, name: 'Alt Update Cash Box' });
    const createVoucherResponse = await server.inject({
      method: 'POST',
      url: '/api/vouchers',
      headers: authHeaders(token),
      payload: {
        id: 'v-update-comp-restore-1',
        type: 'payment',
        date: '2026-03-19',
        amount: 9,
        currency: 'USD',
        cashBoxId: 'cb-default',
        cashBoxName: 'Default Cash',
        description: 'manual review restore seed',
      },
    });
    assert.equal(createVoucherResponse.statusCode, 200);

    const response = await server.inject({
      method: 'PUT',
      url: '/api/vouchers/v-update-comp-restore-1',
      headers: authHeaders(token),
      payload: {
        cashBoxId: 'cb-alt-update',
        amount: 30,
      },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 'ENTITY_OUTSIDE_COMPANY');

    const voucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, 'v-update-comp-restore-1')).get();
    assert.ok(voucher);
    assert.equal(Number(voucher?.amount || 0), 9);
    assert.equal(String(voucher?.cashBoxId || ''), 'cb-default');
  });

  test('posted voucher update short-circuits before compensation path', async () => {
    const token = await tokenFor('u-admin');
    const createVoucherResponse = await server.inject({
      method: 'POST',
      url: '/api/vouchers',
      headers: authHeaders(token),
      payload: {
        id: 'v-update-comp-cleanup-1',
        type: 'payment',
        date: '2026-03-19',
        amount: 11,
        currency: 'USD',
        cashBoxId: 'cb-default',
        cashBoxName: 'Default Cash',
        description: 'manual review cleanup seed',
      },
    });
    assert.equal(createVoucherResponse.statusCode, 200);
    await db.update(schema.vouchers).set({ journalEntryId: '999999' }).where(eq(schema.vouchers.id, 'v-update-comp-cleanup-1')).run();

    process.env.COMPENSATION_FAIL_STEPS = 'voucher.new_voucher_cleanup';
    try {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/vouchers/v-update-comp-cleanup-1',
        headers: authHeaders(token),
        payload: {
          amount: 20,
        },
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, 'POSTED_VOUCHER_EDIT_BLOCKED');
    } finally {
      delete process.env.COMPENSATION_FAIL_STEPS;
    }

    const voucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, 'v-update-comp-cleanup-1')).get();
    const auditRow = await findLatestAuditLog('voucher.update.compensation.failed', 'v-update-comp-cleanup-1');
    assert.ok(voucher);
    assert.equal(auditRow ?? null, null);
  });

  test('compensation creates system event rows and stores manual review flag', async () => {
    const token = await tokenFor('u-admin');
    await insertParty('party-system-event-1', 'System Event Customer', 'CUSTOMER');
    await insertItem({ id: 'item-system-event-1', name: 'System Event Item', code: 'SYSEVT-1', quantity: 4, salePrice: 18 });

    await server.inject({
      method: 'POST',
      url: '/api/delivery-notices',
      headers: authHeaders(token),
      payload: {
        id: 'dn-system-event-1',
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        receiverType: 'CUSTOMER',
        receiverId: 'party-system-event-1',
        receiverName: 'System Event Customer',
        items: [{
          itemId: 'item-system-event-1',
          itemName: 'System Event Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
        }],
        createdById: 'u-admin',
        createdByName: 'admin',
      },
    });
    await server.inject({
      method: 'POST',
      url: '/api/delivery-notices/dn-system-event-1/submit',
      headers: authHeaders(token),
      payload: { submittedById: 'u-admin', submittedByName: 'admin' },
    });

    process.env.AUDIT_FAIL_OPERATIONS = 'delivery.confirm';
    process.env.COMPENSATION_FAIL_STEPS = 'delivery.notice_restore';
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery-notices/dn-system-event-1/confirm',
        headers: authHeaders(token),
        payload: {
          convertToInvoice: true,
          receiverId: 'party-system-event-1',
          receiverName: 'System Event Customer',
          invoiceNumber: 'INV-SYSEVT-1',
          confirmedById: 'u-admin',
          confirmedByName: 'admin',
        },
      });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json().code, 'DELIVERY_CONFIRM_COMPENSATION_FAILED');
    } finally {
      delete process.env.AUDIT_FAIL_OPERATIONS;
      delete process.env.COMPENSATION_FAIL_STEPS;
    }

    const manualReviewEvent = await findLatestSystemEvent('MANUAL_REVIEW_REQUIRED', 'dn-system-event-1');
    assert.ok(manualReviewEvent);
    assert.equal(Boolean((manualReviewEvent as any).requiresManualReview), true);
    assert.equal(String((manualReviewEvent as any).affectedDocumentId || ''), 'dn-system-event-1');
  });

  test('system-events API is admin-only and supports filtering', async () => {
    const weakToken = await tokenFor('u-viewer', 'employee');
    const denied = await server.inject({
      method: 'GET',
      url: '/api/system-events',
      headers: authHeaders(weakToken),
    });
    assert.equal(denied.statusCode, 403);

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/system-events?event_type=MANUAL_REVIEW_REQUIRED&requires_manual_review=true',
      headers: authHeaders(token),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.some((item: any) => item.affectedDocumentId === 'dn-system-event-1'));
  });

  test('system-events resolve endpoint marks manual review as resolved', async () => {
    const token = await tokenFor('u-admin');
    const eventRow = await findLatestSystemEvent('MANUAL_REVIEW_REQUIRED', 'dn-system-event-1');
    assert.ok(eventRow);

    const response = await server.inject({
      method: 'POST',
      url: `/api/system-events/${(eventRow as any).id}/resolve`,
      headers: authHeaders(token),
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().success, true);
    assert.ok(response.json().item.resolvedAt);
    assert.equal(response.json().item.resolvedBy, 'u-admin');

    const updated = await db.select().from(schema.systemEvents).where(eq(schema.systemEvents.id, String((eventRow as any).id))).get();
    assert.ok(updated);
    assert.ok((updated as any).resolvedAt);
    assert.equal(String((updated as any).resolvedBy || ''), 'u-admin');
  });

  test('company isolation prevents reading vouchers from another company', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await ensureCashBox({ id: 'cb-alt', companyId: ALT_COMPANY_ID, branchId: ALT_BRANCH_ID, name: 'Alt Cash Box' });
    await db.insert(schema.vouchers).values({
      id: 'v-alt-company-1',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      type: 'receipt',
      date: '2026-03-22',
      amount: 44,
      amountBase: 44,
      amountTransaction: 44,
      originalAmount: 44,
      currency: 'USD',
      exchangeRate: 1,
      cashBoxId: 'cb-alt',
      cashBoxName: 'Alt Cash Box',
      status: 'DRAFT',
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/vouchers/v-alt-company-1',
      headers: authHeaders(token),
    });

    assert.equal(response.statusCode, 404);
  });

  test('invoices isolation: direct GET for cross-company invoice returns 404', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await db.insert(schema.invoices).values({
      id: 'inv-alt-iso-read-1',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      invoiceNumber: 'INV-ALT-ISO-1',
      type: 'sale',
      date: '2026-04-01',
      items: '[]',
      totalAmount: 120,
      totalAmountBase: 120,
      totalAmountTransaction: 120,
      paidAmount: 0,
      paidAmountBase: 0,
      paidAmountTransaction: 0,
      remainingAmount: 120,
      remainingAmountBase: 120,
      remainingAmountTransaction: 120,
      paymentType: 'credit',
      currency: 'USD',
      exchangeRate: 1,
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/invoices/inv-alt-iso-read-1',
      headers: authHeaders(token),
    });
    assert.equal(response.statusCode, 404);
  });

  test('inventory isolation: serial listing by cross-company item id returns 404', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await insertWarehouse('wh-alt-serial-iso', 'Alt Serial Warehouse', { companyId: ALT_COMPANY_ID, branchId: ALT_BRANCH_ID });
    await insertItem({
      id: 'item-alt-serial-iso',
      name: 'Alt Serial Item',
      code: 'ALT-SERIAL-ISO',
      quantity: 1,
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      warehouseId: 'wh-alt-serial-iso',
      warehouseName: 'Alt Serial Warehouse',
      serialTracking: 'required',
    });
    await db.insert(schema.itemSerials).values({
      id: 'iserial-alt-serial-iso',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      itemId: 'item-alt-serial-iso',
      serialNumber: 'ALT-SERIAL-ISO-1',
      warehouseId: 'wh-alt-serial-iso',
      status: 'available',
      purchaseInvoiceId: null,
      salesInvoiceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/inventory/serials?itemId=item-alt-serial-iso',
      headers: authHeaders(token),
    });
    assert.equal(response.statusCode, 404);
  });

  test('inventory isolation: serial import rejects cross-company item access', async () => {
    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/inventory/serials/import',
      headers: authHeaders(token),
      payload: {
        itemId: 'item-alt-serial-iso',
        warehouseId: 'wh-alt-serial-iso',
        serialNumbers: ['ALT-SERIAL-ISO-NEW-1'],
      },
    });
    assert.equal(response.statusCode, 404);
  });

  test('inventory isolation: merge rejects target item from another company', async () => {
    await insertItem({
      id: 'item-main-merge-iso',
      name: 'Main Merge Item',
      code: 'MAIN-MERGE-ISO',
      quantity: 2,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      warehouseId: 'wh-main',
      warehouseName: 'Main Warehouse',
    });

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/inventory/merge',
      headers: authHeaders(token),
      payload: {
        sourceItemId: 'item-main-merge-iso',
        targetItemId: 'item-alt-serial-iso',
        userId: 'u-admin',
      },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 'ENTITY_OUTSIDE_COMPANY');
  });

  test('funds transfer isolation: cross-company cash boxes are rejected', async () => {
    await ensureCashBox({ id: 'cb-alt-transfer-iso', companyId: ALT_COMPANY_ID, branchId: ALT_BRANCH_ID, name: 'Alt Transfer Cash Box' });
    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/funds/transfer',
      headers: authHeaders(token),
      payload: {
        fromBoxId: 'cb-default',
        toBoxId: 'cb-alt-transfer-iso',
        amount: 5,
      },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 'ENTITY_OUTSIDE_COMPANY');
  });

  test('vouchers isolation: fx-preview rejects cross-company invoice', async () => {
    await db.insert(schema.invoices).values({
      id: 'inv-alt-fx-preview-1',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      invoiceNumber: 'INV-ALT-FX-1',
      type: 'sale',
      date: '2026-04-02',
      items: '[]',
      totalAmount: 100,
      totalAmountBase: 100,
      totalAmountTransaction: 3000,
      paidAmount: 0,
      paidAmountBase: 0,
      paidAmountTransaction: 0,
      remainingAmount: 100,
      remainingAmountBase: 100,
      remainingAmountTransaction: 3000,
      paymentType: 'credit',
      currency: 'TRY',
      exchangeRate: 30,
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/fx-preview?invoiceId=inv-alt-fx-preview-1&paymentRate=28&paymentAmountForeign=3000',
      headers: authHeaders(token),
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 'ENTITY_OUTSIDE_COMPANY');
  });

  test('journal entries isolation: direct GET for cross-company entry returns 404', async () => {
    const entryNumber = `JE-ALT-ISO-${Date.now()}`;
    await db.insert(schema.journalEntries).values({
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      entryNumber,
      entryDate: '2026-04-03',
      description: 'Alt company journal isolation',
      referenceType: 'manual',
      totalDebit: 10,
      totalCredit: 10,
      currencyCode: 'USD',
      exchangeRate: 1,
      status: 'draft',
    }).run();
    const inserted = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.entryNumber, entryNumber)).get();
    const entryId = Number((inserted as any)?.id || 0);
    assert.ok(entryId > 0);

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: `/api/journal-entries/${entryId}`,
      headers: authHeaders(token),
    });
    assert.equal(response.statusCode, 404);
  });

  test('party ledger isolation: cross-company customer statement returns 404', async () => {
    await db.insert(schema.parties).values({
      id: 'party-alt-ledger-iso-1',
      companyId: ALT_COMPANY_ID,
      name: 'Alt Ledger Customer',
      type: 'CUSTOMER',
      isActive: true,
      balance: 0,
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/customers/party-alt-ledger-iso-1/statement?from=2000-01-01&to=2100-12-31',
      headers: authHeaders(token),
    });
    assert.equal(response.statusCode, 404);
  });

  test('dashboard isolation: system summary excludes cross-company rows', async () => {
    const token = await tokenFor('u-admin');
    const beforeResponse = await server.inject({
      method: 'GET',
      url: '/api/system/summary',
      headers: authHeaders(token),
    });
    assert.equal(beforeResponse.statusCode, 200);
    const before = beforeResponse.json();

    await db.insert(schema.items).values({
      id: 'item-alt-dashboard-iso-1',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      name: 'Alt Dashboard Item',
      code: 'ALT-DSH-1',
      quantity: 3,
      unitName: 'pcs',
      costPrice: 5,
      costPriceBase: 5,
      salePrice: 9,
      salePriceBase: 9,
      wholesalePrice: 9,
      wholesalePriceBase: 9,
      posPrice: 9,
      posPriceBase: 9,
      warehouseId: 'wh-alt-serial-iso',
      warehouseName: 'Alt Serial Warehouse',
      priceCurrency: 'USD',
      lastUpdated: new Date().toISOString(),
    }).onConflictDoNothing().run();
    await db.insert(schema.invoices).values({
      id: 'inv-alt-dashboard-iso-1',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      invoiceNumber: 'INV-ALT-DSH-1',
      type: 'sale',
      date: '2026-04-05',
      items: '[]',
      totalAmount: 333,
      totalAmountBase: 333,
      totalAmountTransaction: 333,
      paidAmount: 0,
      paidAmountBase: 0,
      paidAmountTransaction: 0,
      remainingAmount: 333,
      remainingAmountBase: 333,
      remainingAmountTransaction: 333,
      paymentType: 'credit',
      currency: 'USD',
      exchangeRate: 1,
    }).onConflictDoNothing().run();

    const afterResponse = await server.inject({
      method: 'GET',
      url: '/api/system/summary',
      headers: authHeaders(token),
    });
    assert.equal(afterResponse.statusCode, 200);
    const after = afterResponse.json();

    assert.equal(Number(after.totalSales || 0), Number(before.totalSales || 0));
    assert.equal(Number(after.itemsCount || 0), Number(before.itemsCount || 0));
    assert.equal(Number(after.invoicesCount || 0), Number(before.invoicesCount || 0));
  });

  test('inventory isolation: bulk price update cannot mutate cross-company items', async () => {
    await insertItem({
      id: 'item-alt-bulk-iso-1',
      name: 'Alt Bulk Isolated Item',
      code: 'ALT-BULK-ISO-1',
      quantity: 4,
      salePrice: 70,
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      warehouseId: 'wh-alt-serial-iso',
      warehouseName: 'Alt Serial Warehouse',
    });
    const before = await db.select().from(schema.items).where(eq(schema.items.id, 'item-alt-bulk-iso-1')).get();
    assert.ok(before);

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/inventory/bulk-price-update',
      headers: authHeaders(token),
      payload: {
        mode: 'execute',
        payload: {
          scope: 'all',
          targetField: 'sale_price',
          operation: 'add_fixed',
          amount: 3,
          amountMode: 'usd',
        },
      },
    });
    assert.equal(response.statusCode, 200, response.body);

    const after = await db.select().from(schema.items).where(eq(schema.items.id, 'item-alt-bulk-iso-1')).get();
    assert.ok(after);
    assert.equal(Number(after?.salePrice || 0), Number(before?.salePrice || 0));
  });

  test('reports summary is company-safe and respects branch filters', async () => {
    await db.insert(schema.invoices).values([
      {
        id: 'inv-report-main-1',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        invoiceNumber: 'RPT-MAIN-1',
        type: 'sale',
        date: '2026-04-10',
        totalAmount: 50,
        totalAmountBase: 50,
        totalAmountTransaction: 50,
        items: '[]',
        currency: 'USD',
        exchangeRate: 1,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: 50,
        remainingAmountBase: 50,
        remainingAmountTransaction: 50,
        paymentType: 'credit',
      },
      {
        id: 'inv-report-secondary-1',
        companyId: TEST_COMPANY_ID,
        branchId: SECONDARY_BRANCH_ID,
        invoiceNumber: 'RPT-SEC-1',
        type: 'sale',
        date: '2026-04-10',
        totalAmount: 70,
        totalAmountBase: 70,
        totalAmountTransaction: 70,
        items: '[]',
        currency: 'USD',
        exchangeRate: 1,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: 70,
        remainingAmountBase: 70,
        remainingAmountTransaction: 70,
        paymentType: 'credit',
      },
      {
        id: 'inv-report-alt-1',
        companyId: ALT_COMPANY_ID,
        branchId: ALT_BRANCH_ID,
        invoiceNumber: 'RPT-ALT-1',
        type: 'sale',
        date: '2026-04-10',
        totalAmount: 90,
        totalAmountBase: 90,
        totalAmountTransaction: 90,
        items: '[]',
        currency: 'USD',
        exchangeRate: 1,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: 90,
        remainingAmountBase: 90,
        remainingAmountTransaction: 90,
        paymentType: 'credit',
      },
    ]).onConflictDoNothing().run();

    const token = await tokenFor('u-admin', 'admin', TEST_COMPANY_ID, TEST_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID, SECONDARY_BRANCH_ID],
      defaultBranchId: TEST_BRANCH_ID,
      currentBranchId: TEST_BRANCH_ID,
      branchScope: 'company_wide',
    });

    const companyWide = await server.inject({
      method: 'GET',
      url: '/api/reports/summary?from=2026-04-01&to=2026-04-30&branchId=all',
      headers: authHeaders(token),
    });
    assert.equal(companyWide.statusCode, 200);
    assert.equal(Number(companyWide.json().totals.sales || 0), 120);

    const branchOnly = await server.inject({
      method: 'GET',
      url: `/api/reports/summary?from=2026-04-01&to=2026-04-30&branchId=${TEST_BRANCH_ID}`,
      headers: authHeaders(token),
    });
    assert.equal(branchOnly.statusCode, 200);
    assert.equal(Number(branchOnly.json().totals.sales || 0), 50);
  });

  test('reports remain balanced against posted journals', async () => {
    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/reports/trial-balance?asOfDate=2026-12-31',
      headers: authHeaders(token),
    });

    assert.equal(response.statusCode, 200);
    const rows = response.json();
    const totalDebit = rows.reduce((sum: number, row: any) => sum + Number(row.debit || 0), 0);
    const totalCredit = rows.reduce((sum: number, row: any) => sum + Number(row.credit || 0), 0);
    assert.equal(Number(totalDebit.toFixed(2)), Number(totalCredit.toFixed(2)));
  });

  // ─── LEGACY TENANT HARMONIZATION TESTS ───────────────────────────────────

  test('parties isolation: party from another company is not accessible by GET', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALT' });
    await db.insert(schema.parties).values({
      id: 'party-alt-iso-1',
      companyId: ALT_COMPANY_ID,
      name: 'Alt Company Supplier',
      type: 'SUPPLIER',
      isActive: true,
      balance: 0,
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'GET',
      url: '/api/parties/party-alt-iso-1',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 404, 'cross-company party access must return 404');
  });

  test('parties isolation: party statement scoped to requesting company only', async () => {
    const partyId = 'party-stmt-main-1';
    await db.insert(schema.parties).values({
      id: partyId,
      companyId: TEST_COMPANY_ID,
      name: 'Main Co Customer',
      type: 'CUSTOMER',
      isActive: true,
      balance: 0,
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'GET',
      url: `/api/customers/${partyId}/statement?from=2000-01-01&to=2100-12-31`,
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 200, 'party statement should succeed for same-company party');
    assert.ok('party' in res.json(), 'response should contain party key');
  });

  test('parties isolation: generic parties list does not leak cross-company rows', async () => {
    await db.insert(schema.parties).values({
      id: 'party-leak-check-alt',
      companyId: ALT_COMPANY_ID,
      name: 'Should Not Appear',
      type: 'CUSTOMER',
      isActive: true,
      balance: 0,
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'GET',
      url: '/api/parties',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 200);
    const rows: any[] = res.json();
    const leaked = rows.find((r: any) => r.id === 'party-leak-check-alt');
    assert.equal(leaked, undefined, 'party from alt company must not appear in main company list');
  });

  test('opening isolation: opening stock requires warehouse belonging to current company/branch', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALTB' });
    await insertWarehouse('wh-alt-open', 'Alt Warehouse', { companyId: ALT_COMPANY_ID, branchId: ALT_BRANCH_ID });

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'POST',
      url: '/api/opening-stock/post',
      headers: authHeaders(token),
      payload: {
        warehouseId: 'wh-alt-open',
        fiscalYear: '2026',
        currency: 'USD',
        date: new Date().toISOString(),
        lines: [{ item_id: 'dummy-item', item_name: 'Test', quantity: 5, cost_price: 10 }],
      },
    });
    assert.ok(
      res.statusCode === 403 || res.statusCode === 404,
      `opening stock to cross-company warehouse must be denied, got ${res.statusCode}`,
    );
  });

  test('payroll isolation: salary transactions list is scoped to current company', async () => {
    await db.insert(schema.salaryTransactions).values({
      id: 'sal-tx-alt-1',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      employeeId: 'emp-alt-1',
      employeeName: 'Alt Employee',
      amount: 1200,
      currency: 'USD',
      type: 'full_salary',
      date: '2026-03-01',
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'GET',
      url: '/api/payroll/transactions',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 200);
    const rows: any[] = res.json();
    const leaked = rows.find((r: any) => r.id === 'sal-tx-alt-1');
    assert.equal(leaked, undefined, 'salary tx from alt company must not appear in main company payroll list');
  });

  test('payroll isolation: processing payroll for employee from another company is rejected', async () => {
    await db.insert(schema.employees).values({
      id: 'emp-alt-iso-2',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      name: 'Foreign Employee',
      status: 'active',
      baseSalary: 500,
      currency: 'USD',
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'POST',
      url: '/api/payroll/process',
      headers: authHeaders(token),
      payload: {
        employeeId: 'emp-alt-iso-2',
        amount: 500,
        date: new Date().toISOString().slice(0, 10),
        type: 'full_salary',
        affectCashBox: false,
      },
    });
    assert.ok(
      res.statusCode === 403 || res.statusCode === 404,
      `payroll for cross-company employee must be denied, got ${res.statusCode}`,
    );
  });

  test('manufacturing isolation: recipe list does not leak cross-company recipes', async () => {
    await db.insert(schema.recipes).values({
      id: 'rec-alt-1',
      companyId: ALT_COMPANY_ID,
      name: 'Alt Company Recipe',
      outputItemId: 'item-alt-out-1',
      outputItemName: 'Alt Output',
      outputQty: 1,
      lines: '[]',
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'GET',
      url: '/api/manufacturing/recipes',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 200);
    const rows: any[] = res.json();
    const leaked = rows.find((r: any) => r.id === 'rec-alt-1');
    assert.equal(leaked, undefined, 'recipe from alt company must not appear in main company list');
  });

  test('manufacturing isolation: manufacturing orders list is scoped to current company/branch', async () => {
    await db.insert(schema.manufacturingOrders).values({
      id: 'mfg-alt-1',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      code: 'MFG-ALT-001',
      date: '2026-03-01',
      warehouseId: 'wh-alt-open',
      outputItemId: 'item-alt-out-1',
      outputItemName: 'Alt Output',
      outputQty: 10,
      status: 'POSTED',
      items: '[]',
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'GET',
      url: '/api/manufacturing/orders',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 200);
    const rows: any[] = res.json();
    const leaked = rows.find((r: any) => r.id === 'mfg-alt-1');
    assert.equal(leaked, undefined, 'manufacturing order from alt company must not appear in main company list');
  });

  test('consignment isolation: consignment documents are scoped to current company', async () => {
    await db.insert(schema.consignmentDocuments).values({
      id: 'cs-alt-1',
      companyId: ALT_COMPANY_ID,
      branchId: ALT_BRANCH_ID,
      documentNumber: 'CS-ALT-001',
      direction: 'OUT_CUSTOMER',
      status: 'DRAFT',
      partyType: 'CUSTOMER',
      partyId: 'party-alt-cs-1',
      consignmentWarehouseId: 'wh-alt-open',
      issueDate: '2026-03-01',
      createdBy: 'system',
    }).onConflictDoNothing().run();

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'GET',
      url: '/api/consignments',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 200);
    const rows: any[] = res.json();
    const leaked = rows.find((r: any) => r.id === 'cs-alt-1');
    assert.equal(leaked, undefined, 'consignment document from alt company must not appear in main company list');
  });

  test('consignment isolation: direct GET of cross-company consignment returns 404', async () => {
    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'GET',
      url: '/api/consignments/cs-alt-1',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 404, 'cross-company consignment must be not-found');
  });

  test('generic route tenant safety: branch-scoped collections do not leak across branches', async () => {
    await ensureBranch({ id: SECONDARY_BRANCH_ID, companyId: TEST_COMPANY_ID, name: 'Secondary Branch', code: 'SEC' });
    await db.insert(schema.expenses).values({
      id: 'exp-sec-branch-1',
      companyId: TEST_COMPANY_ID,
      branchId: SECONDARY_BRANCH_ID,
      code: 'EXP-SEC-001',
      date: '2026-03-01',
      description: 'Expense in secondary branch',
      totalAmount: 300,
      currency: 'USD',
      status: 'DRAFT',
      lines: '[]',
    }).onConflictDoNothing().run();

    await insertUser({
      id: 'u-branch-restricted-exp',
      username: 'branch.restricted.exp',
      password: 'pass123',
      role: 'accountant',
      permissions: ['manage_expenses', 'view_accounts'],
      companyId: TEST_COMPANY_ID,
      defaultBranchId: TEST_BRANCH_ID,
      allowedBranchIds: [TEST_BRANCH_ID],
      branchScope: 'restricted',
    });

    const restrictedToken = await tokenFor('u-branch-restricted-exp', 'accountant', TEST_COMPANY_ID, TEST_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID],
      branchScope: 'restricted',
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/expenses',
      headers: authHeaders(restrictedToken),
    });
    assert.equal(res.statusCode, 200);
    const rows: any[] = res.json();
    const leaked = rows.find((r: any) => r.id === 'exp-sec-branch-1');
    assert.equal(leaked, undefined, 'expense from secondary branch must not appear to user restricted to main branch');
  });

  test('generic route tenant safety: company-wide admin can see all branches of own company', async () => {
    const wideToken = await tokenFor('u-admin', 'admin', TEST_COMPANY_ID, TEST_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID, SECONDARY_BRANCH_ID],
      branchScope: 'company_wide',
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/expenses',
      headers: { ...authHeaders(wideToken), 'x-branch-id': '' },
    });
    assert.equal(res.statusCode, 200);
    const rows: any[] = res.json();
    const fromAlt = rows.filter((r: any) => r.companyId === ALT_COMPANY_ID);
    assert.equal(fromAlt.length, 0, 'company-wide admin must not see expenses from another company');
  });

  test('generic route tenant safety: write to branch-scoped collection tags it with current company and branch', async () => {
    await ensureBranch({ id: TEST_BRANCH_ID, companyId: TEST_COMPANY_ID, name: 'Main Branch', code: 'MAIN', isMain: true });

    const token = await tokenFor('u-admin');
    const res = await server.inject({
      method: 'POST',
      url: '/api/employees',
      headers: authHeaders(token),
      payload: {
        id: 'emp-tenant-tag-1',
        name: 'Tagged Employee',
        status: 'active',
        baseSalary: 800,
        currency: 'USD',
      },
    });
    assert.equal(res.statusCode, 200, `employee creation should succeed, got: ${res.body}`);
    const saved = await db.select().from(schema.employees).where(eq(schema.employees.id, 'emp-tenant-tag-1')).get();
    assert.ok(saved, 'employee must be saved in DB');
    assert.equal(saved?.companyId, TEST_COMPANY_ID, 'saved employee must be tagged with current company');
  });

  test('payroll isolation: branch-restricted user cannot process payroll for employee in unauthorized branch', async () => {
    await ensureBranch({ id: SECONDARY_BRANCH_ID, companyId: TEST_COMPANY_ID, name: 'Secondary Branch', code: 'SEC' });
    await db.insert(schema.employees).values({
      id: 'emp-sec-branch-pay',
      companyId: TEST_COMPANY_ID,
      branchId: SECONDARY_BRANCH_ID,
      name: 'Secondary Branch Employee',
      status: 'active',
      baseSalary: 600,
      currency: 'USD',
    }).onConflictDoNothing().run();

    await insertUser({
      id: 'u-restricted-pay',
      username: 'restricted-pay',
      password: 'pass',
      role: 'accountant',
      permissions: ['manage_payroll', 'view_employees'],
      companyId: TEST_COMPANY_ID,
      defaultBranchId: TEST_BRANCH_ID,
      allowedBranchIds: [TEST_BRANCH_ID],
      branchScope: 'restricted',
    });

    const restrictedToken = await tokenFor('u-restricted-pay', 'accountant', TEST_COMPANY_ID, TEST_BRANCH_ID, {
      allowedBranchIds: [TEST_BRANCH_ID],
      branchScope: 'restricted',
    });

    const res = await server.inject({
      method: 'POST',
      url: '/api/payroll/process',
      headers: authHeaders(restrictedToken, TEST_COMPANY_ID, TEST_BRANCH_ID),
      payload: {
        employeeId: 'emp-sec-branch-pay',
        amount: 600,
        date: '2026-03-01',
        type: 'full_salary',
        affectCashBox: false,
      },
    });
    assert.ok(
      res.statusCode === 403 || res.statusCode === 404,
      `payroll for out-of-branch employee must be denied, got ${res.statusCode}: ${res.body}`,
    );
  });
});

// ===========================================================================
// LANDED COST SEPARATION TESTS
// Tests for the fix that prevents extra purchase costs from inflating supplier AP
// ===========================================================================
describe('Landed cost separation — purchase invoice accounting', () => {
  const LC_SUPPLIER_ID = 'party-lc-supplier';
  const LC_WH_ID = 'wh-lc-test';
  const LC_CB_ID = 'cb-lc-test';

  before(async () => {
    await insertParty(LC_SUPPLIER_ID, 'Landed Cost Test Supplier', 'SUPPLIER');
    await insertWarehouse(LC_WH_ID, 'Landed Cost Warehouse');
    await ensureCashBox({ id: LC_CB_ID, companyId: TEST_COMPANY_ID, branchId: TEST_BRANCH_ID, name: 'LC Cash Box' });
  });

  test('9.1 — credit purchase with NO extra costs: supplier payable = goods subtotal', async () => {
    const token = await tokenFor('u-admin');
    const goodsTotal = 6500;
    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `LC-PR-001-${Date.now()}`,
        type: 'purchase',
        clientId: LC_SUPPLIER_ID,
        clientName: 'Landed Cost Test Supplier',
        date: '2026-03-20',
        paymentType: 'credit',
        targetWarehouseId: LC_WH_ID,
        targetWarehouseName: 'Landed Cost Warehouse',
        currency: 'USD',
        totalAmount: goodsTotal,
        totalAmountBase: goodsTotal,
        totalAmountTransaction: goodsTotal,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: goodsTotal,
        remainingAmountBase: goodsTotal,
        remainingAmountTransaction: goodsTotal,
        goodsSubtotal: goodsTotal,
        additionalCostsTotal: 0,
        exchangeRate: 1,
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: `lc-item-1-${Date.now()}`,
          itemName: 'Goods Only Item',
          itemCode: `LC001-${Date.now()}`,
          unitName: 'pcs',
          quantity: 10,
          baseQuantity: 10,
          unitPrice: 650,
          unitPriceBase: 650,
          lineTotalBase: 6500,
          total: 6500,
        }],
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
    const inv = res.json();

    // Verify party balance increased by goods only (6500)
    const supplier = await db.select().from(schema.parties).where(eq(schema.parties.id, LC_SUPPLIER_ID)).get();
    assert.ok(supplier, 'Supplier party must exist');
    assert.equal(Number((supplier as any).balance || 0), goodsTotal, 'Supplier balance must equal goods subtotal exactly');

    // Verify party transaction amount = goods subtotal
    const pt = await db.select().from(schema.partyTransactions)
      .where(eq(schema.partyTransactions.refId, inv.id))
      .get();
    assert.ok(pt, 'Party transaction must exist');
    assert.equal(Number((pt as any).amount || 0), goodsTotal, 'Party transaction amount must equal goods subtotal');
  });

  test('9.2 — credit purchase WITH extra costs: supplier payable = goods subtotal only, inventory includes full cost', async () => {
    const token = await tokenFor('u-admin');
    const goodsTotal = 6500;
    const extraCosts = 1500;
    const fullTotal = goodsTotal + extraCosts; // 8000

    // Reset supplier balance from previous test
    await db.update(schema.parties).set({ balance: 0 }).where(eq(schema.parties.id, LC_SUPPLIER_ID)).run();

    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `LC-PR-002-${Date.now()}`,
        type: 'purchase',
        clientId: LC_SUPPLIER_ID,
        clientName: 'Landed Cost Test Supplier',
        date: '2026-03-20',
        paymentType: 'credit',
        targetWarehouseId: LC_WH_ID,
        targetWarehouseName: 'Landed Cost Warehouse',
        currency: 'USD',
        totalAmount: fullTotal,
        totalAmountBase: fullTotal,
        totalAmountTransaction: fullTotal,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: fullTotal,
        remainingAmountBase: fullTotal,
        remainingAmountTransaction: fullTotal,
        goodsSubtotal: goodsTotal,
        additionalCostsTotal: extraCosts,
        exchangeRate: 1,
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: `lc-item-2-${Date.now()}`,
          itemName: 'Goods With Costs Item',
          itemCode: `LC002-${Date.now()}`,
          unitName: 'pcs',
          quantity: 10,
          baseQuantity: 10,
          unitPrice: 650,
          unitPriceBase: 650,
          lineTotalBase: 6500,
          total: 6500,
        }],
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
    const inv = res.json();

    // CRITICAL: Supplier balance must NOT include extra costs
    const supplier = await db.select().from(schema.parties).where(eq(schema.parties.id, LC_SUPPLIER_ID)).get();
    assert.ok(supplier, 'Supplier party must exist');
    assert.equal(
      Number((supplier as any).balance || 0),
      goodsTotal,
      `Supplier balance must be ${goodsTotal}, not ${fullTotal}. Extra costs must NOT inflate AP.`,
    );

    // Party transaction must be for goods amount only
    const pt = await db.select().from(schema.partyTransactions)
      .where(eq(schema.partyTransactions.refId, inv.id))
      .get();
    assert.ok(pt, 'Party transaction must exist');
    assert.equal(
      Number((pt as any).amount || 0),
      goodsTotal,
      `Party transaction must be for goods (${goodsTotal}), not full total (${fullTotal})`,
    );

    // Verify invoice stores the split fields
    const savedInv = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)).get();
    assert.ok(savedInv, 'Invoice must be persisted');
    assert.equal(Number((savedInv as any).goodsSubtotal || 0), goodsTotal, 'Invoice goodsSubtotal must be stored');
    assert.equal(Number((savedInv as any).additionalCostsTotal || 0), extraCosts, 'Invoice additionalCostsTotal must be stored');

    // Journal entry: verify AP credit = goods only, inventory debit = full cost
    const je = await db.select().from(schema.journalEntries)
      .where(eq(schema.journalEntries.id, Number((savedInv as any).journalEntryId || 0)))
      .get();
    assert.ok(je, 'Journal entry must exist');

    const jeLines = await db.select().from(schema.journalEntryLines)
      .where(eq(schema.journalEntryLines.journalEntryId, je.id))
      .all();
    assert.ok(jeLines.length > 0, 'Journal entry must have lines');

    const totalDebit = jeLines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
    const totalCredit = jeLines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
    // Journal must be balanced
    assert.ok(Math.abs(totalDebit - totalCredit) < 0.01, `Journal must be balanced, debit=${totalDebit} credit=${totalCredit}`);
    // Total credit must equal full inventory cost (8000)
    assert.ok(Math.abs(totalCredit - fullTotal) < 0.01, `Total credits must equal fullTotal=${fullTotal}, got ${totalCredit}`);
  });

  test('9.3 — credit purchase + partial payment + extra costs: balance = goods - payment', async () => {
    const token = await tokenFor('u-admin');
    const goodsTotal = 5000;
    const extraCosts = 800;
    const fullTotal = goodsTotal + extraCosts; // 5800
    const partialPayment = 2000;

    // Reset supplier balance
    await db.update(schema.parties).set({ balance: 0 }).where(eq(schema.parties.id, LC_SUPPLIER_ID)).run();

    // Create credit purchase with extra costs
    const resCreate = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `LC-PR-003-${Date.now()}`,
        type: 'purchase',
        clientId: LC_SUPPLIER_ID,
        clientName: 'Landed Cost Test Supplier',
        date: '2026-03-20',
        paymentType: 'credit',
        targetWarehouseId: LC_WH_ID,
        targetWarehouseName: 'Landed Cost Warehouse',
        currency: 'USD',
        totalAmount: fullTotal,
        totalAmountBase: fullTotal,
        totalAmountTransaction: fullTotal,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: fullTotal,
        remainingAmountBase: fullTotal,
        remainingAmountTransaction: fullTotal,
        goodsSubtotal: goodsTotal,
        additionalCostsTotal: extraCosts,
        exchangeRate: 1,
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: `lc-item-3-${Date.now()}`,
          itemName: 'Partial Payment Item',
          itemCode: `LC003-${Date.now()}`,
          unitName: 'pcs',
          quantity: 5,
          baseQuantity: 5,
          unitPrice: 1000,
          unitPriceBase: 1000,
          lineTotalBase: 5000,
          total: 5000,
        }],
      },
    });

    assert.equal(resCreate.statusCode, 200, `Create: ${resCreate.body}`);
    const createdInv = resCreate.json();

    // Apply partial payment via voucher
    const resVoucher = await server.inject({
      method: 'POST',
      url: '/api/vouchers',
      headers: authHeaders(token),
      payload: {
        id: `v-lc-pay-${Date.now()}`,
        type: 'payment',
        date: '2026-03-21',
        amount: partialPayment,
        amountBase: partialPayment,
        currency: 'USD',
        exchangeRate: 1,
        cashBoxId: LC_CB_ID,
        cashBoxName: 'LC Cash Box',
        clientId: LC_SUPPLIER_ID,
        clientName: 'Landed Cost Test Supplier',
        category: 'مشتريات',
        description: 'دفعة جزئية للمورد',
        referenceNumber: `PAY-LC-003-${Date.now()}`,
        linkedInvoiceId: createdInv.id,
        status: 'DRAFT',
      },
    });
    assert.equal(resVoucher.statusCode, 200, `Voucher: ${resVoucher.body}`);

    // Verify supplier balance = goods - payment = 5000 - 2000 = 3000
    const supplier = await db.select().from(schema.parties).where(eq(schema.parties.id, LC_SUPPLIER_ID)).get();
    const expectedBalance = goodsTotal - partialPayment; // 3000
    assert.ok(supplier, 'Supplier must exist');
    assert.ok(
      Math.abs(Number((supplier as any).balance || 0) - expectedBalance) < 0.01,
      `Supplier balance must be ${expectedBalance} (goods - payment), got ${(supplier as any).balance}. Extra costs must NOT be in balance.`,
    );
  });

  test('9.4 — cash purchase with extra costs: no party ledger entry, journal balanced', async () => {
    const token = await tokenFor('u-admin');
    const goodsTotal = 3000;
    const extraCosts = 500;
    const fullTotal = goodsTotal + extraCosts;

    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `LC-PR-004-${Date.now()}`,
        type: 'purchase',
        clientId: LC_SUPPLIER_ID,
        clientName: 'Landed Cost Test Supplier',
        date: '2026-03-20',
        paymentType: 'cash',
        targetWarehouseId: LC_WH_ID,
        targetWarehouseName: 'Landed Cost Warehouse',
        cashBoxId: LC_CB_ID,
        cashBoxName: 'LC Cash Box',
        currency: 'USD',
        totalAmount: fullTotal,
        totalAmountBase: fullTotal,
        totalAmountTransaction: fullTotal,
        paidAmount: fullTotal,
        paidAmountBase: fullTotal,
        paidAmountTransaction: fullTotal,
        remainingAmount: 0,
        remainingAmountBase: 0,
        remainingAmountTransaction: 0,
        goodsSubtotal: goodsTotal,
        additionalCostsTotal: extraCosts,
        exchangeRate: 1,
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: `lc-item-4-${Date.now()}`,
          itemName: 'Cash Purchase Item',
          itemCode: `LC004-${Date.now()}`,
          unitName: 'pcs',
          quantity: 3,
          baseQuantity: 3,
          unitPrice: 1000,
          unitPriceBase: 1000,
          lineTotalBase: 3000,
          total: 3000,
        }],
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
    const inv = res.json();

    // Cash purchase: no party AP ledger entry
    const pt = await db.select().from(schema.partyTransactions)
      .where(eq(schema.partyTransactions.refId, inv.id))
      .get();
    assert.ok(!pt, 'Cash purchase must NOT create a party transaction (no AP)');

    // Journal must be balanced
    const savedInv = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)).get();
    if ((savedInv as any)?.journalEntryId) {
      const jeLines = await db.select().from(schema.journalEntryLines)
        .where(eq(schema.journalEntryLines.journalEntryId, Number((savedInv as any).journalEntryId)))
        .all();
      const totalDebit = jeLines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const totalCredit = jeLines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      assert.ok(Math.abs(totalDebit - totalCredit) < 0.01, `Cash purchase journal must be balanced, debit=${totalDebit} credit=${totalCredit}`);
    }
  });

  test('9.5 — legacy invoice (no goodsSubtotal field) falls back gracefully', async () => {
    const token = await tokenFor('u-admin');
    const total = 4000;

    // Reset supplier balance
    await db.update(schema.parties).set({ balance: 0 }).where(eq(schema.parties.id, LC_SUPPLIER_ID)).run();

    // Simulate a legacy invoice payload without goodsSubtotal/additionalCostsTotal
    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `LC-PR-005-${Date.now()}`,
        type: 'purchase',
        clientId: LC_SUPPLIER_ID,
        clientName: 'Landed Cost Test Supplier',
        date: '2026-03-20',
        paymentType: 'credit',
        targetWarehouseId: LC_WH_ID,
        targetWarehouseName: 'Landed Cost Warehouse',
        currency: 'USD',
        totalAmount: total,
        totalAmountBase: total,
        totalAmountTransaction: total,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: total,
        remainingAmountBase: total,
        remainingAmountTransaction: total,
        // NOTE: no goodsSubtotal or additionalCostsTotal — legacy behavior
        exchangeRate: 1,
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: `lc-item-5-${Date.now()}`,
          itemName: 'Legacy Invoice Item',
          itemCode: `LC005-${Date.now()}`,
          unitName: 'pcs',
          quantity: 4,
          baseQuantity: 4,
          unitPrice: 1000,
          unitPriceBase: 1000,
          lineTotalBase: 4000,
          total: 4000,
        }],
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);

    // Legacy fallback: supplier balance = totalAmount (safe, no extra costs were specified)
    const supplier = await db.select().from(schema.parties).where(eq(schema.parties.id, LC_SUPPLIER_ID)).get();
    assert.equal(Number((supplier as any).balance || 0), total, 'Legacy invoice: supplier balance = totalAmount when no goodsSubtotal provided');
  });

  test('9.6 â€” purchase posting updates existing item cost and missing sell prices even without extra costs', async () => {
    const token = await tokenFor('u-admin');
    const itemId = `lc-existing-${Date.now()}`;
    const itemCode = `LC-EX-${Date.now()}`;
    await insertItem({
      id: itemId,
      name: 'Existing Zero Price Item',
      code: itemCode,
      quantity: 2,
      warehouseId: LC_WH_ID,
      warehouseName: 'Landed Cost Warehouse',
      salePrice: 0,
      costPrice: 0,
    });

    const purchaseCost = 42.5;
    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `LC-PR-006-${Date.now()}`,
        type: 'purchase',
        clientId: LC_SUPPLIER_ID,
        clientName: 'Landed Cost Test Supplier',
        date: '2026-03-20',
        paymentType: 'cash',
        targetWarehouseId: LC_WH_ID,
        targetWarehouseName: 'Landed Cost Warehouse',
        cashBoxId: LC_CB_ID,
        cashBoxName: 'LC Cash Box',
        currency: 'USD',
        exchangeRate: 1,
        totalAmount: purchaseCost,
        totalAmountBase: purchaseCost,
        totalAmountTransaction: purchaseCost,
        paidAmount: purchaseCost,
        paidAmountBase: purchaseCost,
        paidAmountTransaction: purchaseCost,
        remainingAmount: 0,
        remainingAmountBase: 0,
        remainingAmountTransaction: 0,
        goodsSubtotal: purchaseCost,
        additionalCostsTotal: 0,
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId,
          itemName: 'Existing Zero Price Item',
          itemCode,
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: purchaseCost,
          unitPriceBase: purchaseCost,
          total: purchaseCost,
          lineTotalBase: purchaseCost,
        }],
      },
    });

    assert.equal(res.statusCode, 200, res.body);

    const inventoryRes = await server.inject({
      method: 'GET',
      url: '/api/inventory',
      headers: authHeaders(token),
    });
    assert.equal(inventoryRes.statusCode, 200, inventoryRes.body);
    const item = inventoryRes.json().find((row: any) => String(row.id || '') === itemId);
    assert.ok(item, 'Purchased item must remain visible in inventory');
    assert.equal(Number(item.costPrice || 0), purchaseCost);
    assert.equal(Number(item.costPriceBase || 0), purchaseCost);
    assert.ok(Number(item.salePrice || 0) > 0, 'Retail price should be auto-populated when missing');
    assert.ok(Number(item.posPrice || 0) > 0, 'POS price should be auto-populated when missing');
    assert.ok(Number(item.delegatePrice || 0) > 0, 'Agent price should be auto-populated when missing');
  });

  test('9.7 â€” purchase posting preserves existing non-zero sale, POS, and agent prices while updating cost', async () => {
    const token = await tokenFor('u-admin');
    const itemId = `lc-priced-${Date.now()}`;
    const itemCode = `LC-PR-${Date.now()}`;
    await db.insert(schema.items).values({
      id: itemId,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      warehouseId: LC_WH_ID,
      warehouseName: 'Landed Cost Warehouse',
      name: 'Existing Priced Item',
      code: itemCode,
      quantity: 3,
      unitName: 'pcs',
      costPrice: 5,
      costPriceBase: 5,
      salePrice: 80,
      salePriceBase: 80,
      posPrice: 78,
      posPriceBase: 78,
      delegatePrice: 70,
      delegatePriceBase: 70,
      wholesalePrice: 75,
      wholesalePriceBase: 75,
      priceCurrency: 'USD',
      itemType: 'STOCK',
      lastUpdated: new Date().toISOString(),
    }).run();

    const postedCost = 33;
    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `LC-PR-007-${Date.now()}`,
        type: 'purchase',
        clientId: LC_SUPPLIER_ID,
        clientName: 'Landed Cost Test Supplier',
        date: '2026-03-20',
        paymentType: 'credit',
        targetWarehouseId: LC_WH_ID,
        targetWarehouseName: 'Landed Cost Warehouse',
        currency: 'USD',
        exchangeRate: 1,
        totalAmount: postedCost,
        totalAmountBase: postedCost,
        totalAmountTransaction: postedCost,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: postedCost,
        remainingAmountBase: postedCost,
        remainingAmountTransaction: postedCost,
        goodsSubtotal: postedCost,
        additionalCostsTotal: 0,
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId,
          itemName: 'Existing Priced Item',
          itemCode,
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: postedCost,
          unitPriceBase: postedCost,
          total: postedCost,
          lineTotalBase: postedCost,
        }],
      },
    });

    assert.equal(res.statusCode, 200, res.body);
    const item = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
    assert.ok(item, 'Existing item must still exist');
    assert.equal(Number((item as any).costPrice || 0), postedCost);
    assert.equal(Number((item as any).salePrice || 0), 80);
    assert.equal(Number((item as any).posPrice || 0), 78);
    assert.equal(Number((item as any).delegatePrice || 0), 70);
    assert.equal(Number((item as any).lastPurchasePriceTransaction || 0), postedCost);
  });

  test('partner accounting bridge: internal accounting ledger preview derives balance from posted subaccount lines', async () => {
    const token = await tokenFor('u-admin');
    const partyId = `party-bridge-customer-${Date.now()}`;
    const createPartyRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: partyId,
        name: 'Bridge Customer',
        type: 'CUSTOMER',
      },
    });
    assert.equal(createPartyRes.statusCode, 200, createPartyRes.body);

    const invoiceRes = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `BRIDGE-SALE-${Date.now()}`,
        type: 'sale',
        clientId: partyId,
        clientName: 'Bridge Customer',
        date: '2026-03-22',
        paymentType: 'credit',
        currency: 'USD',
        exchangeRate: 1,
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        totalAmount: 60,
        totalAmountBase: 60,
        totalAmountTransaction: 60,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: 60,
        remainingAmountBase: 60,
        remainingAmountTransaction: 60,
        items: [{
          itemId: 'item-sale-1',
          itemName: 'Sale Item',
          unitName: 'pcs',
          quantity: 2,
          baseQuantity: 2,
          unitPrice: 30,
          unitPriceBase: 30,
          total: 60,
          lineTotalBase: 60,
        }],
      },
    });
    assert.equal(invoiceRes.statusCode, 200, invoiceRes.body);
    const createdInvoice = invoiceRes.json();

    const cashBox = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.companyId, TEST_COMPANY_ID)).get();
    assert.ok(cashBox, 'Cash box must exist for receipt settlement');
    const cashAccount = await db.select().from(schema.accounts).where(eq(schema.accounts.lookupCode, '1110')).get();
    assert.ok(cashAccount, 'Cash account 1110 must exist');
    await db.update(schema.cashBoxes)
      .set({ accountId: (cashAccount as any).id })
      .where(eq(schema.cashBoxes.id, (cashBox as any).id))
      .run();

    const voucherRes = await server.inject({
      method: 'POST',
      url: '/api/vouchers',
      headers: authHeaders(token),
      payload: {
        id: `v-bridge-${Date.now()}`,
        type: 'receipt',
        date: '2026-03-22',
        amount: 60,
        amountBase: 60,
        amountTransaction: 60,
        currency: 'USD',
        exchangeRate: 1,
        cashBoxId: (cashBox as any).id,
        cashBoxName: (cashBox as any).name,
        clientId: partyId,
        clientName: 'Bridge Customer',
        category: 'Bridge Receipt',
        description: 'Bridge receipt voucher',
        referenceNumber: `BRIDGE-V-${Date.now()}`,
        linkedInvoiceId: createdInvoice.id,
        status: 'DRAFT',
      },
    });
    assert.equal(voucherRes.statusCode, 200, voucherRes.body);

    const ledgerPreviewRes = await server.inject({
      method: 'GET',
      url: `/api/reports/v2/internal/partner-accounting-ledger/${partyId}?from=2000-01-01&to=2100-12-31`,
      headers: authHeaders(token),
    });
    assert.equal(ledgerPreviewRes.statusCode, 200, ledgerPreviewRes.body);
    const ledgerPreview = ledgerPreviewRes.json();
    assert.equal(ledgerPreview.preview, true);
    assert.ok(Array.isArray(ledgerPreview.accountLinks));
    assert.ok(ledgerPreview.accountLinks.some((entry: any) => entry.role === 'receivable'));
    assert.equal(Number(ledgerPreview.comparison.accountingBalance || 0), 0);
    assert.equal(Number(ledgerPreview.comparison.operationalBalance || 0), 0);
    assert.ok(Number(ledgerPreview.journalLinkIntegrity.textPartnerLinkedLineCount || 0) > 0);
    assert.equal(String(ledgerPreview.journalLinkIntegrity.textPartnerCoverageLevel || ''), 'full');
    assert.equal(Number(ledgerPreview.comparison.accountingBalanceTextLinked || 0), 0);
    assert.equal(ledgerPreview.journalLinkIntegrity.typedPartyLinkUsable, false);

    const compareRes = await server.inject({
      method: 'GET',
      url: `/api/reports/v2/internal/partner-accounting/compare?partyId=${encodeURIComponent(partyId)}`,
      headers: authHeaders(token),
    });
    assert.equal(compareRes.statusCode, 200, compareRes.body);
    const compareBody = compareRes.json();
    assert.equal(compareBody.rows.length, 1);
    assert.equal(compareBody.rows[0].mismatchFlags.unusableTypedJournalPartyLink, true);
    assert.equal(compareBody.rows[0].coverage.level, 'full');
    assert.equal(Number(compareBody.summary.fullTextPartnerCoverageCount || 0), 1);
  });

  test('partner accounting bridge: partner creation auto-enforces required AR/AP subaccounts', async () => {
    const token = await tokenFor('u-admin');

    const customerId = `party-bridge-auto-customer-${Date.now()}`;
    const customerRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: customerId,
        name: 'Auto Customer',
        type: 'CUSTOMER',
      },
    });
    assert.equal(customerRes.statusCode, 200, customerRes.body);
    const customer = await db.select().from(schema.parties).where(eq(schema.parties.id, customerId)).get();
    assert.ok(customer, 'Customer must be created');
    assert.ok(Number((customer as any).accountId || 0) > 0, 'Customer must have generic accountId');
    assert.ok(Number((customer as any).arAccountId || 0) > 0, 'Customer must have receivable subaccount');

    const supplierId = `party-bridge-auto-supplier-${Date.now()}`;
    const supplierRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: supplierId,
        name: 'Auto Supplier',
        type: 'SUPPLIER',
      },
    });
    assert.equal(supplierRes.statusCode, 200, supplierRes.body);
    const supplier = await db.select().from(schema.parties).where(eq(schema.parties.id, supplierId)).get();
    assert.ok(supplier, 'Supplier must be created');
    assert.ok(Number((supplier as any).accountId || 0) > 0, 'Supplier must have generic accountId');
    assert.ok(Number((supplier as any).apAccountId || 0) > 0, 'Supplier must have payable subaccount');
  });

  test('partner accounting bridge: posted voucher recomputes linked invoice residuals via compensation-safe flow', async () => {
    const token = await tokenFor('u-admin');
    const partyId = `party-bridge-settlement-${Date.now()}`;
    const createPartyRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: partyId,
        name: 'Settlement Customer',
        type: 'CUSTOMER',
      },
    });
    assert.equal(createPartyRes.statusCode, 200, createPartyRes.body);

    const invoiceRes = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `BRIDGE-SETTLE-${Date.now()}`,
        type: 'sale',
        clientId: partyId,
        clientName: 'Settlement Customer',
        date: '2026-03-22',
        paymentType: 'credit',
        currency: 'USD',
        exchangeRate: 1,
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        totalAmount: 100,
        totalAmountBase: 100,
        totalAmountTransaction: 100,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: 100,
        remainingAmountBase: 100,
        remainingAmountTransaction: 100,
        items: [{
          itemId: 'item-sale-1',
          itemName: 'Sale Item',
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 100,
          unitPriceBase: 100,
          total: 100,
          lineTotalBase: 100,
        }],
      },
    });
    assert.equal(invoiceRes.statusCode, 200, invoiceRes.body);
    const createdInvoice = invoiceRes.json();

    const cashBox = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.companyId, TEST_COMPANY_ID)).get();
    assert.ok(cashBox, 'Cash box must exist for settlement');
    const cashAccount = await db.select().from(schema.accounts).where(eq(schema.accounts.lookupCode, '1110')).get();
    assert.ok(cashAccount, 'Cash account must exist');
    await db.update(schema.cashBoxes)
      .set({ accountId: (cashAccount as any).id })
      .where(eq(schema.cashBoxes.id, (cashBox as any).id))
      .run();

    const voucherRes = await server.inject({
      method: 'POST',
      url: '/api/vouchers',
      headers: authHeaders(token),
      payload: {
        id: `v-bridge-settle-${Date.now()}`,
        type: 'receipt',
        date: '2026-03-22',
        amount: 40,
        amountBase: 40,
        amountTransaction: 40,
        currency: 'USD',
        exchangeRate: 1,
        cashBoxId: (cashBox as any).id,
        cashBoxName: (cashBox as any).name,
        clientId: partyId,
        clientName: 'Settlement Customer',
        category: 'Settlement Receipt',
        description: 'Settlement receipt voucher',
        referenceNumber: `BRIDGE-SETTLE-V-${Date.now()}`,
        linkedInvoiceId: createdInvoice.id,
        status: 'DRAFT',
      },
    });
    assert.equal(voucherRes.statusCode, 200, voucherRes.body);

    const updatedInvoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, createdInvoice.id)).get();
    assert.ok(updatedInvoice, 'Invoice must still exist');
    assert.equal(Number((updatedInvoice as any).paidAmountBase || 0), 40);
    assert.equal(Number((updatedInvoice as any).remainingAmountBase || 0), 60);
    assert.equal(String((updatedInvoice as any).paymentType || '').toLowerCase(), 'credit');

    const consistencyRes = await server.inject({
      method: 'GET',
      url: `/api/reports/v2/internal/partner-settlement-consistency?partyId=${encodeURIComponent(partyId)}`,
      headers: authHeaders(token),
    });
    assert.equal(consistencyRes.statusCode, 200, consistencyRes.body);
    const consistencyBody = consistencyRes.json();
    const invoiceRow = consistencyBody.rows.find((row: any) => row.invoiceId === createdInvoice.id);
    assert.ok(invoiceRow, 'Invoice must appear in settlement consistency report');
    assert.equal(invoiceRow.mismatch, false, JSON.stringify(invoiceRow));
  });

  test('partner accounting bridge: settlement consistency report flags invoice residual drift safely', async () => {
    const token = await tokenFor('u-admin');
    const supplierId = `party-bridge-supplier-${Date.now()}`;
    const createPartyRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: supplierId,
        name: 'Bridge Supplier',
        type: 'SUPPLIER',
      },
    });
    assert.equal(createPartyRes.statusCode, 200, createPartyRes.body);

    const purchaseRes = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `BRIDGE-PUR-${Date.now()}`,
        type: 'purchase',
        clientId: supplierId,
        clientName: 'Bridge Supplier',
        date: '2026-03-22',
        paymentType: 'credit',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        currency: 'USD',
        exchangeRate: 1,
        totalAmount: 120,
        totalAmountBase: 120,
        totalAmountTransaction: 120,
        paidAmount: 0,
        paidAmountBase: 0,
        paidAmountTransaction: 0,
        remainingAmount: 120,
        remainingAmountBase: 120,
        remainingAmountTransaction: 120,
        goodsSubtotal: 100,
        additionalCostsTotal: 20,
        items: [{
          itemId: `bridge-purchase-item-${Date.now()}`,
          itemName: 'Bridge Purchase Item',
          itemCode: `BPI-${Date.now()}`,
          unitName: 'pcs',
          quantity: 1,
          baseQuantity: 1,
          unitPrice: 100,
          unitPriceBase: 100,
          total: 100,
          lineTotalBase: 100,
        }],
      },
    });
    assert.equal(purchaseRes.statusCode, 200, purchaseRes.body);
    const purchaseInvoice = purchaseRes.json();

    const consistencyRes = await server.inject({
      method: 'GET',
      url: `/api/reports/v2/internal/partner-settlement-consistency?partyId=${encodeURIComponent(supplierId)}`,
      headers: authHeaders(token),
    });
    assert.equal(consistencyRes.statusCode, 200, consistencyRes.body);
    const consistencyBody = consistencyRes.json();
    const targetRow = consistencyBody.rows.find((row: any) => row.invoiceId === purchaseInvoice.id);
    assert.ok(targetRow, 'Purchase invoice must appear in settlement consistency report');
    assert.equal(targetRow.mismatch, true);
    assert.ok(Array.isArray(targetRow.mismatchCategories));
    assert.ok(targetRow.mismatchCategories.includes('purchase_exposure_basis_difference'));
    assert.ok(targetRow.reasons.some((reason: string) => reason.includes('goodsSubtotal')));
  });

  test('partner accounting bridge: admin shadow transition audit exposes coverage and ready-for-trust rows', async () => {
    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'GET',
      url: '/api/reports/v2/internal/partner-transition-audit?from=2000-01-01&to=2100-12-31',
      headers: authHeaders(token),
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.ok(Array.isArray(body.rows));
    assert.ok(body.summary);
    assert.ok(typeof body.summary.readyForShadowTrustCount === 'number');
    assert.ok(typeof body.summary.activePartnersReviewed === 'number');
    assert.ok(typeof body.summary.fullCoverageCount === 'number');
    assert.ok(Array.isArray(body.summary.recurringMismatchPatterns));
    if (body.rows[0]) {
      assert.ok(Array.isArray(body.rows[0].blockingReasons));
      assert.ok(Array.isArray(body.rows[0].mismatchClassification));
      assert.ok(typeof body.rows[0].activeInRange === 'boolean');
    }

    const csvResponse = await server.inject({
      method: 'GET',
      url: '/api/reports/v2/internal/partner-transition-audit?from=2000-01-01&to=2100-12-31&format=csv',
      headers: authHeaders(token),
    });
    assert.equal(csvResponse.statusCode, 200, csvResponse.body);
    assert.ok(String(csvResponse.headers['content-type'] || '').includes('text/csv'));
    assert.ok(String(csvResponse.body || '').includes('partyId'));
    assert.ok(String(csvResponse.body || '').includes('blockingReasons'));
  });

  test('partner pilot cutover: ready partner uses accounting shadow ledger internally and logs pilot operation', async () => {
    const token = await tokenFor('u-admin');
    const partyId = `party-pilot-${Date.now()}`;

    const partyRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: partyId,
        name: 'Pilot Partner',
        type: 'CUSTOMER',
      },
    });
    assert.equal(partyRes.statusCode, 200, partyRes.body);

    const openingRes = await server.inject({
      method: 'POST',
      url: '/api/opening-balances/parties',
      headers: authHeaders(token),
      payload: {
        partyId,
        amount: 120,
        currency: 'USD',
        entryType: 'debit',
        date: '2026-03-22',
      },
    });
    assert.equal(openingRes.statusCode, 200, openingRes.body);
    const openingBody = openingRes.json();
    assert.ok(openingBody.partnerPilotReview);
    assert.equal(openingBody.partnerPilotReview.readyForShadowTrust, true);
    assert.equal(openingBody.partnerPilotReview.fallbackToOperational, false);

    const pilotLedgerRes = await server.inject({
      method: 'GET',
      url: `/api/reports/v2/internal/partner-pilot-ledger/${encodeURIComponent(partyId)}?from=2000-01-01&to=2100-12-31`,
      headers: authHeaders(token),
    });
    assert.equal(pilotLedgerRes.statusCode, 200, pilotLedgerRes.body);
    const pilotLedgerBody = pilotLedgerRes.json();
    assert.equal(pilotLedgerBody.selectedSource, 'accounting_shadow_pilot');
    assert.equal(pilotLedgerBody.fallbackActive, false);
    assert.equal(Number(pilotLedgerBody.selectedBalance || 0), Number(pilotLedgerBody.accounting?.comparison?.accountingBalanceTextLinked || 0));

    const pilotEvent = (await db.select().from(schema.systemEvents).all()).find((row: any) =>
      String(row?.affectedDocumentId || '') === String(openingBody.voucherId || '')
      && String(row?.sourceModule || '') === 'partner-pilot'
    );
    assert.ok(pilotEvent);
  });

  test('partner pilot cutover: detected delta drift forces fallback to party_transactions', async () => {
    const token = await tokenFor('u-admin');
    const partyId = `party-pilot-drift-${Date.now()}`;

    const partyRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: partyId,
        name: 'Pilot Drift Partner',
        type: 'CUSTOMER',
      },
    });
    assert.equal(partyRes.statusCode, 200, partyRes.body);

    const openingRes = await server.inject({
      method: 'POST',
      url: '/api/opening-balances/parties',
      headers: authHeaders(token),
      payload: {
        partyId,
        amount: 80,
        currency: 'USD',
        entryType: 'debit',
        date: '2026-03-22',
      },
    });
    assert.equal(openingRes.statusCode, 200, openingRes.body);

    await db.insert(schema.partyTransactions).values({
      id: `pt-drift-${Date.now()}`,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      partyId,
      partyType: 'CUSTOMER',
      kind: 'manual_drift',
      refId: `manual-drift-${Date.now()}`,
      amount: 5,
      delta: 5,
      amountBase: 5,
      deltaBase: 5,
      amountTransaction: 5,
      deltaTransaction: 5,
      currency: 'USD',
      exchangeRate: 1,
      createdAt: new Date().toISOString(),
    }).run();
    await db.update(schema.parties).set({ balance: 85 }).where(eq(schema.parties.id, partyId)).run();

    const pilotLedgerRes = await server.inject({
      method: 'GET',
      url: `/api/reports/v2/internal/partner-pilot-ledger/${encodeURIComponent(partyId)}?from=2000-01-01&to=2100-12-31`,
      headers: authHeaders(token),
    });
    assert.equal(pilotLedgerRes.statusCode, 200, pilotLedgerRes.body);
    const pilotLedgerBody = pilotLedgerRes.json();
    assert.equal(pilotLedgerBody.selectedSource, 'party_transactions_fallback');
    assert.equal(pilotLedgerBody.fallbackActive, true);
    assert.equal(String(pilotLedgerBody.fallbackReason || ''), 'delta_drift_detected');
  });

  test('partner pilot cutover: metrics summary reports stable partners, fallbacks, and rollout recommendation from real pilot events', async () => {
    const token = await tokenFor('u-admin');

    const stablePartyId = `party-pilot-metrics-stable-${Date.now()}`;
    const stablePartyRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: stablePartyId,
        name: 'Pilot Metrics Stable',
        type: 'CUSTOMER',
      },
    });
    assert.equal(stablePartyRes.statusCode, 200, stablePartyRes.body);

    const stableOpeningRes = await server.inject({
      method: 'POST',
      url: '/api/opening-balances/parties',
      headers: authHeaders(token),
      payload: {
        partyId: stablePartyId,
        amount: 120,
        currency: 'USD',
        entryType: 'debit',
        date: '2026-03-22',
      },
    });
    assert.equal(stableOpeningRes.statusCode, 200, stableOpeningRes.body);

    const driftPartyId = `party-pilot-metrics-drift-${Date.now()}`;
    const driftPartyRes = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: driftPartyId,
        name: 'Pilot Metrics Drift',
        type: 'CUSTOMER',
      },
    });
    assert.equal(driftPartyRes.statusCode, 200, driftPartyRes.body);

    const driftOpeningRes = await server.inject({
      method: 'POST',
      url: '/api/opening-balances/parties',
      headers: authHeaders(token),
      payload: {
        partyId: driftPartyId,
        amount: 80,
        currency: 'USD',
        entryType: 'debit',
        date: '2026-03-22',
      },
    });
    assert.equal(driftOpeningRes.statusCode, 200, driftOpeningRes.body);

    await db.insert(schema.partyTransactions).values({
      id: `pt-pilot-metrics-drift-${Date.now()}`,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      partyId: driftPartyId,
      partyType: 'CUSTOMER',
      kind: 'manual_drift',
      refId: `manual-pilot-metrics-drift-${Date.now()}`,
      amount: 5,
      delta: 5,
      amountBase: 5,
      deltaBase: 5,
      amountTransaction: 5,
      deltaTransaction: 5,
      currency: 'USD',
      exchangeRate: 1,
      createdAt: new Date().toISOString(),
    }).run();
    await db.update(schema.parties).set({ balance: 85 }).where(eq(schema.parties.id, driftPartyId)).run();

    const driftFollowupRes = await server.inject({
      method: 'POST',
      url: '/api/opening-balances/parties',
      headers: authHeaders(token),
      payload: {
        partyId: driftPartyId,
        amount: 10,
        currency: 'USD',
        entryType: 'debit',
        date: '2026-03-22',
      },
    });
    assert.equal(driftFollowupRes.statusCode, 200, driftFollowupRes.body);
    const driftFollowupBody = driftFollowupRes.json();
    assert.ok(driftFollowupBody.partnerPilotReview);

    const metricsRes = await server.inject({
      method: 'GET',
      url: '/api/reports/v2/internal/partner-pilot-metrics?from=2000-01-01&to=2100-12-31',
      headers: authHeaders(token),
    });
    assert.equal(metricsRes.statusCode, 200, metricsRes.body);
    const metricsBody = metricsRes.json();
    assert.equal(metricsBody.preview, true);
    assert.equal(metricsBody.pilotMode, true);
    assert.ok(metricsBody.summary.totalPilotPartners >= 2, JSON.stringify(metricsBody.summary));
    assert.ok(metricsBody.summary.fallbackCount >= 1, JSON.stringify(metricsBody.summary));
    assert.ok(metricsBody.summary.driftIncidents >= 1, JSON.stringify(metricsBody.summary));
    assert.ok(metricsBody.summary.stablePartnersOverTime >= 1, JSON.stringify(metricsBody.summary));
    assert.ok(['expand', 'hold', 'fix'].includes(String(metricsBody.summary.recommendation || '')));

    const stableRow = metricsBody.partners.find((row: any) => row.partyId === stablePartyId);
    assert.ok(stableRow, 'Stable pilot partner must appear in metrics summary');
    assert.equal(stableRow.reviewStatus, 'stable');

    const driftRow = metricsBody.partners.find((row: any) => row.partyId === driftPartyId);
    assert.ok(driftRow, 'Drift pilot partner must appear in metrics summary');
    assert.equal(driftRow.reviewStatus, 'unstable');
    assert.equal(driftRow.currentlyEligible, false);
    assert.equal(Math.abs(Number(driftRow.currentDelta || 0)) > 0.01, true);
  });

  test('institution scope hardening: generic parties create ignores forged companyId/branchId payload', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALTB' });

    const token = await tokenFor('u-admin');
    const partyId = `party-scope-generic-${Date.now()}`;
    const response = await server.inject({
      method: 'POST',
      url: '/api/parties',
      headers: authHeaders(token),
      payload: {
        id: partyId,
        name: 'Scoped Party',
        type: 'CUSTOMER',
        companyId: ALT_COMPANY_ID,
        branchId: ALT_BRANCH_ID,
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    const saved = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).get();
    assert.ok(saved);
    assert.equal(String((saved as any)?.companyId || ''), TEST_COMPANY_ID);
    assert.notEqual(String((saved as any)?.branchId || ''), ALT_BRANCH_ID);
  });

  test('institution scope hardening: invoice lifecycle blocks cross-company party even when payload scope is forged', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALTI' });
    await insertParty('party-alt-invoice-scope-1', 'Alt Scoped Party', 'CUSTOMER');
    await db.update(schema.parties)
      .set({ companyId: ALT_COMPANY_ID })
      .where(eq(schema.parties.id, 'party-alt-invoice-scope-1'))
      .run();

    const token = await tokenFor('u-admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `INV-SCOPE-${Date.now()}`,
        type: 'sale',
        clientId: 'party-alt-invoice-scope-1',
        clientName: 'Alt Scoped Party',
        date: '2026-05-01',
        paymentType: 'credit',
        currency: 'USD',
        exchangeRate: 1,
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        companyId: ALT_COMPANY_ID,
        branchId: ALT_BRANCH_ID,
        items: [
          {
            itemId: 'item-sale-1',
            itemName: 'Sale Item',
            unitName: 'pcs',
            quantity: 1,
            baseQuantity: 1,
            unitPrice: 30,
            unitPriceBase: 30,
            total: 30,
            lineTotalBase: 30,
          },
        ],
      },
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().code, 'ENTITY_OUTSIDE_COMPANY');
  });

  test('institution scope hardening: print template/printer creation ignores forged companyId/branchId payload', async () => {
    await ensureCompany(ALT_COMPANY_ID, 'Alt Company');
    await ensureBranch({ id: ALT_BRANCH_ID, companyId: ALT_COMPANY_ID, name: 'Alt Branch', code: 'ALTP' });

    const token = await tokenFor('u-admin');
    const tplResponse = await server.inject({
      method: 'POST',
      url: '/api/print/templates',
      headers: authHeaders(token),
      payload: {
        templateType: 'sale_invoice',
        format: 'A4',
        name: `Scoped Template ${Date.now()}`,
        companyId: ALT_COMPANY_ID,
        branchId: ALT_BRANCH_ID,
        isDefault: false,
      },
    });
    assert.equal(tplResponse.statusCode, 201, tplResponse.body);
    const tplId = String(tplResponse.json()?.data?.id || '');
    const tpl = await db.select().from(schema.printTemplates).where(eq(schema.printTemplates.id, tplId)).get();
    assert.ok(tpl);
    assert.equal(String((tpl as any)?.companyId || ''), TEST_COMPANY_ID);
    assert.equal(String((tpl as any)?.branchId || ''), TEST_BRANCH_ID);

    const printerResponse = await server.inject({
      method: 'POST',
      url: '/api/print/printers',
      headers: authHeaders(token),
      payload: {
        name: `Scoped Printer ${Date.now()}`,
        type: 'thermal',
        connectionType: 'network',
        address: '192.168.1.250',
        companyId: ALT_COMPANY_ID,
        branchId: ALT_BRANCH_ID,
      },
    });
    assert.equal(printerResponse.statusCode, 201, printerResponse.body);
    const printerId = String(printerResponse.json()?.data?.id || '');
    const printer = await db.select().from(schema.printers).where(eq(schema.printers.id, printerId)).get();
    assert.ok(printer);
    assert.equal(String((printer as any)?.companyId || ''), TEST_COMPANY_ID);
    assert.equal(String((printer as any)?.branchId || ''), TEST_BRANCH_ID);
  });
});



