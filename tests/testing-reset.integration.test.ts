import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shamel-testing-reset-'));
const tempDbPath = path.join(tempRoot, 'testing-reset.db');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'testing-reset-secret';
process.env.DB_PATH = tempDbPath;
process.env.DB_DIALECT = 'sqlite';
process.env.ERP_ENABLE_TESTING_RESET = '1';
delete process.env.DB_PATH_FROM_ELECTRON;
delete process.env.ELECTRON_IS_PACKAGED;

const [{ server }, dbModule, schema, seedModule] = await Promise.all([
  import('../backend/server.ts'),
  import('../backend/db/index.ts'),
  import('../backend/db/schema.ts'),
  import('../backend/db/seed-accounts.ts'),
]);

const { db, closeDb } = dbModule;
const { ensureDatabaseColumns } = seedModule;

const TEST_COMPANY_ID = 'org-main';
const TEST_BRANCH_ID = 'br-main';

const nowIso = () => new Date().toISOString();

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
  await db.insert(schema.userCompanyAccess).values({
    id: `uca-${payload.id}-${payload.companyId || TEST_COMPANY_ID}`,
    userId: payload.id,
    companyId: payload.companyId || TEST_COMPANY_ID,
    isDefault: true,
    isActive: true,
  }).onConflictDoNothing().run();
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

const tokenFor = async (id: string, role = 'admin') => {
  await server.ready();
  return server.jwt.sign({
    id,
    role,
    companyId: TEST_COMPANY_ID,
    allowedBranchIds: [TEST_BRANCH_ID],
    defaultBranchId: TEST_BRANCH_ID,
    currentBranchId: TEST_BRANCH_ID,
    branchScope: String(role).toLowerCase() === 'admin' ? 'company_wide' : 'restricted',
  });
};

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'x-active-org': TEST_COMPANY_ID,
  'x-company-id': TEST_COMPANY_ID,
  'x-branch-id': TEST_BRANCH_ID,
});

const seedBase = async () => {
  await db.insert(schema.companies).values({
    id: TEST_COMPANY_ID,
    name: 'Main Company',
    code: 'MAIN',
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).onConflictDoNothing().run();

  await db.insert(schema.branches).values({
    id: TEST_BRANCH_ID,
    companyId: TEST_COMPANY_ID,
    name: 'Main Branch',
    code: 'MAIN',
    isMain: true,
    isActive: true,
    location: '',
    manager: '',
    phone: '',
    notes: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).onConflictDoNothing().run();
};

const resetData = async () => {
  for (const table of [
    schema.invoiceMovements,
    schema.invoices,
    schema.vouchers,
    schema.journalEntryLines,
    schema.journalEntries,
    schema.accountBalances,
    schema.partyTransactions,
    schema.partnerTransactions,
    schema.expenses,
    schema.stockTransfers,
    schema.partyTransfers,
    schema.agentTransferLines,
    schema.agentInventoryMovements,
    schema.agentTransfers,
    schema.agentInventory,
    schema.agents,
    schema.deliveryNotices,
    schema.reconciliationMarks,
    schema.manufacturingOrders,
    schema.recipes,
    schema.salaryTransactions,
    schema.attendanceRecords,
    schema.biometricDevices,
    schema.employees,
    schema.itemGroupItems,
    schema.itemGroups,
    schema.itemBarcodes,
    schema.itemSerials,
    schema.inventoryMovements,
    schema.promotions,
    schema.items,
    schema.partners,
    schema.parties,
    schema.categories,
    schema.subCategories,
    schema.units,
    schema.remoteBranches,
    schema.printJobs,
    schema.systemEvents,
    schema.auditLogs,
    schema.documentSequences,
    schema.queueCounters,
    schema.cashBoxes,
    schema.warehouses,
    schema.userBranchAccess,
    schema.userCompanyAccess,
    schema.systemSettings,
    schema.users,
    schema.branches,
    schema.companies,
  ]) {
    await db.delete(table).run();
  }
};

before(async () => {
  await server.ready();
  await ensureDatabaseColumns(db);
});

after(async () => {
  try { await server.close(); } catch {}
  try { await closeDb(); } catch {}
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('clean testing reset', { concurrency: false }, () => {
  test('reset preserves admin login, clears operational data, and reseeds minimal foundations', async () => {
    await resetData();
    await seedBase();

    await insertUser({ id: 'u-admin-1', username: 'admin1', password: 'admin123', role: 'admin', permissions: ['*'] });
    await insertUser({ id: 'u-admin-2', username: 'admin2', password: 'admin456', role: 'admin', permissions: ['manage_settings'] });
    await insertUser({ id: 'u-employee', username: 'employee1', password: 'emp123', role: 'employee', permissions: ['view_reports'] });

    await db.insert(schema.systemSettings).values({
      key: 'app_name',
      value: JSON.stringify('Shamel ERP'),
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      updatedAt: nowIso(),
    }).run();

    await db.insert(schema.warehouses).values({
      id: 'wh-old',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Old Warehouse',
      code: 'OLD',
      isActive: true,
      location: '',
      manager: '',
    }).run();
    await db.insert(schema.cashBoxes).values({
      id: 'cb-old',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Old Cash',
      balance: 5,
      currency: 'USD',
      isActive: true,
    }).run();
    await db.insert(schema.parties).values({
      id: 'party-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Legacy Party',
      type: 'CUSTOMER',
      balance: 0,
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();
    await db.insert(schema.items).values({
      id: 'item-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      warehouseId: 'wh-old',
      warehouseName: 'Old Warehouse',
      name: 'Legacy Item',
      code: 'ITEM-1',
      barcode: '',
      unitName: 'pcs',
      quantity: 5,
      costPrice: 1,
      costPriceBase: 1,
      salePrice: 2,
      salePriceBase: 2,
      itemType: 'STOCK',
      priceCurrency: 'USD',
    }).run();
    await db.insert(schema.inventoryMovements).values({
      id: 'imv-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      itemId: 'item-1',
      warehouseId: 'wh-old',
      warehouseName: 'Old Warehouse',
      documentType: 'OPENING',
      documentId: 'doc-1',
      movementType: 'OPENING',
      qty: 5,
      baseQty: 5,
      createdAt: nowIso(),
    }).run();
    await db.insert(schema.invoices).values({
      id: 'inv-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      invoiceNumber: '1000',
      type: 'sale',
      date: '2026-04-03',
      clientId: 'party-1',
      clientName: 'Legacy Party',
      totalAmount: 10,
      paidAmount: 10,
      remainingAmount: 0,
      paymentType: 'cash',
      currency: 'USD',
      status: 'posted',
      items: JSON.stringify([]),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();
    await db.insert(schema.vouchers).values({
      id: 'v-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      type: 'receipt',
      date: '2026-04-03',
      amount: 10,
      currency: 'USD',
      status: 'POSTED',
      createdAt: nowIso(),
    }).run();

    const token = await tokenFor('u-admin-1', 'admin');
    const response = await server.inject({
      method: 'POST',
      url: '/api/system/reset',
      headers: authHeaders(token),
      payload: { confirmationText: 'RESET CLEAN TESTING' },
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.preservedUserIds));
    assert.ok(body.preservedUserIds.includes('u-admin-1'));
    assert.ok(body.preservedUserIds.includes('u-admin-2'));

    const remainingUsers = await db.select().from(schema.users).all();
    assert.deepEqual(
      remainingUsers.map((row: any) => String(row.id)).sort(),
      ['u-admin-1', 'u-admin-2'],
    );

    const companyAccessRows = await db.select().from(schema.userCompanyAccess).all();
    assert.deepEqual(
      companyAccessRows.map((row: any) => String(row.userId)).sort(),
      ['u-admin-1', 'u-admin-2'],
    );

    const branchAccessRows = await db.select().from(schema.userBranchAccess).all();
    assert.deepEqual(
      branchAccessRows.map((row: any) => String(row.userId)).sort(),
      ['u-admin-1', 'u-admin-2'],
    );

    assert.equal((await db.select().from(schema.items).all()).length, 0);
    assert.equal((await db.select().from(schema.inventoryMovements).all()).length, 0);
    assert.equal((await db.select().from(schema.invoices).all()).length, 0);
    assert.equal((await db.select().from(schema.vouchers).all()).length, 0);
    assert.equal((await db.select().from(schema.parties).all()).length, 0);
    assert.equal((await db.select().from(schema.systemSettings).all()).length, 1);

    const warehouses = await db.select().from(schema.warehouses).all();
    const cashBoxes = await db.select().from(schema.cashBoxes).all();
    assert.equal(warehouses.length, 1);
    assert.equal(String(warehouses[0]?.id || ''), 'wh-main');
    assert.equal(cashBoxes.length, 1);
    assert.equal(String(cashBoxes[0]?.id || ''), 'cb-main');

    const loginResponse = await server.inject({
      method: 'POST',
      url: '/api/login',
      headers: {
        'x-active-org': TEST_COMPANY_ID,
        'x-company-id': TEST_COMPANY_ID,
      },
      payload: {
        username: 'admin1',
        password: 'admin123',
        companyId: TEST_COMPANY_ID,
      },
    });
    assert.equal(loginResponse.statusCode, 200, loginResponse.body);
  });

  test('reset endpoint denies unauthorized users and can be disabled by flag', async () => {
    await resetData();
    await seedBase();
    await insertUser({ id: 'u-admin', username: 'admin', password: 'admin123', role: 'admin', permissions: ['*'] });
    await insertUser({ id: 'u-manager', username: 'manager', password: 'manager123', role: 'manager', permissions: ['manage_settings'] });

    const managerToken = await tokenFor('u-manager', 'manager');
    const forbidden = await server.inject({
      method: 'POST',
      url: '/api/system/reset',
      headers: authHeaders(managerToken),
      payload: { confirmationText: 'RESET CLEAN TESTING' },
    });
    assert.equal(forbidden.statusCode, 403);

    process.env.ERP_ENABLE_TESTING_RESET = '0';
    const adminToken = await tokenFor('u-admin', 'admin');
    const disabled = await server.inject({
      method: 'POST',
      url: '/api/system/reset',
      headers: authHeaders(adminToken),
      payload: { confirmationText: 'RESET CLEAN TESTING' },
    });
    assert.equal(disabled.statusCode, 403);
    process.env.ERP_ENABLE_TESTING_RESET = '1';
  });
});
