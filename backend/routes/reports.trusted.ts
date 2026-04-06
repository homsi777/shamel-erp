/**
 * TRUSTED REPORTS ROUTES
 *
 * All endpoints in this file use the canonical reporting engine.
 * Sources of truth:
 *   - journal_entry_lines (posted only)  → accounting reports
 *   - inventory_movements                → inventory reports
 *   - party_transactions                 → party AR/AP reports
 *
 * Rules enforced:
 *   - Auth-scoped company/branch on every query
 *   - No cross-company data
 *   - Posted-only accounting data
 *   - Drift warnings logged if detected
 */

import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { appError } from '../lib/errors';
import {
  buildTrialBalance,
  buildGeneralLedger,
  buildPartyLedger,
  buildAgedBalances,
  buildStockBalance,
  buildStockMovements,
  buildInventoryValuation,
  detectReportingDrift,
  type ReportScope,
  type DateRange,
} from '../services/reportingEngine';
import {
  analyzePartnerSettlementConsistency,
  buildPartnerAccountingComparison,
  buildPartnerAccountingLedgerPreview,
  buildPartnerTransitionAudit,
} from '../services/partnerAccountingView';
import { buildPartnerPilotLedger, buildPartnerPilotMetrics } from '../services/partnerPilotService';
import { getAccountLogicalCode } from '../accountingService';
import { roundMoney } from '../accountingService';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, rawSqlite, schema } = ctx as any;
  const reportDb = rawSqlite || db;

  // ─── Scope helper ────────────────────────────────────────────────────────

  function getScope(req: any): ReportScope {
    const auth = (req as any).authContext || {};
    const companyId = String(auth.companyId || '').trim();
    if (!companyId) {
      throw appError(403, 'REPORT_SCOPE_REQUIRED', 'Company context is required for all reports.');
    }
    const q = req.query as any;
    const requestedBranch = String(q?.branchId || '').trim();
    const authBranch = String(auth.branchId || '').trim();

    // Branch: use requested if explicitly provided and user has access, else auth branch
    let branchId: string | null = null;
    if (requestedBranch && requestedBranch !== 'all') {
      // Validate branch access
      const allowedBranches: string[] = Array.isArray(auth.allowedBranches)
        ? auth.allowedBranches.map(String)
        : authBranch ? [authBranch] : [];
      if (allowedBranches.length > 0 && !allowedBranches.includes(requestedBranch)) {
        throw appError(403, 'BRANCH_ACCESS_DENIED', 'You do not have access to this branch.');
      }
      branchId = requestedBranch;
    }
    return { companyId, branchId: branchId || null };
  }

  function getDateRange(req: any, defaultFrom = '2000-01-01', defaultTo = '2100-12-31'): DateRange {
    const q = req.query as any;
    return {
      from: String(q?.from || q?.fromDate || defaultFrom).slice(0, 10),
      to:   String(q?.to   || q?.toDate   || defaultTo  ).slice(0, 10),
    };
  }

  function assertAdmin(req: any) {
    const auth = (req as any).authContext || {};
    const role = String(auth.role || '').toLowerCase();
    if (role !== 'admin') {
      throw appError(403, 'ADMIN_REQUIRED', 'This transition audit endpoint is available to admin users only.');
    }
  }

  function toCsv(rows: Array<Record<string, unknown>>) {
    if (!rows.length) return '';
    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const escapeCell = (value: unknown) => {
      const raw = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
      const escaped = String(raw).replace(/"/g, '""');
      return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
    };
    const body = rows.map((row) => headers.map((header) => escapeCell(row[header])).join(','));
    return [headers.join(','), ...body].join('\n');
  }

  // ─── PHASE 2A: Trial Balance ─────────────────────────────────────────────

  /**
   * GET /reports/v2/trial-balance
   * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=optional
   *
   * Returns aggregated debit/credit/balance per account.
   * Source: journal_entry_lines + journal_entries (posted only).
   */
  api.get('/reports/v2/trial-balance', async (req) => {
    const scope = getScope(req);
    const range = getDateRange(req);
    const lines = buildTrialBalance(reportDb, scope, range, getAccountLogicalCode);
    const totalDebit  = roundMoney(lines.reduce((s, l) => s + l.debit,  0));
    const totalCredit = roundMoney(lines.reduce((s, l) => s + l.credit, 0));
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      lines,
      totals: {
        debit:  totalDebit,
        credit: totalCredit,
        diff:   roundMoney(totalDebit - totalCredit),
      },
      meta: { source: 'journal_entry_lines', filter: 'posted_only' },
    };
  });

  // ─── PHASE 2B: General Ledger ────────────────────────────────────────────

  /**
   * GET /reports/v2/general-ledger/:accountId
   * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=optional
   *
   * Returns account detail with opening balance and running balance per line.
   * Source: journal_entry_lines (posted only).
   */
  api.get('/reports/v2/general-ledger/:accountId', async (req) => {
    const { accountId } = req.params as any;
    const accId = parseInt(String(accountId || ''), 10);
    if (!accId || isNaN(accId)) {
      throw appError(400, 'INVALID_ACCOUNT_ID', 'accountId must be a valid integer.');
    }
    const scope = getScope(req);
    const range = getDateRange(req);
    const report = buildGeneralLedger(reportDb, scope, accId, range);
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      ...report,
      meta: { source: 'journal_entry_lines', filter: 'posted_only' },
    };
  });

  // ─── PHASE 2C: Party Ledger ──────────────────────────────────────────────

  /**
   * GET /reports/v2/party-ledger/:partyId
   * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=optional
   *
   * Returns party transaction history with running balance.
   * Source: party_transactions only.
   */
  api.get('/reports/v2/party-ledger/:partyId', async (req) => {
    const { partyId } = req.params as any;
    if (!partyId) {
      throw appError(400, 'INVALID_PARTY_ID', 'partyId is required.');
    }
    const scope = getScope(req);
    const range = getDateRange(req);
    const report = buildPartyLedger(reportDb, scope, String(partyId), range);
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      ...report,
      meta: { source: 'party_transactions' },
    };
  });

  // ─── PHASE 2C (list): All Parties Ledger Summary ────────────────────────

  /**
   * GET /reports/v2/party-ledger
   * Query: ?partyType=CUSTOMER|SUPPLIER|BOTH&from=...&to=...&branchId=optional
   *
   * Returns ledger summary for all matching parties.
   * Source: party_transactions only.
   */
  api.get('/reports/v2/internal/partner-accounting/compare', async (req) => {
    const scope = getScope(req);
    const q = req.query as any;
    const range = getDateRange(req);
    const report = await buildPartnerAccountingComparison(scope, {
      partyId: q?.partyId ? String(q.partyId) : undefined,
      limit: q?.limit ? Number(q.limit) : undefined,
      range,
    });
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      ...report,
      meta: {
        internal: true,
        preview: true,
        note: 'Bridge report only. Existing partner APIs still use party_transactions as canonical ledger.',
      },
    };
  });

  api.get('/reports/v2/internal/partner-accounting-ledger/:partyId', async (req) => {
    const scope = getScope(req);
    const range = getDateRange(req);
    const { partyId } = req.params as any;
    if (!partyId) {
      throw appError(400, 'INVALID_PARTY_ID', 'partyId is required.');
    }
    const report = await buildPartnerAccountingLedgerPreview(scope, String(partyId), range);
    if (!report) {
      throw appError(404, 'PARTY_NOT_FOUND', 'Party not found.');
    }
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      ...report,
      meta: {
        internal: true,
        preview: true,
        note: 'Accounting-view preview derived from posted journal entry lines on partner subaccounts.',
      },
    };
  });

  api.get('/reports/v2/internal/partner-settlement-consistency', async (req) => {
    const scope = getScope(req);
    const q = req.query as any;
    const range = getDateRange(req);
    const report = await analyzePartnerSettlementConsistency(scope, {
      partyId: q?.partyId ? String(q.partyId) : undefined,
      limit: q?.limit ? Number(q.limit) : undefined,
      range,
    });
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      ...report,
      meta: {
        internal: true,
        preview: true,
        note: 'Diagnostic report only. It does not change invoice or voucher behavior.',
      },
    };
  });

  api.get('/reports/v2/internal/partner-transition-audit', async (req, reply) => {
    assertAdmin(req);
    const scope = getScope(req);
    const q = req.query as any;
    const range = getDateRange(req);
    const report = await buildPartnerTransitionAudit(scope, range, {
      partyId: q?.partyId ? String(q.partyId) : undefined,
      limit: q?.limit ? Number(q.limit) : undefined,
    });
    const format = String(q?.format || 'json').trim().toLowerCase();
      if (format === 'csv') {
        const csv = toCsv(report.rows.map((row: any) => ({
          partyId: row.partyId,
          partyName: row.partyName,
          partyType: row.partyType,
          activeInRange: row.activeInRange ? 'yes' : 'no',
          journalLineCountInRange: row.activity.journalLineCountInRange,
          settlementDocumentCountInRange: row.activity.settlementDocumentCountInRange,
          coverageLevel: row.coverage.level,
          candidateScopedLineCount: row.coverage.candidateScopedLineCount,
          textPartnerLinkedLineCount: row.coverage.textPartnerLinkedLineCount,
          candidateRangedLineCount: row.coverage.candidateRangedLineCount,
          textPartnerLinkedRangedLineCount: row.coverage.textPartnerLinkedRangedLineCount,
          operationalBalance: row.balances.operational,
          accountingTextLinkedBalance: row.balances.accountingTextLinked,
          delta: row.balances.delta,
          settlementMismatchCount: row.settlementMismatchCount,
          settlementMismatchReasons: row.settlementMismatchReasons.join(' | '),
          safeToAutoLinkGaps: row.historicalGaps.safe_to_auto_link,
          needsManualReviewGaps: row.historicalGaps.needs_manual_review,
          cannotInferSafelyGaps: row.historicalGaps.cannot_infer_safely,
          blockingReasons: row.blockingReasons.join(' | '),
          mismatchClassification: row.mismatchClassification.join(' | '),
          readyForShadowTrust: row.readyForShadowTrust ? 'yes' : 'no',
        })));
      reply.header('content-type', 'text/csv; charset=utf-8');
      return csv;
    }
      return {
        scope: { companyId: scope.companyId, branchId: scope.branchId },
        ...report,
        meta: {
          internal: true,
          preview: true,
          shadowMode: true,
          note: 'Transition audit only for active partners with in-range activity. Canonical partner source remains party_transactions.',
        },
      };
    });

  api.get('/reports/v2/internal/partner-pilot-ledger/:partyId', async (req) => {
    const scope = getScope(req);
    const range = getDateRange(req);
    const { partyId } = req.params as any;
    if (!partyId) {
      throw appError(400, 'INVALID_PARTY_ID', 'partyId is required.');
    }
    const report = await buildPartnerPilotLedger(reportDb, scope, String(partyId), range);
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      ...report,
      meta: {
        internal: true,
        preview: true,
        pilotMode: true,
        note: 'Pilot ledger view uses accounting-derived balance only for ready shadow-trust partners and falls back automatically on drift.',
      },
    };
  });

  api.get('/reports/v2/internal/partner-pilot-metrics', async (req) => {
    assertAdmin(req);
    const scope = getScope(req);
    const range = getDateRange(req);
    const report = await buildPartnerPilotMetrics(db, schema, scope, range);
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      ...report,
      meta: {
        internal: true,
        preview: true,
        pilotMode: true,
        note: 'Pilot metrics summarize real partner-pilot operations from system events and keep immediate fallback active on any detected drift.',
      },
    };
  });

  api.get('/reports/v2/party-ledger', async (req) => {
    const scope = getScope(req);
    const range = getDateRange(req);
    const q = req.query as any;
    const partyType = String(q?.partyType || 'all').toUpperCase();

    let typeClause = '';
    const typeParams: any[] = [];
    if (partyType === 'CUSTOMER') {
      typeClause = "AND type IN ('CUSTOMER', 'BOTH')";
    } else if (partyType === 'SUPPLIER') {
      typeClause = "AND type IN ('SUPPLIER', 'BOTH')";
    }

    const parties: Array<{ id: string }> = db.prepare(`
      SELECT id FROM parties
      WHERE company_id = ? ${typeClause} AND (is_active IS NULL OR is_active = 1)
    `).all(scope.companyId, ...typeParams);

    const results = parties.map((p) => {
      try {
        const report = buildPartyLedger(reportDb, scope, p.id, range);
        return {
          partyId:        report.partyId,
          partyName:      report.partyName,
          partyType:      report.partyType,
          openingBalance: report.openingBalance,
          totalDebit:     report.totalDebit,
          totalCredit:    report.totalCredit,
          closingBalance: report.closingBalance,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    const grandDebit  = roundMoney(results.reduce((s, r: any) => s + (r?.totalDebit  || 0), 0));
    const grandCredit = roundMoney(results.reduce((s, r: any) => s + (r?.totalCredit || 0), 0));

    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      parties: results,
      totals: {
        debit:  grandDebit,
        credit: grandCredit,
        balance: roundMoney(grandDebit - grandCredit),
      },
      meta: { source: 'party_transactions' },
    };
  });

  // ─── PHASE 2D: Aged Receivables ──────────────────────────────────────────

  /**
   * GET /reports/v2/aged-receivables
   * Query: ?asOfDate=YYYY-MM-DD&branchId=optional
   *
   * Returns aged AR bucketed: 0-30, 31-60, 61-90, 90+.
   * Source: invoices (remaining_amount_base > 0, type=sale).
   */
  api.get('/reports/v2/aged-receivables', async (req) => {
    const scope = getScope(req);
    const q = req.query as any;
    const asOfDate = String(q?.asOfDate || q?.asOf || new Date().toISOString().split('T')[0]).slice(0, 10);
    const lines = buildAgedBalances(reportDb, scope, 'CUSTOMER', asOfDate);
    const totals = lines.reduce(
      (acc, l) => ({
        current:    roundMoney(acc.current    + l.buckets.current),
        days31_60:  roundMoney(acc.days31_60  + l.buckets.days31_60),
        days61_90:  roundMoney(acc.days61_90  + l.buckets.days61_90),
        days91plus: roundMoney(acc.days91plus + l.buckets.days91plus),
        total:      roundMoney(acc.total      + l.buckets.total),
      }),
      { current: 0, days31_60: 0, days61_90: 0, days91plus: 0, total: 0 }
    );
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      asOfDate,
      lines,
      totals,
      meta: { source: 'invoices.remaining_amount_base', type: 'CUSTOMER' },
    };
  });

  // ─── PHASE 2D: Aged Payables ─────────────────────────────────────────────

  /**
   * GET /reports/v2/aged-payables
   * Query: ?asOfDate=YYYY-MM-DD&branchId=optional
   *
   * Returns aged AP bucketed: 0-30, 31-60, 61-90, 90+.
   * Source: invoices (remaining_amount_base > 0, type=purchase).
   */
  api.get('/reports/v2/aged-payables', async (req) => {
    const scope = getScope(req);
    const q = req.query as any;
    const asOfDate = String(q?.asOfDate || q?.asOf || new Date().toISOString().split('T')[0]).slice(0, 10);
    const lines = buildAgedBalances(reportDb, scope, 'SUPPLIER', asOfDate);
    const totals = lines.reduce(
      (acc, l) => ({
        current:    roundMoney(acc.current    + l.buckets.current),
        days31_60:  roundMoney(acc.days31_60  + l.buckets.days31_60),
        days61_90:  roundMoney(acc.days61_90  + l.buckets.days61_90),
        days91plus: roundMoney(acc.days91plus + l.buckets.days91plus),
        total:      roundMoney(acc.total      + l.buckets.total),
      }),
      { current: 0, days31_60: 0, days61_90: 0, days91plus: 0, total: 0 }
    );
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      asOfDate,
      lines,
      totals,
      meta: { source: 'invoices.remaining_amount_base', type: 'SUPPLIER' },
    };
  });

  // ─── PHASE 3A: Stock Balance ─────────────────────────────────────────────

  /**
   * GET /reports/v2/stock-balance
   * Query: ?warehouseId=optional&itemId=optional&branchId=optional
   *
   * Returns stock balance per item per warehouse.
   * Source: inventory_movements only (NOT items.quantity).
   */
  api.get('/reports/v2/stock-balance', async (req) => {
    const scope = getScope(req);
    const q = req.query as any;
    const warehouseId = String(q?.warehouseId || '').trim() || null;
    const itemId      = String(q?.itemId      || '').trim() || null;
    const lines = buildStockBalance(reportDb, scope, warehouseId, itemId);
    const totalQty   = roundMoney(lines.reduce((s, l) => s + l.netQty, 0));
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      lines,
      totals: { items: lines.length, netQty: totalQty },
      meta: { source: 'inventory_movements', note: 'items.quantity is NOT used' },
    };
  });

  // ─── PHASE 3B: Stock Movement Report ────────────────────────────────────

  /**
   * GET /reports/v2/stock-movements/:itemId
   * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&warehouseId=optional&branchId=optional
   *
   * Returns full movement history for an item with running quantity.
   * Source: inventory_movements only.
   */
  api.get('/reports/v2/stock-movements/:itemId', async (req) => {
    const { itemId } = req.params as any;
    if (!itemId) {
      throw appError(400, 'INVALID_ITEM_ID', 'itemId is required.');
    }
    const scope = getScope(req);
    const range = getDateRange(req);
    const q = req.query as any;
    const warehouseId = String(q?.warehouseId || '').trim() || null;
    const report = buildStockMovements(reportDb, scope, String(itemId), range, warehouseId);
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      range,
      ...report,
      meta: { source: 'inventory_movements' },
    };
  });

  // ─── PHASE 3C: Inventory Valuation ──────────────────────────────────────

  /**
   * GET /reports/v2/inventory-valuation
   * Query: ?warehouseId=optional&branchId=optional
   *
   * Returns qty (from movements) × cost (from items.costPrice) per item.
   * Source: inventory_movements for qty, items.cost_price_base for cost.
   */
  api.get('/reports/v2/inventory-valuation', async (req) => {
    const scope = getScope(req);
    const q = req.query as any;
    const warehouseId = String(q?.warehouseId || '').trim() || null;
    const lines = buildInventoryValuation(reportDb, scope, warehouseId);
    const totalValue = roundMoney(lines.reduce((s, l) => s + l.totalValue, 0));
    const totalQty   = roundMoney(lines.reduce((s, l) => s + l.netQty, 0));
    return {
      scope: { companyId: scope.companyId, branchId: scope.branchId },
      lines,
      totals: { items: lines.length, netQty: totalQty, totalValue },
      meta: {
        source:    'inventory_movements + items.cost_price_base',
        costBasis: 'last_known_cost',
        note:      'items.quantity is NOT used for quantity calculation',
      },
    };
  });

  // ─── PHASE 4: Drift Detection ────────────────────────────────────────────

  /**
   * GET /reports/v2/drift-check
   * Query: ?checkStock=true&checkParty=true&limit=50
   *
   * Detects drift between canonical sources and snapshot fields.
   * Admin-only endpoint.
   */
  api.get('/reports/v2/drift-check', async (req) => {
    const auth = (req as any).authContext || {};
    const role = String(auth.role || '').toLowerCase();
    if (role !== 'admin') {
      throw appError(403, 'ADMIN_REQUIRED', 'Drift check is available to admin users only.');
    }

    const scope = getScope(req);
    const q = req.query as any;
    const checkStock  = q?.checkStock  !== 'false';
    const checkParty  = q?.checkParty  !== 'false';
    const limit       = Math.min(Number(q?.limit || 50), 200);

    const warnings = detectReportingDrift(reportDb, scope, { checkStock, checkParty, limit });

    if (warnings.length > 0) {
      console.warn(`[DriftCheck] company=${scope.companyId} found ${warnings.length} drift warnings`);
    }

    return {
      scope: { companyId: scope.companyId },
      driftCount: warnings.length,
      warnings,
      checked: { stock: checkStock, party: checkParty },
      recommendation: warnings.length > 0
        ? 'Review warnings and consider running consistency repair scripts.'
        : 'No drift detected. Canonical sources match snapshot fields.',
    };
  });
}
