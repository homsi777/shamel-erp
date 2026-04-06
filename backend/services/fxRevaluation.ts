/**
 * FX Revaluation Engine — SAP F.05 equivalent for Shamel ERP
 *
 * PURPOSE
 * -------
 * At period-end, open AR/AP balances denominated in foreign currencies
 * (SYP, TRY) are still carried at their *original booking rate*.
 * The balance sheet must reflect the *current market rate* (mark-to-market).
 * This engine:
 *   1. Scans all open (unsettled / partially-settled) foreign-currency invoices.
 *   2. Computes the unrealized FX gain or loss for each open item.
 *   3. Posts a single aggregated (or line-by-line) journal entry on the valuation date.
 *   4. Posts an automatic reversal on the first day of the next period.
 *
 * ACCOUNTING LOGIC (SAP-style)
 * ----------------------------
 * For a Customer receivable (SYP invoice, USD base):
 *   - Book value   = outstanding_foreign / original_rate
 *   - Revalued     = outstanding_foreign / current_rate
 *   - If current_rate > original_rate → SYP weakened → USD value dropped → LOSS
 *     DR FX Loss Unrealized   (5815)
 *     CR  Accounts Receivable (1130)
 *   - If current_rate < original_rate → SYP strengthened → USD value rose → GAIN
 *     DR  Accounts Receivable (1130)
 *     CR FX Gain Unrealized   (4315)
 *
 * Exchange rate convention (same as rest of Shamel):
 *   amountBase = amountForeign / exchangeRate
 *   (higher exchangeRate → weaker foreign currency)
 *
 * BASE CURRENCY: USD
 */

import { db as database } from '../db';
import { createJournalEntry, postJournalEntry, SYSTEM_ACCOUNTS, resolveAccountByCode } from '../accountingService';
import * as schema from '../db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { ensurePartyAccountLinks, requirePartyAccountId } from './partnerAccountEnforcement';
function generateId(prefix = 'fxr'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
const auditLogger = {
  log: (data: Record<string, unknown>) => {
    try { console.log('[AUDIT]', JSON.stringify(data)); } catch { /* noop */ }
  },
};

export { computeUnrealizedFx } from './fxRevaluationCore';
import { computeUnrealizedFx, round2 } from './fxRevaluationCore';

const BASE_CURRENCY = 'USD';
const SUPPORTED_CURRENCIES = ['SYP', 'TRY'];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RevaluationRates {
  SYP: number;
  TRY: number;
}

export interface RevaluationLineResult {
  invoiceId: string;
  invoiceNumber: string;
  itemType: 'receivable' | 'payable';
  partyId: string;
  partyName: string;
  currency: string;
  outstandingForeign: number;
  originalRate: number;
  bookValueBase: number;
  revaluationRate: number;
  revaluedBase: number;
  unrealizedDiff: number;
  diffType: 'gain' | 'loss' | 'none';
}

export interface RevaluationRunResult {
  runId: string;
  valuationDate: string;
  reversalDate: string;
  lines: RevaluationLineResult[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netUnrealized: number;
  itemsEvaluated: number;
}

export interface PostedRevaluationResult extends RevaluationRunResult {
  status: 'posted';
  revaluationJournalEntryId: number | null;
  reversalJournalEntryId: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core computation
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Open items scanner
// ─────────────────────────────────────────────────────────────────────────────

interface OpenItem {
  invoiceId: string;
  invoiceNumber: string;
  itemType: 'receivable' | 'payable';
  partyId: string;
  partyName: string;
  currency: string;
  remainingAmountTransaction: number;
  exchangeRate: number;
}

async function getOpenForeignCurrencyItems(companyId?: string, branchId?: string): Promise<OpenItem[]> {
  const db = database as any;

  // We query invoices that:
  //  - have a foreign currency (SYP / TRY)
  //  - have remaining_amount_transaction > 0 (unsettled portion)
  //  - are sales invoices (customer AR) or purchase invoices (supplier AP)
  const rows: any[] = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        companyId ? eq(schema.invoices.companyId, companyId) : undefined,
        branchId  ? eq(schema.invoices.branchId,  branchId)  : undefined,
      ),
    )
    .all();

  const items: OpenItem[] = [];

  for (const row of rows) {
    const currency: string = row.currency || BASE_CURRENCY;
    if (!SUPPORTED_CURRENCIES.includes(currency)) continue;

    const remaining: number = Number(row.remainingAmountTransaction ?? row.remainingAmount ?? 0);
    if (remaining <= 0.001) continue;

    const rate: number = Number(row.exchangeRate ?? 0);
    if (rate <= 0) continue;

    const invType: string = String(row.type || '').toLowerCase();
    const itemType: 'receivable' | 'payable' =
      invType.includes('purchase') ? 'payable' : 'receivable';

    items.push({
      invoiceId:    String(row.id),
      invoiceNumber: String(row.invoiceNumber || row.id),
      itemType,
      partyId:   String(row.clientId  || ''),
      partyName: String(row.clientName || ''),
      currency,
      remainingAmountTransaction: remaining,
      exchangeRate: rate,
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dry-run: preview without posting
// ─────────────────────────────────────────────────────────────────────────────

export async function previewRevaluation(params: {
  valuationDate: string;
  rates: RevaluationRates;
  companyId?: string;
  branchId?: string;
}): Promise<RevaluationRunResult> {
  const { valuationDate, rates, companyId, branchId } = params;

  const nextDay = new Date(valuationDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const reversalDate = nextDay.toISOString().slice(0, 10);

  const openItems = await getOpenForeignCurrencyItems(companyId, branchId);

  const lines: RevaluationLineResult[] = [];
  let totalGain = 0;
  let totalLoss  = 0;

  for (const item of openItems) {
    const currentRate = rates[item.currency as keyof RevaluationRates];
    if (!currentRate || currentRate <= 0) continue;

    const fx = computeUnrealizedFx(
      item.remainingAmountTransaction,
      item.currency,
      item.exchangeRate,
      currentRate,
      item.itemType,
    );

    lines.push({
      invoiceId:           item.invoiceId,
      invoiceNumber:       item.invoiceNumber,
      itemType:            item.itemType,
      partyId:             item.partyId,
      partyName:           item.partyName,
      currency:            item.currency,
      outstandingForeign:  item.remainingAmountTransaction,
      originalRate:        item.exchangeRate,
      bookValueBase:       fx.bookValueBase,
      revaluationRate:     currentRate,
      revaluedBase:        fx.revaluedBase,
      unrealizedDiff:      fx.unrealizedDiff,
      diffType:            fx.diffType,
    });

    if (fx.diffType === 'gain') totalGain += fx.unrealizedDiff;
    else if (fx.diffType === 'loss') totalLoss += fx.unrealizedDiff;
  }

  return {
    runId:              '',
    valuationDate,
    reversalDate,
    lines,
    totalUnrealizedGain: round2(totalGain),
    totalUnrealizedLoss: round2(totalLoss),
    netUnrealized:       round2(totalGain - totalLoss),
    itemsEvaluated:      lines.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Journal line builders
// ─────────────────────────────────────────────────────────────────────────────

interface JournalLine {
  accountCode?: string;
  accountId?: number | null;
  debitAmount: number;
  creditAmount: number;
  description: string;
  partyType?: 'customer' | 'supplier';
  partyId?: string;
}

async function buildRevaluationJournalLines(
  lines: RevaluationLineResult[],
  companyId?: string,
): Promise<JournalLine[]> {
  const journalLines: JournalLine[] = [];

  for (const line of lines) {
    if (line.diffType === 'none' || line.unrealizedDiff < 0.001) continue;

    const partyType = line.itemType === 'receivable' ? 'customer' : 'supplier';
    let partyAccountId: number | null = null;
    if (line.partyId) {
      const party = await db.select().from(schema.parties).where(eq(schema.parties.id, String(line.partyId))).get();
      if (party) {
        const scopedCompanyId = companyId || String((party as any).companyId || '').trim() || null;
        const enforcedParty = await ensurePartyAccountLinks(db, party, scopedCompanyId);
        partyAccountId = await requirePartyAccountId(
          db,
          enforcedParty,
          line.itemType === 'receivable' ? 'receivable' : 'payable',
          scopedCompanyId,
        );
      }
    }
    if (!partyAccountId) {
      throw new Error(`FX_REVALUATION_PARTY_ACCOUNT_REQUIRED:${line.partyId || line.invoiceId}`);
    }

    const desc = `إعادة تقييم عملة — ${line.partyName} — ${line.invoiceNumber} (${line.currency})`;

    if (line.itemType === 'receivable') {
      if (line.diffType === 'gain') {
        // AR increased in USD → DR Receivable, CR FX Gain Unrealized
        journalLines.push({ accountId: partyAccountId, debitAmount: line.unrealizedDiff, creditAmount: 0, description: desc, partyType, partyId: line.partyId });
        journalLines.push({ accountCode: SYSTEM_ACCOUNTS.FX_GAIN_UNREALIZED, debitAmount: 0, creditAmount: line.unrealizedDiff, description: desc });
      } else {
        // AR decreased in USD → DR FX Loss Unrealized, CR Receivable
        journalLines.push({ accountCode: SYSTEM_ACCOUNTS.FX_LOSS_UNREALIZED, debitAmount: line.unrealizedDiff, creditAmount: 0, description: desc });
        journalLines.push({ accountId: partyAccountId, debitAmount: 0, creditAmount: line.unrealizedDiff, description: desc, partyType, partyId: line.partyId });
      }
    } else {
      // Payable
      if (line.diffType === 'gain') {
        // AP decreased in USD → DR Payable, CR FX Gain Unrealized
        journalLines.push({ accountId: partyAccountId, debitAmount: line.unrealizedDiff, creditAmount: 0, description: desc, partyType, partyId: line.partyId });
        journalLines.push({ accountCode: SYSTEM_ACCOUNTS.FX_GAIN_UNREALIZED, debitAmount: 0, creditAmount: line.unrealizedDiff, description: desc });
      } else {
        // AP increased in USD → DR FX Loss Unrealized, CR Payable
        journalLines.push({ accountCode: SYSTEM_ACCOUNTS.FX_LOSS_UNREALIZED, debitAmount: line.unrealizedDiff, creditAmount: 0, description: desc });
        journalLines.push({ accountId: partyAccountId, debitAmount: 0, creditAmount: line.unrealizedDiff, description: desc, partyType, partyId: line.partyId });
      }
    }
  }

  return journalLines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute revaluation run (post + auto-reverse)
// ─────────────────────────────────────────────────────────────────────────────

export async function executeRevaluation(params: {
  valuationDate: string;
  rates: RevaluationRates;
  companyId?: string;
  branchId?: string;
  executedBy?: string;
  notes?: string;
}): Promise<PostedRevaluationResult> {
  const { valuationDate, rates, companyId, branchId, executedBy, notes } = params;

  const nextDay = new Date(valuationDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const reversalDate = nextDay.toISOString().slice(0, 10);

  const runId = generateId('fxrun');
  const db = database as any;

  // ── 1. Scan open items ────────────────────────────────────────────────────
  const openItems = await getOpenForeignCurrencyItems(companyId, branchId);

  const lines: RevaluationLineResult[] = [];
  let totalGain = 0;
  let totalLoss  = 0;

  for (const item of openItems) {
    const currentRate = rates[item.currency as keyof RevaluationRates];
    if (!currentRate || currentRate <= 0) continue;

    const fx = computeUnrealizedFx(
      item.remainingAmountTransaction,
      item.currency,
      item.exchangeRate,
      currentRate,
      item.itemType,
    );

    const lineRow: RevaluationLineResult = {
      invoiceId:          item.invoiceId,
      invoiceNumber:      item.invoiceNumber,
      itemType:           item.itemType,
      partyId:            item.partyId,
      partyName:          item.partyName,
      currency:           item.currency,
      outstandingForeign: item.remainingAmountTransaction,
      originalRate:       item.exchangeRate,
      bookValueBase:      fx.bookValueBase,
      revaluationRate:    currentRate,
      revaluedBase:       fx.revaluedBase,
      unrealizedDiff:     fx.unrealizedDiff,
      diffType:           fx.diffType,
    };
    lines.push(lineRow);

    if (fx.diffType === 'gain') totalGain += fx.unrealizedDiff;
    else if (fx.diffType === 'loss') totalLoss += fx.unrealizedDiff;
  }

  const summary = {
    totalUnrealizedGain: round2(totalGain),
    totalUnrealizedLoss: round2(totalLoss),
    netUnrealized:       round2(totalGain - totalLoss),
    itemsEvaluated:      lines.length,
  };

  // ── 2. Persist run record (draft) ─────────────────────────────────────────
  await db.insert(schema.fxRevaluationRuns).values({
    id: runId,
    companyId:           companyId || null,
    branchId:            branchId  || null,
    valuationDate,
    reversalDate,
    rateSyp:             rates.SYP,
    rateTry:             rates.TRY,
    status:              'draft',
    totalUnrealizedGain: summary.totalUnrealizedGain,
    totalUnrealizedLoss: summary.totalUnrealizedLoss,
    netUnrealized:       summary.netUnrealized,
    itemsEvaluated:      summary.itemsEvaluated,
    executedBy:          executedBy || null,
    executedAt:          new Date().toISOString(),
    notes:               notes || null,
  }).run();

  // ── 3. Persist line records ────────────────────────────────────────────────
  for (const line of lines) {
    await db.insert(schema.fxRevaluationLines).values({
      id:                 generateId('fxline'),
      companyId:          companyId || null,
      runId,
      itemType:           line.itemType,
      partyId:            line.partyId,
      partyName:          line.partyName,
      invoiceId:          line.invoiceId,
      invoiceNumber:      line.invoiceNumber,
      currency:           line.currency,
      outstandingForeign: line.outstandingForeign,
      originalRate:       line.originalRate,
      bookValueBase:      line.bookValueBase,
      revaluationRate:    line.revaluationRate,
      revaluedBase:       line.revaluedBase,
      unrealizedDiff:     line.unrealizedDiff,
      diffType:           line.diffType,
    }).run();
  }

  // ── 4. Resolve accounts and build journal lines ───────────────────────────
  let revaluationJournalEntryId: number | null = null;
  let reversalJournalEntryId:    number | null = null;

  const activeLines = lines.filter(l => l.diffType !== 'none' && l.unrealizedDiff >= 0.001);

  if (activeLines.length > 0) {
    const resolveAccount = async (code: string): Promise<number | null> => {
      try {
        return await resolveAccountByCode(db, code, params.companyId || null);
      } catch {
        return null;
      }
    };

    const journalLines = await buildRevaluationJournalLines(activeLines, params.companyId || null);

    // Aggregate by account code to produce a compact journal entry
    const aggregated = new Map<string, { accountId: number | null; accountCode: string | null; debit: number; credit: number; description: string; partyType?: string; partyId?: string }>();
    for (const jl of journalLines) {
      const aggregateKey = jl.accountId ? `id:${jl.accountId}` : `code:${String(jl.accountCode || '')}`;
      const existing = aggregated.get(aggregateKey);
      if (existing) {
        existing.debit  += jl.debitAmount;
        existing.credit += jl.creditAmount;
      } else {
        aggregated.set(aggregateKey, {
          accountId: jl.accountId ?? null,
          accountCode: jl.accountCode ? String(jl.accountCode) : null,
          debit:     jl.debitAmount,
          credit:    jl.creditAmount,
          description: jl.description,
          partyType: jl.partyType,
          partyId:   jl.partyId,
        });
      }
    }

    // Build final lines array with resolved account IDs
    const finalLines: any[] = [];
    for (const [, agg] of aggregated.entries()) {
      const accountId = agg.accountId || (agg.accountCode ? await resolveAccount(agg.accountCode) : null);
      if (!accountId) continue;
      if (agg.debit > 0.001) {
        finalLines.push({
          accountId,
          debit: round2(agg.debit),
          credit: 0,
          description:  'إعادة تقييم العملة — غير محقق',
          partyId: Number.isFinite(Number(agg.partyId)) ? Number(agg.partyId) : null,
          partnerRefId: agg.partyId ? String(agg.partyId) : null,
        });
      }
      if (agg.credit > 0.001) {
        finalLines.push({
          accountId,
          debit: 0,
          credit: round2(agg.credit),
          description:  'إعادة تقييم العملة — غير محقق',
          partyId: Number.isFinite(Number(agg.partyId)) ? Number(agg.partyId) : null,
          partnerRefId: agg.partyId ? String(agg.partyId) : null,
        });
      }
    }

    if (finalLines.length > 0) {
      // ── 5. Post revaluation journal entry ────────────────────────────────
      const revalJE = await createJournalEntry({
        entryDate:     valuationDate,
        description:   `إعادة تقييم العملات الأجنبية — ${valuationDate} (SYP:${rates.SYP}, TRY:${rates.TRY})`,
        referenceType: 'fx_revaluation',
        referenceId:   null,
        companyId,
        branchId,
        createdBy:     Number.isFinite(Number(executedBy)) ? Number(executedBy) : null,
        bypassPeriodLock: false,
        lines:         finalLines,
      });
      await postJournalEntry(revalJE.id);
      revaluationJournalEntryId = revalJE.id;

      // ── 6. Build reversal lines (swap debit/credit) ───────────────────────
      const reversalLines = finalLines.map((l: any) => ({
        ...l,
        debit: l.credit,
        credit: l.debit,
        description:  'عكس إعادة تقييم العملات الأجنبية — تلقائي',
      }));

      const reversalJE = await createJournalEntry({
        entryDate:     reversalDate,
        description:   `عكس إعادة تقييم العملات — ${reversalDate} (رقم التشغيل: ${runId.slice(0, 8)})`,
        referenceType: 'fx_revaluation_reversal',
        referenceId:   null,
        companyId,
        branchId,
        createdBy:     Number.isFinite(Number(executedBy)) ? Number(executedBy) : null,
        bypassPeriodLock: true, // reversal may cross into the new period
        lines:         reversalLines,
      });
      await postJournalEntry(reversalJE.id);
      reversalJournalEntryId = reversalJE.id;
    }
  }

  // ── 7. Update run to 'posted' ────────────────────────────────────────────
  await db
    .update(schema.fxRevaluationRuns)
    .set({
      status:                     activeLines.length > 0 ? 'posted' : 'no_impact',
      revaluationJournalEntryId,
      reversalJournalEntryId,
    })
    .where(eq(schema.fxRevaluationRuns.id, runId))
    .run();

  // ── 8. Audit log ──────────────────────────────────────────────────────────
  try {
    auditLogger.log({
      action:   'FX_REVALUATION_EXECUTED',
      userId:   executedBy,
      details: {
        runId,
        valuationDate,
        reversalDate,
        rates,
        itemsEvaluated: summary.itemsEvaluated,
        netUnrealized:  summary.netUnrealized,
        revaluationJournalEntryId,
        reversalJournalEntryId,
      },
    });
  } catch { /* non-fatal */ }

  return {
    runId,
    valuationDate,
    reversalDate,
    lines,
    ...summary,
    status: 'posted',
    revaluationJournalEntryId,
    reversalJournalEntryId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function listRevaluationRuns(companyId?: string): Promise<any[]> {
  const db = database as any;
  const rows: any[] = await db
    .select()
    .from(schema.fxRevaluationRuns)
    .where(companyId ? eq(schema.fxRevaluationRuns.companyId, companyId) : undefined)
    .all();
  return rows.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function getRevaluationRunDetails(runId: string): Promise<{ run: any; lines: any[] }> {
  const db = database as any;
  const [run] = await db
    .select()
    .from(schema.fxRevaluationRuns)
    .where(eq(schema.fxRevaluationRuns.id, runId))
    .all();
  if (!run) throw new Error(`Revaluation run not found: ${runId}`);

  const lines: any[] = await db
    .select()
    .from(schema.fxRevaluationLines)
    .where(eq(schema.fxRevaluationLines.runId, runId))
    .all();

  return { run, lines };
}
