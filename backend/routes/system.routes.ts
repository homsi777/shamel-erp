import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { appError, isAppError } from '../lib/errors';
import { resolveDeploymentConfig } from '../lib/deployment';
import { createCompanyProvisioningService } from '../services/companyProvisioningService';
import {
  isTestingResetEnabled,
  runCleanTestingReset,
  TESTING_RESET_CONFIRMATION_PHRASE,
} from '../services/testingResetService';
import { databaseConfig, databaseDialect, pgPool } from '../db';
import { ensureBackupDir as ensurePgBackupDir, parsePgUrl, resolvePgBinary, runCommand } from '../../scripts/_pgTools';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
} from '../lib/tenantScope';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, appendAudit, buildPartyStatement, getBackupDir, buildBackupPayload, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, fs, path, getResolvedDbPath, rawSqlite, closeDb, bcrypt, server, getLocalIp, adjustItemStockWithMovement } = ctx as any;
  const getAuthContext = (req: any) => (req as any).authContext || {};
  const scopeRows = (rows: any[], req: any, collection: string) => filterRowsByTenantScope(rows, getAuthContext(req), collection);
  const companyProvisioning = createCompanyProvisioningService({ db, schema, eq });
  const withScopedRemoteBranch = async (id: string, req: any) => {
    const row = await db.select().from(schema.remoteBranches).where(eq(schema.remoteBranches.id, id)).get();
    if (!row) return null;
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(row, String(authContext.companyId || ''), 'الفرع غير موجود.');
    assertEntityBelongsToAllowedBranch(row, authContext, 'الفرع غير موجود.');
    return row;
  };

api.get('/system/status', async () => ({ 
  deployment: resolveDeploymentConfig(),
  status: 'online', 
  serverIp: getLocalIp(),
  serverHost: process.env.SERVER_HOST || process.env.SHAMEL_SERVER_HOST || '0.0.0.0',
  serverPort: Number(process.env.SERVER_PORT || process.env.SHAMEL_API_PORT || '3111') || 3111,
  appBaseUrl: process.env.APP_BASE_URL || process.env.SHAMEL_APP_BASE_URL || null,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.SHAMEL_PUBLIC_BASE_URL || null,
  corsAllowedOrigins: String(process.env.CORS_ALLOWED_ORIGINS || process.env.SHAMEL_CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  dbDialect: process.env.DB_DIALECT || 'sqlite',
  dbPath: process.env.DB_PATH || 'default',
  resolvedDbPath: getResolvedDbPath(),
  isPackaged: !!process.env.ELECTRON_IS_PACKAGED
}));

api.get('/system/healthz', async () => ({
  ok: true,
  status: 'online',
  timestamp: new Date().toISOString(),
  serverIp: getLocalIp(),
}));

api.get('/system/readiness', async (_req, reply) => {
  try {
    const dbStatus = await db.select({ cnt: sql<number>`count(*)` }).from(schema.systemSettings).get();
    return {
      ok: true,
      status: 'ready',
      timestamp: new Date().toISOString(),
      dbConnected: true,
      settingsRows: Number(dbStatus?.cnt || 0),
      deployment: resolveDeploymentConfig(),
      serverIp: getLocalIp(),
    };
  } catch (error: any) {
    return reply.status(503).send({
      ok: false,
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      dbConnected: false,
      error: error?.message || 'READINESS_FAILED',
    });
  }
});

// Public: allow listing active companies before authentication (for login flow).
api.get('/public/companies', async (req, reply) => {
  try {
    const companies = await db.select().from(schema.companies).all();
    const activeCompanies = (companies || [])
      .filter((company: any) => Number(company?.isActive ?? 1) !== 0)
      .map((company: any) => ({
        id: company.id,
        name: company.name,
        code: company.code || null,
        address: company.address || '',
        phone: company.phone || '',
        primaryCurrency: company.primaryCurrency || company.currency || 'USD',
        createdAt: company.createdAt || null,
      }));
    return { companies: activeCompanies };
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message || 'PUBLIC_COMPANIES_FAILED' });
  }
});

// Non-operational exception:
// `/companies/provision` is an admin/bootstrap flow used to provision new companies.
// It intentionally accepts target company/branch ids from payload and must stay isolated
// from normal tenant-bound operational write routes.
api.post('/companies/provision', async (req, reply) => {
  try {
    const authContext = getAuthContext(req);
    const body = (req.body || {}) as any;
    const result = await companyProvisioning.provisionCompany({
      companyId: body.companyId,
      companyCode: body.companyCode,
      companyName: String(body.companyName || body.name || '').trim(),
      branchId: body.branchId,
      branchCode: body.branchCode,
      branchName: body.branchName,
      warehouseId: body.warehouseId,
      warehouseName: body.warehouseName,
      cashBoxId: body.cashBoxId,
      cashBoxName: body.cashBoxName,
      primaryCurrency: body.primaryCurrency,
      secondaryCurrency: body.secondaryCurrency,
      secondaryCurrencyRate: body.secondaryCurrencyRate,
      companySettings: body.companySettings,
      printSettings: body.printSettings,
      adminUserId: String(authContext.userId || authContext.id || '').trim(),
      adminName: String(authContext.username || authContext.name || '').trim() || null,
    });
    return { success: true, data: result };
  } catch (error: any) {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details || null,
      });
    }
    return reply.status(500).send({ error: error?.message || 'COMPANY_PROVISION_FAILED' });
  }
});


api.get('/system/db-status', async (req, reply) => {
  try {
    // Test database connection (query should succeed even if table is empty)
    await db.select({ cnt: sql<number>`count(*)` }).from(schema.systemSettings).get();
    return { 
      status: 'connected', 
      dbPath: process.env.DB_PATH || 'default',
      resolvedDbPath: getResolvedDbPath(),
      testQuery: true,
      timestamp: new Date().toISOString()
    };
  } catch (e: any) {
    return reply.status(500).send({ 
      status: 'error', 
      error: e.message,
      dbPath: process.env.DB_PATH || 'default',
      timestamp: new Date().toISOString()
    });
  }
});


api.get('/system/summary', async (req, reply) => {
  try {
      const scopedItems = scopeRows(await db.select().from(schema.items).all(), req, 'items');
      const scopedInvoices = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
      const scopedAgents = scopeRows(await db.select().from(schema.agents).all(), req, 'agents');
      const scopedAgentInventory = scopeRows(await db.select().from(schema.agentInventory).all(), req, 'agent-inventory');
      const scopedSettings = scopeRows(await db.select().from(schema.systemSettings).all(), req, 'system-settings');
    const itemsCountRow = { cnt: scopedItems.length };
    const invoicesCountRow = { cnt: scopedInvoices.length };
    const totalSalesRow = {
      sum: scopedInvoices
        .filter((invoice: any) => String(invoice.type || '').toLowerCase() === 'sale')
        .reduce((sum: number, invoice: any) => sum + Number(invoice.totalAmount || 0), 0),
    };

    const recentInvoicesRaw = [...scopedInvoices]
      .sort((a: any, b: any) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))
      .slice(0, 10);

    const recentInvoices = (recentInvoicesRaw || []).map((r: any) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      createdAt: r.createdAt || r.date,
      totalAmount: Number(r.totalAmount || 0),
      clientName: r.clientName || ''
    }));

    const saleInvoicesForTop = [...scopedInvoices]
      .filter((invoice: any) => String(invoice.type || '').toLowerCase() === 'sale')
      .sort((a: any, b: any) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))
      .slice(0, 200);

    const counter = new Map<string, { name: string; qty: number }>();
    for (const inv of saleInvoicesForTop || []) {
      const lines = safeJsonParse((inv as any).items, []);
      for (const line of lines || []) {
        const name = String(line.itemName || line.name || '').trim() || 'مادة';
        const qty = Number(line.baseQuantity ?? line.quantity ?? 0) || 0;
        if (!qty) continue;
        const key = String(line.itemId || name);
        const prev = counter.get(key);
        counter.set(key, { name, qty: (prev?.qty || 0) + qty });
      }
    }
    const topSelling = Array.from(counter.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

      const todayKey = new Date().toISOString().slice(0, 10);
      const syncIntervalEntry = (scopedSettings || []).find((row: any) => String(row.key || '') === 'agent_sync_interval');
      const syncIntervalSec = Number(syncIntervalEntry?.value || 10) || 10;
      const onlineWindowMs = Math.max(5, syncIntervalSec) * 2000;
      const agentOnlineCount = (scopedAgents || []).filter((agent: any) => {
        if (!agent?.lastSeenAt) return false;
        const ts = Date.parse(agent.lastSeenAt);
        if (!Number.isFinite(ts)) return false;
        return Date.now() - ts <= onlineWindowMs;
      }).length;
      const agentActiveCount = (scopedAgents || []).filter((agent: any) => Number(agent?.isActive ?? 1) !== 0).length;
      const agentInactiveCount = (scopedAgents || []).filter((agent: any) => Number(agent?.isActive ?? 1) === 0).length;

      const itemCostMap = new Map<string, number>();
      for (const item of scopedItems || []) {
        const cost = Number((item as any).costPriceBase ?? (item as any).costPrice ?? 0);
        itemCostMap.set(String(item.id), Number.isFinite(cost) ? cost : 0);
      }
      const agentInventoryQty = (scopedAgentInventory || []).reduce((sum: number, row: any) => sum + Number(row?.quantity || 0), 0);
      const agentInventoryValue = (scopedAgentInventory || []).reduce((sum: number, row: any) => {
        const cost = itemCostMap.get(String(row?.itemId || '')) || 0;
        return sum + Number(row?.quantity || 0) * cost;
      }, 0);
      const agentSalesToday = (scopedInvoices || [])
        .filter((inv: any) => String(inv.type || '').toLowerCase() === 'sale')
        .filter((inv: any) => String(inv.date || '').slice(0, 10) === todayKey)
        .filter((inv: any) => inv?.agentId || String(inv?.createdByRole || '').toLowerCase() === 'agent');
      const agentSalesTotalToday = agentSalesToday.reduce((sum: number, inv: any) => sum + Number(inv.totalAmount || 0), 0);

      return {
        totalSales: Number(totalSalesRow?.sum || 0),
        itemsCount: Number(itemsCountRow?.cnt || 0),
        invoicesCount: Number(invoicesCountRow?.cnt || 0),
        recentInvoices,
        topSelling,
        agentActiveCount,
        agentInactiveCount,
        agentOnlineCount,
        agentInventoryQty,
        agentInventoryValue,
        agentSalesTotalToday,
        agentSalesCountToday: agentSalesToday.length,
      };
  } catch (e: any) {
    return reply.status(500).send({ error: e?.message || 'فشل توليد ملخص النظام' });
  }
});

api.get('/remote-branches', async (req) => {
  const rows = await db.select().from(schema.remoteBranches).orderBy(desc(schema.remoteBranches.createdAt)).all();
  const scoped = scopeRows(rows, req, 'remote-branches');
  if (!scoped.length) return scoped;

  const authContext = getAuthContext(req);
  const companyId = String(authContext.companyId || '').trim();
  const branchRows = companyId
    ? await db.select().from(schema.branches).where(eq(schema.branches.companyId, companyId)).all()
    : [];
  const branchNameMap = new Map((branchRows || []).map((b: any) => [String(b.id), String(b.name || '')]));
  const scopedInvoices = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
  const saleByBranch = new Map<string, { number: string | null; at: string | null }>();
  let companyLastSale: { number: string | null; at: string | null } = { number: null, at: null };

  const resolveTimestamp = (inv: any) => {
    const raw = inv?.createdAt || inv?.date || '';
    const ts = new Date(String(raw)).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  for (const inv of scopedInvoices || []) {
    if (String(inv.type || '').toLowerCase() !== 'sale') continue;
    const branchId = String(inv.branchId || '').trim();
    const entry = {
      number: inv?.invoiceNumber ? String(inv.invoiceNumber) : null,
      at: inv?.createdAt || inv?.date || null,
    };
    const invTs = resolveTimestamp(inv);
    if (invTs) {
      const prev = saleByBranch.get(branchId);
      const prevTs = prev?.at ? resolveTimestamp({ createdAt: prev.at }) : 0;
      if (!prev || invTs > prevTs) saleByBranch.set(branchId, entry);
      const companyPrevTs = companyLastSale.at ? resolveTimestamp({ createdAt: companyLastSale.at }) : 0;
      if (invTs > companyPrevTs) companyLastSale = entry;
    }
  }

  const enriched = await Promise.all(scoped.map(async (row: any) => {
    const branchId = row.branchId ? String(row.branchId) : '';
    const branchName = branchId ? (branchNameMap.get(branchId) || '') : '';
    const lastSale = branchId ? (saleByBranch.get(branchId) || { number: null, at: null }) : companyLastSale;
    return {
      ...row,
      branchName,
      lastInvoiceNumber: lastSale.number,
      lastInvoiceAt: lastSale.at,
    };
  }));

  return enriched;
});

api.post('/clients/heartbeat', async (req, reply) => {
  try {
    const authContext = getAuthContext(req);
    const body = (req.body || {}) as any;
    const companyId = String(authContext.companyId || '').trim() || null;
    if (!companyId) {
      return reply.status(401).send({ error: 'NO_COMPANY_CONTEXT' });
    }

    const clientId = String(body.clientId || '').trim();
    if (!clientId) {
      return reply.status(400).send({ error: 'CLIENT_ID_REQUIRED' });
    }

    const branchId = String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
    const userId = String(authContext.userId || authContext.id || '').trim() || null;
    const userName = String(authContext.username || authContext.name || '').trim() || null;
    const deviceLabel = String(body.deviceLabel || body.deviceName || body.clientName || 'Browser').trim();
    const clientName = String(body.clientName || body.name || deviceLabel).trim() || deviceLabel;
    const platform = String(body.platform || '').trim() || null;
    const appVersion = String(body.appVersion || body.app || '').trim() || null;
    const userAgent = String(body.userAgent || req.headers['user-agent'] || '').trim() || null;
    const sessionId = String(body.sessionId || '').trim() || null;
    const ipAddress = String(body.ipAddress || (Array.isArray(req.headers['x-forwarded-for']) ? req.headers['x-forwarded-for'][0] : req.headers['x-forwarded-for']) || (req as any).ip || '').split(',')[0].trim() || 'unknown';
    const now = new Date().toISOString();

    const existing = await db.select().from(schema.remoteBranches)
      .where(and(eq(schema.remoteBranches.companyId, companyId), eq(schema.remoteBranches.clientId, clientId)))
      .get();

    if (existing) {
      await db.update(schema.remoteBranches).set({
        branchId,
        name: clientName,
        employeeName: userName || existing.employeeName,
        ipAddress,
        syncInterval: Number(body.syncInterval || existing.syncInterval || 30),
        showFinancials: !!body.showFinancials || false,
        showInventory: !!body.showInventory || false,
        showInvoices: !!body.showInvoices || false,
        connectionMode: 'client',
        clientName,
        userId,
        userName,
        deviceLabel,
        platform,
        appVersion,
        userAgent,
        sessionId: sessionId || existing.sessionId || null,
        lastSeen: now,
      }).where(eq(schema.remoteBranches.id, existing.id)).run();
      return { success: true };
    }

    await db.insert(schema.remoteBranches).values({
      id: clientId,
      companyId,
      branchId,
      name: clientName,
      employeeName: userName,
      ipAddress,
      syncInterval: Number(body.syncInterval || 30),
      showFinancials: !!body.showFinancials || false,
      showInventory: !!body.showInventory || false,
      showInvoices: !!body.showInvoices || false,
      connectionMode: 'client',
      clientId,
      clientName,
      userId,
      userName,
      deviceLabel,
      platform,
      appVersion,
      userAgent,
      sessionId,
      lastSeen: now,
    }).run();
    return { success: true };
  } catch (e: any) {
    if (isAppError(e)) {
      return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
    }
    return reply.status(500).send({ error: e?.message || 'CLIENT_HEARTBEAT_FAILED' });
  }
});


api.post('/remote-branches', async (req, reply) => {
  try {
    const data = req.body as any;
    const authContext = getAuthContext(req);
    if (!data?.id || !data?.name || !data?.ipAddress) {
      return reply.status(400).send({ error: 'البيانات غير مكتملة.' });
    }
    const companyId = String(authContext.companyId || '').trim() || null;
    if (!companyId) {
      return reply.status(401).send({ error: 'NO_COMPANY_CONTEXT' });
    }
    const branchId = String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
    if (branchId) {
      const branch = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId)).get();
      if (!branch) return reply.status(404).send({ error: 'الفرع غير موجود.' });
      assertEntityBelongsToCompany(branch, String(companyId || ''), 'الفرع غير موجود.');
      assertEntityBelongsToAllowedBranch(branch, authContext, 'الفرع غير موجود.');
    }
    await db.insert(schema.remoteBranches).values({
      id: data.id,
      companyId,
      branchId,
      name: data.name,
      employeeName: data.employeeName,
      ipAddress: data.ipAddress,
      syncInterval: Number(data.syncInterval || 30),
      showFinancials: !!data.showFinancials,
      showInventory: !!data.showInventory,
      showInvoices: !!data.showInvoices,
      connectionMode: data.connectionMode || 'server'
    }).run();
    return { success: true };
  } catch (e: any) {
    if (isAppError(e)) {
      return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
    }
    return reply.status(500).send({ error: e?.message || 'فشل حفظ الفرع' });
  }
});

api.put('/remote-branches/:id', async (req, reply) => {
  try {
    const { id } = req.params as any;
    const existing = await withScopedRemoteBranch(String(id || ''), req);
    if (!existing) return reply.status(404).send({ error: 'الفرع غير موجود.' });
    const data = req.body as any;
    const authContext = getAuthContext(req);
    const nextBranchId = String(existing.branchId || pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
    if (nextBranchId) {
      const branch = await db.select().from(schema.branches).where(eq(schema.branches.id, nextBranchId)).get();
      if (!branch) return reply.status(404).send({ error: 'الفرع غير موجود.' });
      assertEntityBelongsToCompany(branch, String(existing.companyId || authContext.companyId || ''), 'الفرع غير موجود.');
      assertEntityBelongsToAllowedBranch(branch, authContext, 'الفرع غير موجود.');
    }
    await db.update(schema.remoteBranches).set({
      companyId: existing.companyId || authContext.companyId || null,
      branchId: nextBranchId,
      name: data.name,
      employeeName: data.employeeName,
      ipAddress: data.ipAddress,
      syncInterval: Number(data.syncInterval || 30),
      showFinancials: !!data.showFinancials,
      showInventory: !!data.showInventory,
      showInvoices: !!data.showInvoices,
      connectionMode: data.connectionMode || 'server'
    }).where(eq(schema.remoteBranches.id, id)).run();
    return { success: true };
  } catch (e: any) {
    if (isAppError(e)) {
      return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
    }
    return reply.status(500).send({ error: e?.message || 'فشل تحديث الفرع' });
  }
});


api.delete('/remote-branches/:id', async (req, reply) => {
  try {
    const { id } = req.params as any;
    const existing = await withScopedRemoteBranch(String(id || ''), req);
    if (!existing) return reply.status(404).send({ error: 'الفرع غير موجود.' });
    await db.delete(schema.remoteBranches).where(eq(schema.remoteBranches.id, id)).run();
    return { success: true };
  } catch (e: any) {
    return reply.status(500).send({ error: e?.message || 'فشل حذف الفرع' });
  }
});


api.post('/system/reset', async (req, reply) => {
  try {
    try {
      await (req as any).jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'غير مصرح' });
    }
    {
      const authContext = getAuthContext(req);
      const userRole = String((req as any).user?.role || authContext.role || '').trim().toLowerCase();
      if (userRole !== 'admin') return reply.status(403).send({ error: 'FORBIDDEN' });
      if (!isTestingResetEnabled((ctx as any).serverConfig)) {
        return reply.status(403).send({
          error: 'Clean testing reset is disabled.',
          code: 'TESTING_RESET_DISABLED',
        });
      }

      const body = (req.body || {}) as any;
      const confirmationText = String(body.confirmationText || '').trim();
      if (confirmationText !== TESTING_RESET_CONFIRMATION_PHRASE) {
        return reply.status(400).send({
          error: 'Invalid confirmation phrase.',
          code: 'TESTING_RESET_CONFIRMATION_REQUIRED',
          confirmationPhrase: TESTING_RESET_CONFIRMATION_PHRASE,
        });
      }

      const currentUserId = String(authContext.userId || (req as any).user?.id || '').trim();
      return await runCleanTestingReset({
        db,
        schema,
        eq,
        fs,
        path,
        getResolvedDbPath,
        rawSqlite,
        serverConfig: (ctx as any).serverConfig,
      }, {
        authContext,
        currentUserId,
        confirmationText,
      });
    }
    const userRole = (req as any).user?.role;
    if (userRole !== 'admin') return reply.status(403).send({ error: 'صلاحيات غير كافية' });

    // Production/strict mode hard block
    const serverCfg = (ctx as any).serverConfig;
    if (serverCfg?.isProduction || serverCfg?.strictMode) {
      return reply.status(403).send({
        error: 'إعادة الضبط الكاملة محظورة في وضع الإنتاج. استخدم أداة الصيانة المباشرة عبر السيرفر.',
        code: 'RESET_BLOCKED_IN_PRODUCTION',
      });
    }

    const authContext = getAuthContext(req);
    const currentUserId = String(authContext.userId || (req as any).user?.id || '').trim();
    const companies = await db.select().from(schema.companies).all();
    const activeCompanies = (companies || []).filter((company: any) => Number(company?.isActive ?? 1) !== 0);
    if (activeCompanies.length > 1) {
      return reply.status(409).send({
        error: 'إعادة الضبط العامة معطلة عند وجود أكثر من مؤسسة. استخدم أداة صيانة مخصصة بالمؤسسة الحالية فقط.',
        code: 'MULTI_COMPANY_RESET_BLOCKED',
      });
    }
    let companyId = String(authContext.companyId || activeCompanies[0]?.id || '').trim();
    if (!companyId) companyId = 'org-main';

    const allUsers = await db.select().from(schema.users).all();
    const adminUsers = (allUsers || []).filter((user: any) => String(user?.role || '').toLowerCase() === 'admin');
    const preservedAdmin = adminUsers.find((user: any) => String(user?.id || '') === currentUserId)
      || adminUsers.find((user: any) => String(user?.id || '') === 'u-admin')
      || adminUsers[0]
      || ((allUsers || []).find((user: any) => String(user?.id || '') === currentUserId) || null);
    if (!preservedAdmin) {
      return reply.status(409).send({
        error: 'لا يمكن تنفيذ التصفير بدون مستخدم مدير صالح.',
        code: 'RESET_ADMIN_NOT_FOUND',
      });
    }

    if (!(companies || []).some((company: any) => String(company?.id || '') === companyId)) {
      await db.insert(schema.companies).values({
        id: companyId,
        name: 'الشركة الرئيسية',
        code: String(companyId).toUpperCase().slice(0, 10) || 'ORGMAIN',
        isActive: true,
      }).run();
    }

    const dbFilePath = getResolvedDbPath();
    const backupDir = databaseDialect === 'postgres'
      ? ensurePgBackupDir()
      : (() => {
          const baseDir = path.dirname(dbFilePath);
          const dir = path.join(baseDir, 'backups');
          fs.mkdirSync(dir, { recursive: true });
          return dir;
        })();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `pre-reset-${stamp}.${databaseDialect === 'postgres' ? 'dump' : 'db'}`);
    try {
      if (databaseDialect === 'postgres') {
        const databaseUrl = databaseConfig.databaseUrl;
        if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL reset backup.');
        const parsed = parsePgUrl(databaseUrl);
        const source = new URL(parsed.connectionString);
        await runCommand(
          resolvePgBinary('pg_dump'),
          [
            '--format=custom',
            '--no-owner',
            '--no-privileges',
            '--host', source.hostname,
            '--port', source.port || '5432',
            '--username', decodeURIComponent(source.username),
            '--dbname', parsed.dbName,
            '--file', backupPath,
          ],
          { PGPASSWORD: decodeURIComponent(source.password) },
        );
      } else if (typeof rawSqlite?.backup === 'function') await rawSqlite.backup(backupPath);
      else {
        try { rawSqlite?.pragma?.('wal_checkpoint(TRUNCATE)'); } catch {}
        fs.copyFileSync(dbFilePath, backupPath);
      }
    } catch {}

    const resetFailures: string[] = [];
    const wipe = async (label: string, table: any) => {
      if (!table) return;
      try {
        await db.delete(table).run();
      } catch (error: any) {
        resetFailures.push(`${label}: ${error?.message || error}`);
      }
    };

    if (databaseDialect === 'postgres' && pgPool) {
      const tablesToTruncate = [
        'invoice_movements',
        'invoices',
        'vouchers',
        'party_transactions',
        'expenses',
        'stock_transfers',
        'party_transfers',
        'agent_transfers',
        'agent_inventory',
        'agent_transfer_lines',
        'agent_inventory_movements',
        'delivery_notices',
        'reconciliation_marks',
        'manufacturing_orders',
        'recipes',
        'salary_transactions',
        'employees',
        'partner_transactions',
        'partners',
        'item_group_items',
        'item_barcodes',
        'item_serials',
        'inventory_movements',
        'promotions',
        'items',
        'parties',
        'categories',
        'sub_categories',
        'units',
        'remote_branches',
        'print_jobs',
        'system_events',
        'audit_logs',
        'user_branch_access',
        'user_company_access',
        'branches',
        'warehouses',
        'cash_boxes',
      ];
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`TRUNCATE TABLE ${tablesToTruncate.map((name) => `"${name}"`).join(', ')} RESTART IDENTITY CASCADE`);
        await client.query('COMMIT');
      } catch (error: any) {
        await client.query('ROLLBACK');
        resetFailures.push(`postgres-truncate: ${error?.message || error}`);
      } finally {
        client.release();
      }
    } else {
      await wipe('invoiceMovements', schema.invoiceMovements);
      await wipe('invoices', schema.invoices);
      await wipe('vouchers', schema.vouchers);
      await wipe('partyTransactions', schema.partyTransactions);
      await wipe('expenses', schema.expenses);
      await wipe('stockTransfers', schema.stockTransfers);
      await wipe('partyTransfers', schema.partyTransfers);
      await wipe('agentTransfers', schema.agentTransfers);
      await wipe('agentInventory', schema.agentInventory);
      await wipe('agentTransferLines', schema.agentTransferLines);
      await wipe('agentInventoryMovements', schema.agentInventoryMovements);
      await wipe('deliveryNotices', schema.deliveryNotices);
      await wipe('reconciliationMarks', schema.reconciliationMarks);
      await wipe('manufacturingOrders', schema.manufacturingOrders);
      await wipe('recipes', schema.recipes);
      await wipe('salaryTransactions', schema.salaryTransactions);
      await wipe('employees', schema.employees);
      await wipe('partnerTransactions', schema.partnerTransactions);
      await wipe('partners', schema.partners);
      await wipe('itemGroupItems', schema.itemGroupItems);
      await wipe('itemBarcodes', schema.itemBarcodes);
      await wipe('itemSerials', schema.itemSerials);
      await wipe('inventoryMovements', schema.inventoryMovements);
      await wipe('promotions', schema.promotions);
      await wipe('items', schema.items);
      await wipe('parties', schema.parties);
      await wipe('categories', schema.categories);
      await wipe('subCategories', schema.subCategories);
      await wipe('units', schema.units);
      await wipe('remoteBranches', schema.remoteBranches);
      await wipe('printJobs', schema.printJobs);
      await wipe('systemEvents', schema.systemEvents);
      await wipe('auditLogs', schema.auditLogs);
      await wipe('userBranchAccess', schema.userBranchAccess);
      await wipe('userCompanyAccess', schema.userCompanyAccess);
      await wipe('branches', schema.branches);
      await wipe('warehouses', schema.warehouses);
      await wipe('cashBoxes', schema.cashBoxes);
    }

    try {
      const toDelete = (allUsers || []).filter((u: any) => String(u?.id || '') !== String(preservedAdmin.id || ''));
      for (const u of toDelete) {
        await db.delete(schema.users).where(eq(schema.users.id, u.id)).run();
      }
    } catch (error: any) {
      resetFailures.push(`users: ${error?.message || error}`);
    }

    if (resetFailures.length > 0) {
      return reply.status(500).send({
        error: 'فشل تصفير بعض البيانات. راجع التفاصيل.',
        code: 'RESET_PARTIAL_FAILURE',
        details: { failures: resetFailures },
      });
    }

    try {
      await db.insert(schema.branches).values({
        id: 'br-main',
        companyId: companyId || 'org-main',
        name: 'الفرع الرئيسي',
        code: 'MAIN',
        isMain: true,
        isActive: true,
        location: '',
        manager: '',
        phone: '',
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();
    } catch {}
    try {
      await db.insert(schema.warehouses).values({
        id: 'wh-main',
        companyId: companyId || 'org-main',
        branchId: 'br-main',
        name: 'المستودع الرئيسي',
        code: 'MAIN',
        isActive: true,
        location: '',
        manager: '',
      }).run();
    } catch {}
    try {
      await db.insert(schema.cashBoxes).values({
        id: 'cb-main',
        companyId: companyId || 'org-main',
        branchId: 'br-main',
        name: 'الصندوق الرئيسي',
        balance: 0,
        currency: 'USD',
        isActive: true,
      }).run();
    } catch {}

    try {
      await db.update(schema.users).set({
        companyId,
        defaultBranchId: 'br-main',
        branchScope: 'company_wide',
        isActive: true,
      }).where(eq(schema.users.id, preservedAdmin.id)).run();
    } catch {}
    try {
      await db.insert(schema.userCompanyAccess).values({
        id: `uca-${preservedAdmin.id}-${companyId}`,
        userId: preservedAdmin.id,
        companyId,
        isDefault: true,
        isActive: true,
      }).run();
    } catch {}
    try {
      await db.insert(schema.userBranchAccess).values({
        id: `uba-${preservedAdmin.id}-br-main`,
        userId: preservedAdmin.id,
        branchId: 'br-main',
        isDefault: true,
        isActive: true,
      }).run();
    } catch {}

    return { success: true, backupPath, preservedAdminId: preservedAdmin.id };
  } catch (e: any) {
    return reply.status(500).send({ error: e?.message || 'فشل تصفير البيانات' });
  }
});


api.post('/inventory/audit', async (req, reply) => {
  try {
    const authContext = getAuthContext(req);
    const companyId = String(authContext.companyId || '').trim() || null;
    const effectiveBranchId = String(pickEffectiveBranchId((req.body as any)?.branchId, authContext) || authContext.branchId || '').trim() || null;
    const body = req.body as any;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) return reply.status(400).send({ error: 'لا توجد مواد للجرد.' });

    const nowIso = new Date().toISOString();
    const updated: string[] = [];
    const missing: string[] = [];
    const adjustmentLines: any[] = [];
    const inventoryAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.INVENTORY, companyId);
    const miscExpenseId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.MISC_EXPENSE, companyId);
    const otherRevenueId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.OTHER_REVENUE, companyId);

    for (const entry of items) {
      const id = String(entry?.id || '').trim();
      if (!id) continue;
      const qty = Number(entry?.quantity);
      if (!Number.isFinite(qty)) continue;
      const existing = await db.select().from(schema.items).where(eq(schema.items.id, id)).get();
      if (!existing) {
        missing.push(id);
        continue;
      }
      assertEntityBelongsToCompany(existing, String(companyId || ''), 'المادة غير موجودة.');
      assertEntityBelongsToAllowedBranch(existing, authContext, 'المادة غير موجودة.');
      if (effectiveBranchId && String((existing as any).branchId || '').trim() && String((existing as any).branchId || '').trim() !== effectiveBranchId) {
        throw appError(409, 'INVENTORY_AUDIT_BRANCH_MISMATCH', 'لا يمكن اعتماد جرد لفرع مختلف عن الفرع النشط الحالي.', {
          item_id: id,
          item_branch_id: (existing as any).branchId,
          branch_id: effectiveBranchId,
        });
      }
      const beforeQty = Number(existing.quantity || 0);
      const diff = roundMoney(qty - beforeQty);
      const cost = Number(existing.costPrice || 0);
      const value = roundMoney(Math.abs(diff) * cost);
      if (diff !== 0 && value > 0) {
        if (diff < 0) {
          adjustmentLines.push(
            { accountId: miscExpenseId, debit: value, credit: 0, description: buildDescription(ACCOUNTING_LABELS.STOCK_SHORTAGE, existing.name ? `: ${existing.name}` : '') },
            { accountId: inventoryAccountId, debit: 0, credit: value, description: buildDescription(ACCOUNTING_LABELS.STOCK_SHORTAGE, existing.name ? `: ${existing.name}` : '') }
          );
        } else {
          adjustmentLines.push(
            { accountId: inventoryAccountId, debit: value, credit: 0, description: buildDescription(ACCOUNTING_LABELS.STOCK_SURPLUS, existing.name ? `: ${existing.name}` : '') },
            { accountId: otherRevenueId, debit: 0, credit: value, description: buildDescription(ACCOUNTING_LABELS.STOCK_SURPLUS, existing.name ? `: ${existing.name}` : '') }
          );
        }
      }

      if (diff !== 0) {
        const warehouseId = String((existing as any).warehouseId || '').trim();
        if (!warehouseId) {
          throw appError(409, 'INVENTORY_AUDIT_WAREHOUSE_REQUIRED', 'لا يمكن اعتماد الجرد لصنف غير مرتبط بمستودع.');
        }
        adjustItemStockWithMovement(db, {
          itemId: id,
          warehouseId,
          warehouseName: (existing as any).warehouseName || null,
          unitId: (existing as any).unitId || null,
          unitName: (existing as any).unitName || null,
          qtyDelta: diff,
          baseQtyDelta: diff,
          meta: {
            documentType: 'INVENTORY_AUDIT',
            documentId: `audit-${Date.now()}`,
            documentNumber: null,
            movementType: diff > 0 ? 'STOCK_AUDIT_SURPLUS' : 'STOCK_AUDIT_SHORTAGE',
            userId: String(authContext.userId || '') || null,
            userName: String(authContext.username || '') || null,
            notes: 'Stocktake adjustment',
          },
        });
      }
      updated.push(id);
    }

    if (adjustmentLines.length > 0) {
      try {
        const entry = await createJournalEntry({
          description: buildDescription(ACCOUNTING_LABELS.STOCK_ADJUSTMENT, '—', nowIso.slice(0, 10)),
          referenceType: 'stock_adjustment',
          referenceId: null,
          entryDate: nowIso,
          currencyCode: 'SYP',
          companyId,
          branchId: effectiveBranchId,
          lines: adjustmentLines
        });
        await postJournalEntry(entry.id);
      } catch (e: any) {
        console.error('Stock adjustment journal error:', e?.message || e);
      }
    }

    await db.insert(schema.reconciliationMarks).values({
      id: `rm-audit-${Date.now()}`,
      companyId,
      branchId: effectiveBranchId,
      scopeType: 'ITEM_AUDIT',
      scopeId: 'inventory',
      reportType: 'STOCKTAKE',
      markAt: nowIso,
      rowRefId: `audit-${Date.now()}`,
      note: `اعتماد جرد مخزني (${updated.length} تحديث)`
    }).run();

    return { success: true, updatedCount: updated.length, missingIds: missing };
  } catch (e: any) {
    return reply.status(500).send({ error: e?.message || 'فشل اعتماد الجرد' });
  }
});

}
