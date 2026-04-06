import bcrypt from 'bcryptjs';
import { server } from '../backend/server';
import { db } from '../backend/db';
import * as schema from '../backend/db/schema';
import { seedAccountsForCompany } from '../backend/db/companyAccountSeed';
import { eq } from 'drizzle-orm';

const now = Date.now();
const suffix = `${now}-${Math.random().toString(36).slice(2, 7)}`;

const companyId = `pgc-${suffix}`;
const branchId = `pgb-${suffix}`;
const userId = `pgu-${suffix}`;
const warehouseId = `pgw-${suffix}`;
const cashBoxId = `pgcb-${suffix}`;
const itemId = `pgi-${suffix}`;
const tableId = `pgt-${suffix}`;
const username = `pg_admin_${suffix}`;
const password = 'P@ssw0rd-Phase2!';

const json = (response: any) => JSON.parse(response.body || '{}');

async function seedValidationTenant() {
  await db.insert(schema.companies).values({
    id: companyId,
    name: `PG Phase2 Company ${suffix}`,
    code: `PG${String(now).slice(-6)}`,
    isActive: true,
  }).run();

  await db.insert(schema.branches).values({
    id: branchId,
    companyId,
    name: `PG Branch ${suffix}`,
    code: `BR${String(now).slice(-4)}`,
    isMain: true,
    isActive: true,
  }).run();

  await seedAccountsForCompany(db, companyId);

  const passwordHash = bcrypt.hashSync(password, 10);
  await db.insert(schema.users).values({
    id: userId,
    username,
    passwordHash,
    name: 'Postgres Phase2 Admin',
    role: 'admin',
    isActive: true,
    permissions: 'all',
    companyId,
    defaultBranchId: branchId,
    branchScope: 'company_wide',
  }).run();

  await db.insert(schema.userCompanyAccess).values({
    id: `uca-${suffix}`,
    userId,
    companyId,
    isDefault: true,
    isActive: true,
  }).run();

  await db.insert(schema.userBranchAccess).values({
    id: `uba-${suffix}`,
    userId,
    branchId,
    isDefault: true,
    isActive: true,
  }).run();

  await db.insert(schema.warehouses).values({
    id: warehouseId,
    companyId,
    branchId,
    name: `PG Warehouse ${suffix}`,
    code: `WH${String(now).slice(-4)}`,
    isActive: true,
  }).run();

  await db.insert(schema.cashBoxes).values({
    id: cashBoxId,
    companyId,
    branchId,
    name: `PG Cash Box ${suffix}`,
    balance: 0,
    currency: 'USD',
    isActive: true,
  }).run();

  await db.insert(schema.items).values({
    id: itemId,
    companyId,
    branchId,
    name: `PG Item ${suffix}`,
    code: `IT${String(now).slice(-5)}`,
    barcode: null,
    unitId: null,
    unitName: 'pcs',
    quantity: 25,
    costPrice: 10,
    costPriceBase: 10,
    salePrice: 15,
    salePriceBase: 15,
    posPrice: 15,
    posPriceBase: 15,
    warehouseId,
    warehouseName: `PG Warehouse ${suffix}`,
    isActive: true,
    itemType: 'STOCK',
    serialTracking: 'none',
    lastUpdated: new Date().toISOString(),
  }).run();
}

async function main() {
  if (process.env.DB_DIALECT !== 'postgres') {
    throw new Error('DB_DIALECT=postgres is required for Phase 2 validation.');
  }

  await seedValidationTenant();
  await server.ready();

  const loginRes = await server.inject({
    method: 'POST',
    url: '/api/login',
    payload: {
      username,
      password,
      companyId,
    },
  });
  if (loginRes.statusCode !== 200) {
    throw new Error(`LOGIN_FAILED:${loginRes.statusCode}:${loginRes.body}`);
  }
  const loginBody = json(loginRes);
  const token = String(loginBody.token || '');
  if (!token) throw new Error('LOGIN_TOKEN_MISSING');

  const headers = {
    authorization: `Bearer ${token}`,
    'x-company-id': companyId,
  };

  const printJobRes = await server.inject({
    method: 'POST',
    url: '/api/print/jobs',
    headers,
    payload: {
      printType: 'customer_receipt',
      status: 'success',
      documentType: 'pos_receipt',
      invoiceId: null,
      invoiceNumber: `TMP-${suffix}`,
      printerId: 'printer-validation',
    },
  });
  if (printJobRes.statusCode !== 200) {
    throw new Error(`PRINT_JOB_FAILED:${printJobRes.statusCode}:${printJobRes.body}`);
  }

  const createTableRes = await server.inject({
    method: 'POST',
    url: '/api/restaurant/tables',
    headers,
    payload: {
      id: tableId,
      code: `T-${String(now).slice(-3)}`,
      name: `Validation Table ${suffix}`,
      sortOrder: 1,
    },
  });
  if (createTableRes.statusCode !== 200 && createTableRes.statusCode !== 201) {
    throw new Error(`RESTAURANT_TABLE_CREATE_FAILED:${createTableRes.statusCode}:${createTableRes.body}`);
  }
  const createdTable = json(createTableRes);
  const createdTableId = String(createdTable?.table?.id || tableId);

  const openSessionRes = await server.inject({
    method: 'POST',
    url: `/api/restaurant/tables/${createdTableId}/open-session`,
    headers,
    payload: {
      guestCount: 2,
    },
  });
  if (openSessionRes.statusCode !== 200) {
    throw new Error(`RESTAURANT_SESSION_OPEN_FAILED:${openSessionRes.statusCode}:${openSessionRes.body}`);
  }

  const invoiceId = `inv-${suffix}`;
  const invoiceRes = await server.inject({
    method: 'POST',
    url: '/api/invoices',
    headers,
    payload: {
      id: invoiceId,
      invoiceNumber: `INV-${String(now).slice(-6)}`,
      type: 'sale',
      date: new Date().toISOString().slice(0, 10),
      currency: 'USD',
      exchangeRate: 1,
      paymentType: 'cash',
      applyStock: 1,
      targetWarehouseId: warehouseId,
      targetWarehouseName: `PG Warehouse ${suffix}`,
      cashBoxId,
      items: [
        {
          itemId,
          itemName: `PG Item ${suffix}`,
          quantity: 2,
          baseQuantity: 2,
          unitName: 'pcs',
          unitPrice: 15,
          unitPriceBase: 15,
          unitPriceTransaction: 15,
          total: 30,
          lineTotalBase: 30,
          lineTotalTransaction: 30,
        },
      ],
      totalAmount: 30,
      totalAmountBase: 30,
      totalAmountTransaction: 30,
      paidAmount: 30,
      paidAmountBase: 30,
      paidAmountTransaction: 30,
      remainingAmount: 0,
      remainingAmountBase: 0,
      remainingAmountTransaction: 0,
    },
  });
  if (invoiceRes.statusCode !== 200) {
    throw new Error(`INVOICE_CREATE_FAILED:${invoiceRes.statusCode}:${invoiceRes.body}`);
  }
  const invoiceBody = json(invoiceRes);
  if (!invoiceBody?.success) {
    throw new Error(`INVOICE_CREATE_NOT_SUCCESS:${invoiceRes.body}`);
  }

  const systemEventsRes = await server.inject({
    method: 'GET',
    url: '/api/system-events?limit=20',
    headers,
  });
  if (systemEventsRes.statusCode !== 200) {
    throw new Error(`SYSTEM_EVENTS_FAILED:${systemEventsRes.statusCode}:${systemEventsRes.body}`);
  }
  const systemEventsBody = json(systemEventsRes);
  if (!Array.isArray(systemEventsBody.items)) {
    throw new Error('SYSTEM_EVENTS_ITEMS_MISSING');
  }

  const reportRes = await server.inject({
    method: 'GET',
    url: '/api/reports/trial-balance',
    headers,
  });
  if (reportRes.statusCode !== 200) {
    throw new Error(`TRIAL_BALANCE_FAILED:${reportRes.statusCode}:${reportRes.body}`);
  }
  const reportBody = json(reportRes);
  if (!Array.isArray(reportBody)) {
    throw new Error('TRIAL_BALANCE_RESPONSE_INVALID');
  }

  const savedInvoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
  const invoiceMovements = await db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.documentId, invoiceId)).all();
  const sessions = await db.select().from(schema.restaurantTableSessions).where(eq(schema.restaurantTableSessions.tableId, createdTableId)).all();
  const printJobs = await db.select().from(schema.printJobs).where(eq(schema.printJobs.companyId, companyId)).all();

  console.log(JSON.stringify({
    success: true,
    companyId,
    branchId,
    userId,
    invoiceId,
    invoiceJournalEntryId: savedInvoice?.journalEntryId ?? null,
    inventoryMovementCount: invoiceMovements.length,
    restaurantSessionCount: sessions.length,
    printJobCount: printJobs.length,
    systemEventCount: Array.isArray(systemEventsBody.items) ? systemEventsBody.items.length : 0,
    trialBalanceLineCount: reportBody.length,
  }, null, 2));

  await server.close();
}

main().catch(async (error) => {
  try {
    await server.close();
  } catch {}
  console.error(error);
  process.exit(1);
});
