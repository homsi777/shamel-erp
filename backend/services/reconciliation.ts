/**
 * Reconciliation Service — SAP FI / Odoo-style for Shamel ERP
 *
 * Orchestrates:
 *   1. Session lifecycle: create, load, confirm, cancel
 *   2. Open-items scanner: pulls unreconciled invoices & vouchers for a party
 *   3. Auto-match execution (delegates to reconciliationCore)
 *   4. Manual match application
 *   5. Write-off posting: tolerance differences → journal entry (RECON_GAIN / RECON_LOSS)
 *   6. Aging analysis
 *   7. Reconciliation report
 */

import { db as database } from '../db';
import * as schema from '../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  autoMatch,
  manualMatch,
  analyzeAging,
  round2,
  type ReconciliationItem,
  type MatchGroup,
  type AutoMatchResult,
  type AgingBucket,
} from './reconciliationCore';
import {
  createJournalEntry,
  postJournalEntry,
  resolveAccountByCode,
  SYSTEM_ACCOUNTS,
} from '../accountingService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSessionParams {
  type: 'party_ar' | 'party_ap' | 'bank' | 'interco';
  partyId?: string;
  partyName?: string;
  fromDate?: string;
  toDate?: string;
  toleranceAmount?: number;
  companyId?: string;
  branchId?: string;
  createdBy?: string;
  notes?: string;
}

export interface SessionSummary {
  sessionId: string;
  type: string;
  partyId?: string;
  partyName?: string;
  status: string;
  itemCount: number;
  matchedCount: number;
  unmatchedCount: number;
  totalDebitMatched: number;
  totalCreditMatched: number;
  differenceAmount: number;
  agingBuckets: AgingBucket[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Session lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createReconciliationSession(params: CreateSessionParams): Promise<string> {
  const db = database as any;
  const sessionId = newId('recon');

  await db.insert(schema.reconciliationSessions).values({
    id:              sessionId,
    companyId:       params.companyId || null,
    branchId:        params.branchId  || null,
    type:            params.type,
    partyId:         params.partyId   || null,
    partyName:       params.partyName || null,
    fromDate:        params.fromDate  || null,
    toDate:          params.toDate    || null,
    toleranceAmount: params.toleranceAmount ?? 0,
    status:          'open',
    createdBy:       params.createdBy || null,
    notes:           params.notes     || null,
  }).run();

  return sessionId;
}

export async function getSession(sessionId: string): Promise<any> {
  const db = database as any;
  const [session] = await db
    .select()
    .from(schema.reconciliationSessions)
    .where(eq(schema.reconciliationSessions.id, sessionId))
    .all();
  if (!session) throw new Error(`SESSION_NOT_FOUND: ${sessionId}`);
  return session;
}

export async function getSessionItems(sessionId: string): Promise<ReconciliationItem[]> {
  const db = database as any;
  const rows: any[] = await db
    .select()
    .from(schema.reconciliationItems)
    .where(eq(schema.reconciliationItems.sessionId, sessionId))
    .all();
  return rows.map(rowToItem);
}

export async function listSessions(companyId?: string, partyId?: string): Promise<any[]> {
  const db = database as any;
  const rows: any[] = await db
    .select()
    .from(schema.reconciliationSessions)
    .where(
      and(
        companyId ? eq(schema.reconciliationSessions.companyId, companyId) : undefined,
        partyId   ? eq(schema.reconciliationSessions.partyId,   partyId)   : undefined,
      )
    )
    .all();
  return rows.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// ─────────────────────────────────────────────────────────────────────────────
// Open-items scanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull all unreconciled invoices (debit) and payment vouchers (credit)
 * for a given party, then insert them as session items.
 */
export async function loadOpenItemsIntoSession(
  sessionId: string,
  params: {
    partyId: string;
    partyType: 'customer' | 'supplier';
    companyId?: string;
    fromDate?: string;
    toDate?: string;
  },
): Promise<{ debitCount: number; creditCount: number }> {
  const db = database as any;

  const allInvoices: any[] = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        params.companyId ? eq(schema.invoices.companyId, params.companyId) : undefined,
        eq(schema.invoices.clientId, params.partyId),
      )
    )
    .all();

  const allVouchers: any[] = await db
    .select()
    .from(schema.vouchers)
    .where(
      and(
        params.companyId ? eq(schema.vouchers.companyId, params.companyId) : undefined,
        eq(schema.vouchers.clientId, params.partyId),
      )
    )
    .all();

  const items: any[] = [];

  // ── Debit items (invoices with remaining balance) ─────────────────────────
  for (const inv of allInvoices) {
    const remaining = Number(inv.remainingAmountBase ?? inv.remainingAmount ?? 0);
    if (remaining < 0.001) continue;

    const invDate = String(inv.date || inv.createdAt || '').slice(0, 10);
    if (params.fromDate && invDate < params.fromDate) continue;
    if (params.toDate   && invDate > params.toDate)   continue;

    const invType = String(inv.type || '').toLowerCase();
    const side: 'debit' | 'credit' = invType.includes('purchase') ? 'credit' : 'debit';

    items.push({
      id:           newId('ri'),
      companyId:    params.companyId || null,
      sessionId,
      itemType:     invType.includes('return') ? 'credit_note' : invType.includes('purchase') ? 'supplier_invoice' : 'invoice',
      side,
      refId:        String(inv.id),
      refNumber:    String(inv.invoiceNumber || inv.id),
      refDate:      invDate,
      partyId:      params.partyId,
      partyName:    String(inv.clientName || ''),
      currency:     String(inv.currency || 'USD'),
      amountForeign: Number(inv.remainingAmountTransaction ?? inv.remainingAmount ?? 0),
      amountBase:   remaining,
      allocatedBase: 0,
      remainingBase: remaining,
      matchGroupId:  null,
      matchStatus:  'unmatched',
      matchMethod:  null,
      matchDifference: 0,
    });
  }

  // ── Credit items (payment vouchers not yet fully applied) ─────────────────
  for (const v of allVouchers) {
    const amount = Number(v.amountBase ?? v.amount ?? 0);
    if (amount < 0.001) continue;
    if (String(v.status || '').toUpperCase() !== 'POSTED') continue;

    const vDate = String(v.date || v.createdAt || '').slice(0, 10);
    if (params.fromDate && vDate < params.fromDate) continue;
    if (params.toDate   && vDate > params.toDate)   continue;

    // For AR: receipts are credits; for AP: payment vouchers are debits
    const vType = String(v.type || '').toLowerCase();
    const isReceipt = vType.includes('receipt') || vType.includes('قبض');
    const side: 'debit' | 'credit' = (params.partyType === 'customer' && isReceipt) ||
                                     (params.partyType === 'supplier' && !isReceipt)
                                       ? 'credit' : 'debit';

    items.push({
      id:            newId('ri'),
      companyId:     params.companyId || null,
      sessionId,
      itemType:      'receipt',
      side,
      refId:         String(v.id),
      refNumber:     String(v.referenceNumber || v.id),
      refDate:       vDate,
      partyId:       params.partyId,
      partyName:     String(v.clientName || ''),
      currency:      String(v.currency || 'USD'),
      amountForeign: Number(v.amountTransaction ?? v.amount ?? 0),
      amountBase:    amount,
      allocatedBase: 0,
      remainingBase: amount,
      matchGroupId:  null,
      matchStatus:   'unmatched',
      matchMethod:   null,
      matchDifference: 0,
    });
  }

  // Bulk insert
  for (const item of items) {
    await db.insert(schema.reconciliationItems).values(item).run();
  }

  return {
    debitCount:  items.filter(i => i.side === 'debit').length,
    creditCount: items.filter(i => i.side === 'credit').length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-match
// ─────────────────────────────────────────────────────────────────────────────

export async function runAutoMatch(sessionId: string): Promise<AutoMatchResult> {
  const db = database as any;
  const session = await getSession(sessionId);
  if (session.status !== 'open') {
    throw new Error(`SESSION_NOT_OPEN: لا يمكن تشغيل المطابقة التلقائية على جلسة ${session.status}`);
  }

  const items = await getSessionItems(sessionId);
  const debits  = items.filter(i => i.side === 'debit'  && i.matchStatus === 'unmatched');
  const credits = items.filter(i => i.side === 'credit' && i.matchStatus === 'unmatched');
  const tolerance = Number(session.toleranceAmount ?? 0);

  const result = autoMatch(debits, credits, tolerance);

  // Persist match results
  for (const group of result.groups) {
    for (const d of group.debitItems) {
      await db.update(schema.reconciliationItems)
        .set({
          allocatedBase:   d.allocatedBase,
          remainingBase:   d.remainingBase,
          matchGroupId:    group.matchGroupId,
          matchStatus:     d.matchStatus,
          matchMethod:     'auto',
          matchDifference: group.difference,
        })
        .where(eq(schema.reconciliationItems.id, d.id))
        .run();
    }
    for (const c of group.creditItems) {
      await db.update(schema.reconciliationItems)
        .set({
          allocatedBase:   c.allocatedBase,
          remainingBase:   c.remainingBase,
          matchGroupId:    group.matchGroupId,
          matchStatus:     c.matchStatus,
          matchMethod:     'auto',
          matchDifference: group.difference,
        })
        .where(eq(schema.reconciliationItems.id, c.id))
        .run();
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual match
// ─────────────────────────────────────────────────────────────────────────────

export async function applyManualMatch(params: {
  sessionId: string;
  debitItemIds: string[];
  creditItemIds: string[];
}): Promise<MatchGroup> {
  const db = database as any;
  const session = await getSession(params.sessionId);
  if (session.status !== 'open') {
    throw new Error(`SESSION_NOT_OPEN: الجلسة ليست مفتوحة`);
  }

  const allItems  = await getSessionItems(params.sessionId);
  const debitItems  = allItems.filter(i => params.debitItemIds.includes(i.id));
  const creditItems = allItems.filter(i => params.creditItemIds.includes(i.id));

  if (debitItems.length === 0 || creditItems.length === 0) {
    throw new Error('MATCH_ITEMS_NOT_FOUND: بنود المطابقة غير موجودة في الجلسة');
  }

  const tolerance = Number(session.toleranceAmount ?? 0);
  const group = manualMatch(debitItems, creditItems, tolerance);

  // Persist
  for (const d of group.debitItems) {
    await db.update(schema.reconciliationItems)
      .set({
        allocatedBase:   d.allocatedBase,
        remainingBase:   d.remainingBase,
        matchGroupId:    group.matchGroupId,
        matchStatus:     d.matchStatus,
        matchMethod:     'manual',
        matchDifference: group.difference,
      })
      .where(eq(schema.reconciliationItems.id, d.id))
      .run();
  }
  for (const c of group.creditItems) {
    await db.update(schema.reconciliationItems)
      .set({
        allocatedBase:   c.allocatedBase,
        remainingBase:   c.remainingBase,
        matchGroupId:    group.matchGroupId,
        matchStatus:     c.matchStatus,
        matchMethod:     'manual',
        matchDifference: group.difference,
      })
      .where(eq(schema.reconciliationItems.id, c.id))
      .run();
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm session (post write-offs, lock session)
// ─────────────────────────────────────────────────────────────────────────────

export async function confirmSession(params: {
  sessionId: string;
  confirmedBy: string;
  companyId?: string;
  branchId?: string;
}): Promise<{ writeOffJournalEntryId: number | null; differenceAmount: number }> {
  const db = database as any;
  const session = await getSession(params.sessionId);
  if (session.status !== 'open') {
    throw new Error(`SESSION_NOT_OPEN: لا يمكن تأكيد جلسة ${session.status}`);
  }

  const items = await getSessionItems(params.sessionId);
  const tolerance = Number(session.toleranceAmount ?? 0);

  // Gather all within-tolerance differences to write off
  const matchGroupIds = [...new Set(items.map(i => i.matchGroupId).filter(Boolean))];
  let totalWriteOffGain = 0;
  let totalWriteOffLoss  = 0;

  interface WriteOffLine { accountCode: string; debit: number; credit: number; desc: string }
  const writeOffLines: WriteOffLine[] = [];
  const arAccountCode = SYSTEM_ACCOUNTS.RECEIVABLE;
  const apAccountCode = SYSTEM_ACCOUNTS.PAYABLE;

  for (const mgId of matchGroupIds) {
    if (!mgId) continue;
    const groupItems = items.filter(i => i.matchGroupId === mgId);
    const totalDebit  = round2(groupItems.filter(i => i.side === 'debit').reduce((s, i) => s + i.amountBase, 0));
    const totalCredit = round2(groupItems.filter(i => i.side === 'credit').reduce((s, i) => s + i.amountBase, 0));
    const diff = round2(totalDebit - totalCredit);

    if (Math.abs(diff) < 0.001) continue; // exact — no write-off
    if (Math.abs(diff) > tolerance + 0.001) continue; // beyond tolerance — not written off automatically

    const isAR = session.type === 'party_ar';
    const partyAccountCode = isAR ? arAccountCode : apAccountCode;
    const desc = `تسوية فرق مطابقة — مجموعة ${mgId.slice(0, 8)}`;

    if (diff > 0) {
      // Debit > credit → we have an excess receivable/payable → write off as loss
      totalWriteOffLoss += diff;
      writeOffLines.push({ accountCode: SYSTEM_ACCOUNTS.RECON_LOSS, debit: diff, credit: 0, desc });
      writeOffLines.push({ accountCode: partyAccountCode, debit: 0, credit: diff, desc });
    } else {
      // Credit > debit → overpayment → write off as gain
      const absDiff = Math.abs(diff);
      totalWriteOffGain += absDiff;
      writeOffLines.push({ accountCode: partyAccountCode, debit: absDiff, credit: 0, desc });
      writeOffLines.push({ accountCode: SYSTEM_ACCOUNTS.RECON_GAIN, debit: 0, credit: absDiff, desc });
    }
  }

  let writeOffJournalEntryId: number | null = null;
  const totalDiff = round2(totalWriteOffLoss - totalWriteOffGain);

  if (writeOffLines.length > 0) {
    // Resolve account IDs
    const finalLines: any[] = [];
    for (const wl of writeOffLines) {
      let accountId: number | null = null;
      try {
        accountId = await resolveAccountByCode(db, wl.accountCode, params.companyId);
      } catch {
        accountId = null;
      }
      if (!accountId) continue;
      finalLines.push({
        accountId,
        debit: wl.debit,
        credit: wl.credit,
        description: wl.desc,
      });
    }

    if (finalLines.length > 0) {
      const je = await createJournalEntry({
        entryDate:   new Date().toISOString().slice(0, 10),
        description: `تسوية فروق مطابقة — جلسة ${params.sessionId.slice(0, 8)}`,
        referenceType: 'reconciliation',
        referenceId:   null,
        companyId:     params.companyId,
        branchId:      params.branchId,
        createdBy:     Number.isFinite(Number(params.confirmedBy)) ? Number(params.confirmedBy) : null,
        bypassPeriodLock: false,
        lines: finalLines,
      });
      await postJournalEntry(je.id);
      writeOffJournalEntryId = je.id;
    }
  }

  // Compute totals
  const matchedItems   = items.filter(i => i.matchStatus === 'matched' || i.matchStatus === 'partial');
  const totalDebitM    = round2(matchedItems.filter(i => i.side === 'debit').reduce((s, i) => s + i.allocatedBase, 0));
  const totalCreditM   = round2(matchedItems.filter(i => i.side === 'credit').reduce((s, i) => s + i.allocatedBase, 0));

  // Lock session
  await db.update(schema.reconciliationSessions)
    .set({
      status:                'confirmed',
      totalDebitMatched:     totalDebitM,
      totalCreditMatched:    totalCreditM,
      differenceAmount:      totalDiff,
      writeOffJournalEntryId,
      confirmedBy:           params.confirmedBy,
      confirmedAt:           new Date().toISOString(),
      updatedAt:             new Date().toISOString(),
    })
    .where(eq(schema.reconciliationSessions.id, params.sessionId))
    .run();

  return { writeOffJournalEntryId, differenceAmount: totalDiff };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unmatch (reverse a match group within an open session)
// ─────────────────────────────────────────────────────────────────────────────

export async function unmatchGroup(sessionId: string, matchGroupId: string): Promise<void> {
  const db = database as any;
  const session = await getSession(sessionId);
  if (session.status !== 'open') {
    throw new Error('SESSION_NOT_OPEN: لا يمكن إلغاء مطابقة في جلسة مؤكدة');
  }

  await db.update(schema.reconciliationItems)
    .set({
      matchGroupId:    null,
      matchStatus:     'unmatched',
      matchMethod:     null,
      matchDifference: 0,
      allocatedBase:   0,
      remainingBase:   null, // will be recalculated from amountBase on read
    })
    .where(
      and(
        eq(schema.reconciliationItems.sessionId, sessionId),
        eq(schema.reconciliationItems.matchGroupId, matchGroupId),
      )
    )
    .run();

  // Fix remainingBase = amountBase for unmatched items
  const items: any[] = await db.select().from(schema.reconciliationItems)
    .where(eq(schema.reconciliationItems.sessionId, sessionId))
    .all();
  for (const item of items) {
    if (item.matchStatus === 'unmatched') {
      await db.update(schema.reconciliationItems)
        .set({ remainingBase: item.amountBase })
        .where(eq(schema.reconciliationItems.id, item.id))
        .run();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session summary / report
// ─────────────────────────────────────────────────────────────────────────────

export async function getSessionSummary(sessionId: string): Promise<SessionSummary> {
  const session = await getSession(sessionId);
  const items   = await getSessionItems(sessionId);

  const matched   = items.filter(i => i.matchStatus !== 'unmatched');
  const unmatched = items.filter(i => i.matchStatus === 'unmatched');
  const unmatchedDebits = unmatched.filter(i => i.side === 'debit');

  const agingBuckets = analyzeAging(unmatchedDebits);

  return {
    sessionId,
    type:          session.type,
    partyId:       session.partyId,
    partyName:     session.partyName,
    status:        session.status,
    itemCount:     items.length,
    matchedCount:  matched.length,
    unmatchedCount: unmatched.length,
    totalDebitMatched:  round2(matched.filter(i => i.side === 'debit').reduce((s, i) => s + i.allocatedBase, 0)),
    totalCreditMatched: round2(matched.filter(i => i.side === 'credit').reduce((s, i) => s + i.allocatedBase, 0)),
    differenceAmount:   Number(session.differenceAmount ?? 0),
    agingBuckets,
  };
}

/**
 * Generate full reconciliation report: all sessions for a party,
 * aggregated matched/unmatched amounts, aging, write-offs.
 */
export async function generateReconciliationReport(params: {
  companyId?: string;
  partyId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{
  sessions: any[];
  summary: {
    totalSessions: number;
    confirmedSessions: number;
    totalMatched: number;
    totalUnmatched: number;
    totalWriteOff: number;
  };
}> {
  const sessions = await listSessions(params.companyId, params.partyId);

  const filtered = sessions.filter((s: any) => {
    if (params.fromDate && String(s.fromDate || s.createdAt || '').slice(0, 10) < params.fromDate) return false;
    if (params.toDate   && String(s.toDate   || s.createdAt || '').slice(0, 10) > params.toDate)   return false;
    return true;
  });

  let totalMatched   = 0;
  let totalUnmatched = 0;
  let totalWriteOff  = 0;

  for (const s of filtered) {
    totalMatched   += Number(s.totalDebitMatched   ?? 0);
    totalUnmatched += Number(s.totalDebitMatched   ?? 0) > 0 ? 0 : 1; // rough
    totalWriteOff  += Math.abs(Number(s.differenceAmount ?? 0));
  }

  return {
    sessions: filtered,
    summary: {
      totalSessions:    filtered.length,
      confirmedSessions: filtered.filter((s: any) => s.status === 'confirmed').length,
      totalMatched:   round2(totalMatched),
      totalUnmatched: round2(totalUnmatched),
      totalWriteOff:  round2(totalWriteOff),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rowToItem(row: any): ReconciliationItem {
  return {
    id:             String(row.id),
    side:           row.side as 'debit' | 'credit',
    itemType:       String(row.itemType || row.item_type || ''),
    refId:          row.refId   ?? row.ref_id,
    refNumber:      row.refNumber ?? row.ref_number,
    refDate:        row.refDate ?? row.ref_date,
    partyId:        row.partyId ?? row.party_id,
    partyName:      row.partyName ?? row.party_name,
    currency:       String(row.currency || 'USD'),
    amountBase:     Number(row.amountBase ?? row.amount_base ?? 0),
    allocatedBase:  Number(row.allocatedBase ?? row.allocated_base ?? 0),
    remainingBase:  Number(row.remainingBase ?? row.remaining_base ?? row.amountBase ?? row.amount_base ?? 0),
    matchGroupId:   row.matchGroupId ?? row.match_group_id ?? null,
    matchStatus:    (row.matchStatus ?? row.match_status ?? 'unmatched') as ReconciliationItem['matchStatus'],
    matchMethod:    row.matchMethod ?? row.match_method ?? null,
    matchDifference: Number(row.matchDifference ?? row.match_difference ?? 0),
  };
}
