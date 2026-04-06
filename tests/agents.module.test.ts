import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { loadWarehouseScopedItemStock } from '../backend/inventoryService.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shamel-agents-'));
const tempDbPath = path.join(tempRoot, 'agents-test.db');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'agents-test-secret';
process.env.DB_PATH = tempDbPath;
process.env.DB_DIALECT = 'sqlite';
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
const ALT_COMPANY_ID = 'org-alt';

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

const seedBase = async () => {
  await db.insert(schema.companies).values({
    id: TEST_COMPANY_ID,
    name: 'Main',
    code: 'MAIN',
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).onConflictDoNothing().run();
  await db.insert(schema.companies).values({
    id: ALT_COMPANY_ID,
    name: 'Alt',
    code: 'ALT',
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
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).onConflictDoNothing().run();
};

const resetData = async () => {
  await db.delete(schema.agentInventoryMovements).run();
  await db.delete(schema.agentTransferLines).run();
  await db.delete(schema.agentTransfers).run();
  await db.delete(schema.agentInventory).run();
  await db.delete(schema.vouchers).run();
  await db.delete(schema.cashBoxes).run();
  await db.delete(schema.journalEntryLines).run();
  await db.delete(schema.journalEntries).run();
  await db.delete(schema.accountBalances).run();
  await db.delete(schema.accounts).run();
  await db.delete(schema.agents).run();
  await db.delete(schema.invoices).run();
  await db.delete(schema.items).run();
  await db.delete(schema.warehouses).run();
  await db.delete(schema.parties).run();
  await db.delete(schema.userBranchAccess).run();
  await db.delete(schema.users).run();
};

const seedAccountingForInvoice = async () => {
  const insertAccount = async (payload: { code: string; name: string; type: string; nature: string }) => {
    await db.insert(schema.accounts).values({
      companyId: TEST_COMPANY_ID,
      code: payload.code,
      lookupCode: payload.code,
      nameAr: payload.name,
      nameEn: payload.name,
      parentId: null,
      level: 1,
      accountType: payload.type,
      accountNature: payload.nature,
      isParent: false,
      isActive: true,
      isSystem: true,
      currencyCode: 'USD',
      branchId: TEST_BRANCH_ID,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).onConflictDoNothing().run();
  };

  await insertAccount({ code: '1110', name: 'Cash', type: 'assets', nature: 'debit' });
  await insertAccount({ code: '1130', name: 'Receivable', type: 'assets', nature: 'debit' });
  await insertAccount({ code: '1140', name: 'Inventory', type: 'assets', nature: 'debit' });
  await insertAccount({ code: '2110', name: 'Payable', type: 'liabilities', nature: 'credit' });
  await insertAccount({ code: '2125', name: 'Landed Cost Clearing', type: 'liabilities', nature: 'credit' });
  await insertAccount({ code: '3200', name: 'Retained Earnings', type: 'equity', nature: 'credit' });
  await insertAccount({ code: '4100', name: 'Sales', type: 'revenue', nature: 'credit' });
  await insertAccount({ code: '4400', name: 'Sales Discount', type: 'revenue', nature: 'debit' });
  await insertAccount({ code: '4500', name: 'Sales Return', type: 'revenue', nature: 'debit' });
  await insertAccount({ code: '5900', name: 'Purchase Discount', type: 'expenses', nature: 'credit' });

  const cashAccount = await db.select().from(schema.accounts).where(eq(schema.accounts.code, '1110')).get();
  await db.insert(schema.cashBoxes).values({
    id: 'cb-1',
    companyId: TEST_COMPANY_ID,
    branchId: TEST_BRANCH_ID,
    name: 'Main Cash',
    type: 'cash',
    accountId: cashAccount?.id || null,
    accountName: 'Cash',
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).run();

  await db.insert(schema.parties).values({
    id: 'c-1',
    companyId: TEST_COMPANY_ID,
    branchId: TEST_BRANCH_ID,
    name: 'Client',
    type: 'CUSTOMER',
    balance: 0,
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).onConflictDoNothing().run();
};

before(async () => {
  await server.ready();
  await ensureDatabaseColumns(db);
  await seedBase();
});

after(async () => {
  await closeDb();
});

describe('Agents module operational flow', () => {
  test('agent self location update allowed, other agent blocked', async () => {
    await resetData();
    await seedBase();
    await insertUser({ id: 'u-agent', username: 'agent1', password: 'pass', role: 'agent', permissions: [] });
    await insertUser({ id: 'u-agent-2', username: 'agent2', password: 'pass', role: 'agent', permissions: [] });
    await db.insert(schema.agents).values({
      id: 'u-agent',
      userId: 'u-agent',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();
    await db.insert(schema.agents).values({
      id: 'u-agent-2',
      userId: 'u-agent-2',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent Two',
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-agent', 'agent');
    const ok = await server.inject({
      method: 'POST',
      url: '/api/agents/u-agent/location',
      headers: authHeaders(token),
      payload: { lat: 33.5, lng: 36.3 },
    });
    assert.equal(ok.statusCode, 200);

    const forbidden = await server.inject({
      method: 'POST',
      url: '/api/agents/u-agent-2/location',
      headers: authHeaders(token),
      payload: { lat: 33.5, lng: 36.3 },
    });
    assert.equal(forbidden.statusCode, 403);
  });

  test('agent restricted mode blocks settings and reports access', async () => {
    await resetData();
    await seedBase();
    await insertUser({
      id: 'u-agent-restricted',
      username: 'agent_restricted',
      password: 'pass',
      role: 'agent',
      permissions: ['create_sale_invoice', 'view_inventory', 'manage_clients', 'access_pos', 'agent_mode_restricted', 'view_reports'],
    });

    const token = await tokenFor('u-agent-restricted', 'agent');
    const settingsRes = await server.inject({
      method: 'GET',
      url: '/api/settings',
      headers: authHeaders(token),
    });
    assert.equal(settingsRes.statusCode, 403);

    const reportsRes = await server.inject({
      method: 'GET',
      url: '/api/reports/agents/sales?from=2026-01-01&to=2026-01-31',
      headers: authHeaders(token),
    });
    assert.equal(reportsRes.statusCode, 403);
  });

  test('manager can access agents reports', async () => {
    await resetData();
    await seedBase();
    await insertUser({
      id: 'u-manager',
      username: 'manager1',
      password: 'pass',
      role: 'manager',
      permissions: ['view_reports'],
    });
    const token = await tokenFor('u-manager', 'manager');
    const res = await server.inject({
      method: 'GET',
      url: '/api/reports/agents/sales?from=2026-01-01&to=2026-01-31',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 200);
  });

  test('cross-tenant location update rejected', async () => {
    await resetData();
    await seedBase();
    await insertUser({ id: 'u-agent', username: 'agent1', password: 'pass', role: 'agent', permissions: [] });
    await db.insert(schema.agents).values({
      id: 'u-agent',
      userId: 'u-agent',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-agent', 'agent');
    const res = await server.inject({
      method: 'POST',
      url: '/api/agents/u-agent/location',
      headers: authHeaders(token, ALT_COMPANY_ID, TEST_BRANCH_ID),
      payload: { lat: 33.5, lng: 36.3 },
    });
    assert.equal(res.statusCode, 409);
  });

  test('warehouse to agent transfer success and insufficient stock failure', async () => {
    await resetData();
    await seedBase();
    await insertUser({ id: 'u-admin', username: 'admin', password: 'pass', role: 'admin', permissions: ['*'] });
    await db.insert(schema.warehouses).values({
      id: 'wh-main',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Main Warehouse',
      location: '',
      manager: '',
    }).run();
    await db.insert(schema.items).values({
      id: 'item-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      warehouseId: 'wh-main',
      warehouseName: 'Main Warehouse',
      name: 'Item 1',
      code: 'ITEM-1',
      barcode: '',
      unitName: 'pcs',
      quantity: 10,
      costPrice: 1,
      costPriceBase: 1,
      salePrice: 2,
      salePriceBase: 2,
      itemType: 'STOCK',
      priceCurrency: 'USD',
    }).run();
    await db.insert(schema.agents).values({
      id: 'agent-1',
      userId: null,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-admin', 'admin');
    const ok = await server.inject({
      method: 'POST',
      url: '/api/agent-inventory/transfer',
      headers: authHeaders(token),
      payload: { agentId: 'agent-1', warehouseId: 'wh-main', items: [{ itemId: 'item-1', quantity: 5 }] },
    });
    assert.equal(ok.statusCode, 200);

    const itemRow = await db.select().from(schema.items).where(eq(schema.items.id, 'item-1')).get();
    assert.equal(Number(itemRow?.quantity || 0), 5);
    const agentLine = await db.select().from(schema.agentInventory).where(eq(schema.agentInventory.agentId, 'agent-1')).get();
    assert.equal(Number(agentLine?.quantity || 0), 5);

    const fail = await server.inject({
      method: 'POST',
      url: '/api/agent-inventory/transfer',
      headers: authHeaders(token),
      payload: { agentId: 'agent-1', warehouseId: 'wh-main', items: [{ itemId: 'item-1', quantity: 99 }] },
    });
    assert.equal(fail.statusCode, 409);
  });

  test('purchase-posted stock is transferable from the receiving warehouse only', async () => {
    await resetData();
    await seedBase();
    await seedAccountingForInvoice();
    await insertUser({ id: 'u-admin', username: 'admin', password: 'pass', role: 'admin', permissions: ['*'] });
    await db.insert(schema.warehouses).values([
      {
        id: 'wh-main',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        name: 'Main Warehouse',
        location: '',
        manager: '',
      },
      {
        id: 'wh-secondary',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        name: 'Secondary Warehouse',
        location: '',
        manager: '',
      },
    ]).run();
    await db.insert(schema.parties).values({
      id: 'supplier-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Supplier One',
      type: 'SUPPLIER',
      balance: 0,
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).onConflictDoNothing().run();
    await db.insert(schema.agents).values({
      id: 'agent-1',
      userId: null,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-admin', 'admin');
    const purchaseRes = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: `P-AG-${Date.now()}`,
        type: 'purchase',
        date: '2026-04-03',
        clientId: 'supplier-1',
        clientName: 'Supplier One',
        paymentType: 'cash',
        cashBoxId: 'cb-1',
        cashBoxName: 'Main Cash',
        targetWarehouseId: 'wh-main',
        targetWarehouseName: 'Main Warehouse',
        currency: 'USD',
        exchangeRate: 1,
        totalAmount: 50,
        totalAmountBase: 50,
        totalAmountTransaction: 50,
        paidAmount: 50,
        paidAmountBase: 50,
        paidAmountTransaction: 50,
        remainingAmount: 0,
        remainingAmountBase: 0,
        remainingAmountTransaction: 0,
        goodsSubtotal: 50,
        additionalCostsTotal: 0,
        createdById: 'u-admin',
        createdByName: 'admin',
        items: [{
          itemId: 'item-purchase-1',
          itemName: 'Purchased Item',
          itemCode: 'PUR-1',
          unitName: 'pcs',
          quantity: 5,
          baseQuantity: 5,
          unitPrice: 10,
          unitPriceBase: 10,
          total: 50,
          lineTotalBase: 50,
        }],
      },
    });
    assert.equal(purchaseRes.statusCode, 200, purchaseRes.body);

    const inventoryItem = await db.select().from(schema.items).where(eq(schema.items.id, 'item-purchase-1')).get();
    assert.equal(Number(inventoryItem?.quantity || 0), 5);

    const mainWarehouseStock = await loadWarehouseScopedItemStock(db, {
      itemId: 'item-purchase-1',
      warehouseId: 'wh-main',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
    });
    assert.ok(mainWarehouseStock?.item);
    assert.equal(Number(mainWarehouseStock?.availableQty || 0), 5);

    const secondaryWarehouseStock = await loadWarehouseScopedItemStock(db, {
      itemId: 'item-purchase-1',
      warehouseId: 'wh-secondary',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
    });
    assert.equal(Number(secondaryWarehouseStock?.availableQty || 0), 0);

    const ok = await server.inject({
      method: 'POST',
      url: '/api/agent-inventory/transfer',
      headers: authHeaders(token),
      payload: { agentId: 'agent-1', warehouseId: 'wh-main', items: [{ itemId: 'item-purchase-1', quantity: 3 }] },
    });
    assert.equal(ok.statusCode, 200, ok.body);

    const mainWarehouseStockAfterTransfer = await loadWarehouseScopedItemStock(db, {
      itemId: 'item-purchase-1',
      warehouseId: 'wh-main',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
    });
    assert.equal(Number(mainWarehouseStockAfterTransfer?.availableQty || 0), 2);

    const wrongWarehouse = await server.inject({
      method: 'POST',
      url: '/api/agent-inventory/transfer',
      headers: authHeaders(token),
      payload: { agentId: 'agent-1', warehouseId: 'wh-secondary', items: [{ itemId: 'item-purchase-1', quantity: 1 }] },
    });
    assert.equal(wrongWarehouse.statusCode, 409, wrongWarehouse.body);

    const wrongCompany = await server.inject({
      method: 'POST',
      url: '/api/agent-inventory/transfer',
      headers: authHeaders(token, ALT_COMPANY_ID, TEST_BRANCH_ID),
      payload: { agentId: 'agent-1', warehouseId: 'wh-main', items: [{ itemId: 'item-purchase-1', quantity: 1 }] },
    });
    assert.equal(wrongCompany.statusCode, 409, wrongCompany.body);

    const agentLine = await db.select().from(schema.agentInventory).where(eq(schema.agentInventory.agentId, 'agent-1')).get();
    assert.equal(Number(agentLine?.quantity || 0), 3);
  });

  test('restricted agent reads only own transferred inventory', async () => {
    await resetData();
    await seedBase();
    await insertUser({
      id: 'u-agent-self',
      username: 'agent-self',
      password: 'pass',
      role: 'agent',
      permissions: ['create_sale_invoice', 'view_inventory', 'access_pos', 'agent_mode_restricted'],
    });
    await insertUser({
      id: 'u-agent-other',
      username: 'agent-other',
      password: 'pass',
      role: 'agent',
      permissions: ['create_sale_invoice', 'view_inventory', 'access_pos', 'agent_mode_restricted'],
    });
    await db.insert(schema.items).values([
      {
        id: 'item-self',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        name: 'Own Item',
        code: 'OWN-1',
        barcode: '',
        unitName: 'pcs',
        quantity: 0,
        costPrice: 5,
        costPriceBase: 5,
        salePrice: 8,
        salePriceBase: 8,
        delegatePrice: 7,
        delegatePriceBase: 7,
        posPrice: 8,
        posPriceBase: 8,
        itemType: 'STOCK',
        priceCurrency: 'USD',
      },
      {
        id: 'item-other',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        warehouseId: 'wh-main',
        warehouseName: 'Main Warehouse',
        name: 'Other Item',
        code: 'OTHER-1',
        barcode: '',
        unitName: 'pcs',
        quantity: 0,
        costPrice: 3,
        costPriceBase: 3,
        salePrice: 6,
        salePriceBase: 6,
        delegatePrice: 5,
        delegatePriceBase: 5,
        posPrice: 6,
        posPriceBase: 6,
        itemType: 'STOCK',
        priceCurrency: 'USD',
      },
    ]).run();
    await db.insert(schema.agents).values([
      {
        id: 'agent-self',
        userId: 'u-agent-self',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        name: 'Agent Self',
        isActive: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      {
        id: 'agent-other',
        userId: 'u-agent-other',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        name: 'Agent Other',
        isActive: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ]).run();
    await db.insert(schema.agentInventory).values([
      {
        id: 'ai-self',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        agentId: 'agent-self',
        itemId: 'item-self',
        itemName: 'Own Item',
        unitName: 'pcs',
        quantity: 4,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      {
        id: 'ai-other',
        companyId: TEST_COMPANY_ID,
        branchId: TEST_BRANCH_ID,
        agentId: 'agent-other',
        itemId: 'item-other',
        itemName: 'Other Item',
        unitName: 'pcs',
        quantity: 9,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ]).run();

    const token = await tokenFor('u-agent-self', 'agent');
    const inventoryRes = await server.inject({
      method: 'GET',
      url: '/api/agent-inventory',
      headers: authHeaders(token),
    });
    assert.equal(inventoryRes.statusCode, 200);
    const inventoryBody = inventoryRes.json();
    assert.equal(inventoryBody.length, 1);
    assert.equal(String(inventoryBody[0]?.agentId || ''), 'agent-self');
    assert.equal(String(inventoryBody[0]?.itemId || ''), 'item-self');
    assert.equal(Number(inventoryBody[0]?.delegatePrice || 0), 7);
  });

  test('agent sale invoice depletes agent inventory only', async () => {
    await resetData();
    await seedBase();
    await seedAccountingForInvoice();
    await insertUser({ id: 'u-admin', username: 'admin', password: 'pass', role: 'admin', permissions: ['*'] });
    await db.insert(schema.warehouses).values({
      id: 'wh-main',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Main Warehouse',
      location: '',
      manager: '',
    }).run();
    await db.insert(schema.items).values({
      id: 'item-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      warehouseId: 'wh-main',
      warehouseName: 'Main Warehouse',
      name: 'Item 1',
      code: 'ITEM-1',
      barcode: '',
      unitName: 'pcs',
      quantity: 10,
      costPrice: 1,
      costPriceBase: 1,
      salePrice: 2,
      salePriceBase: 2,
      itemType: 'STOCK',
      priceCurrency: 'USD',
    }).run();
    await db.insert(schema.agents).values({
      id: 'agent-1',
      userId: 'u-agent',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();
    await db.insert(schema.agentInventory).values({
      id: 'ai-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      agentId: 'agent-1',
      itemId: 'item-1',
      itemName: 'Item 1',
      unitName: 'pcs',
      quantity: 4,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-admin', 'admin');
    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: '10001',
        type: 'sale',
        date: '2026-04-02',
        clientId: 'c-1',
        clientName: 'Client',
        items: [{ itemId: 'item-1', itemName: 'Item 1', quantity: 2, unitPrice: 2, total: 4, unitName: 'pcs' }],
        totalAmount: 4,
        paidAmount: 4,
        remainingAmount: 0,
        currency: 'USD',
        paymentType: 'cash',
        applyStock: 1,
        agentId: 'agent-1',
        createdById: 'u-agent',
        createdByName: 'Agent One',
        createdByRole: 'agent',
      },
    });
    assert.equal(res.statusCode, 200);

    const itemRow = await db.select().from(schema.items).where(eq(schema.items.id, 'item-1')).get();
    assert.equal(Number(itemRow?.quantity || 0), 10);
    const agentLine = await db.select().from(schema.agentInventory).where(eq(schema.agentInventory.agentId, 'agent-1')).get();
    assert.equal(Number(agentLine?.quantity || 0), 2);
  });

  test('insufficient agent stock rejects invoice', async () => {
    await resetData();
    await seedBase();
    await seedAccountingForInvoice();
    await insertUser({ id: 'u-admin', username: 'admin', password: 'pass', role: 'admin', permissions: ['*'] });
    await db.insert(schema.items).values({
      id: 'item-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      warehouseId: 'wh-main',
      warehouseName: 'Main Warehouse',
      name: 'Item 1',
      code: 'ITEM-1',
      barcode: '',
      unitName: 'pcs',
      quantity: 10,
      costPrice: 1,
      costPriceBase: 1,
      salePrice: 2,
      salePriceBase: 2,
      itemType: 'STOCK',
      priceCurrency: 'USD',
    }).run();
    await db.insert(schema.agents).values({
      id: 'agent-1',
      userId: 'u-agent',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();
    await db.insert(schema.agentInventory).values({
      id: 'ai-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      agentId: 'agent-1',
      itemId: 'item-1',
      itemName: 'Item 1',
      unitName: 'pcs',
      quantity: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-admin', 'admin');
    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeaders(token),
      payload: {
        invoiceNumber: '10002',
        type: 'sale',
        date: '2026-04-02',
        clientId: 'c-1',
        clientName: 'Client',
        items: [{ itemId: 'item-1', itemName: 'Item 1', quantity: 5, unitPrice: 2, total: 10, unitName: 'pcs' }],
        totalAmount: 10,
        paidAmount: 10,
        remainingAmount: 0,
        currency: 'USD',
        paymentType: 'cash',
        applyStock: 1,
        agentId: 'agent-1',
        createdById: 'u-agent',
        createdByName: 'Agent One',
        createdByRole: 'agent',
      },
    });
    assert.equal(res.statusCode, 409);
  });

  test('return and reconcile update agent inventory correctly', async () => {
    await resetData();
    await seedBase();
    await insertUser({ id: 'u-admin', username: 'admin', password: 'pass', role: 'admin', permissions: ['*'] });
    await db.insert(schema.warehouses).values({
      id: 'wh-main',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Main Warehouse',
      location: '',
      manager: '',
    }).run();
    await db.insert(schema.items).values({
      id: 'item-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      warehouseId: 'wh-main',
      warehouseName: 'Main Warehouse',
      name: 'Item 1',
      code: 'ITEM-1',
      barcode: '',
      unitName: 'pcs',
      quantity: 10,
      costPrice: 1,
      costPriceBase: 1,
      salePrice: 2,
      salePriceBase: 2,
      itemType: 'STOCK',
      priceCurrency: 'USD',
    }).run();
    await db.insert(schema.agents).values({
      id: 'agent-1',
      userId: null,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();
    await db.insert(schema.agentInventory).values({
      id: 'ai-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      agentId: 'agent-1',
      itemId: 'item-1',
      itemName: 'Item 1',
      unitName: 'pcs',
      quantity: 5,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-admin', 'admin');
    const ret = await server.inject({
      method: 'POST',
      url: '/api/agent-inventory/return',
      headers: authHeaders(token),
      payload: { agentId: 'agent-1', warehouseId: 'wh-main', items: [{ itemId: 'item-1', quantity: 2 }] },
    });
    assert.equal(ret.statusCode, 200);
    const agentLine = await db.select().from(schema.agentInventory).where(eq(schema.agentInventory.agentId, 'agent-1')).get();
    assert.equal(Number(agentLine?.quantity || 0), 3);
    const itemRow = await db.select().from(schema.items).where(eq(schema.items.id, 'item-1')).get();
    assert.equal(Number(itemRow?.quantity || 0), 12);

    const rec = await server.inject({
      method: 'POST',
      url: '/api/agent-inventory/reconcile',
      headers: authHeaders(token),
      payload: { agentId: 'agent-1', mode: 'set', items: [{ itemId: 'item-1', quantity: 8 }] },
    });
    assert.equal(rec.statusCode, 200);
    const agentAfter = await db.select().from(schema.agentInventory).where(eq(schema.agentInventory.agentId, 'agent-1')).get();
    assert.equal(Number(agentAfter?.quantity || 0), 8);
  });

  test('inactive agent blocks transfers', async () => {
    await resetData();
    await seedBase();
    await insertUser({ id: 'u-admin', username: 'admin', password: 'pass', role: 'admin', permissions: ['*'] });
    await db.insert(schema.warehouses).values({
      id: 'wh-main',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Main Warehouse',
      location: '',
      manager: '',
    }).run();
    await db.insert(schema.items).values({
      id: 'item-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      warehouseId: 'wh-main',
      warehouseName: 'Main Warehouse',
      name: 'Item 1',
      code: 'ITEM-1',
      barcode: '',
      unitName: 'pcs',
      quantity: 10,
      costPrice: 1,
      costPriceBase: 1,
      salePrice: 2,
      salePriceBase: 2,
      itemType: 'STOCK',
      priceCurrency: 'USD',
    }).run();
    await db.insert(schema.agents).values({
      id: 'agent-1',
      userId: null,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-admin', 'admin');
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-inventory/transfer',
      headers: authHeaders(token),
      payload: { agentId: 'agent-1', warehouseId: 'wh-main', items: [{ itemId: 'item-1', quantity: 1 }] },
    });
    assert.equal(res.statusCode, 409);
  });

  test('system summary includes agent KPIs', async () => {
    await resetData();
    await seedBase();
    await insertUser({ id: 'u-admin', username: 'admin', password: 'pass', role: 'admin', permissions: ['*'] });
    await db.insert(schema.agents).values({
      id: 'agent-1',
      userId: null,
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      name: 'Agent One',
      isActive: true,
      lastSeenAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();
    await db.insert(schema.agentInventory).values({
      id: 'ai-1',
      companyId: TEST_COMPANY_ID,
      branchId: TEST_BRANCH_ID,
      agentId: 'agent-1',
      itemId: 'item-1',
      itemName: 'Item 1',
      unitName: 'pcs',
      quantity: 7,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }).run();

    const token = await tokenFor('u-admin', 'admin');
    const res = await server.inject({
      method: 'GET',
      url: '/api/system/summary',
      headers: authHeaders(token),
    });
    assert.equal(res.statusCode, 200);
    const payload = res.json();
    assert.equal(payload.agentActiveCount, 1);
    assert.equal(payload.agentInventoryQty, 7);
  });
});
