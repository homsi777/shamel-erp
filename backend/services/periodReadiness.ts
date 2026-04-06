/**
 * Period Readiness & Operational Diagnostics Engine — Shamel ERP
 *
 * Provides:
 *   1. Close Readiness Summary     — full pre-close audit for month-end/year-end
 *   2. Period Diagnostics          — deep inspection of a period's financial state
 *   3. Inventory Drift Diagnostics — items.quantity vs inventory_movements
 *   4. Party Balance Drift         — parties.balance vs party_transactions
 *   5. Missing Journal Link        — invoices/vouchers posted but missing JE
 *   6. Failed Compensation         — documents where compensation/rollback may have failed
 *   7. Year-End Readiness          — checks specific to fiscal-year close
 *   8. Duplicate Carry-Forward     — detects if carry_forward JE already exists for a period pair
 *
 * Design rules:
 *   - All reads are READ-ONLY; this service never mutates data
 *   - All queries scoped to companyId (required); branchId optional
 *   - Drift warnings are returned explicitly; callers decide severity
 *   - Full table scan avoided where possible via prepared queries
 */

import { roundMoney } from '../accountingService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiagnosticsScope {
  companyId: string;
  branchId?: string | null;
}

export interface CloseReadinessSummary {
  periodId: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  ready: boolean;

  hardBlockers: BlockerItem[];
  warnings: WarningItem[];

  stats: {
    draftVouchers: number;
    draftJournalEntries: number;
    unpostedInvoices: number;
    openInvoices: number;
    totalPostedJournalEntries: number;
    totalRevenue: number;
    totalExpenses: number;
    netPnl: number;
    hasRetainedEarningsAccount: boolean;
    backdatedPostingAfterPeriodEnd: number;
    consecutivePreviousPeriodsOpen: string[];
  };
}

export interface BlockerItem {
  code: string;
  message: string;
  count?: number;
  details?: any;
}

export interface WarningItem {
  code: string;
  message: string;
  count?: number;
  details?: any;
}

export interface YearEndReadiness {
  ready: boolean;
  periodId: string;
  periodName: string;
  isYearPeriod: boolean;
  allMonthsClosed: boolean;
  unclosedMonths: string[];
  plSweepRequired: boolean;
  retainedEarningsAccountExists: boolean;
  carryForwardAlreadyExists: boolean;
  carryForwardJournalEntryId: number | null;
  hardBlockers: BlockerItem[];
  warnings: WarningItem[];
}

export interface InventoryDriftItem {
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string | null;
  snapshotQty: number;
  computedQty: number;
  drift: number;
  driftPct: number;
}

export interface InventoryDriftReport {
  checkedAt: string;
  companyId: string;
  branchId: string | null;
  totalItems: number;
  driftedItems: number;
  totalDrift: number;
  items: InventoryDriftItem[];
}

export interface PartyBalanceDriftItem {
  partyId: string;
  partyName: string;
  partyType: string;
  snapshotBalance: number;
  computedBalance: number;
  drift: number;
}

export interface PartyBalanceDriftReport {
  checkedAt: string;
  companyId: string;
  branchId: string | null;
  totalParties: number;
  driftedParties: number;
  totalDrift: number;
  parties: PartyBalanceDriftItem[];
}

export interface MissingJournalLinkItem {
  documentType: string;
  documentId: string;
  documentRef: string;
  documentDate: string;
  issue: string;
}

export interface MissingJournalLinkReport {
  checkedAt: string;
  companyId: string;
  branchId: string | null;
  totalIssues: number;
  items: MissingJournalLinkItem[];
}

export interface FailedCompensationItem {
  documentType: string;
  documentId: string;
  status: string;
  issue: string;
  documentDate: string;
}

export interface FailedCompensationReport {
  checkedAt: string;
  companyId: string;
  branchId: string | null;
  totalIssues: number;
  items: FailedCompensationItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertScope(scope: DiagnosticsScope): void {
  if (!scope.companyId || !String(scope.companyId).trim()) {
    throw Object.assign(new Error('SCOPE_REQUIRED'), { statusCode: 403, code: 'SCOPE_REQUIRED' });
  }
}

/**
 * Returns a parameterized WHERE fragment for an optional branch filter.
 * Usage:
 *   const { clause, params } = branchParam(branchId, 'v');
 *   db.prepare(`SELECT ... WHERE ... ${clause}`).all(...baseParams, ...params)
 */
function branchParam(
  branchId: string | null | undefined,
  alias = '',
): { clause: string; params: any[] } {
  if (!branchId) return { clause: '', params: [] };
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return { clause: `AND ${col} = ?`, params: [branchId] };
}

// ─── 1. Close Readiness Summary ───────────────────────────────────────────────

export function buildCloseReadinessSummary(
  db: any,
  scope: DiagnosticsScope,
  periodId: string,
): CloseReadinessSummary {
  assertScope(scope);

  const { companyId, branchId } = scope;

  // Load period
  const period = db.prepare(
    `SELECT * FROM fiscal_periods WHERE id = ? AND company_id = ?`
  ).get(periodId, companyId);

  if (!period) {
    throw Object.assign(new Error('PERIOD_NOT_FOUND'), { statusCode: 404, code: 'PERIOD_NOT_FOUND' });
  }

  const startDate = String(period.start_date || period.startDate || '').slice(0, 10);
  const endDate   = String(period.end_date   || period.endDate   || '').slice(0, 10);
  const vBranch  = branchParam(branchId, 'v');
  const jeBranch = branchParam(branchId, 'je');

  const hardBlockers: BlockerItem[] = [];
  const warnings: WarningItem[] = [];

  // Hard blocker: already closed
  if (period.status === 'closed') {
    hardBlockers.push({ code: 'PERIOD_ALREADY_CLOSED', message: 'الفترة مغلقة مسبقاً.' });
  }

  // Hard blocker: in "closing" state (concurrent close in progress)
  if (period.status === 'closing') {
    hardBlockers.push({ code: 'PERIOD_CLOSING_IN_PROGRESS', message: 'عملية الإقفال جارية حالياً — لا يمكن البدء بإقفال آخر.' });
  }

  // Hard blocker: draft vouchers
  const draftVouchersRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM vouchers v
    WHERE v.company_id = ?
      AND SUBSTR(v.date, 1, 10) >= ?
      AND SUBSTR(v.date, 1, 10) <= ?
      AND UPPER(COALESCE(v.status, 'DRAFT')) = 'DRAFT'
      ${vBranch.clause}
  `).get(companyId, startDate, endDate, ...vBranch.params);
  const draftVouchers = Number(draftVouchersRow?.cnt || 0);
  if (draftVouchers > 0) {
    hardBlockers.push({
      code: 'DRAFT_VOUCHERS_EXIST',
      message: `يوجد ${draftVouchers} سند غير مرحّل ضمن الفترة — يجب ترحيل أو حذف جميع السندات.`,
      count: draftVouchers,
    });
  }

  // Hard blocker: draft journal entries
  const draftJeRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM journal_entries je
    WHERE je.company_id = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      AND je.status = 'draft'
      ${jeBranch.clause}
  `).get(companyId, startDate, endDate, ...jeBranch.params);
  const draftJEs = Number(draftJeRow?.cnt || 0);
  if (draftJEs > 0) {
    hardBlockers.push({
      code: 'DRAFT_JOURNAL_ENTRIES_EXIST',
      message: `يوجد ${draftJEs} قيد يومية غير مرحّل ضمن الفترة — يجب ترحيل جميع القيود.`,
      count: draftJEs,
    });
  }

  // Hard blocker: unposted invoices within period
  const unpostedInvRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM invoices
    WHERE company_id = ?
      AND SUBSTR(date, 1, 10) >= ?
      AND SUBSTR(date, 1, 10) <= ?
      AND status = 'draft'
  `).get(companyId, startDate, endDate);
  const unpostedInvoices = Number(unpostedInvRow?.cnt || 0);
  if (unpostedInvoices > 0) {
    hardBlockers.push({
      code: 'UNPOSTED_INVOICES_EXIST',
      message: `يوجد ${unpostedInvoices} فاتورة بحالة مسودة — يجب ترحيل أو حذف الفواتير قبل الإقفال.`,
      count: unpostedInvoices,
    });
  }

  // Warning: backdated postings — JEs dated within the period but created after its end date
  const backdatedRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM journal_entries je
    WHERE je.company_id = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      AND je.status = 'posted'
      AND SUBSTR(je.created_at, 1, 10) > ?
      ${jeBranch.clause}
  `).get(companyId, startDate, endDate, endDate, ...jeBranch.params);
  const backdated = Number(backdatedRow?.cnt || 0);
  if (backdated > 0) {
    warnings.push({
      code: 'BACKDATED_POSTINGS_DETECTED',
      message: `يوجد ${backdated} قيد محاسبي مرحّل بعد تاريخ نهاية الفترة — تحقق من صحة التواريخ.`,
      count: backdated,
    });
  }

  // Warning: open invoices (partially or fully unsettled)
  const openInvRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM invoices
    WHERE company_id = ?
      AND SUBSTR(date, 1, 10) >= ?
      AND SUBSTR(date, 1, 10) <= ?
      AND status = 'posted'
      AND COALESCE(remaining_amount_base, remaining_amount, 0) > 0.01
  `).get(companyId, startDate, endDate);
  const openInvoices = Number(openInvRow?.cnt || 0);
  if (openInvoices > 0) {
    warnings.push({
      code: 'OPEN_INVOICES_EXIST',
      message: `يوجد ${openInvoices} فاتورة غير مسددة بالكامل — يُنصح بمراجعة الذمم قبل الإقفال.`,
      count: openInvoices,
    });
  }

  // Warning: check for previous consecutive open periods that should be closed first
  const allPeriods: any[] = db.prepare(`
    SELECT id, name, start_date, end_date, status
    FROM fiscal_periods
    WHERE company_id = ?
    ORDER BY start_date ASC
  `).all(companyId);

  const currentIdx = allPeriods.findIndex((p: any) => p.id === periodId);
  const consecutivePreviousPeriodsOpen: string[] = [];
  if (currentIdx > 0) {
    for (let i = 0; i < currentIdx; i++) {
      const prev = allPeriods[i];
      if (prev.status !== 'closed') {
        consecutivePreviousPeriodsOpen.push(`${prev.name} (${prev.start_date} → ${prev.end_date})`);
      }
    }
  }
  if (consecutivePreviousPeriodsOpen.length > 0) {
    warnings.push({
      code: 'PREVIOUS_PERIODS_NOT_CLOSED',
      message: `توجد ${consecutivePreviousPeriodsOpen.length} فترة سابقة لم تُقفل بعد. يُنصح بإقفال الفترات بالترتيب.`,
      count: consecutivePreviousPeriodsOpen.length,
      details: { periods: consecutivePreviousPeriodsOpen },
    });
  }

  // Stats: total posted JE count in period
  const postedJeRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM journal_entries je
    WHERE je.company_id = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      AND je.status = 'posted'
      ${jeBranch.clause}
  `).get(companyId, startDate, endDate, ...jeBranch.params);
  const totalPostedJE = Number(postedJeRow?.cnt || 0);

  // Stats: revenue and expenses totals from posted JE lines
  const plRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.account_type = 'revenue'  THEN jel.credit - jel.debit ELSE 0 END), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN a.account_type = 'expenses' THEN jel.debit - jel.credit ELSE 0 END), 0) AS total_expenses
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN accounts a ON a.id = jel.account_id
    WHERE je.company_id = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      AND je.status = 'posted'
      AND a.company_id = ?
      ${jeBranch.clause}
  `).get(companyId, startDate, endDate, companyId, ...jeBranch.params);
  const totalRevenue  = roundMoney(Number(plRow?.total_revenue  || 0));
  const totalExpenses = roundMoney(Number(plRow?.total_expenses || 0));
  const netPnl        = roundMoney(totalRevenue - totalExpenses);

  // Stats: retained earnings account exists?
  const retainedRow = db.prepare(`
    SELECT id FROM accounts
    WHERE company_id = ? AND (code = '3200' OR lookup_code = '3200') AND is_active = 1
    LIMIT 1
  `).get(companyId);
  const hasRetainedEarningsAccount = Boolean(retainedRow);
  if (!hasRetainedEarningsAccount) {
    hardBlockers.push({
      code: 'RETAINED_EARNINGS_ACCOUNT_MISSING',
      message: 'حساب الأرباح المدورة (3200) غير موجود أو غير نشط — مطلوب لقيد إقفال الإيرادات والمصروفات.',
    });
  }

  const ready = hardBlockers.length === 0;

  return {
    periodId,
    periodName: period.name,
    periodStart: startDate,
    periodEnd: endDate,
    status: period.status,
    ready,
    hardBlockers,
    warnings,
    stats: {
      draftVouchers,
      draftJournalEntries: draftJEs,
      unpostedInvoices,
      openInvoices,
      totalPostedJournalEntries: totalPostedJE,
      totalRevenue,
      totalExpenses,
      netPnl,
      hasRetainedEarningsAccount,
      backdatedPostingAfterPeriodEnd: backdated,
      consecutivePreviousPeriodsOpen,
    },
  };
}

// ─── 2. Year-End Readiness ─────────────────────────────────────────────────────

export function buildYearEndReadiness(
  db: any,
  scope: DiagnosticsScope,
  periodId: string,
): YearEndReadiness {
  assertScope(scope);

  const { companyId, branchId } = scope;

  const period = db.prepare(
    `SELECT * FROM fiscal_periods WHERE id = ? AND company_id = ?`
  ).get(periodId, companyId);

  if (!period) {
    throw Object.assign(new Error('PERIOD_NOT_FOUND'), { statusCode: 404, code: 'PERIOD_NOT_FOUND' });
  }

  const hardBlockers: BlockerItem[] = [];
  const warnings: WarningItem[] = [];

  const endDate   = String(period.end_date   || period.endDate   || '').slice(0, 10);
  const startDate = String(period.start_date || period.startDate || '').slice(0, 10);

  // Determine if this looks like a year-end period (full calendar year or 12-month span)
  const startYear = startDate.slice(0, 4);
  const endYear   = endDate.slice(0, 4);
  const isYearPeriod = startYear === endYear; // same calendar year, or accept cross-year

  // Already closed check
  if (period.status === 'closed') {
    hardBlockers.push({ code: 'YEAR_ALREADY_CLOSED', message: 'هذه السنة المالية مغلقة بالفعل.' });
  }

  // Look for months within this year that are still open (sub-periods)
  // Strategy: find all periods within same company whose date range is inside this period's range
  const subPeriods: any[] = db.prepare(`
    SELECT id, name, start_date, end_date, status
    FROM fiscal_periods
    WHERE company_id = ?
      AND id != ?
      AND start_date >= ?
      AND end_date <= ?
    ORDER BY start_date ASC
  `).all(companyId, periodId, startDate, endDate);

  const unclosedMonths = subPeriods
    .filter((p: any) => p.status !== 'closed')
    .map((p: any) => `${p.name} (${p.start_date} → ${p.end_date})`);

  const allMonthsClosed = unclosedMonths.length === 0;

  if (!allMonthsClosed) {
    hardBlockers.push({
      code: 'UNCLOSED_SUB_PERIODS',
      message: `يوجد ${unclosedMonths.length} فترة فرعية (شهر/ربع) لم تُقفل — يجب إقفالها أولاً.`,
      count: unclosedMonths.length,
      details: { periods: unclosedMonths },
    });
  }

  // P&L sweep required?
  const plRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.account_type = 'revenue'  THEN jel.credit - jel.debit ELSE 0 END), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN a.account_type = 'expenses' THEN jel.debit - jel.credit ELSE 0 END), 0) AS total_expenses
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN accounts a ON a.id = jel.account_id
    WHERE je.company_id = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      AND je.status = 'posted'
      AND je.reference_type != 'period_closing'
      AND a.company_id = ?
  `).get(companyId, startDate, endDate, companyId);

  const totalRevenue  = roundMoney(Number(plRow?.total_revenue  || 0));
  const totalExpenses = roundMoney(Number(plRow?.total_expenses || 0));
  const plSweepRequired = Math.abs(totalRevenue) > 0.01 || Math.abs(totalExpenses) > 0.01;

  // Retained earnings account check
  const retainedRow = db.prepare(`
    SELECT id FROM accounts
    WHERE company_id = ? AND (code = '3200' OR lookup_code = '3200') AND is_active = 1
    LIMIT 1
  `).get(companyId);
  const retainedEarningsAccountExists = Boolean(retainedRow);
  if (!retainedEarningsAccountExists) {
    hardBlockers.push({
      code: 'RETAINED_EARNINGS_ACCOUNT_MISSING',
      message: 'حساب الأرباح المدورة (3200) مفقود أو غير نشط.',
    });
  }

  // Duplicate carry-forward detection: is there already a carry_forward JE referencing this period?
  const cfRow = db.prepare(`
    SELECT id FROM journal_entries
    WHERE company_id = ?
      AND reference_type = 'carry_forward'
      AND status = 'posted'
      AND SUBSTR(entry_date, 1, 10) > ?
    LIMIT 1
  `).get(companyId, endDate);
  const carryForwardAlreadyExists = Boolean(cfRow);
  const carryForwardJournalEntryId = cfRow ? Number(cfRow.id) : null;

  if (carryForwardAlreadyExists) {
    warnings.push({
      code: 'CARRY_FORWARD_ALREADY_EXISTS',
      message: `يوجد قيد ترحيل أرصدة (carry_forward) مرحّل بالفعل بعد نهاية هذه السنة (قيد #${carryForwardJournalEntryId}) — تحقق من عدم تكرار العملية.`,
      details: { journalEntryId: carryForwardJournalEntryId },
    });
  }

  // Draft documents check (blocker at year-end) — parameterized branch filter
  const jeBranchYE = branchParam(branchId, 'je');
  const draftVRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM vouchers v
    WHERE v.company_id = ?
      AND SUBSTR(v.date, 1, 10) >= ?
      AND SUBSTR(v.date, 1, 10) <= ?
      AND UPPER(COALESCE(v.status, 'DRAFT')) = 'DRAFT'
  `).get(companyId, startDate, endDate);
  const draftVouchers = Number(draftVRow?.cnt || 0);
  if (draftVouchers > 0) {
    hardBlockers.push({
      code: 'DRAFT_VOUCHERS_IN_YEAR',
      message: `يوجد ${draftVouchers} سند غير مرحّل في السنة المالية.`,
      count: draftVouchers,
    });
  }

  const draftJeRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM journal_entries je
    WHERE je.company_id = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      AND je.status = 'draft'
      ${jeBranchYE.clause}
  `).get(companyId, startDate, endDate, ...jeBranchYE.params);
  const draftJEs = Number(draftJeRow?.cnt || 0);
  if (draftJEs > 0) {
    hardBlockers.push({
      code: 'DRAFT_JOURNAL_ENTRIES_IN_YEAR',
      message: `يوجد ${draftJEs} قيد يومية غير مرحّل في السنة المالية.`,
      count: draftJEs,
    });
  }

  const ready = hardBlockers.length === 0;

  return {
    ready,
    periodId,
    periodName: period.name,
    isYearPeriod,
    allMonthsClosed,
    unclosedMonths,
    plSweepRequired,
    retainedEarningsAccountExists,
    carryForwardAlreadyExists,
    carryForwardJournalEntryId,
    hardBlockers,
    warnings,
  };
}

// ─── 3. Inventory Drift Diagnostics ───────────────────────────────────────────

export function buildInventoryDriftReport(
  db: any,
  scope: DiagnosticsScope,
): InventoryDriftReport {
  assertScope(scope);

  const { companyId, branchId } = scope;

  // Compute quantity per item/warehouse from inventory_movements
  const movRows: any[] = db.prepare(`
    SELECT
      item_id,
      warehouse_id,
      COALESCE(SUM(quantity), 0) AS computed_qty
    FROM inventory_movements
    WHERE company_id = ?
    GROUP BY item_id, warehouse_id
  `).all(companyId);

  // Build computed map: itemId -> computed_qty (sum across all warehouses for item)
  const computedByItem = new Map<string, number>();
  for (const row of movRows) {
    const existing = computedByItem.get(row.item_id) || 0;
    computedByItem.set(row.item_id, roundMoney(existing + Number(row.computed_qty)));
  }

  // Load items with snapshot quantity — parameterized branch filter
  const itemBranch = branchParam(branchId);
  const items: any[] = db.prepare(`
    SELECT id, code, name_ar, quantity, company_id
    FROM items
    WHERE company_id = ?
      AND COALESCE(is_active, 1) = 1
      ${itemBranch.clause}
  `).all(companyId, ...itemBranch.params);

  const driftItems: InventoryDriftItem[] = [];
  let totalDrift = 0;

  for (const item of items) {
    const snapshotQty = roundMoney(Number(item.quantity || 0));
    const computedQty = roundMoney(computedByItem.get(String(item.id)) || 0);
    const drift = roundMoney(snapshotQty - computedQty);

    if (Math.abs(drift) > 0.001) {
      const driftPct = computedQty !== 0 ? roundMoney((drift / Math.abs(computedQty)) * 100) : 0;
      driftItems.push({
        itemId: String(item.id),
        itemCode: item.code || '',
        itemName: item.name_ar || '',
        warehouseId: null,
        snapshotQty,
        computedQty,
        drift,
        driftPct,
      });
      totalDrift = roundMoney(totalDrift + Math.abs(drift));
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    companyId,
    branchId: branchId || null,
    totalItems: items.length,
    driftedItems: driftItems.length,
    totalDrift,
    items: driftItems.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift)),
  };
}

// ─── 4. Party Balance Drift Diagnostics ───────────────────────────────────────

export function buildPartyBalanceDriftReport(
  db: any,
  scope: DiagnosticsScope,
): PartyBalanceDriftReport {
  assertScope(scope);

  const { companyId, branchId } = scope;

  // Compute balance per party from party_transactions — parameterized branch filter
  const ptBranch = branchParam(branchId);
  const txRows: any[] = db.prepare(`
    SELECT
      party_id,
      COALESCE(SUM(amount), 0) AS computed_balance
    FROM party_transactions
    WHERE company_id = ?
      ${ptBranch.clause}
    GROUP BY party_id
  `).all(companyId, ...ptBranch.params);

  const computedByParty = new Map<string, number>();
  for (const row of txRows) {
    computedByParty.set(String(row.party_id), roundMoney(Number(row.computed_balance)));
  }

  // Load parties
  const partiesBranch = branchParam(branchId);
  const parties: any[] = db.prepare(`
    SELECT id, name, type, balance, company_id
    FROM parties
    WHERE company_id = ?
      ${partiesBranch.clause}
  `).all(companyId, ...partiesBranch.params);

  const driftParties: PartyBalanceDriftItem[] = [];
  let totalDrift = 0;

  for (const party of parties) {
    const snapshotBalance = roundMoney(Number(party.balance || 0));
    const computedBalance = roundMoney(computedByParty.get(String(party.id)) || 0);
    const drift = roundMoney(snapshotBalance - computedBalance);

    if (Math.abs(drift) > 0.01) {
      driftParties.push({
        partyId: String(party.id),
        partyName: party.name || '',
        partyType: party.type || '',
        snapshotBalance,
        computedBalance,
        drift,
      });
      totalDrift = roundMoney(totalDrift + Math.abs(drift));
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    companyId,
    branchId: branchId || null,
    totalParties: parties.length,
    driftedParties: driftParties.length,
    totalDrift,
    parties: driftParties.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift)),
  };
}

// ─── 5. Missing Journal Link Diagnostics ──────────────────────────────────────

export function buildMissingJournalLinkReport(
  db: any,
  scope: DiagnosticsScope,
  fromDate?: string,
  toDate?: string,
): MissingJournalLinkReport {
  assertScope(scope);

  const { companyId } = scope;
  const dateFrom = fromDate || '1900-01-01';
  const dateTo   = toDate   || '2999-12-31';

  const issues: MissingJournalLinkItem[] = [];

  // 1. Posted invoices with no journal_entry_id
  const invoicesNoJe: any[] = db.prepare(`
    SELECT id, reference_number, date, type, NULL as status
    FROM invoices
    WHERE company_id = ?
      AND COALESCE(journal_entry_id, '') = ''
      AND COALESCE(total_amount_base, total_amount, 0) > 0.0001
      AND SUBSTR(date, 1, 10) >= ?
      AND SUBSTR(date, 1, 10) <= ?
    ORDER BY date ASC
    LIMIT 500
  `).all(companyId, dateFrom, dateTo);

  for (const inv of invoicesNoJe) {
    issues.push({
      documentType: 'invoice',
      documentId: String(inv.id),
      documentRef: inv.reference_number || inv.id,
      documentDate: inv.date || '',
      issue: `فاتورة مرحّلة (${inv.type}) بدون قيد محاسبي مرتبط`,
    });
  }

  // 2. Posted vouchers with no journal_entry_id
  const vouchersNoJe: any[] = db.prepare(`
    SELECT id, reference_number, date, type, status
    FROM vouchers
    WHERE company_id = ?
      AND UPPER(COALESCE(status, 'POSTED')) = 'POSTED'
      AND COALESCE(journal_entry_id, '') = ''
      AND COALESCE(amount_base, amount, 0) > 0.0001
      AND SUBSTR(date, 1, 10) >= ?
      AND SUBSTR(date, 1, 10) <= ?
    ORDER BY date ASC
    LIMIT 500
  `).all(companyId, dateFrom, dateTo);

  for (const v of vouchersNoJe) {
    issues.push({
      documentType: 'voucher',
      documentId: String(v.id),
      documentRef: v.reference_number || v.id,
      documentDate: v.date || '',
      issue: `سند مرحّل (${v.type}) بدون قيد محاسبي مرتبط`,
    });
  }

  // 3. Journal entries referencing invoices that don't exist
  const orphanedJeRows: any[] = db.prepare(`
    SELECT je.id, je.entry_date, je.reference_type, je.reference_id
    FROM journal_entries je
    WHERE je.company_id = ?
      AND je.reference_type = 'invoice'
      AND je.reference_id IS NOT NULL
      AND je.status = 'posted'
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      AND NOT EXISTS (
        SELECT 1 FROM invoices i WHERE i.id = je.reference_id AND i.company_id = je.company_id
      )
    ORDER BY je.entry_date ASC
    LIMIT 200
  `).all(companyId, dateFrom, dateTo);

  for (const je of orphanedJeRows) {
    issues.push({
      documentType: 'orphaned_journal_entry',
      documentId: String(je.id),
      documentRef: String(je.id),
      documentDate: je.entry_date || '',
      issue: `قيد محاسبي يشير إلى فاتورة غير موجودة (reference_id: ${je.reference_id})`,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    companyId,
    branchId: scope.branchId || null,
    totalIssues: issues.length,
    items: issues,
  };
}

// ─── 6. Failed Compensation Diagnostics ───────────────────────────────────────

export function buildFailedCompensationReport(
  db: any,
  scope: DiagnosticsScope,
  fromDate?: string,
  toDate?: string,
): FailedCompensationReport {
  assertScope(scope);

  const { companyId } = scope;
  const dateFrom = fromDate || '1900-01-01';
  const dateTo   = toDate   || '2999-12-31';

  const issues: FailedCompensationItem[] = [];

  // 1. Cancelled invoices that still have an active (posted) journal entry
  const cancelledWithJe: any[] = db.prepare(`
    SELECT i.id, i.date, i.status, i.journal_entry_id
    FROM invoices i
    INNER JOIN journal_entries je ON je.id = i.journal_entry_id
    WHERE i.company_id = ?
      AND i.status = 'cancelled'
      AND je.status = 'posted'
      AND je.reference_type != 'reversal'
      AND SUBSTR(i.date, 1, 10) >= ?
      AND SUBSTR(i.date, 1, 10) <= ?
    LIMIT 200
  `).all(companyId, dateFrom, dateTo);

  for (const inv of cancelledWithJe) {
    issues.push({
      documentType: 'invoice',
      documentId: String(inv.id),
      status: inv.status,
      issue: `فاتورة ملغاة لها قيد محاسبي مرحّل بدون عكس (journal_entry_id: ${inv.journal_entry_id}) — تحقق من التعويض`,
      documentDate: inv.date || '',
    });
  }

  // 2. Periods stuck in 'closing' status (incomplete close attempt)
  const stuckClosing: any[] = db.prepare(`
    SELECT id, name, start_date, end_date, status
    FROM fiscal_periods
    WHERE company_id = ?
      AND status = 'closing'
    ORDER BY start_date ASC
  `).all(companyId);

  for (const p of stuckClosing) {
    issues.push({
      documentType: 'fiscal_period',
      documentId: String(p.id),
      status: p.status,
      issue: `فترة مالية عالقة في حالة "closing" — عملية إقفال لم تكتمل: ${p.name}`,
      documentDate: p.start_date || '',
    });
  }

  // 3. System events with compensation_failed or requiresManualReview
  const failedCompEvents: any[] = db.prepare(`
    SELECT id, event_type, affected_document_type, affected_document_id, created_at, metadata
    FROM system_events
    WHERE company_id = ?
      AND (
        event_type IN ('COMPENSATION_FAILED', 'COMPENSATION_PARTIAL', 'MANUAL_REVIEW_REQUIRED')
        OR requires_manual_review = 1
      )
      AND COALESCE(resolved_at, '') = ''
      AND SUBSTR(created_at, 1, 10) >= ?
      AND SUBSTR(created_at, 1, 10) <= ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(companyId, dateFrom, dateTo);

  for (const evt of failedCompEvents) {
    issues.push({
      documentType: evt.affected_document_type || 'system_event',
      documentId: String(evt.affected_document_id || evt.id),
      status: evt.event_type,
      issue: `حدث نظامي غير محلول (${evt.event_type}) — يتطلب مراجعة يدوية`,
      documentDate: (evt.created_at || '').slice(0, 10),
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    companyId,
    branchId: scope.branchId || null,
    totalIssues: issues.length,
    items: issues,
  };
}

// ─── 7. Period Diagnostics (deep single-period inspection) ────────────────────

export interface PeriodDiagnosticsReport {
  periodId: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  financialSummary: {
    totalRevenue: number;
    totalExpenses: number;
    netPnl: number;
    totalPostedJournalEntries: number;
    totalJournalLines: number;
    debitTotal: number;
    creditTotal: number;
    isBalanced: boolean;
    imbalance: number;
  };
  documentCounts: {
    postedInvoices: number;
    draftInvoices: number;
    cancelledInvoices: number;
    postedVouchers: number;
    draftVouchers: number;
    postedJournalEntries: number;
    draftJournalEntries: number;
  };
  closingInfo: {
    closingJournalEntryId: number | null;
    closedBy: string | null;
    closedAt: string | null;
    reopenedBy: string | null;
    reopenedAt: string | null;
    reopenReason: string | null;
    carryForwardExists: boolean;
    carryForwardJournalEntryId: number | null;
  };
}

export function buildPeriodDiagnosticsReport(
  db: any,
  scope: DiagnosticsScope,
  periodId: string,
): PeriodDiagnosticsReport {
  assertScope(scope);

  const { companyId, branchId } = scope;

  const period = db.prepare(
    `SELECT * FROM fiscal_periods WHERE id = ? AND company_id = ?`
  ).get(periodId, companyId);

  if (!period) {
    throw Object.assign(new Error('PERIOD_NOT_FOUND'), { statusCode: 404, code: 'PERIOD_NOT_FOUND' });
  }

  const startDate = String(period.start_date || '').slice(0, 10);
  const endDate   = String(period.end_date   || '').slice(0, 10);
  const diagJeBranch = branchParam(branchId, 'je');

  // Financial summary from JE lines
  const finRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.account_type = 'revenue'  THEN jel.credit - jel.debit  ELSE 0 END), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN a.account_type = 'expenses' THEN jel.debit  - jel.credit ELSE 0 END), 0) AS total_expenses,
      COUNT(DISTINCT je.id) AS je_count,
      COUNT(jel.id)         AS line_count,
      COALESCE(SUM(jel.debit),  0) AS debit_total,
      COALESCE(SUM(jel.credit), 0) AS credit_total
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN accounts a ON a.id = jel.account_id
    WHERE je.company_id = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      AND je.status = 'posted'
      AND a.company_id = ?
      ${diagJeBranch.clause}
  `).get(companyId, startDate, endDate, companyId, ...diagJeBranch.params);

  const debitTotal  = roundMoney(Number(finRow?.debit_total  || 0));
  const creditTotal = roundMoney(Number(finRow?.credit_total || 0));
  const imbalance   = roundMoney(debitTotal - creditTotal);

  // Document counts
  const docCountRow = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'posted'    THEN 1 ELSE 0 END) AS posted_inv,
      SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END) AS draft_inv,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_inv
    FROM invoices
    WHERE company_id = ?
      AND SUBSTR(date, 1, 10) >= ?
      AND SUBSTR(date, 1, 10) <= ?
  `).get(companyId, startDate, endDate);

  const voucherCountRow = db.prepare(`
    SELECT
      SUM(CASE WHEN UPPER(COALESCE(status, 'POSTED')) = 'POSTED' THEN 1 ELSE 0 END) AS posted_v,
      SUM(CASE WHEN UPPER(COALESCE(status, 'DRAFT'))  = 'DRAFT'  THEN 1 ELSE 0 END) AS draft_v
    FROM vouchers
    WHERE company_id = ?
      AND SUBSTR(date, 1, 10) >= ?
      AND SUBSTR(date, 1, 10) <= ?
  `).get(companyId, startDate, endDate);

  const jeCountRow = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted_je,
      SUM(CASE WHEN status = 'draft'  THEN 1 ELSE 0 END) AS draft_je
    FROM journal_entries je
    WHERE je.company_id = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      ${diagJeBranch.clause}
  `).get(companyId, startDate, endDate, ...diagJeBranch.params);

  // Carry-forward check
  const cfRow = db.prepare(`
    SELECT id FROM journal_entries
    WHERE company_id = ?
      AND reference_type = 'carry_forward'
      AND status = 'posted'
      AND SUBSTR(entry_date, 1, 10) > ?
    ORDER BY entry_date ASC
    LIMIT 1
  `).get(companyId, endDate);

  return {
    periodId,
    periodName: period.name,
    periodStart: startDate,
    periodEnd: endDate,
    status: period.status,
    financialSummary: {
      totalRevenue:  roundMoney(Number(finRow?.total_revenue  || 0)),
      totalExpenses: roundMoney(Number(finRow?.total_expenses || 0)),
      netPnl:        roundMoney(Number(finRow?.total_revenue  || 0) - Number(finRow?.total_expenses || 0)),
      totalPostedJournalEntries: Number(finRow?.je_count   || 0),
      totalJournalLines:         Number(finRow?.line_count  || 0),
      debitTotal,
      creditTotal,
      isBalanced: Math.abs(imbalance) <= 0.01,
      imbalance,
    },
    documentCounts: {
      postedInvoices:    Number(docCountRow?.posted_inv    || 0),
      draftInvoices:     Number(docCountRow?.draft_inv     || 0),
      cancelledInvoices: Number(docCountRow?.cancelled_inv || 0),
      postedVouchers:    Number(voucherCountRow?.posted_v  || 0),
      draftVouchers:     Number(voucherCountRow?.draft_v   || 0),
      postedJournalEntries: Number(jeCountRow?.posted_je   || 0),
      draftJournalEntries:  Number(jeCountRow?.draft_je    || 0),
    },
    closingInfo: {
      closingJournalEntryId: period.closing_journal_entry_id || period.closingJournalEntryId || null,
      closedBy:      period.closed_by      || period.closedBy      || null,
      closedAt:      period.closed_at      || period.closedAt      || null,
      reopenedBy:    period.reopened_by    || period.reopenedBy    || null,
      reopenedAt:    period.reopened_at    || period.reopenedAt    || null,
      reopenReason:  period.reopen_reason  || period.reopenReason  || null,
      carryForwardExists:          Boolean(cfRow),
      carryForwardJournalEntryId:  cfRow ? Number(cfRow.id) : null,
    },
  };
}
