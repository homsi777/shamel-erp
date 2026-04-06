import { db as database, getResolvedDbPath, closeDb } from '../db';
import * as schema from '../db/schema';
import { sql, eq, desc, and } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
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
} from '../accountingService';
import { ACCOUNTING_LABELS, buildDescription } from '../accounting-labels';

export const db = database as any;

export const TABLE_MAP: Record<string, any> = {
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
  'audit-logs': schema.auditLogs,
  'item-groups': schema.itemGroups,
  'item-group-items': schema.itemGroupItems,
  'item-serials': schema.itemSerials,
  'item-barcodes': schema.itemBarcodes,
  'promotions': schema.promotions,
  'branches': schema.branches,
  'remote-branches': schema.remoteBranches,
  'settings': schema.systemSettings,
  'inventory/transfers': schema.stockTransfers,
  'parties/transfers': schema.partyTransfers,
  'reconciliation-marks': schema.reconciliationMarks
};

export const safeJsonParse = (value: any, fallback: any) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

export const stringifyOrEmpty = (value: any) => JSON.stringify(value || []);

export type RouteContext = {
  [k: string]: any;
};

export {
  schema,
  sql,
  eq,
  desc,
  and,
  fs,
  path,
  getResolvedDbPath,
  closeDb,
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
  SYSTEM_ACCOUNTS
};

/* ── Sequential numeric document numbering ─────────────────────────
 * Each document type is identified by its digit count (no letters).
 * | Type            | Digits | Range               |
 * |-----------------|--------|---------------------|
 * | Opening stock   | 3      | 100 – 999           |
 * | Purchase        | 4      | 1000 – 9999         |
 * | Sale            | 5      | 10000 – 99999       |
 * | POS             | 6      | 100000 – 999999     |
 * | Voucher         | 7      | 1000000 – 9999999   |
 * | Return          | 8      | 10000000 – 49999999 |
 * | Exchange        | 8      | 50000000 – 89999999 |
 */
export const DOC_RANGES: Record<string, { min: number; max: number }> = {
  opening_stock: { min: 100, max: 999 },
  purchase:      { min: 1000, max: 9999 },
  sale:          { min: 10000, max: 99999 },
  pos:           { min: 100000, max: 999999 },
  voucher:       { min: 1000000, max: 9999999 },
  return:        { min: 10000000, max: 49999999 },
  exchange:      { min: 50000000, max: 89999999 },
  consignment_document: { min: 90000000, max: 94999999 },
  consignment_settlement: { min: 95000000, max: 99999999 },
};

const buildSequenceKey = (
  type: 'opening_stock' | 'purchase' | 'sale' | 'pos' | 'voucher' | 'return' | 'exchange' | 'consignment_document' | 'consignment_settlement',
  scope?: { companyId?: string | null; branchId?: string | null },
) => {
  const companyId = String(scope?.companyId || 'global').trim() || 'global';
  const branchId = String(scope?.branchId || '*').trim() || '*';
  return `docseq:${companyId}:${branchId}:${type}`;
};

const newSequenceId = (type: string) => `docseq-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Reserve the next sequential document number for a given type.
 * Uses a persisted atomic counter instead of MAX+1 to remain safe under concurrent POS terminals.
 */
export async function getNextDocNumber(
  type: 'opening_stock' | 'purchase' | 'sale' | 'pos' | 'voucher' | 'return' | 'exchange' | 'consignment_document' | 'consignment_settlement',
  scope?: { companyId?: string | null; branchId?: string | null },
): Promise<string> {
  const range = DOC_RANGES[type];
  if (!range) return String(Date.now());
  const sequenceKey = buildSequenceKey(type, scope);
  return await db.transaction(async (tx: any) => {
    const existing = await tx.select().from(schema.documentSequences)
      .where(eq(schema.documentSequences.sequenceKey, sequenceKey))
      .get();
    const current = Number(existing?.lastValue || 0);
    const nextValue = Math.max(current + 1, range.min);
    if (nextValue > range.max) {
      throw new Error(`DOCUMENT_SEQUENCE_EXHAUSTED:${type}`);
    }
    if (existing) {
      await tx.update(schema.documentSequences)
        .set({ lastValue: nextValue, updatedAt: new Date().toISOString() })
        .where(eq(schema.documentSequences.sequenceKey, sequenceKey))
        .run();
    } else {
      await tx.insert(schema.documentSequences).values({
        id: newSequenceId(type),
        companyId: scope?.companyId || null,
        branchId: scope?.branchId || null,
        sequenceKey,
        documentType: type,
        lastValue: nextValue,
        updatedAt: new Date().toISOString(),
      }).run();
    }
    return String(nextValue);
  });
}
