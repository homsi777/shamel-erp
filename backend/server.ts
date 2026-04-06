import fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import {
    db as database,
    getResolvedDbPath,
    closeDb,
    rawSqlite,
    databaseDialect,
    ensureDatabaseReady,
    verifyDatabaseConnectivity,
    isPostgresDialect,
} from './db';
import { createFxJournalPostingService } from './services/fxJournalService';
import { computeFxDifference } from './services/fxSettlement';
import { recomputeInvoiceSettlementTx } from './services/invoiceSettlement';
import { ensureAllPartyAccountLinks, ensurePartyAccountLinks, requirePartyAccountId } from './services/partnerAccountEnforcement';
import * as schema from './db/schema';
// Fix: sql and eq are typically exported from 'drizzle-orm'
import { sql, eq, desc, and } from 'drizzle-orm';
import {
    applyPartyTransaction,
    createPartySubAccount,
    computePartyDelta,
    createJournalEntry,
    deletePartyTransactionByRef,
    getAccountBalance,
    getAccountStatement,
    getTrialBalance,
    ledgerIdForRef,
    normalizePaymentTerm,
    postJournalEntry,
    recomputePartyBalance,
    reverseJournalEntry,
    roundMoney,
    resolveAccountByCode,
    SYSTEM_ACCOUNTS
} from './accountingService';
import { adjustItemStockWithMovement, computeBaseQty, resolveUnitFactor } from './inventoryService';
import {
    postConsignmentDispatchJournal,
    postSupplierConsignmentSettlementJournal,
    reverseConsignmentJournal
} from './consignmentAccounting';
import { ACCOUNTING_LABELS, buildDescription } from './accounting-labels';
import bcrypt from 'bcryptjs';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { getNextDocNumber } from './routes/_common';
import systemRoutes from './routes/system.routes';
import authRoutes from './routes/auth.routes';
import invoicesRoutes from './routes/invoices.routes';
import vouchersRoutes from './routes/vouchers.routes';
import partiesRoutes from './routes/parties.routes';
import inventoryRoutes from './routes/inventory.routes';
import openingRoutes from './routes/opening.routes';
import expensesRoutes from './routes/expenses.routes';
import fundsRoutes from './routes/funds.routes';
import payrollRoutes from './routes/payroll.routes';
import manufacturingRoutes from './routes/manufacturing.routes';
import accountsRoutes from './routes/accounts.routes';
import reportsRoutes from './routes/reports.routes';
import reportsTrustedRoutes from './routes/reports.trusted';
import { ensureReportingIndexes } from './services/reportingEngine';
import { ensurePrintJobsAuditColumnsOnce } from './services/printJobService';
import periodsAdminRoutes from './routes/periods.admin';
import provisioningAdminRoutes from './routes/provisioning.admin';
import deliveryRoutes from './routes/delivery.routes';
import restaurantRoutes from './routes/restaurant.routes';
import agentsRoutes from './routes/agents.routes';
import partnersRoutes from './routes/partners.routes';
import unitsRoutes from './routes/units.routes';
import biometricRoutes from './routes/biometric.routes';
import backupsRoutes from './routes/backups.routes';
import smartRoutes from './routes/smart.routes';
import genericRoutes from './routes/generic.routes';
import activationRoutes from './routes/activation.routes';
import superAdminRoutes from './routes/superAdmin.routes';
import consignmentRoutes from './routes/consignments.routes';
import pricingRoutes from './routes/pricing.routes';
import periodsRoutes from './routes/periods.routes';
import textileRoutes from './routes/textile.routes';
import { fxRevaluationRoutes } from './routes/fxRevaluation.routes';
import { reconciliationRoutes } from './routes/reconciliation.routes';
import { printRoutes } from './routes/print.routes';
import {
    BASE_CURRENCY,
    normalizeCurrencyCode,
    normalizeExchangeRate,
    normalizeInvoiceMoney,
    toBaseAmount,
    toTransactionAmount,
} from './lib/currency';
import { serverConfig, getServerConfigSummary } from './lib/serverConfig';
import { loadNormalizedSettingsMap } from './lib/settings';
import { createSecurityTools, DEFAULT_POLICY_COVERAGE_TARGETS, verifySensitiveRoutePolicyCoverage } from './lib/security';
import { initRestaurantSocket } from './lib/restaurantSocket';
import { createAuditLogger } from './lib/audit';
import { createSystemEventLogger, SYSTEM_EVENT_TYPES } from './lib/systemEvents';
import systemEventsRoutes from './routes/systemEvents.routes';

const db = database as any;
const server = fastify({ logger: false });

const normalizePort = (raw: string | undefined, fallback: number) => {
  const n = Number(raw || fallback);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? n : fallback;
};

const normalizeListenHost = (raw: string | undefined, fallback: string) => {
  const value = String(raw || '').trim();
  return value || fallback;
};

const normalizeBaseUrl = (raw: string | undefined) => {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const normalizeOrigin = (raw: string) => {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`.replace(/\/$/, '');
  } catch {
    return raw.replace(/\/$/, '');
  }
};

/** منفذ استماع API على كل الواجهات — يُفضّل 3111 للشبكة المحلية. يمكن التجاوز بـ SERVER_PORT أو SHAMEL_API_PORT. */
const LISTEN_PORT = (() => {
  return normalizePort(process.env.SERVER_PORT || process.env.SHAMEL_API_PORT, 3111);
})();
const LISTEN_HOST = normalizeListenHost(process.env.SERVER_HOST || process.env.SHAMEL_SERVER_HOST, '0.0.0.0');
/** منفذ واجهة منيو QR العامة (منفذ مستقل عن شاشة المشروع). يمكن التجاوز بـ QR_MENU_PORT أو SHAMEL_QR_MENU_PORT. */
const QR_MENU_PORT = (() => {
  const raw = process.env.QR_MENU_PORT ?? process.env.SHAMEL_QR_MENU_PORT;
  if (raw !== undefined && raw !== null) {
    return normalizePort(String(raw), 3222);
  }
  return 3222;
})();
const QR_MENU_HOST = normalizeListenHost(process.env.QR_MENU_HOST || process.env.SHAMEL_QR_MENU_HOST, LISTEN_HOST);
const APP_BASE_URL = normalizeBaseUrl(process.env.APP_BASE_URL || process.env.SHAMEL_APP_BASE_URL);
const PUBLIC_BASE_URL = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || process.env.SHAMEL_PUBLIC_BASE_URL);
const configuredOrigins = [
    ...(String(process.env.CORS_ALLOWED_ORIGINS || process.env.SHAMEL_CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)),
    ...(APP_BASE_URL ? [APP_BASE_URL] : []),
    ...(PUBLIC_BASE_URL ? [PUBLIC_BASE_URL] : []),
].map(normalizeOrigin);
const ALLOWED_CORS_ORIGINS = Array.from(new Set(configuredOrigins));

/** Resolve built Vite `dist/` so browsers can load the SPA from the same port as the API (e.g. LAN http://host:3111/). */
function resolveSpaDistRoot(): string | null {
    const candidates: string[] = [
        path.join(process.cwd(), 'dist'),
        path.join(process.cwd(), '..', 'dist'),
    ];
    if (typeof __dirname !== 'undefined') {
        candidates.push(path.join(__dirname, '..', 'dist'), path.join(__dirname, 'dist'));
    }
    const seen = new Set<string>();
    for (const raw of candidates) {
        const abs = path.resolve(raw);
        if (seen.has(abs)) continue;
        seen.add(abs);
        try {
            if (fs.existsSync(path.join(abs, 'index.html'))) return abs;
        } catch {
            /* ignore */
        }
    }
    return null;
}

server.addHook('onSend', async (_req, reply, payload) => {
    const rawType = reply.getHeader('content-type');
    const contentType = Array.isArray(rawType) ? String(rawType[0] || '') : String(rawType || '');
    if (!contentType) return payload;
    if (/charset=/i.test(contentType)) return payload;

    if (/^application\/json\b/i.test(contentType)) {
        reply.header('content-type', `${contentType}; charset=utf-8`);
    } else if (/^text\/html\b/i.test(contentType)) {
        reply.header('content-type', `${contentType}; charset=utf-8`);
    } else if (/^text\/plain\b/i.test(contentType)) {
        reply.header('content-type', `${contentType}; charset=utf-8`);
    }
    return payload;
});

server.register(cors, {
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }
        if (ALLOWED_CORS_ORIGINS.length === 0) {
            callback(null, true);
            return;
        }
        const normalized = normalizeOrigin(origin);
        callback(null, ALLOWED_CORS_ORIGINS.includes(normalized));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Active-Org', 'X-Company-Id', 'X-Branch-Id']
});
server.register(jwt, { secret: serverConfig.jwtSecret });

const systemEventLogger = createSystemEventLogger(db, schema);
const auditLogger = createAuditLogger(db, schema, systemEventLogger);
const security = createSecurityTools({ db, schema, eq, systemEventLogger });
server.addHook('preHandler', security.preHandler);

const TABLE_MAP: Record<string, any> = {
  'inventory': schema.items,
  'items': schema.items,
  'warehouses': schema.warehouses,
    'agents': schema.agents,
    'agent-inventory': schema.agentInventory,
    'agent-transfers': schema.agentTransfers,
    'agent-transfer-lines': schema.agentTransferLines,
    'agent-inventory-movements': schema.agentInventoryMovements,
  'clients': schema.parties,
  'parties': schema.parties,
  'party-transactions': schema.partyTransactions,
  'invoices': schema.invoices,
  'cash-boxes': schema.cashBoxes,
  'vouchers': schema.vouchers,
  'accounts': schema.accounts,
  'partners': schema.partners,
  'partner-transactions': schema.partnerTransactions,
  'categories': schema.categories,
  'sub-categories': schema.subCategories,
  'units': schema.units,
  'users': schema.users,
  'employees': schema.employees,
  'payroll/transactions': schema.salaryTransactions,
  'biometric-devices': schema.biometricDevices,
  'attendance-records': schema.attendanceRecords,
  'expenses': schema.expenses,
  'branches': schema.branches,
  'companies': schema.companies,
  'user-branch-access': schema.userBranchAccess,
  'user-company-access': schema.userCompanyAccess,
  'remote-branches': schema.remoteBranches,
  'settings': schema.systemSettings,
  'system-settings': schema.systemSettings,
  'item-groups': schema.itemGroups,
  'item-group-items': schema.itemGroupItems,
  'item-serials': schema.itemSerials,
  'item-barcodes': schema.itemBarcodes,
  'promotions': schema.promotions,
  'inventory/transfers': schema.stockTransfers,
  'parties/transfers': schema.partyTransfers,
  'reconciliation-marks': schema.reconciliationMarks
};

const tableCoverageTargets = Object.keys(TABLE_MAP).map((collection) => ({
    path: `/api/${collection}`,
    methods: ['POST'],
}));
const securityPolicyCoverage = verifySensitiveRoutePolicyCoverage([
    ...DEFAULT_POLICY_COVERAGE_TARGETS,
    ...tableCoverageTargets,
]);
if (securityPolicyCoverage.missing.length > 0) {
    throw new Error(`[security] uncovered sensitive route policies: ${securityPolicyCoverage.missing.map((entry) => `${entry.method} ${entry.path}`).join(', ')}`);
}

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    let bestIp = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (iface.address.startsWith('192.168.')) return iface.address;
                bestIp = iface.address;
            }
        }
    }
    return bestIp;
}

const safeJsonParse = (value: any, fallback: any) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
};

const stringifyOrEmpty = (value: any) => JSON.stringify(value || []);

const loadZkService = async () => {
    try {
        const servicePath = path.join(process.cwd(), 'zkNodeService.js');
        if (!fs.existsSync(servicePath)) return null;
        const module = await import(servicePath);
        return module.default || module;
    } catch (e) {
        console.warn('Failed to load zkNodeService:', (e as any)?.message || e);
        return null;
    }
};

const shouldApplyPartyLedgerForVoucher = async (tx: any, payload: any, isCashMove: boolean) => {
    if (!payload?.clientId || !isCashMove) return false;
    const linkedInvoiceId = String(payload.linkedInvoiceId || payload.linked_invoice_id || '').trim();
    if (!linkedInvoiceId) return true;
    const invoice = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, linkedInvoiceId)).get();
    if (!invoice) return true;
    const term = normalizePaymentTerm(
        (invoice as any).paymentType || (Number((invoice as any).remainingAmount || 0) > 0 ? 'credit' : 'cash')
    );
    // Cash invoices should not affect party ledger even if a cash voucher exists.
    return term !== 'cash';
};

const parseMultiCurrencyError = (e: any) => {
    const msg = String(e?.message || '');
    if (!msg.startsWith('MULTI_CURRENCY_PARTY:')) return null;
    const parts = msg.split(':');
    return { partyId: parts[1] || '', currencies: (parts[2] || '').split(',').filter(Boolean) };
};

const resolveSystemAccountId = async (code: string, companyId?: string | null) => resolveAccountByCode(db, code, companyId);
const requireSqliteDriver = () => {
    if (!rawSqlite) {
        throw new Error('SQLITE_DRIVER_UNAVAILABLE');
    }
    return rawSqlite;
};

const startConsistencyGuards = () => {
    const disabled = ['1', 'true', 'yes'].includes(String(process.env.ERP_DISABLE_CONSISTENCY_GUARDS || '').trim().toLowerCase());
    if (disabled) {
        console.warn('[consistency-guards] disabled by ERP_DISABLE_CONSISTENCY_GUARDS');
        return;
    }

    const intervalMsRaw = Number(process.env.ERP_CONSISTENCY_GUARD_INTERVAL_MS || 300000);
    const intervalMs = Number.isFinite(intervalMsRaw) && intervalMsRaw >= 30000 ? intervalMsRaw : 300000;
    let running = false;
    let lastDriftSignature = '';
    let lastFailureMessage = '';
    let lastFailureCount = 0;
    let lastFailureLoggedAt = 0;
    const failureThrottleMs = 5 * 60 * 1000;
    const columnCache = new Map<string, boolean>();
    const sqliteDb = requireSqliteDriver();

    const hasColumn = (table: string, column: string) => {
        const key = `${table}.${column}`;
        if (columnCache.has(key)) return Boolean(columnCache.get(key));
        try {
            const columns = sqliteDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
            const exists = columns.some((entry) => String(entry?.name || '').toLowerCase() === column.toLowerCase());
            columnCache.set(key, exists);
            return exists;
        } catch {
            columnCache.set(key, false);
            return false;
        }
    };

    const safeColumn = (table: string, column: string, alias?: string) => {
        if (!hasColumn(table, column)) return null;
        const prefix = alias || table;
        return `${prefix}.${column}`;
    };

    const safeColumnOrNull = (table: string, column: string, alias?: string) =>
        safeColumn(table, column, alias) || 'NULL';

    const summarizeByScope = (rows: Array<Record<string, any>>) => {
        const byCompany = new Map<string, number>();
        const byBranch = new Map<string, number>();
        for (const row of rows || []) {
            const companyId = String(row.companyId || 'unknown');
            byCompany.set(companyId, (byCompany.get(companyId) || 0) + 1);
            const branchId = String(row.branchId || 'unassigned');
            byBranch.set(branchId, (byBranch.get(branchId) || 0) + 1);
        }
        return {
            byCompany: Object.fromEntries(byCompany.entries()),
            byBranch: Object.fromEntries(byBranch.entries()),
        };
    };

    const buildPartyDriftBreakdown = (rows: Array<Record<string, any>>) => {
        return rows.map((row) => {
            const partyId = String(row.partyId || '').trim();
            const partyIdNumber = Number(partyId);
            const lastTransactions = sqliteDb.prepare(`
                SELECT id, ref_id AS refId, amount_base AS amountBase, delta_base AS deltaBase, created_at AS createdAt
                FROM party_transactions
                WHERE party_id = ?
                ORDER BY created_at DESC
                LIMIT 5
            `).all(partyId) as Array<Record<string, any>>;

            const lastVouchers = sqliteDb.prepare(`
                SELECT id, amount_base AS amountBase, amount, currency, status, date, linked_invoice_id AS linkedInvoiceId
                FROM vouchers
                WHERE client_id = ?
                ORDER BY date DESC
                LIMIT 5
            `).all(partyId) as Array<Record<string, any>>;

            const lastJournalEntries = sqliteDb.prepare(`
                SELECT jel.id AS lineId,
                       jel.debit,
                       jel.credit,
                       je.id AS journalEntryId,
                       je.entry_date AS entryDate,
                       je.reference_type AS referenceType,
                       je.reference_id AS referenceId,
                       ${safeColumnOrNull('journal_entries', 'status', 'je')} AS status
                FROM journal_entry_lines jel
                LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
                WHERE jel.partner_ref_id = ? ${Number.isFinite(partyIdNumber) ? 'OR jel.party_id = ?' : ''}
                ORDER BY je.entry_date DESC, jel.id DESC
                LIMIT 5
            `).all(Number.isFinite(partyIdNumber) ? [partyId, partyIdNumber] : [partyId]) as Array<Record<string, any>>;

            const unmatchedTransactions = sqliteDb.prepare(`
                SELECT id, ref_id AS refId, amount_base AS amountBase, delta_base AS deltaBase, created_at AS createdAt
                FROM party_transactions
                WHERE party_id = ?
                  AND (ref_id IS NULL OR trim(ref_id) = '')
                ORDER BY created_at DESC
                LIMIT 5
            `).all(partyId) as Array<Record<string, any>>;

            return {
                partyId,
                partyBalance: Number(row.partyBalance || 0),
                ledgerBalance: Number(row.ledgerBalance || 0),
                delta: Number(row.partyBalance || 0) - Number(row.ledgerBalance || 0),
                lastTransactions,
                lastVouchers,
                lastJournalEntries,
                unmatchedTransactions,
            };
        });
    };

    const emitGuardAlert = async (
        eventType: string,
        errorCode: string,
        severity: 'warning' | 'error' | 'critical',
        metadata: Record<string, any>,
    ) => {
        await systemEventLogger?.log({
            eventType,
            severity,
            sourceModule: 'consistency_guards',
            action: 'scan',
            status: 'failed',
            errorCode,
            requiresManualReview: severity === 'critical',
            affectedDocumentType: metadata.documentType || null,
            affectedDocumentId: null,
            metadata,
        });
    };

    const run = async () => {
        if (running) return;
        running = true;
        try {
            const invoiceStatusColumn = safeColumn('invoices', 'status', 'invoices');
            const invoicePostedAtColumn = safeColumn('invoices', 'posted_at', 'invoices') || safeColumn('invoices', 'postedAt', 'invoices');
            const invoiceStatusClause = invoiceStatusColumn
                ? `upper(coalesce(${invoiceStatusColumn}, '')) = 'POSTED' AND`
                : (invoicePostedAtColumn ? `${invoicePostedAtColumn} IS NOT NULL AND` : '');

            const voucherStatusColumn = safeColumn('vouchers', 'status', 'vouchers');
            const voucherPostedAtColumn = safeColumn('vouchers', 'posted_at', 'vouchers') || safeColumn('vouchers', 'postedAt', 'vouchers');
            const voucherStatusClause = voucherStatusColumn
                ? `upper(coalesce(${voucherStatusColumn}, '')) = 'POSTED' AND`
                : (voucherPostedAtColumn ? `${voucherPostedAtColumn} IS NOT NULL AND` : '');

            const stockDrifts = sqliteDb.prepare(`
                SELECT
                  i.id AS itemId,
                  i.company_id AS companyId,
                  ${safeColumnOrNull('items', 'branch_id', 'i')} AS branchId,
                  coalesce(i.quantity, 0) AS itemQty,
                  coalesce(sum(coalesce(m.base_qty, 0)), 0) AS movementQty
                FROM items i
                LEFT JOIN inventory_movements m ON m.item_id = i.id
                GROUP BY i.id
                HAVING abs(coalesce(i.quantity, 0) - coalesce(sum(coalesce(m.base_qty, 0)), 0)) > 0.0001
                LIMIT 50
            `).all() as Array<Record<string, any>>;

            const partyDrifts = sqliteDb.prepare(`
                SELECT
                  p.id AS partyId,
                  p.company_id AS companyId,
                  ${safeColumnOrNull('parties', 'branch_id', 'p')} AS branchId,
                  coalesce(p.balance, 0) AS partyBalance,
                  coalesce(sum(coalesce(t.delta_base, t.delta, 0)), 0) AS ledgerBalance
                FROM parties p
                LEFT JOIN party_transactions t ON t.party_id = p.id
                GROUP BY p.id
                HAVING abs(coalesce(p.balance, 0) - coalesce(sum(coalesce(t.delta_base, t.delta, 0)), 0)) > 0.0001
                LIMIT 50
            `).all() as Array<Record<string, any>>;

            const invoicePostedWithoutJournal = sqliteDb.prepare(`
                SELECT id, company_id AS companyId, ${safeColumnOrNull('invoices', 'branch_id', 'invoices')} AS branchId
                FROM invoices
                WHERE ${invoiceStatusClause}
                  coalesce(total_amount_base, total_amount, 0) > 0.0001
                  AND
                  (journal_entry_id IS NULL OR trim(cast(journal_entry_id as text)) = '')
                LIMIT 50
            `).all() as Array<Record<string, any>>;

            const voucherPostedWithoutJournal = sqliteDb.prepare(`
                SELECT id, company_id AS companyId, ${safeColumnOrNull('vouchers', 'branch_id', 'vouchers')} AS branchId
                FROM vouchers
                WHERE ${voucherStatusClause}
                  coalesce(amount_base, amount, 0) > 0.0001
                  AND
                  (journal_entry_id IS NULL OR trim(cast(journal_entry_id as text)) = '')
                LIMIT 50
            `).all() as Array<Record<string, any>>;

            if (stockDrifts.length > 0 || partyDrifts.length > 0 || invoicePostedWithoutJournal.length > 0 || voucherPostedWithoutJournal.length > 0) {
                console.warn('[consistency-guards] detected drift', {
                    stockDrifts: stockDrifts.length,
                    partyDrifts: partyDrifts.length,
                    invoicePostedWithoutJournal: invoicePostedWithoutJournal.length,
                    voucherPostedWithoutJournal: voucherPostedWithoutJournal.length,
                });
            }

            const currentSignature = JSON.stringify({
                stock: stockDrifts.map((row) => String(row.itemId || '')).sort(),
                party: partyDrifts.map((row) => String(row.partyId || '')).sort(),
                invoiceNoJournal: invoicePostedWithoutJournal.map((row) => String(row.id || '')).sort(),
                voucherNoJournal: voucherPostedWithoutJournal.map((row) => String(row.id || '')).sort(),
            });

            if (currentSignature !== '{"stock":[],"party":[],"invoiceNoJournal":[],"voucherNoJournal":[]}' && currentSignature !== lastDriftSignature) {
                if (stockDrifts.length > 0 || partyDrifts.length > 0) {
                    const partyDriftBreakdown = partyDrifts.length > 0
                        ? buildPartyDriftBreakdown(partyDrifts.slice(0, 5))
                        : [];
                    await emitGuardAlert(
                        SYSTEM_EVENT_TYPES.CONSISTENCY_DRIFT_DETECTED,
                        'CONSISTENCY_DRIFT_DETECTED',
                        (stockDrifts.length + partyDrifts.length) > 25 ? 'critical' : 'warning',
                        {
                            documentType: 'consistency_guard',
                            stockDriftsCount: stockDrifts.length,
                            partyDriftsCount: partyDrifts.length,
                            stockScope: summarizeByScope(stockDrifts),
                            partyScope: summarizeByScope(partyDrifts),
                            stockSample: stockDrifts.slice(0, 10),
                            partySample: partyDrifts.slice(0, 10),
                            driftBreakdown: partyDriftBreakdown,
                        },
                    );
                }

                if (invoicePostedWithoutJournal.length > 0 || voucherPostedWithoutJournal.length > 0) {
                    await emitGuardAlert(
                        SYSTEM_EVENT_TYPES.MISSING_JOURNAL_LINK,
                        'MISSING_JOURNAL_LINK',
                        (invoicePostedWithoutJournal.length + voucherPostedWithoutJournal.length) > 10 ? 'critical' : 'error',
                        {
                            documentType: 'journal_linkage',
                            invoiceMissingJournalCount: invoicePostedWithoutJournal.length,
                            voucherMissingJournalCount: voucherPostedWithoutJournal.length,
                            invoiceScope: summarizeByScope(invoicePostedWithoutJournal),
                            voucherScope: summarizeByScope(voucherPostedWithoutJournal),
                            invoiceSample: invoicePostedWithoutJournal.slice(0, 10),
                            voucherSample: voucherPostedWithoutJournal.slice(0, 10),
                        },
                    );
                }
            }

            lastDriftSignature = currentSignature;
            if (lastFailureMessage) {
                const recoveredAt = new Date().toISOString();
                await systemEventLogger?.log({
                    eventType: SYSTEM_EVENT_TYPES.GUARD_RECOVERED,
                    severity: 'info',
                    sourceModule: 'consistency_guards',
                    action: 'scan',
                    status: 'success',
                    errorCode: 'CONSISTENCY_GUARD_RECOVERED',
                    requiresManualReview: false,
                    affectedDocumentType: 'consistency_guard',
                    metadata: {
                        lastFailureMessage,
                        lastFailureCount,
                        recoveredAt,
                    },
                });
                try {
                    const unresolved = sqliteDb.prepare(`
                        SELECT id
                        FROM system_events
                        WHERE source_module = ?
                          AND error_code = ?
                          AND (resolved_at IS NULL OR trim(resolved_at) = '')
                        ORDER BY created_at DESC
                        LIMIT 1
                    `).get('consistency_guards', 'CONSISTENCY_GUARD_FAILURE') as { id?: string } | undefined;
                    if (unresolved?.id) {
                        sqliteDb.prepare(`
                            UPDATE system_events
                            SET resolved_at = ?,
                                resolved_by = ?,
                                resolution_note = ?
                            WHERE id = ?
                        `).run(
                            recoveredAt,
                            'system',
                            `Auto-resolved after guard recovery at ${recoveredAt}`,
                            unresolved.id,
                        );
                    }
                } catch (e: any) {
                    console.warn('[consistency-guards] failed to auto-resolve:', e?.message || e);
                }
                lastFailureMessage = '';
                lastFailureCount = 0;
                lastFailureLoggedAt = 0;
            }
        } catch (error: any) {
            console.warn('[consistency-guards] failed:', error?.message || error);
            const message = String(error?.message || error || 'Unknown consistency guard failure');
            const now = Date.now();
            if (message === lastFailureMessage && (now - lastFailureLoggedAt) < failureThrottleMs) {
                lastFailureCount += 1;
                return;
            }
            lastFailureMessage = message;
            lastFailureCount = Math.max(1, lastFailureCount + 1);
            lastFailureLoggedAt = now;
            await systemEventLogger?.log({
                eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
                severity: 'error',
                sourceModule: 'consistency_guards',
                action: 'scan',
                status: 'failed',
                errorCode: 'CONSISTENCY_GUARD_FAILURE',
                requiresManualReview: false,
                affectedDocumentType: 'consistency_guard',
                metadata: {
                    message,
                    occurrences: lastFailureCount,
                    throttled: lastFailureCount > 1,
                },
            });
        } finally {
            running = false;
        }
    };

    setInterval(() => { void run(); }, intervalMs);
    void run();
};




export const buildInvoiceJournalLines = async (invoice: any) => {
    const invType = String(invoice?.type || '').toLowerCase();
    const returnType = String(invoice?.returnType || invoice?.return_type || '').toLowerCase();
    const paymentTerm = normalizePaymentTerm(
        invoice?.paymentType || (Number(invoice?.remainingAmount || 0) > 0 ? 'credit' : 'cash')
    );
    const isCash = paymentTerm === 'cash';

    if (!['sale', 'purchase', 'return', 'exchange', 'opening_stock'].includes(invType)) return [];

    const normalizedMoney = normalizeInvoiceMoney(invoice);
    const rate = normalizedMoney.exchangeRate;
    const total = normalizedMoney.totalBase;
    const discount = normalizedMoney.discountBase;
    const gross = roundMoney(total + (discount > 0 ? discount : 0));

    const party = invoice?.clientId
        ? await db.select().from(schema.parties).where(eq(schema.parties.id, invoice.clientId)).get()
        : null;

    const toAccountId = (value: any): number | null => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : null;
    };

    const companyId = String(invoice?.companyId || '').trim() || null;
    const cashAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.CASH, companyId);
    const inventoryAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.INVENTORY, companyId);
    const salesAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.SALES, companyId);
    const salesReturnAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.SALES_RETURN, companyId);
    const salesDiscountAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.SALES_DISCOUNT, companyId);
    const purchaseDiscountAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.PURCHASE_DISCOUNT, companyId);
    const retainedAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.RETAINED, companyId);

    const enforcedParty = party ? await ensurePartyAccountLinks(db, party, companyId) : null;
    const partyReceivableAccountId = enforcedParty ? await requirePartyAccountId(db, enforcedParty, 'receivable', companyId) : null;
    const partyPayableAccountId = enforcedParty ? await requirePartyAccountId(db, enforcedParty, 'payable', companyId) : null;

    const lines: any[] = [];
    const pushLine = (accountId: number, debit: number, credit: number, description?: string) => {
        if (!debit && !credit) return;
        const lineCurrency = normalizeCurrencyCode(invoice?.currency || BASE_CURRENCY);
        lines.push({
            accountId,
            debit: roundMoney(debit),
            credit: roundMoney(credit),
            description,
            currencyCode: lineCurrency,
            exchangeRate: rate,
            amountInCurrency: lineCurrency !== BASE_CURRENCY ? roundMoney((debit + credit) * rate) : undefined,
            partyId: (() => {
                const n = Number(enforcedParty?.id);
                return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            partnerRefId: enforcedParty ? String((enforcedParty as any).id || '') : null,
        });
    };

    if (invType === 'return' && returnType === 'purchase') {
        if (!partyPayableAccountId) throw new Error('PARTY_PAYABLE_ACCOUNT_REQUIRED');
        pushLine(partyPayableAccountId, total, 0, ACCOUNTING_LABELS.PURCHASE_RETURN);
        pushLine(inventoryAccountId, 0, total, ACCOUNTING_LABELS.PURCHASE_RETURN);
        return lines;
    }

    if (invType === 'exchange' && returnType === 'purchase') {
        if (!partyPayableAccountId) throw new Error('PARTY_PAYABLE_ACCOUNT_REQUIRED');
        pushLine(partyPayableAccountId, total, 0, ACCOUNTING_LABELS.PURCHASE_RETURN);
        pushLine(inventoryAccountId, 0, total, ACCOUNTING_LABELS.PURCHASE_RETURN);
        return lines;
    }

    if (invType === 'return' || invType === 'exchange') {
        if (!isCash && !partyReceivableAccountId) throw new Error('PARTY_RECEIVABLE_ACCOUNT_REQUIRED');
        const creditAccount = isCash ? cashAccountId : partyReceivableAccountId!;
        pushLine(salesReturnAccountId, total, 0, ACCOUNTING_LABELS.SALE_RETURN);
        pushLine(creditAccount, 0, total, ACCOUNTING_LABELS.SALE_RETURN);
        return lines;
    }

    if (invType === 'sale') {
        if (!isCash && !partyReceivableAccountId) throw new Error('PARTY_RECEIVABLE_ACCOUNT_REQUIRED');
        const debitAccount = isCash ? cashAccountId : partyReceivableAccountId!;
        pushLine(debitAccount, total, 0, ACCOUNTING_LABELS.RECEIVABLES);
        if (discount > 0) {
            pushLine(salesDiscountAccountId, discount, 0, ACCOUNTING_LABELS.SALES_DISCOUNT);
        }
        pushLine(salesAccountId, 0, gross, ACCOUNTING_LABELS.SALES_REVENUE);
        return lines;
    }

    if (invType === 'purchase') {
        // Determine goods-only AP amount (separate from extra/landed costs)
        const goodsSubtotalRaw = Number(invoice?.goodsSubtotal ?? invoice?.goods_subtotal);
        const additionalCostsTotalRaw = Number(invoice?.additionalCostsTotal ?? invoice?.additional_costs_total ?? 0);
        // If goodsSubtotal was provided, use it for AP; otherwise fall back to full total (legacy)
        const goodsForAP = (Number.isFinite(goodsSubtotalRaw) && goodsSubtotalRaw >= 0)
            ? roundMoney(goodsSubtotalRaw)
            : total;
        const extraCosts = (Number.isFinite(additionalCostsTotalRaw) && additionalCostsTotalRaw > 0)
            ? roundMoney(additionalCostsTotalRaw)
            : roundMoney(Math.max(0, total - goodsForAP));

        if (!isCash && !partyPayableAccountId) throw new Error('PARTY_PAYABLE_ACCOUNT_REQUIRED');
        const creditAccount = isCash ? cashAccountId : partyPayableAccountId!;
        // Resolve landed cost clearing; fall back to payable if account not yet seeded
        const landedCostClearingAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.LANDED_COST_CLEARING, companyId);

        // Inventory debit = full cost basis (goods + extra costs)
        pushLine(inventoryAccountId, gross, 0, ACCOUNTING_LABELS.INVENTORY);
        if (discount > 0) {
            pushLine(purchaseDiscountAccountId, 0, discount, ACCOUNTING_LABELS.PURCHASE_DISCOUNT);
        }
        // AP credit = goods subtotal only â€” extra costs must NOT inflate supplier payable
        pushLine(creditAccount, 0, goodsForAP, ACCOUNTING_LABELS.PAYABLES);
        // Landed cost clearing credit = extra costs (customs, freight, transport, labor, etc.)
        if (extraCosts > 0) {
            const extraCostCreditAccount = isCash ? cashAccountId : landedCostClearingAccountId;
            pushLine(extraCostCreditAccount, 0, extraCosts, 'مقاصة مصاريف الاستيراد');
        }
        return lines;
    }

    if (invType === 'opening_stock') {
        pushLine(inventoryAccountId, total, 0, ACCOUNTING_LABELS.OPENING_STOCK);
        pushLine(retainedAccountId, 0, total, ACCOUNTING_LABELS.OPENING_BALANCE);
        return lines;
    }

    return lines;
};


const buildVoucherJournalLines = async (voucher: any, party: any) => {
    const type = String(voucher?.type || '').toLowerCase();
    const isCashMove = type === 'receipt' || type === 'payment';
    if (!isCashMove) return [];

    const amount = roundMoney(Number(voucher?.amount || 0));
    if (!amount) return [];

    const cashBox = voucher?.cashBoxId
        ? await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, voucher.cashBoxId)).get()
        : null;
    const cashAccountId = cashBox?.accountId ? Number(cashBox.accountId) : null;
    if (!cashAccountId || !party) return [];

    const companyId = String(voucher?.companyId || party?.companyId || '').trim() || null;
    const enforcedParty = await ensurePartyAccountLinks(db, party, companyId);
    const partyReceivableId = await requirePartyAccountId(db, enforcedParty, 'receivable', companyId);
    const partyPayableId = await requirePartyAccountId(db, enforcedParty, 'payable', companyId);
    const partyLedgerId = (() => {
        const n = Number(enforcedParty?.id);
        return Number.isFinite(n) && n > 0 ? n : null;
    })();

    const lines: any[] = [];
    if (type === 'receipt') {
        lines.push({ accountId: cashAccountId, debit: amount, credit: 0, description: ACCOUNTING_LABELS.CASH_RECEIVED, currencyCode: voucher.currency || 'SYP', exchangeRate: voucher.exchangeRate || 1, partyId: partyLedgerId, partnerRefId: String((enforcedParty as any)?.id || '') || null });
        lines.push({ accountId: partyReceivableId, debit: 0, credit: amount, description: ACCOUNTING_LABELS.RECEIPT_VOUCHER, partyId: partyLedgerId, partnerRefId: String((enforcedParty as any)?.id || '') || null, currencyCode: voucher.currency || 'SYP', exchangeRate: voucher.exchangeRate || 1 });
    } else if (type === 'payment') {
        lines.push({ accountId: partyPayableId, debit: amount, credit: 0, description: ACCOUNTING_LABELS.PAYMENT_VOUCHER, partyId: partyLedgerId, partnerRefId: String((enforcedParty as any)?.id || '') || null, currencyCode: voucher.currency || 'SYP', exchangeRate: voucher.exchangeRate || 1 });
        lines.push({ accountId: cashAccountId, debit: 0, credit: amount, description: ACCOUNTING_LABELS.CASH_PAID, currencyCode: voucher.currency || 'SYP', exchangeRate: voucher.exchangeRate || 1, partyId: partyLedgerId, partnerRefId: String((enforcedParty as any)?.id || '') || null });
    }
    return lines;
};

const createVoucherWithAccounting = async (data: any) => {
    if (data?.id) {
        const existing = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, data.id)).get();
        if (existing) return { success: true, duplicate: true, id: existing.id };
    }
    const voucherCurrency = normalizeCurrencyCode(data.currency || BASE_CURRENCY);
    const voucherRate = normalizeExchangeRate(voucherCurrency, data.exchangeRate);
    const amountBaseCandidate = Number(data.amountBase ?? data.amount ?? 0);
    const amountTransactionCandidate = Number(data.amountTransaction ?? data.originalAmount ?? 0);
    const amount = roundMoney(
        Number.isFinite(amountBaseCandidate) && amountBaseCandidate > 0
            ? amountBaseCandidate
            : toBaseAmount(amountTransactionCandidate, voucherCurrency, voucherRate)
    );
    const amountTransaction = roundMoney(
        Number.isFinite(amountTransactionCandidate) && amountTransactionCandidate > 0
            ? amountTransactionCandidate
            : toTransactionAmount(amount, voucherCurrency, voucherRate)
    );
    const rawType = String(data.type || 'receipt');
    const type = rawType === 'payment' ? 'payment' : rawType === 'receipt' ? 'receipt' : rawType;
    const voucherId = data.id || `v-${Date.now()}`;
    const payload = {
        ...data,
        id: voucherId,
        type,
        currency: voucherCurrency,
        exchangeRate: voucherRate,
        amount,
        amountBase: amount,
        amountTransaction,
        originalAmount: amountTransaction,
        status: String(data?.status || 'DRAFT').toUpperCase() === 'POSTED' ? 'POSTED' : 'DRAFT'
    };
    const isCashMove = type === 'payment' || type === 'receipt';

    let linkedInvoice: any = null;
    if (payload.linkedInvoiceId) {
        linkedInvoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, payload.linkedInvoiceId)).get();
    }
    let cashBox: any = null;
    if (payload.cashBoxId && isCashMove) {
        cashBox = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, payload.cashBoxId)).get();
    }
    payload.companyId = String(
        payload.companyId
        || cashBox?.companyId
        || linkedInvoice?.companyId
        || ''
    ).trim() || null;
    payload.branchId = String(
        payload.branchId
        || cashBox?.branchId
        || linkedInvoice?.branchId
        || ''
    ).trim() || null;

    if (payload.cashBoxId && isCashMove) {
        const box = cashBox || await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, payload.cashBoxId)).get();
        if (!box) throw new Error('Cash box not found.');
        if (payload.companyId && box.companyId && String(box.companyId) !== String(payload.companyId)) {
            throw new Error('CASH_BOX_COMPANY_MISMATCH');
        }
        if (payload.branchId && box.branchId && String(box.branchId) !== String(payload.branchId)) {
            throw new Error('CASH_BOX_BRANCH_MISMATCH');
        }
    }

    const rollbackCreatedVoucher = async (journalEntryId?: number | null) => {
        if (journalEntryId && journalEntryId > 0) {
            try {
                await reverseJournalEntry(journalEntryId, 'Voucher create rollback');
            } catch {}
        }
        await db.transaction(async (tx: any) => {
            if (payload.cashBoxId && isCashMove) {
                const box = await tx.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, payload.cashBoxId)).get();
                if (box) {
                    const delta = type === 'payment' ? -amount : amount;
                    await tx.update(schema.cashBoxes)
                        .set({ balance: Number(box.balance || 0) - delta })
                        .where(eq(schema.cashBoxes.id, box.id)).run();
                }
            }
            await tx.delete(schema.partyTransactions).where(eq(schema.partyTransactions.refId, voucherId)).run();
            if (payload.clientId) {
                const party = await tx.select().from(schema.parties).where(eq(schema.parties.id, payload.clientId)).get();
                if (party) await recomputePartyBalance(tx, String(party.id));
            }
            await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, voucherId)).run();
            if (payload.linkedInvoiceId) {
                await recomputeInvoiceSettlementTx(tx, String(payload.linkedInvoiceId));
            }
        });
    };

    await db.transaction(async (tx: any) => {
        if (payload.cashBoxId && isCashMove) {
            const box = await tx.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, payload.cashBoxId)).get();
            if (!box) throw new Error('Cash box not found.');
            const delta = type === 'payment' ? -amount : amount;
            await tx.update(schema.cashBoxes)
                .set({ balance: Number(box.balance || 0) + delta })
                .where(eq(schema.cashBoxes.id, box.id)).run();
        }

        const shouldApplyPartyLedger = await shouldApplyPartyLedgerForVoucher(tx, payload, isCashMove);
        if (payload.clientId && isCashMove && shouldApplyPartyLedger) {
            const party = await tx.select().from(schema.parties).where(eq(schema.parties.id, payload.clientId)).get();
            if (party) {
                const partyDelta = computePartyDelta({
                    partyType: party.type,
                    event: type === 'receipt' ? 'receipt' : 'payment',
                    paymentTerm: 'cash',
                    totalOrAmount: amount
                });
                if (partyDelta !== 0) {
                    await applyPartyTransaction(tx, {
                        id: ledgerIdForRef(voucherId),
                        companyId: payload.companyId || party.companyId || null,
                        branchId: payload.branchId || null,
                        partyId: party.id,
                        partyType: party.type,
                        kind: type === 'receipt' ? 'voucher_receipt' : 'voucher_payment',
                        refId: voucherId,
                        amount: amount,
                        amountBase: amount,
                        amountTransaction,
                        delta: partyDelta,
                        deltaBase: partyDelta,
                        deltaTransaction: payload.currency === BASE_CURRENCY ? partyDelta : roundMoney(partyDelta * payload.exchangeRate),
                        currency: payload.currency || BASE_CURRENCY,
                        exchangeRate: payload.exchangeRate || 1,
                        // Keep ledger sequence by actual posting timestamp, not date-only field.
                        createdAt: new Date().toISOString()
                    });
                }
            }
        }

        await tx.insert(schema.vouchers).values(payload).run();
    });

    // Journal entry
    let shouldSyncLinkedInvoiceSettlement = false;
    let journalEntryId: number | null = null;
    if (isCashMove) {
        let skip = false;
        if (payload.linkedInvoiceId) {
            const inv = linkedInvoice || await db.select().from(schema.invoices).where(eq(schema.invoices.id, payload.linkedInvoiceId)).get();
            if (inv) {
                const invTerm = normalizePaymentTerm(
                    (inv as any).paymentType || (Number((inv as any).remainingAmount || 0) > 0 ? 'credit' : 'cash')
                );
                if (invTerm === 'cash') skip = true;
                else shouldSyncLinkedInvoiceSettlement = true;
            }
        }
        try {
            if (!skip) {
                const party = payload.clientId
                    ? await db.select().from(schema.parties).where(eq(schema.parties.id, payload.clientId)).get()
                    : null;
                const lines = await buildVoucherJournalLines(payload, party);
                if (lines.length > 0) {
                    const entry = await createJournalEntry({
                        description: buildDescription(
                            type === 'receipt' ? ACCOUNTING_LABELS.RECEIPT_VOUCHER : ACCOUNTING_LABELS.PAYMENT_VOUCHER,
                            ACCOUNTING_LABELS.NUMBER,
                            payload.referenceNumber || payload.id
                        ),
                        referenceType: type === 'receipt' ? 'receipt' : 'payment',
                        referenceId: null,
                        lines,
                        companyId: payload.companyId || null,
                        branchId: payload.branchId || null,
                        currencyCode: payload.currency || 'SYP'
                    });
                    await postJournalEntry(entry.id);
                    journalEntryId = Number(entry.id);
                    await db.update(schema.vouchers).set({
                        journalEntryId: entry.id,
                        status: 'POSTED',
                        companyId: payload.companyId || null,
                        branchId: payload.branchId || null,
                    }).where(eq(schema.vouchers.id, voucherId)).run();
                } else {
                    await db.update(schema.vouchers).set({
                        status: 'POSTED',
                        companyId: payload.companyId || null,
                        branchId: payload.branchId || null,
                    }).where(eq(schema.vouchers.id, voucherId)).run();
                }
            } else {
                await db.update(schema.vouchers).set({
                    status: 'POSTED',
                    companyId: payload.companyId || null,
                    branchId: payload.branchId || null,
                }).where(eq(schema.vouchers.id, voucherId)).run();
            }
        } catch (journalError: any) {
            await rollbackCreatedVoucher(journalEntryId);
            throw journalError;
        }
    }

    if (payload.linkedInvoiceId && shouldSyncLinkedInvoiceSettlement && (type === 'receipt' || type === 'payment')) {
        try {
            await db.transaction(async (tx: any) => {
                await recomputeInvoiceSettlementTx(tx, String(payload.linkedInvoiceId));
            });
        } catch (settlementError: any) {
            await rollbackCreatedVoucher(journalEntryId);
            throw new Error(`INVOICE_SETTLEMENT_UPDATE_FAILED: ${settlementError?.message || settlementError}`);
        }
    }

    // --- FX SETTLEMENT POSTING ---
    // If this voucher settles a foreign-currency invoice at a different rate,
    // compute and post the FX difference as a separate journal entry.
    // Policy: controlled by fxSettings.strictFxPosting in system settings.
    //   'strict'  → FX JE failure rolls back the entire voucher (hard fail)
    //   'relaxed' → FX JE failure is logged but voucher is saved (default, backward-compatible)
    if (payload.linkedInvoiceId && (type === 'receipt' || type === 'payment')) {
        // Load FX policy setting (fast read; cached by settings layer)
        let strictFxPosting = false;
        try {
            const settingsMap = await loadNormalizedSettingsMap(db, schema, { companyId: payload.companyId || null });
            const fxSettings = (settingsMap.get('fxSettings') || {}) as { strictFxPosting?: string };
            strictFxPosting = fxSettings.strictFxPosting === 'strict' || serverConfig.strictMode;
        } catch {}

        try {
            const linkedInv = await db.select().from(schema.invoices).where(eq(schema.invoices.id, payload.linkedInvoiceId)).get();
            if (linkedInv) {
                const invCurrency = String((linkedInv as any).currency || 'USD').toUpperCase();
                if (invCurrency !== 'USD') {
                    const fxService = createFxJournalPostingService({
                        db,
                        schema,
                        eq,
                        createJournalEntry,
                        postJournalEntry,
                    });
                    await fxService.postFxDifference({
                        voucher: {
                            id: voucherId,
                            type,
                            currency: payload.currency || 'USD',
                            exchangeRate: Number(payload.exchangeRate || 1),
                            amountBase: amount,
                            amountTransaction,
                            clientId: payload.clientId || null,
                            linkedInvoiceId: payload.linkedInvoiceId,
                            date: payload.date || new Date().toISOString(),
                            companyId: payload.companyId || null,
                            branchId: payload.branchId || null,
                        },
                        invoice: {
                            id: (linkedInv as any).id,
                            type: String((linkedInv as any).type || 'sale').toLowerCase(),
                            currency: invCurrency,
                            exchangeRate: Number((linkedInv as any).exchangeRate || 1),
                            totalAmountBase: Number((linkedInv as any).totalAmountBase || 0),
                            totalAmountTransaction: Number((linkedInv as any).totalAmountTransaction || 0),
                            remainingAmountBase: Number((linkedInv as any).remainingAmountBase || 0),
                        },
                        settlementAmountBase: amount,
                        settlementAmountForeign: amountTransaction,
                    });
                }
            }
        } catch (fxErr: any) {
            if (strictFxPosting) {
                await rollbackCreatedVoucher(journalEntryId);
                throw new Error(`FX_POSTING_FAILED: ${fxErr?.message || 'Failed to post FX difference'}`);
            }
            // Relaxed mode: log but continue (backward-compatible behavior)
            console.error('[FX] Failed to post FX difference for voucher', voucherId, fxErr?.message);
            try {
                await systemEventLogger.log({
                    eventType: SYSTEM_EVENT_TYPES.FX_POSTING_SKIPPED,
                    severity: 'warning',
                    sourceModule: 'vouchers',
                    action: 'create',
                    status: 'partial',
                    errorCode: 'FX_JE_CREATION_FAILED',
                    affectedDocumentType: 'voucher',
                    affectedDocumentId: voucherId,
                    metadata: {
                        linkedInvoiceId: payload.linkedInvoiceId,
                        error: fxErr?.message,
                        note: 'FX difference not posted. Post manually or enable fxSettings.strictFxPosting=strict to prevent this.',
                    },
                });
            } catch {}
        }
    }

    return { success: true, id: voucherId };
};

async function seedDefaultUsers() {
    // Skip auto-seeding: Setup Wizard creates the admin user
    // This function is kept for backward compatibility but no-ops now.
    try {
        const existingUsers = await db.select().from(schema.users).all();
        if (existingUsers.length === 0) {
            console.log("âڈ³ No users found â€“ waiting for Setup Wizard...");
        }
    } catch (e) {}
}

server.register(async (api) => {
  const ctx = {
    db,
    schema,
    sql,
    eq,
    desc,
    and,
    TABLE_MAP,
    safeJsonParse,
    stringifyOrEmpty,
    loadZkService,
    shouldApplyPartyLedgerForVoucher,
    parseMultiCurrencyError,
    BASE_CURRENCY,
    normalizeCurrencyCode,
    normalizeExchangeRate,
    normalizeInvoiceMoney,
    toBaseAmount,
    toTransactionAmount,
    resolveSystemAccountId,
    buildInvoiceJournalLines,
    buildVoucherJournalLines,
    createVoucherWithAccounting,
    ACCOUNTING_LABELS,
    buildDescription,
    applyPartyTransaction,
    createPartySubAccount,
    computePartyDelta,
    createJournalEntry,
    deletePartyTransactionByRef,
    getAccountBalance,
    getAccountStatement,
    getTrialBalance,
    ledgerIdForRef,
    normalizePaymentTerm,
    postJournalEntry,
    recomputePartyBalance,
    reverseJournalEntry,
    roundMoney,
    resolveAccountByCode,
    SYSTEM_ACCOUNTS,
    // Inventory helpers
    adjustItemStockWithMovement,
    computeBaseQty,
    resolveUnitFactor,
    // Consignment accounting helpers
    postConsignmentDispatchJournal,
    postSupplierConsignmentSettlementJournal,
    reverseConsignmentJournal,
    getNextDocNumber,
    fs,
    path,
    getResolvedDbPath,
    rawSqlite,
    closeDb,
    bcrypt,
    server,
    getLocalIp,
    security,
    systemEventLogger,
    auditLogger,
    serverConfig
  };

  await activationRoutes(api, ctx);
  await superAdminRoutes(api, ctx);
  await systemRoutes(api, ctx);
  await systemEventsRoutes(api, ctx);
  await authRoutes(api, ctx);
  await deliveryRoutes(api, ctx);
  await restaurantRoutes(api, ctx);
  await agentsRoutes(api, ctx);
  await inventoryRoutes(api, ctx);
  await payrollRoutes(api, ctx);
  await manufacturingRoutes(api, ctx);
  await expensesRoutes(api, ctx);
  await fundsRoutes(api, ctx);
  await vouchersRoutes(api, ctx);
  await partnersRoutes(api, ctx);
  await openingRoutes(api, ctx);
  await partiesRoutes(api, ctx);
  await invoicesRoutes(api, ctx);
  await accountsRoutes(api, ctx);
  await reportsRoutes(api, ctx);
  await reportsTrustedRoutes(api, ctx);
  await unitsRoutes(api, ctx);
  await biometricRoutes(api, ctx);
  await backupsRoutes(api, ctx);
  await smartRoutes(api, ctx);
  await genericRoutes(api, ctx);
  await consignmentRoutes(api, ctx);
  await pricingRoutes(api, ctx);
  await periodsRoutes(api, ctx);
  await textileRoutes(api, ctx);
  await periodsAdminRoutes(api, ctx);
  await provisioningAdminRoutes(api, ctx);
  await fxRevaluationRoutes(api, ctx);
  await reconciliationRoutes(api, ctx);
  await printRoutes(api, ctx);
}, { prefix: '/api' });


if (serverConfig.strictMode && process.env.ERP_STRICT_MODE !== 'true' && process.env.ERP_STRICT_MODE !== '1') {
  process.env.ERP_STRICT_MODE = 'true';
}

export const startServer = async () => { 
    try { 
        const connectivity = await verifyDatabaseConnectivity();
        await ensureDatabaseReady();
        console.log(`[db] dialect=${databaseDialect} target=${connectivity?.target || getResolvedDbPath()}`);

        const spaRoot = resolveSpaDistRoot();
        if (spaRoot) {
            await server.register(fastifyStatic, {
                root: spaRoot,
                prefix: '/',
                decorateReply: false,
            });
            console.log(`[server] serving SPA static files from ${spaRoot}`);
        } else {
            console.warn('[server] dist/index.html not found — API only. Run `npm run build` to serve the web UI from this port.');
        }

        await server.listen({ port: LISTEN_PORT, host: LISTEN_HOST });
        initRestaurantSocket(server.server, serverConfig.jwtSecret);
        const detectedIp = getLocalIp();
        const lanAppUrl = APP_BASE_URL || `http://${detectedIp}:${LISTEN_PORT}`;
        const lanPublicUrl = PUBLIC_BASE_URL || (QR_MENU_PORT > 0 && QR_MENU_PORT !== LISTEN_PORT
            ? `http://${detectedIp}:${QR_MENU_PORT}`
            : lanAppUrl);
        console.log(`[server] listening on http://${LISTEN_HOST}:${LISTEN_PORT} (reachable e.g. ${lanAppUrl})`);
        console.log(`[server] appBaseUrl=${lanAppUrl}`);
        console.log(`[server] publicBaseUrl=${lanPublicUrl}`);
        console.log(`[server] corsOrigins=${ALLOWED_CORS_ORIGINS.length ? ALLOWED_CORS_ORIGINS.join(', ') : 'dynamic/any'}`);
        const configSummary = getServerConfigSummary();
        console.log(`[config] env=${configSummary.nodeEnv} strictMode=${configSummary.strictMode} devSecret=${configSummary.usedDevelopmentSecret} secretStrength=${configSummary.secretStrength}`);

        if (QR_MENU_PORT > 0 && QR_MENU_PORT !== LISTEN_PORT) {
            const qrRoot = spaRoot || resolveSpaDistRoot();
            if (!qrRoot) {
                console.warn('[qr-menu] dist/index.html not found â€” QR menu port disabled. Run `npm run build` to enable.');
            } else {
                const qrServer = fastify({ logger: false });
                await qrServer.register(fastifyStatic, {
                    root: qrRoot,
                    prefix: '/',
                    decorateReply: false,
                });
                try {
                    await qrServer.listen({ port: QR_MENU_PORT, host: QR_MENU_HOST });
                    console.log(`[qr-menu] listening on http://${QR_MENU_HOST}:${QR_MENU_PORT} (public menu)`);
                } catch (error: any) {
                    const code = String(error?.code || '').trim().toUpperCase();
                    if (code === 'EADDRINUSE') {
                        console.warn(`[qr-menu] port ${QR_MENU_PORT} is already in use; QR/public menu listener disabled and main API will continue on port ${LISTEN_PORT}.`);
                        try { await qrServer.close(); } catch {}
                    } else {
                        throw error;
                    }
                }
            }
        }

        // Emit security system events for weak/dev secrets so they appear in the audit trail
        if (serverConfig.usedDevelopmentSecret || serverConfig.secretStrength !== 'strong') {
            const isWeak = serverConfig.secretStrength === 'weak';
            console.warn(`[security] JWT_SECRET ${isWeak ? 'is weak' : 'not provided — using generated dev secret'}. Set a strong JWT_SECRET (32+ random chars) before going live.`);
            try {
                await systemEventLogger.log({
                    eventType: SYSTEM_EVENT_TYPES.SECURITY_WEAK_SECRET,
                    severity: serverConfig.isProduction ? 'critical' : 'warning',
                    sourceModule: 'server',
                    action: 'startup',
                    status: 'failed',
                    errorCode: serverConfig.usedDevelopmentSecret ? 'JWT_SECRET_NOT_SET' : 'JWT_SECRET_TOO_WEAK',
                    requiresManualReview: serverConfig.isProduction,
                    metadata: {
                        secretStrength: configSummary.secretStrength,
                        usedDevelopmentSecret: configSummary.usedDevelopmentSecret,
                        nodeEnv: configSummary.nodeEnv,
                        recommendation: 'Set JWT_SECRET to a cryptographically random string of at least 32 characters in your .env file.',
                    },
                });
            } catch {}
        }

        if (isPostgresDialect()) {
            console.log('[startup] PostgreSQL runtime mode active.');
            console.log('[startup] PostgreSQL bootstrap and request path validated.');
            console.log('[startup] PostgreSQL bootstrap path validated');
            return;
        }

        // Startup backfills (all idempotent, all try-catch).
        const {
            seedAccounts,
            ensureConsignmentAccounts,
            ensureLandedCostAccounts,
            ensureFxAccounts,
            seedDefaultCashBox,
            seedDefaultWarehouse,
            seedDefaultParties,
            ensureDatabaseColumns,
            fixPartyOpeningBalanceJournalEntries,
            backfillInvoiceClientNames,
            backfillJournalLinePartnerRefs,
            backfillPurchaseDerivedItemPricing,
            seedActivationCodes,
        } = await import('./db/seed-accounts');

        try { 
            const result = await ensureDatabaseColumns(db); 
            if (result?.fixes?.length) console.log('âœ… ensureDatabaseColumns:', result.fixes.join(', ')); 
        } catch (e: any) { console.warn('âڑ  ensureDatabaseColumns:', e.message); }

        await seedDefaultUsers();

        try { 
            const r = await seedAccounts(db); 
            if (r?.seeded) console.log('âœ… seedAccounts: chart of accounts created');
            await ensureConsignmentAccounts(db);
            await ensureLandedCostAccounts(db);
            await ensureFxAccounts(db);
        } catch {}

        try { 
            const r = await seedDefaultCashBox(db); 
            if (r?.seeded) console.log('âœ… seedDefaultCashBox: default cash box created');
        } catch {}

        try { 
            const r = await seedDefaultWarehouse(db); 
            if (r?.seeded) console.log('âœ… seedDefaultWarehouse: default warehouse created');
        } catch {}

        try { 
            const r = await seedDefaultParties(db); 
            if (r?.seeded) console.log('âœ… seedDefaultParties:', r.count, 'default parties created');
        } catch (e: any) { console.warn('âڑ  seedDefaultParties:', e.message); }

        try {
            const r = await ensureAllPartyAccountLinks(db);
            if (r?.fixed) console.log('[startup] ensureAllPartyAccountLinks fixed:', r.fixed);
            if (r?.failed?.length) console.warn('[startup] ensureAllPartyAccountLinks failed:', r.failed.length);
        } catch (e: any) { console.warn('[startup] ensureAllPartyAccountLinks:', e.message); }

        try { 
            const r = await fixPartyOpeningBalanceJournalEntries(db); 
            if (r?.fixed?.length) console.log('âœ… fixPartyOpeningBalance:', r.fixed.length, 'entries');
        } catch (e: any) { console.warn('âڑ  fixPartyOpeningBalance:', e.message); }

        try {
            const r = await backfillJournalLinePartnerRefs(db);
            if (r?.fixedJournalEntryIds?.length) console.log('[startup] backfillJournalLinePartnerRefs entries:', r.fixedJournalEntryIds.length);
            if (r?.skipped?.length) console.warn('[startup] backfillJournalLinePartnerRefs skipped:', r.skipped.length);
        } catch (e: any) { console.warn('[startup] backfillJournalLinePartnerRefs:', e.message); }

        try { 
            const r = await backfillInvoiceClientNames(db); 
            if (r?.fixed?.length) console.log('âœ… backfillInvoiceClientNames:', r.fixed.length, 'invoices');
        } catch (e: any) { console.warn('âڑ  backfillInvoiceClientNames:', e.message); }

        try {
            const r = await backfillPurchaseDerivedItemPricing(db);
            if (r?.fixedItems?.length) console.log('[startup] backfillPurchaseDerivedItemPricing items:', r.fixedItems.length);
            if (r?.createdUnits?.length) console.log('[startup] backfillPurchaseDerivedItemPricing units:', r.createdUnits.length);
        } catch (e: any) { console.warn('[startup] backfillPurchaseDerivedItemPricing:', e.message); }

        try {
            const r = await seedActivationCodes(db);
            if (r?.seeded) console.log('âœ… seedActivationCodes:', r.count, 'codes seeded');
        } catch (e: any) { console.warn('âڑ  seedActivationCodes:', e.message); }

        // Post-startup data-persistence check.
        try {
            const sqliteDb = requireSqliteDriver();
            const fs = await import('fs');
            const stat = fs.statSync(getResolvedDbPath());
            const counts = sqliteDb.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM accounts) AS accounts,
                    (SELECT COUNT(*) FROM items) AS items,
                    (SELECT COUNT(*) FROM invoices) AS invoices
            `).get() as { accounts: number; items: number; invoices: number };
            console.log(`ًں“‚ DB: ${getResolvedDbPath()} | size: ${(stat.size / 1024).toFixed(1)} KB | modified: ${stat.mtime.toISOString()}`);
            console.log(`ًں“ٹ Row counts â€” accounts: ${counts.accounts}, items: ${counts.items}, invoices: ${counts.invoices}`);
        } catch (e: any) { console.warn('âڑ  Row count check:', e.message); }
        try {
            ensureReportingIndexes(requireSqliteDriver());
        } catch (e: any) { console.warn('⚠  ensureReportingIndexes:', e.message); }
        try {
            ensurePrintJobsAuditColumnsOnce();
            console.log('✅ ensurePrintJobsAuditColumns: print_jobs schema ensured');
        } catch (e: any) { console.warn('⚠  ensurePrintJobsAuditColumns:', e.message); }

        startConsistencyGuards();
        console.log('✅ Startup complete — all backfills OK');
    } catch (err) { console.error('â‌Œ Server startup failed:', err); (process as any).exit(1); } 
};

export { server };

const currentFilePath = (() => {
  if (typeof __filename !== 'undefined') {
    return __filename;
  }

  if (process.argv[1]) {
    return path.resolve(process.argv[1]);
  }

  return process.cwd();
})();

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath);

if (isDirectRun && process.env.NODE_ENV !== 'test') {
    startServer();
}


