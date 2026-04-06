/**
 * Period Closing Engine — Shamel ERP
 *
 * SAP-style fiscal year / period closing:
 *
 * Phase 1 — Pre-Closing Validation
 *   • No unposted journal entries in period
 *   • No open (draft) vouchers dated within period
 *   • Period not already closed
 *
 * Phase 2 — P&L Sweep (Closing Entry)
 *   • Sum all Revenue accounts (4xxx) → net credit balance
 *   • Sum all Expense accounts (5xxx) → net debit balance
 *   • Net P&L = Revenue total − Expense total
 *   • Profit: CR Revenue accounts, DR Expense accounts, CR Retained Earnings (3200) = net profit
 *   • Loss:   CR Revenue accounts, DR Expense accounts, DR Retained Earnings (3200) = net loss
 *   All revenue and expense accounts are zeroed by debiting/crediting them back.
 *
 * Phase 3 — Lock Period
 *   • fiscal_periods.status = 'closed'
 *   • All subsequent posting attempts rejected if entryDate falls in closed period
 *
 * Phase 4 — Carry Forward (optional, invoked separately)
 *   • Reads balance sheet account balances at period end
 *   • Creates opening entries for the next period
 *
 * Accounts:
 *   Revenue:           4xxx  (accountType = 'revenue')
 *   Expenses:          5xxx  (accountType = 'expenses')
 *   Retained Earnings: 3200  (SYSTEM_ACCOUNTS.RETAINED)
 */

import { SYSTEM_ACCOUNTS, resolveAccountByCode, roundMoney } from '../accountingService';

export interface PeriodClosingContext {
  db: any;
  schema: any;
  sql: any;
  eq: any;
  and: any;
  createJournalEntry: (data: any) => Promise<any>;
  postJournalEntry: (id: number) => Promise<void>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    draftVouchers: number;
    draftJournalEntries: number;
    periodStart: string;
    periodEnd: string;
  };
}

export interface ClosingResult {
  success: boolean;
  periodId: string;
  closingJournalEntryId: number | null;
  netPnl: number;
  totalRevenue: number;
  totalExpenses: number;
  linesCount: number;
  detail: string;
}

export interface CarryForwardResult {
  success: boolean;
  nextPeriodId: string;
  openingJournalEntryId: number | null;
  balanceSheetAccountsCount: number;
  totalCarriedForward: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns all journal entry IDs for entries dated within [startDate, endDate] and status=posted */
async function getPostedEntryIdsInPeriod(
  ctx: PeriodClosingContext,
  companyId: string | null,
  startDate: string,
  endDate: string
): Promise<Set<number>> {
  const { db, schema } = ctx;
  const allEntries = await db.select().from(schema.journalEntries).all();
  const ids = new Set<number>();
  for (const entry of allEntries) {
    if (companyId && String(entry.companyId || '') !== companyId) continue;
    const d = String(entry.entryDate || '').slice(0, 10);
    if (d < startDate || d > endDate) continue;
    if (String(entry.status || '') === 'posted') ids.add(Number(entry.id));
  }
  return ids;
}

/** Compute net balance per account from posted journal entries in period */
async function computeAccountBalancesInPeriod(
  ctx: PeriodClosingContext,
  postedEntryIds: Set<number>
): Promise<Map<number, { debit: number; credit: number; net: number }>> {
  const { db, schema } = ctx;
  const lines = await db.select().from(schema.journalEntryLines).all();
  const balances = new Map<number, { debit: number; credit: number; net: number }>();
  for (const line of lines) {
    if (!postedEntryIds.has(Number(line.journalEntryId))) continue;
    const accountId = Number(line.accountId);
    const prev = balances.get(accountId) || { debit: 0, credit: 0, net: 0 };
    prev.debit = roundMoney(prev.debit + Number(line.debit || 0));
    prev.credit = roundMoney(prev.credit + Number(line.credit || 0));
    prev.net = roundMoney(prev.debit - prev.credit);
    balances.set(accountId, prev);
  }
  return balances;
}

// ─── Phase 1: Pre-Closing Validation ─────────────────────────────────────────

export async function validatePeriodForClosing(
  ctx: PeriodClosingContext,
  periodId: string,
  companyId: string | null
): Promise<ValidationResult> {
  const { db, schema, eq } = ctx;
  const errors: string[] = [];
  const warnings: string[] = [];

  const period = await db.select().from(schema.fiscalPeriods).where(eq(schema.fiscalPeriods.id, periodId)).get();
  if (!period) {
    return { valid: false, errors: ['الفترة المالية غير موجودة.'], warnings: [], stats: { draftVouchers: 0, draftJournalEntries: 0, periodStart: '', periodEnd: '' } };
  }
  if (companyId && String(period.companyId || '') !== companyId) {
    return { valid: false, errors: ['الفترة المالية لا تنتمي للمؤسسة الحالية.'], warnings: [], stats: { draftVouchers: 0, draftJournalEntries: 0, periodStart: '', periodEnd: '' } };
  }
  if (period.status === 'closed') {
    errors.push('الفترة المالية مغلقة مسبقاً.');
  }

  const startDate = String(period.startDate || '').slice(0, 10);
  const endDate = String(period.endDate || '').slice(0, 10);

  // Check for draft vouchers in period
  const allVouchers = await db.select().from(schema.vouchers).all();
  const draftVouchers = allVouchers.filter((v: any) => {
    const d = String(v.date || '').slice(0, 10);
    if (companyId && String(v.companyId || '') !== companyId) return false;
    return d >= startDate && d <= endDate && String(v.status || 'DRAFT').toUpperCase() === 'DRAFT';
  });
  if (draftVouchers.length > 0) {
    errors.push(`يوجد ${draftVouchers.length} سند (سندات) غير مرحّل ضمن الفترة. يجب ترحيل أو حذف جميع السندات قبل الإقفال.`);
  }

  // Check for draft journal entries in period
  const allEntries = await db.select().from(schema.journalEntries).all();
  const draftEntries = allEntries.filter((e: any) => {
    const d = String(e.entryDate || '').slice(0, 10);
    if (companyId && String(e.companyId || '') !== companyId) return false;
    return d >= startDate && d <= endDate && String(e.status || '') === 'draft';
  });
  if (draftEntries.length > 0) {
    errors.push(`يوجد ${draftEntries.length} قيد يومية غير مرحّل ضمن الفترة. يجب ترحيل جميع القيود قبل الإقفال.`);
  }

  // Warning: check if there are open invoices (remaining amount > 0)
  const allInvoices = await db.select().from(schema.invoices).all();
  const openInvoices = allInvoices.filter((inv: any) => {
    const d = String(inv.date || '').slice(0, 10);
    if (companyId && String(inv.companyId || '') !== companyId) return false;
    return d >= startDate && d <= endDate && Number(inv.remainingAmountBase || inv.remainingAmount || 0) > 0.01;
  });
  if (openInvoices.length > 0) {
    warnings.push(`يوجد ${openInvoices.length} فاتورة غير مسددة بالكامل — يُنصح بمراجعة الذمم قبل الإقفال.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      draftVouchers: draftVouchers.length,
      draftJournalEntries: draftEntries.length,
      periodStart: startDate,
      periodEnd: endDate,
    },
  };
}

// ─── Phase 2: Closing Entry (P&L → Retained Earnings) ────────────────────────

export async function executePeriodClose(
  ctx: PeriodClosingContext,
  periodId: string,
  companyId: string | null,
  branchId: string | null,
  closedBy: string
): Promise<ClosingResult> {
  const { db, schema, eq } = ctx;

  const period = await db.select().from(schema.fiscalPeriods).where(eq(schema.fiscalPeriods.id, periodId)).get();
  if (!period) throw new Error('PERIOD_NOT_FOUND');

  // Hard guard: cross-company close misuse
  if (companyId && String(period.companyId || '') !== companyId) {
    throw new Error('CROSS_COMPANY_CLOSE_DENIED');
  }

  if (period.status === 'closed') throw new Error('PERIOD_ALREADY_CLOSED');

  // Hard guard: concurrent close in progress
  if (period.status === 'closing') {
    throw new Error('PERIOD_CLOSING_IN_PROGRESS');
  }

  const startDate = String(period.startDate || '').slice(0, 10);
  const endDate = String(period.endDate || '').slice(0, 10);

  // Mark as closing (in-progress flag)
  await db.update(schema.fiscalPeriods)
    .set({ status: 'closing', updatedAt: new Date().toISOString() })
    .where(eq(schema.fiscalPeriods.id, periodId))
    .run();

  try {
    // Gather all posted entries in period
    const postedIds = await getPostedEntryIdsInPeriod(ctx, companyId, startDate, endDate);
    const accountBalances = await computeAccountBalancesInPeriod(ctx, postedIds);

    // Load all accounts
    const allAccounts = await db.select().from(schema.accounts).all();
    const accountById = new Map<number, any>(allAccounts.map((a: any) => [Number(a.id), a]));

    // Separate revenue and expense accounts with non-zero balances
    const revenueLines: Array<{ accountId: number; balance: number; name: string }> = [];
    const expenseLines: Array<{ accountId: number; balance: number; name: string }> = [];

    for (const [accountId, bal] of accountBalances) {
      const account = accountById.get(accountId);
      if (!account || account.isParent) continue;
      const accType = String(account.accountType || '');
      const net = bal.net; // debit - credit

      if (accType === 'revenue') {
        // Revenue accounts: credit nature → net is negative in our convention (credit > debit)
        // Balance = credit - debit for revenue
        const revenueBalance = roundMoney(bal.credit - bal.debit);
        if (Math.abs(revenueBalance) > 0.005) {
          revenueLines.push({ accountId, balance: revenueBalance, name: account.nameAr });
        }
      } else if (accType === 'expenses') {
        // Expense accounts: debit nature → net = debit - credit
        const expenseBalance = roundMoney(bal.debit - bal.credit);
        if (Math.abs(expenseBalance) > 0.005) {
          expenseLines.push({ accountId, balance: expenseBalance, name: account.nameAr });
        }
      }
    }

    const totalRevenue = roundMoney(revenueLines.reduce((s, l) => s + l.balance, 0));
    const totalExpenses = roundMoney(expenseLines.reduce((s, l) => s + l.balance, 0));
    const netPnl = roundMoney(totalRevenue - totalExpenses);

    // Build closing journal lines
    // Zero out all revenue accounts (DR each revenue account its balance)
    // Zero out all expense accounts (CR each expense account its balance)
    // Transfer net to Retained Earnings (3200)
    const closingLines: Array<{
      accountId: number;
      debit: number;
      credit: number;
      description: string;
    }> = [];

    for (const rev of revenueLines) {
      // DR revenue to zero it out
      closingLines.push({
        accountId: rev.accountId,
        debit: rev.balance,
        credit: 0,
        description: `إقفال حساب إيرادات — ${rev.name}`,
      });
    }

    for (const exp of expenseLines) {
      // CR expense to zero it out
      closingLines.push({
        accountId: exp.accountId,
        debit: 0,
        credit: exp.balance,
        description: `إقفال حساب مصروفات — ${exp.name}`,
      });
    }

    // Retained earnings line (balancing)
    const retainedAccountId = await resolveAccountByCode(db, SYSTEM_ACCOUNTS.RETAINED, companyId);

    if (netPnl > 0) {
      // Profit: CR Retained Earnings
      closingLines.push({
        accountId: retainedAccountId,
        debit: 0,
        credit: netPnl,
        description: `نقل صافي أرباح الفترة ${period.name} إلى الأرباح المدورة`,
      });
    } else if (netPnl < 0) {
      // Loss: DR Retained Earnings
      closingLines.push({
        accountId: retainedAccountId,
        debit: Math.abs(netPnl),
        credit: 0,
        description: `نقل صافي خسائر الفترة ${period.name} إلى الأرباح المدورة`,
      });
    }

    // Skip posting if there is nothing to close (no revenue/expense activity)
    let closingEntryId: number | null = null;
    if (closingLines.length > 0) {
      const closingEntry = await ctx.createJournalEntry({
        description: `قيد إقفال الفترة المالية — ${period.name} (${startDate} → ${endDate})`,
        referenceType: 'period_closing',
        referenceId: null,
        lines: closingLines,
        companyId: companyId || null,
        branchId: branchId || null,
        currencyCode: 'USD',
        entryDate: endDate,
      });
      await ctx.postJournalEntry(closingEntry.id);
      closingEntryId = closingEntry.id;
    }

    // Lock the period
    const now = new Date().toISOString();
    await db.update(schema.fiscalPeriods)
      .set({
        status: 'closed',
        closingJournalEntryId: closingEntryId,
        netPnl,
        totalRevenue,
        totalExpenses,
        closedBy,
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.fiscalPeriods.id, periodId))
      .run();

    return {
      success: true,
      periodId,
      closingJournalEntryId: closingEntryId,
      netPnl,
      totalRevenue,
      totalExpenses,
      linesCount: closingLines.length,
      detail: netPnl >= 0
        ? `ربح صافي: ${netPnl.toFixed(2)} USD → محوّل لحساب الأرباح المدورة`
        : `خسارة صافية: ${Math.abs(netPnl).toFixed(2)} USD → محوّلة لحساب الأرباح المدورة`,
    };
  } catch (err) {
    // Rollback to open on failure
    await db.update(schema.fiscalPeriods)
      .set({ status: 'open', updatedAt: new Date().toISOString() })
      .where(eq(schema.fiscalPeriods.id, periodId))
      .run();
    throw err;
  }
}

// ─── Phase 3: Carry Forward (Balance Sheet → Next Period Opening) ─────────────

/**
 * Computes the cumulative balance of all balance-sheet accounts (assets, liabilities, equity)
 * up to and including the closed period's end date, then creates an opening journal entry
 * on the first day of the next period.
 *
 * This is optional — balance-sheet accounts carry forward automatically via the
 * continuous double-entry ledger. This function creates an explicit opening marker entry
 * for auditability, matching SAP's carry-forward behavior.
 */
export async function executeCarryForward(
  ctx: PeriodClosingContext,
  closedPeriodId: string,
  nextPeriodId: string,
  companyId: string | null,
  branchId: string | null,
  executedBy: string
): Promise<CarryForwardResult> {
  const { db, schema, eq } = ctx;

  const closedPeriod = await db.select().from(schema.fiscalPeriods).where(eq(schema.fiscalPeriods.id, closedPeriodId)).get();
  if (!closedPeriod) throw new Error('CLOSED_PERIOD_NOT_FOUND');

  // Cross-company guard
  if (companyId && String(closedPeriod.companyId || '') !== companyId) {
    throw new Error('CROSS_COMPANY_CARRY_FORWARD_DENIED');
  }

  if (closedPeriod.status !== 'closed') throw new Error('PERIOD_NOT_CLOSED_YET');

  const nextPeriod = await db.select().from(schema.fiscalPeriods).where(eq(schema.fiscalPeriods.id, nextPeriodId)).get();
  if (!nextPeriod) throw new Error('NEXT_PERIOD_NOT_FOUND');

  // Cross-company guard on next period
  if (companyId && String(nextPeriod.companyId || '') !== companyId) {
    throw new Error('CROSS_COMPANY_NEXT_PERIOD_DENIED');
  }

  if (nextPeriod.status !== 'open') throw new Error('NEXT_PERIOD_MUST_BE_OPEN');

  // Duplicate carry-forward prevention: check if a carry_forward JE already exists
  // dated after the closed period's end date for this company
  const endDate = String(closedPeriod.endDate || '').slice(0, 10);
  const nextStartDate = String(nextPeriod.startDate || '').slice(0, 10);

  // Duplicate carry-forward prevention: check if a carry_forward JE already exists
  // dated after the closed period's end date for this company
  const existingCf = await db.select().from(schema.journalEntries)
    .where(eq(schema.journalEntries.referenceType, 'carry_forward'))
    .all();
  const duplicateCf = existingCf.find((je: any) => {
    if (companyId && String(je.companyId || '') !== companyId) return false;
    const jeDate = String(je.entryDate || '').slice(0, 10);
    return jeDate > endDate && String(je.status || '') === 'posted';
  });
  if (duplicateCf) {
    throw new Error(`CARRY_FORWARD_ALREADY_EXISTS:${duplicateCf.id}`);
  }

  // Compute cumulative balances of ALL posted entries up to end of closed period
  const allEntries = await db.select().from(schema.journalEntries).all();
  const postedIds = new Set<number>();
  for (const entry of allEntries) {
    if (companyId && String(entry.companyId || '') !== companyId) continue;
    const d = String(entry.entryDate || '').slice(0, 10);
    if (d > endDate) continue;
    if (String(entry.status || '') === 'posted') postedIds.add(Number(entry.id));
  }

  const allLines = await db.select().from(schema.journalEntryLines).all();
  const cumulativeBalances = new Map<number, { debit: number; credit: number }>();
  for (const line of allLines) {
    if (!postedIds.has(Number(line.journalEntryId))) continue;
    const accountId = Number(line.accountId);
    const prev = cumulativeBalances.get(accountId) || { debit: 0, credit: 0 };
    prev.debit = roundMoney(prev.debit + Number(line.debit || 0));
    prev.credit = roundMoney(prev.credit + Number(line.credit || 0));
    cumulativeBalances.set(accountId, prev);
  }

  // Filter to balance-sheet accounts only (assets, liabilities, equity)
  const allAccounts = await db.select().from(schema.accounts).all();
  const bsLines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const account of allAccounts) {
    if (account.isParent) continue;
    const accType = String(account.accountType || '');
    if (!['assets', 'liabilities', 'equity'].includes(accType)) continue;

    const bal = cumulativeBalances.get(Number(account.id));
    if (!bal) continue;
    const net = roundMoney(bal.debit - bal.credit);
    if (Math.abs(net) < 0.005) continue;

    if (net > 0) {
      bsLines.push({ accountId: Number(account.id), debit: net, credit: 0, description: `ترحيل رصيد — ${account.nameAr}` });
      totalDebit = roundMoney(totalDebit + net);
    } else {
      bsLines.push({ accountId: Number(account.id), debit: 0, credit: Math.abs(net), description: `ترحيل رصيد — ${account.nameAr}` });
      totalCredit = roundMoney(totalCredit + Math.abs(net));
    }
  }

  if (bsLines.length === 0) {
    return { success: true, nextPeriodId, openingJournalEntryId: null, balanceSheetAccountsCount: 0, totalCarriedForward: 0 };
  }

  // Ensure entry is balanced (it should be, as a closed trial balance always balances)
  const diff = roundMoney(totalDebit - totalCredit);
  if (Math.abs(diff) > 0.01) {
    throw new Error(`CARRY_FORWARD_IMBALANCED: debit=${totalDebit} credit=${totalCredit} diff=${diff}`);
  }

  const openingEntry = await ctx.createJournalEntry({
    description: `أرصدة مرحّلة من فترة "${closedPeriod.name}" → فترة "${nextPeriod.name}"`,
    referenceType: 'carry_forward',
    referenceId: null,
    lines: bsLines,
    companyId: companyId || null,
    branchId: branchId || null,
    currencyCode: 'USD',
    entryDate: nextStartDate,
  });
  await ctx.postJournalEntry(openingEntry.id);

  return {
    success: true,
    nextPeriodId,
    openingJournalEntryId: openingEntry.id,
    balanceSheetAccountsCount: bsLines.length,
    totalCarriedForward: totalDebit,
  };
}

// ─── Period Locking Guard ─────────────────────────────────────────────────────

/**
 * Checks whether the given date falls inside a closed fiscal period.
 * Called by journal entry creation to block posting to locked periods.
 */
export async function isPeriodLocked(
  ctx: PeriodClosingContext,
  entryDate: string,
  companyId: string | null
): Promise<{ locked: boolean; periodName?: string; periodId?: string }> {
  const { db, schema } = ctx;
  const dateStr = String(entryDate || '').slice(0, 10);
  if (!dateStr) return { locked: false };

  const allPeriods = await db.select().from(schema.fiscalPeriods).all();
  for (const period of allPeriods) {
    if (companyId && String(period.companyId || '') !== companyId) continue;
    if (period.status !== 'closed') continue;
    const start = String(period.startDate || '').slice(0, 10);
    const end = String(period.endDate || '').slice(0, 10);
    if (dateStr >= start && dateStr <= end) {
      return { locked: true, periodName: period.name, periodId: period.id };
    }
  }
  return { locked: false };
}

// ─── Reopen Period (exceptional) ─────────────────────────────────────────────

export async function reopenPeriod(
  ctx: PeriodClosingContext,
  periodId: string,
  companyId: string | null,
  reopenedBy: string,
  reason: string,
  /** Must be true to allow reopening; callers must confirm caller has admin/close privilege */
  privilegeConfirmed = false
): Promise<{ success: boolean }> {
  const { db, schema, eq } = ctx;

  if (!privilegeConfirmed) {
    throw new Error('REOPEN_PRIVILEGE_REQUIRED');
  }

  const period = await db.select().from(schema.fiscalPeriods).where(eq(schema.fiscalPeriods.id, periodId)).get();
  if (!period) throw new Error('PERIOD_NOT_FOUND');
  if (companyId && String(period.companyId || '') !== companyId) throw new Error('ACCESS_DENIED');
  if (period.status !== 'closed') throw new Error('PERIOD_NOT_CLOSED');
  if (!reason || reason.trim().length < 10) throw new Error('REOPEN_REASON_TOO_SHORT');

  await db.update(schema.fiscalPeriods)
    .set({
      status: 'reopened',
      reopenedBy,
      reopenedAt: new Date().toISOString(),
      reopenReason: reason.trim(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.fiscalPeriods.id, periodId))
    .run();

  return { success: true };
}

// ─── Period Summary (for dashboard / reporting) ───────────────────────────────

export async function getPeriodSummary(
  ctx: PeriodClosingContext,
  periodId: string,
  companyId: string | null
): Promise<{
  period: any;
  totalRevenue: number;
  totalExpenses: number;
  netPnl: number;
  accountBreakdown: Array<{ accountId: number; code: string; name: string; type: string; balance: number }>;
}> {
  const { db, schema, eq } = ctx;
  const period = await db.select().from(schema.fiscalPeriods).where(eq(schema.fiscalPeriods.id, periodId)).get();
  if (!period) throw new Error('PERIOD_NOT_FOUND');

  const startDate = String(period.startDate || '').slice(0, 10);
  const endDate = String(period.endDate || '').slice(0, 10);

  const postedIds = await getPostedEntryIdsInPeriod(ctx, companyId, startDate, endDate);
  const accountBalances = await computeAccountBalancesInPeriod(ctx, postedIds);

  const allAccounts = await db.select().from(schema.accounts).all();
  const accountById = new Map<number, any>(allAccounts.map((a: any) => [Number(a.id), a]));

  let totalRevenue = 0;
  let totalExpenses = 0;
  const breakdown: Array<{ accountId: number; code: string; name: string; type: string; balance: number }> = [];

  for (const [accountId, bal] of accountBalances) {
    const account = accountById.get(accountId);
    if (!account || account.isParent) continue;
    const accType = String(account.accountType || '');
    let balance = 0;

    if (accType === 'revenue') {
      balance = roundMoney(bal.credit - bal.debit);
      totalRevenue = roundMoney(totalRevenue + balance);
    } else if (accType === 'expenses') {
      balance = roundMoney(bal.debit - bal.credit);
      totalExpenses = roundMoney(totalExpenses + balance);
    } else {
      balance = roundMoney(bal.debit - bal.credit);
    }

    breakdown.push({ accountId, code: account.code, name: account.nameAr, type: accType, balance });
  }

  return {
    period,
    totalRevenue,
    totalExpenses,
    netPnl: roundMoney(totalRevenue - totalExpenses),
    accountBreakdown: breakdown.sort((a, b) => a.code.localeCompare(b.code)),
  };
}
