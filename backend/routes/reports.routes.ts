import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { registerReportsHubRoute } from './reports.hub';
import { appError } from '../lib/errors';
import {
  BASE_CURRENCY,
  itemCostBase,
  normalizeCurrencyCode,
  normalizeExchangeRate,
  toBaseAmount,
  toTransactionAmount,
} from '../lib/currency';
import {
  assertEntityBelongsToCompany,
  filterRowsByTenantScope,
  hasBranchAccess,
  resolveEntityBranchId,
} from '../lib/tenantScope';
import { getAccountLogicalCode } from '../accountingService';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, appendAudit, buildPartyStatement, getBackupDir, buildBackupPayload, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, fs, path, getResolvedDbPath, closeDb, bcrypt, server, getLocalIp } = ctx as any;
  const getAuthContext = (req: any) => (req as any).authContext || {};
  const getRequestedBranchId = (req: any) => {
    const q = req.query as any;
    const branchId = String(q?.branchId || 'all').trim();
    return branchId && branchId !== 'all' ? branchId : null;
  };
  const scopeRows = (rows: any[], req: any, collection: string) => {
    const authContext = getAuthContext(req);
    const requestedBranchId = getRequestedBranchId(req);
    if (requestedBranchId && !hasBranchAccess(authContext, requestedBranchId)) {
      throw appError(403, 'BRANCH_ACCESS_DENIED', 'هذا الفرع غير مسموح للمستخدم الحالي.', {
        branch_id: requestedBranchId,
      });
    }
    let scopedRows = filterRowsByTenantScope(rows, authContext, collection);
    if (requestedBranchId) {
      scopedRows = scopedRows.filter((row: any) => {
        const rowBranchId = resolveEntityBranchId(row);
        return !rowBranchId || rowBranchId === requestedBranchId;
      });
    }
    return scopedRows;
  };

api.get('/reports/trial-balance', async (req) => {
  const q = req.query as any;
  const asOf = q.asOfDate || new Date().toISOString().split('T')[0];
  const entries = scopeRows(await db.select().from(schema.journalEntries).all(), req, 'journal-entries');
  const postedIds = new Set((entries || [])
    .filter((entry: any) => entry.status === 'posted' && String(entry.entryDate || '') <= asOf)
    .map((entry: any) => entry.id));
  const lines = await db.select().from(schema.journalEntryLines).all();
  const accounts = scopeRows(await db.select().from(schema.accounts).all(), req, 'accounts');
  const byAccount = new Map<number, { debit: number; credit: number }>();
  for (const line of lines || []) {
    if (!postedIds.has(line.journalEntryId)) continue;
    const prev = byAccount.get(line.accountId) || { debit: 0, credit: 0 };
    prev.debit += Number(line.debit || 0);
    prev.credit += Number(line.credit || 0);
    byAccount.set(line.accountId, prev);
  }
  return accounts.map((account: any) => {
    const totals = byAccount.get(account.id) || { debit: 0, credit: 0 };
    return {
      accountId: account.id,
      code: getAccountLogicalCode(account),
      nameAr: account.nameAr,
      accountType: account.accountType,
      debit: roundMoney(totals.debit),
      credit: roundMoney(totals.credit),
      balance: roundMoney(totals.debit - totals.credit),
    };
  });
});


api.get('/reports/account-statement/:accountId', async (req) => {
  const { accountId } = req.params as any;
  const q = req.query as any;
  const fromDate = q.from || q.fromDate || '2000-01-01';
  const toDate = q.to || q.toDate || '2100-12-31';
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, Number(accountId))).get();
  const authContext = getAuthContext(req);
  assertEntityBelongsToCompany(account, String(authContext.companyId || ''), 'Account not found.');
  const scopedEntries = scopeRows(await db.select().from(schema.journalEntries).all(), req, 'journal-entries');
  const postedEntryById = new Map<number, any>(
    (scopedEntries || [])
      .filter((entry: any) => entry.status === 'posted' && String(entry.entryDate || '') >= fromDate && String(entry.entryDate || '') <= toDate)
      .map((entry: any) => [Number(entry.id), entry])
  );
  const accountLines = await db.select().from(schema.journalEntryLines).where(eq(schema.journalEntryLines.accountId, Number(accountId))).all();
  const rawLines = (accountLines || [])
    .filter((line: any) => postedEntryById.has(Number(line.journalEntryId)))
    .map((line: any) => {
      const entry = postedEntryById.get(Number(line.journalEntryId));
      return {
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        description: entry.description,
        debit: line.debit,
        credit: line.credit,
      };
    });
  const sorted = (rawLines || []).sort((a: any, b: any) => String(a.entryDate).localeCompare(String(b.entryDate)));
  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines = sorted.map((l: any) => {
    const debit = Number(l.debit || 0);
    const credit = Number(l.credit || 0);
    totalDebit += debit;
    totalCredit += credit;
    running += debit - credit;
    return {
      date: l.entryDate,
      entryNumber: l.entryNumber,
      description: l.description,
      debit,
      credit,
      balance: running
    };
  });
  return {
    account: account ? { ...account, code: getAccountLogicalCode(account), storageCode: account.code } : null,
    lines,
    totals: { debit: roundMoney(totalDebit), credit: roundMoney(totalCredit), balance: roundMoney(running) },
    currency: account?.currencyCode || 'SYP'
  };
});


api.get('/reports/journal-book', async (req) => {
  const q = req.query as any;
  const fromDate = q.from || q.fromDate || '2000-01-01';
  const toDate = q.to || q.toDate || '2100-12-31';
  const entries = scopeRows(await db.select().from(schema.journalEntries).all(), req, 'journal-entries');
  const posted = (entries || []).filter((e: any) =>
    e.status === 'posted' && String(e.entryDate || '') >= fromDate && String(e.entryDate || '') <= toDate
  );
  const lines = await db.select().from(schema.journalEntryLines).all();
  const accounts = scopeRows(await db.select({
    id: schema.accounts.id,
    code: schema.accounts.code,
    nameAr: schema.accounts.nameAr,
    accountType: schema.accounts.accountType
  }).from(schema.accounts).all(), req, 'accounts');
  const accountMap = new Map<number, { id: number; code: string; nameAr: string; accountType: string }>(
    accounts.map((a: any) => [Number(a.id), { id: Number(a.id), code: getAccountLogicalCode(a), nameAr: String(a.nameAr || ''), accountType: String(a.accountType || '') }])
  );
  const result = posted.map((entry: any) => ({
    entryNumber: entry.entryNumber,
    entryDate: entry.entryDate,
    description: entry.description,
    lines: (lines || []).filter((l: any) => l.journalEntryId === entry.id).map((l: any) => {
      const acc = accountMap.get(l.accountId);
      return {
        accountId: l.accountId,
        accountCode: acc?.code || '',
        accountName: acc?.nameAr || '',
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0)
      };
    })
  }));
  return { entries: result };
});


api.get('/reports/income-statement', async (req) => {
  const q = req.query as any;
  const fromDate = q.from || q.fromDate || '2000-01-01';
  const toDate = q.to || q.toDate || '2100-12-31';
  const entries = scopeRows(await db.select().from(schema.journalEntries).all(), req, 'journal-entries');
  const postedIds = new Set((entries || [])
    .filter((e: any) => e.status === 'posted' && String(e.entryDate || '') >= fromDate && String(e.entryDate || '') <= toDate)
    .map((e: any) => e.id));

  const accounts = scopeRows(await db.select({
    id: schema.accounts.id,
    code: schema.accounts.code,
    nameAr: schema.accounts.nameAr,
    accountType: schema.accounts.accountType
  }).from(schema.accounts).all(), req, 'accounts');
  const accountMap = new Map<number, { id: number; code: string; nameAr: string; accountType: string }>(
    accounts.map((a: any) => [Number(a.id), { id: Number(a.id), code: getAccountLogicalCode(a), nameAr: String(a.nameAr || ''), accountType: String(a.accountType || '') }])
  );
  const lines = await db.select().from(schema.journalEntryLines).all();

  const revenueMap = new Map<number, number>();
  const expenseMap = new Map<number, number>();
  for (const line of lines || []) {
    if (!postedIds.has(line.journalEntryId)) continue;
    const acc = accountMap.get(line.accountId);
    if (!acc) continue;
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (acc.accountType === 'revenue') {
      revenueMap.set(acc.id, roundMoney((revenueMap.get(acc.id) || 0) + (credit - debit)));
    }
    if (acc.accountType === 'expenses') {
      expenseMap.set(acc.id, roundMoney((expenseMap.get(acc.id) || 0) + (debit - credit)));
    }
  }

  const revenues = Array.from(revenueMap.entries()).map(([id, balance]) => {
    const acc = accountMap.get(id);
    return { code: acc?.code || '', name: acc?.nameAr || '', balance: roundMoney(balance) };
  }).filter((r) => r.balance !== 0);
  const expenses = Array.from(expenseMap.entries()).map(([id, balance]) => {
    const acc = accountMap.get(id);
    return { code: acc?.code || '', name: acc?.nameAr || '', balance: roundMoney(balance) };
  }).filter((r) => r.balance !== 0);

  const totalRevenue = roundMoney(revenues.reduce((s, r) => s + Number(r.balance || 0), 0));
  const totalExpenses = roundMoney(expenses.reduce((s, r) => s + Number(r.balance || 0), 0));
  const netIncome = roundMoney(totalRevenue - totalExpenses);

  return { revenues, expenses, totalRevenue, totalExpenses, netIncome };
});


api.get('/reports/balance-sheet', async (req) => {
  const q = req.query as any;
  const asOfDate = q.asOfDate || q.asOf || new Date().toISOString().split('T')[0];
  const entries = scopeRows(await db.select().from(schema.journalEntries).all(), req, 'journal-entries');
  const postedIds = new Set((entries || [])
    .filter((e: any) => e.status === 'posted' && String(e.entryDate || '') <= asOfDate)
    .map((e: any) => e.id));

  const accounts = scopeRows(await db.select({
    id: schema.accounts.id,
    code: schema.accounts.code,
    nameAr: schema.accounts.nameAr,
    accountType: schema.accounts.accountType
  }).from(schema.accounts).all(), req, 'accounts');
  const accountMap = new Map<number, { id: number; code: string; nameAr: string; accountType: string }>(
    accounts.map((a: any) => [Number(a.id), { id: Number(a.id), code: getAccountLogicalCode(a), nameAr: String(a.nameAr || ''), accountType: String(a.accountType || '') }])
  );
  const lines = await db.select().from(schema.journalEntryLines).all();

  const assetsMap = new Map<number, number>();
  const liabilitiesMap = new Map<number, number>();
  const equityMap = new Map<number, number>();
  let revenueTotal = 0;
  let expenseTotal = 0;

  for (const line of lines || []) {
    if (!postedIds.has(line.journalEntryId)) continue;
    const acc = accountMap.get(line.accountId);
    if (!acc) continue;
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);

    if (acc.accountType === 'assets') {
      assetsMap.set(acc.id, roundMoney((assetsMap.get(acc.id) || 0) + (debit - credit)));
    } else if (acc.accountType === 'liabilities') {
      liabilitiesMap.set(acc.id, roundMoney((liabilitiesMap.get(acc.id) || 0) + (credit - debit)));
    } else if (acc.accountType === 'equity') {
      equityMap.set(acc.id, roundMoney((equityMap.get(acc.id) || 0) + (credit - debit)));
    } else if (acc.accountType === 'revenue') {
      revenueTotal += (credit - debit);
    } else if (acc.accountType === 'expenses') {
      expenseTotal += (debit - credit);
    }
  }

  const netIncome = roundMoney(revenueTotal - expenseTotal);

  const assets = Array.from(assetsMap.entries()).map(([id, balance]) => {
    const acc = accountMap.get(id);
    return { code: acc?.code || '', name: acc?.nameAr || '', balance: roundMoney(balance) };
  }).filter((r) => r.balance !== 0);

  const liabilities = Array.from(liabilitiesMap.entries()).map(([id, balance]) => {
    const acc = accountMap.get(id);
    return { code: acc?.code || '', name: acc?.nameAr || '', balance: roundMoney(balance) };
  }).filter((r) => r.balance !== 0);

  const equity = Array.from(equityMap.entries()).map(([id, balance]) => {
    const acc = accountMap.get(id);
    return { code: acc?.code || '', name: acc?.nameAr || '', balance: roundMoney(balance) };
  }).filter((r) => r.balance !== 0);

  const totalAssets = roundMoney(assets.reduce((s, r) => s + Number(r.balance || 0), 0));
  const totalLiabilities = roundMoney(liabilities.reduce((s, r) => s + Number(r.balance || 0), 0));
  const totalEquity = roundMoney(equity.reduce((s, r) => s + Number(r.balance || 0), 0) + netIncome);

  return {
    asOfDate,
    assets,
    liabilities,
    equity,
    totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, netIncome }
  };
});

const inDateRange = (dateStr: string, from: string, to: string) => {
  const d = String(dateStr || '');
  return d >= from && d <= to;
};

const monthKey = (dateStr: string) => String(dateStr || '').slice(0, 7);

const normalizeInvoiceItems = (rawItems: any): any[] => {
  if (Array.isArray(rawItems)) return rawItems;
  if (typeof rawItems === 'string') {
    try {
      const parsed = JSON.parse(rawItems);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const toNum = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const invoiceCurrencyCode = (inv: any): string => normalizeCurrencyCode(inv?.currency || BASE_CURRENCY);
const invoiceRate = (inv: any): number => normalizeExchangeRate(invoiceCurrencyCode(inv), inv?.exchangeRate);

const invoiceBaseAmount = (
  inv: any,
  kind: 'total' | 'paid' | 'remaining' | 'discount' = 'total'
): number => {
  const currency = invoiceCurrencyCode(inv);
  const rate = invoiceRate(inv);
  const explicitBase = kind === 'total'
    ? toNum(inv?.totalAmountBase)
    : kind === 'paid'
      ? toNum(inv?.paidAmountBase)
      : kind === 'remaining'
        ? toNum(inv?.remainingAmountBase)
        : toNum(inv?.discountBase);
  if (explicitBase) return explicitBase;
  const raw = kind === 'total'
    ? toNum(inv?.totalAmount)
    : kind === 'paid'
      ? toNum(inv?.paidAmount)
      : kind === 'remaining'
        ? toNum(inv?.remainingAmount)
        : toNum(inv?.discount);
  if (!raw) return 0;
  return currency === BASE_CURRENCY ? raw : toBaseAmount(raw, currency, rate);
};

const invoiceTransactionAmount = (
  inv: any,
  kind: 'total' | 'paid' | 'remaining' | 'discount' = 'total'
): number => {
  const currency = invoiceCurrencyCode(inv);
  const rate = invoiceRate(inv);
  const explicitTxn = kind === 'total'
    ? toNum(inv?.totalAmountTransaction ?? inv?.originalAmount)
    : kind === 'paid'
      ? toNum(inv?.paidAmountTransaction ?? inv?.paidAmountOriginal)
      : kind === 'remaining'
        ? toNum(inv?.remainingAmountTransaction)
        : toNum(inv?.discountTransaction);
  if (explicitTxn) return explicitTxn;
  const base = invoiceBaseAmount(inv, kind);
  if (!base) return 0;
  return currency === BASE_CURRENCY ? base : toTransactionAmount(base, currency, rate);
};

const voucherCurrencyCode = (v: any): string => normalizeCurrencyCode(v?.currency || BASE_CURRENCY);
const voucherRate = (v: any): number => normalizeExchangeRate(voucherCurrencyCode(v), v?.exchangeRate);
const voucherBaseAmount = (v: any): number => {
  const explicitBase = toNum(v?.amountBase);
  if (explicitBase) return explicitBase;
  const raw = toNum(v?.amount);
  if (!raw) return 0;
  const currency = voucherCurrencyCode(v);
  return currency === BASE_CURRENCY ? raw : toBaseAmount(raw, currency, voucherRate(v));
};
const voucherTransactionAmount = (v: any): number => {
  const explicitTxn = toNum(v?.amountTransaction ?? v?.originalAmount);
  if (explicitTxn) return explicitTxn;
  const base = voucherBaseAmount(v);
  if (!base) return 0;
  const currency = voucherCurrencyCode(v);
  return currency === BASE_CURRENCY ? base : toTransactionAmount(base, currency, voucherRate(v));
};

const partyDeltaBase = (row: any): number => toNum(row?.deltaBase ?? row?.delta);

const lineQuantity = (line: any): number => toNum(line?.baseQuantity ?? line?.quantity);
const lineUnitBaseFromInvoice = (line: any, inv: any): number => {
  const explicitBase = toNum(line?.unitPriceBase);
  if (explicitBase) return explicitBase;
  const raw = toNum(line?.unitPrice ?? line?.priceAtSale ?? line?.price);
  if (!raw) return 0;
  const currency = invoiceCurrencyCode(inv);
  return currency === BASE_CURRENCY ? raw : toBaseAmount(raw, currency, invoiceRate(inv));
};
const lineTotalBaseFromInvoice = (line: any, inv: any): number => {
  const explicitBase = toNum(line?.lineTotalBase ?? line?.totalBase);
  if (explicitBase) return explicitBase;
  const explicitTxn = toNum(line?.lineTotalTransaction ?? line?.totalTransaction ?? line?.total);
  if (explicitTxn) {
    const currency = invoiceCurrencyCode(inv);
    return currency === BASE_CURRENCY ? explicitTxn : toBaseAmount(explicitTxn, currency, invoiceRate(inv));
  }
  return lineUnitBaseFromInvoice(line, inv) * lineQuantity(line);
};

api.get('/reports/summary', async (req) => {
  const q = req.query as any;
  const fromDate = q.from || q.fromDate || '2000-01-01';
  const toDate = q.to || q.toDate || '2100-12-31';
  const invoices = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
  const vouchers = scopeRows(await db.select().from(schema.vouchers).all(), req, 'vouchers');
  const parties = scopeRows(await db.select().from(schema.parties).all(), req, 'parties');
  const items = scopeRows(await db.select().from(schema.items).all(), req, 'items');

  const scopedInvoices = (invoices || []).filter((i: any) => inDateRange(i.date, fromDate, toDate));
  const scopedVouchers = (vouchers || []).filter((v: any) => inDateRange(v.date, fromDate, toDate));
  const totalSales = scopedInvoices
    .filter((i: any) => i.type === 'sale')
    .reduce((s: number, i: any) => s + invoiceBaseAmount(i, 'total'), 0);
  const totalPurchases = scopedInvoices
    .filter((i: any) => i.type === 'purchase')
    .reduce((s: number, i: any) => s + invoiceBaseAmount(i, 'total'), 0);
  const totalReceipts = scopedVouchers
    .filter((v: any) => v.type === 'receipt')
    .reduce((s: number, v: any) => s + voucherBaseAmount(v), 0);
  const totalPayments = scopedVouchers
    .filter((v: any) => v.type === 'payment')
    .reduce((s: number, v: any) => s + voucherBaseAmount(v), 0);
  const inventoryValue = (items || []).reduce((s: number, i: any) => s + (Number(i.quantity || 0) * itemCostBase(i)), 0);

  return {
    fromDate,
    toDate,
    totals: {
      sales: roundMoney(totalSales),
      purchases: roundMoney(totalPurchases),
      receipts: roundMoney(totalReceipts),
      payments: roundMoney(totalPayments),
      inventoryValue: roundMoney(inventoryValue),
      partiesCount: parties.length,
      invoicesCount: scopedInvoices.length,
      vouchersCount: scopedVouchers.length
    }
  };
});

api.get('/reports/invoices', async (req) => {
  const q = req.query as any;
  const fromDate = q.from || q.fromDate || '2000-01-01';
  const toDate = q.to || q.toDate || '2100-12-31';
  const invoiceType = String(q.invoiceType || 'all').toLowerCase();
  const partyId = String(q.partyId || '');
  const currency = String(q.currency || 'all').toUpperCase();
  const branchId = String(q.branchId || 'all');
  const status = String(q.status || 'all').toLowerCase();
  const useTransactionView = currency !== 'ALL' && currency !== BASE_CURRENCY;

  const rows = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
  const filtered = (rows || []).filter((inv: any) => {
    if (!inDateRange(inv.date, fromDate, toDate)) return false;
    if (invoiceType !== 'all' && String(inv.type || '').toLowerCase() !== invoiceType) return false;
    if (partyId && String(inv.clientId || '') !== partyId) return false;
    if (currency !== 'ALL' && invoiceCurrencyCode(inv) !== currency) return false;
    if (branchId !== 'all' && String(inv.branchId || '') !== branchId) return false;
    if (status !== 'all') {
      const remaining = invoiceBaseAmount(inv, 'remaining');
      const invStatus = remaining > 0 ? 'open' : 'closed';
      if (invStatus !== status) return false;
    }
    return true;
  }).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));

  const total = filtered.reduce((s: number, inv: any) => s + (useTransactionView ? invoiceTransactionAmount(inv, 'total') : invoiceBaseAmount(inv, 'total')), 0);
  return {
    rows: filtered.map((inv: any) => ({
      date: inv.date,
      invoiceNumber: inv.invoiceNumber || inv.id,
      type: inv.type,
      partyName: inv.clientName || '—',
      totalAmount: useTransactionView ? invoiceTransactionAmount(inv, 'total') : invoiceBaseAmount(inv, 'total'),
      paidAmount: useTransactionView ? invoiceTransactionAmount(inv, 'paid') : invoiceBaseAmount(inv, 'paid'),
      remainingAmount: useTransactionView ? invoiceTransactionAmount(inv, 'remaining') : invoiceBaseAmount(inv, 'remaining'),
      currency: useTransactionView ? invoiceCurrencyCode(inv) : BASE_CURRENCY,
      notes: inv.notes || '',
      ref: { invoiceId: inv.id, partyId: inv.clientId || null }
    })),
    totals: { count: filtered.length, amount: roundMoney(total) }
  };
});

api.get('/reports/party-statement', async (req) => {
  const q = req.query as any;
  const fromDate = q.from || q.fromDate || '2000-01-01';
  const toDate = q.to || q.toDate || '2100-12-31';
  const partyId = String(q.partyId || '');
  const partyType = String(q.partyType || 'all').toUpperCase();

  const parties = scopeRows(await db.select().from(schema.parties).all(), req, 'parties');
  const txRows = scopeRows(await db.select().from(schema.partyTransactions).all(), req, 'party-transactions');
  const allInvoices = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
  const allVouchers = scopeRows(await db.select().from(schema.vouchers).all(), req, 'vouchers');
  const selected = (parties || []).filter((p: any) => {
    if (partyId && p.id !== partyId) return false;
    if (partyType === 'ALL') return true;
    return p.type === partyType || p.type === 'BOTH';
  });

  const labelForKind = (kind: string) => {
    const k = String(kind || '').toLowerCase();
    if (k.includes('return') && k.includes('sale')) return 'فاتورة مرتجع مبيعات';
    if (k.includes('return') && k.includes('purchase')) return 'فاتورة مرتجع مشتريات';
    if (k.includes('return')) return 'فاتورة مرتجع';
    if (k.includes('sale')) return 'فاتورة مبيعات';
    if (k.includes('purchase')) return 'فاتورة مشتريات';
    if (k.includes('receipt')) return 'سند قبض';
    if (k.includes('payment')) return 'سند دفع';
    if (k.includes('opening')) return 'رصيد افتتاحي';
    if (k.includes('transfer')) return 'تحويل';
    return 'حركة مالية';
  };

  const rows: any[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const party of selected) {
    const isSupplier = String(party.type || '').toUpperCase() === 'SUPPLIER';

    // 1. Existing party transactions from ledger
    const partyTx = (txRows || []).filter((t: any) => t.partyId === party.id);
    const ptRefIds = new Set(partyTx.map((r: any) => r.refId).filter(Boolean));

    // Build combined entries (same approach as buildPartyStatementInternal)
    const allEntries: any[] = [];

    for (const r of partyTx) {
      allEntries.push({
        id: r.id,
        kind: r.kind,
        refId: r.refId,
        delta: partyDeltaBase(r),
        createdAt: r.createdAt,
        currency: BASE_CURRENCY,
        source: 'ledger'
      });
    }

    // 2. Add invoices not in ledger
    const partyInvoices = (allInvoices || []).filter((inv: any) => String(inv.clientId || '') === party.id);
    for (const inv of partyInvoices) {
      if (ptRefIds.has(inv.id)) continue;
      const invType = String((inv as any).type || '');
      if (!['sale', 'purchase', 'return', 'exchange'].includes(invType)) continue;
      const total = invoiceBaseAmount(inv, 'total');
      if (total === 0) continue;
      let delta = 0;
      if (invType === 'sale') delta = isSupplier ? -total : total;
      else if (invType === 'purchase') delta = isSupplier ? total : -total;
      else if (invType === 'return') delta = isSupplier ? -total : -total;
      const retType = String((inv as any).returnType || (inv as any).return_type || '').toLowerCase();
      const returnKind = retType === 'sale' ? 'invoice_return_sale' : retType === 'purchase' ? 'invoice_return_purchase' : 'invoice_return';
      allEntries.push({
        id: `inv-${inv.id}`, kind: invType === 'sale' ? 'invoice_sale' : invType === 'purchase' ? 'invoice_purchase' : returnKind,
        refId: inv.id, delta, createdAt: (inv as any).createdAt || (inv as any).date,
        currency: BASE_CURRENCY, source: 'invoice'
      });
    }

    // 3. Add vouchers not in ledger
    const partyVouchers = (allVouchers || []).filter((v: any) => String(v.clientId || '') === party.id);
    for (const v of partyVouchers) {
      if (ptRefIds.has(v.id)) continue;
      const vType = String(v.type || '');
      if (!['receipt', 'payment'].includes(vType)) continue;
      const amount = voucherBaseAmount(v);
      if (amount === 0) continue;
      let delta = 0;
      if (vType === 'receipt') delta = isSupplier ? amount : -amount;
      else if (vType === 'payment') delta = isSupplier ? -amount : amount;
      allEntries.push({
        id: `vch-${v.id}`, kind: vType, refId: v.id, delta,
        createdAt: (v as any).createdAt || v.date, currency: BASE_CURRENCY, source: 'voucher'
      });
    }

    // Filter by date and sort
    const filtered = allEntries.filter((r: any) => inDateRange(String(r.createdAt || ''), fromDate, toDate))
      .sort((a: any, b: any) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    let running = 0;
    for (const entry of filtered) {
      const delta = Number(entry.delta || 0);
      let debit = 0;
      let credit = 0;
      if (isSupplier) {
        if (delta > 0) credit = delta;
        if (delta < 0) debit = Math.abs(delta);
      } else {
        if (delta > 0) debit = delta;
        if (delta < 0) credit = Math.abs(delta);
      }
      running += debit - credit;
      totalDebit += debit;
      totalCredit += credit;
      rows.push({
        date: entry.createdAt,
        partyName: party.name,
        partyType: party.type,
        kind: entry.kind,
        refId: entry.refId,
        memo: labelForKind(entry.kind),
        debit,
        credit,
        balance: running,
        currency: entry.currency || BASE_CURRENCY,
        ref: {
          partyId: party.id,
          invoiceId: String(entry.kind || '').includes('invoice') || String(entry.kind || '').includes('sale') || String(entry.kind || '').includes('purchase') ? entry.refId : null,
          voucherId: String(entry.kind || '').includes('voucher') || String(entry.kind || '').includes('receipt') || String(entry.kind || '').includes('payment') ? entry.refId : null
        }
      });
    }
  }

  return {
    rows,
    totals: {
      debit: roundMoney(totalDebit),
      credit: roundMoney(totalCredit),
      balance: roundMoney(totalDebit - totalCredit)
    }
  };
});

api.get('/reports/item-movement', async (req) => {
  const q = req.query as any;
  const fromDate = q.from || q.fromDate || '2000-01-01';
  const toDate = q.to || q.toDate || '2100-12-31';
  const itemId = String(q.itemId || '');
  const warehouseId = String(q.warehouseId || 'all');

  const invoices = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
  const rows: any[] = [];
  let inward = 0;
  let outward = 0;
  for (const inv of invoices || []) {
    if (!inDateRange(inv.date, fromDate, toDate)) continue;
    let items: any[] = [];
    try { items = inv.items ? JSON.parse(inv.items as any) : []; } catch { items = []; }
    for (const line of Array.isArray(items) ? items : []) {
      const currentItemId = String(line.itemId || '');
      if (itemId && currentItemId !== itemId) continue;
      const currentWh = String(line.warehouseId || inv.targetWarehouseId || '');
      if (warehouseId !== 'all' && currentWh !== warehouseId) continue;
      const qty = Number(line.quantity || line.baseQuantity || 0);
      const isIn = inv.type === 'purchase' || inv.type === 'opening_stock';
      if (isIn) inward += qty; else outward += qty;
      rows.push({
        date: inv.date,
        refNumber: inv.invoiceNumber || inv.id,
        warehouseName: inv.targetWarehouseName || line.warehouseName || '—',
        itemName: line.itemName || currentItemId,
        movementType: isIn ? 'IN' : 'OUT',
        quantity: qty,
        unitName: line.unitName || '',
        notes: inv.notes || '',
        ref: { invoiceId: inv.id, itemId: currentItemId }
      });
    }
  }

  return {
    rows,
    totals: {
      inward: roundMoney(inward),
      outward: roundMoney(outward),
      net: roundMoney(inward - outward)
    }
  };
});

api.get('/reports/stock-by-warehouse', async (req) => {
  const q = req.query as any;
  const warehouseId = String(q.warehouseId || 'all');
  const rows = scopeRows(await db.select().from(schema.items).all(), req, 'items');
  const filtered = (rows || []).filter((item: any) => warehouseId === 'all' || String(item.warehouseId || '') === warehouseId);
  return {
    rows: filtered.map((item: any) => ({
      itemId: item.id,
      itemName: item.name,
      itemCode: item.code,
      warehouseId: item.warehouseId || '',
      warehouseName: item.warehouseName || '—',
      quantity: Number(item.quantity || 0),
      costPrice: itemCostBase(item),
      totalValue: roundMoney(Number(item.quantity || 0) * itemCostBase(item)),
      ref: { itemId: item.id }
    })),
    totals: {
      quantity: roundMoney(filtered.reduce((s: number, item: any) => s + Number(item.quantity || 0), 0)),
      value: roundMoney(filtered.reduce((s: number, item: any) => s + (Number(item.quantity || 0) * itemCostBase(item)), 0))
    }
  };
});

// ── Analytics Smart Reports ───────────────────────────────────────────
api.get('/reports/analytics', async (req) => {
  const q = req.query as any;
  const mode = String(q.mode || 'top_selling');
  const from = String(q.from || '2000-01-01');
  const to = String(q.to || '2100-12-31');
  const limit = Math.min(Number(q.limit) || 20, 100);

  const allInvoices = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
  const dateFiltered = allInvoices.filter((inv: any) => {
    const d = String(inv.date || '').slice(0, 10);
    return d >= from && d <= to;
  });

  if (mode === 'top_selling') {
    const itemMap = new Map<string, { name: string; totalQty: number; totalAmount: number; count: number }>();
    for (const inv of dateFiltered.filter((i: any) => i.type === 'sale')) {
      const items = normalizeInvoiceItems(inv.items);
      for (const it of items) {
        const key = it.itemId || it.fabricName || it.itemName || 'unknown';
        const prev = itemMap.get(key) || { name: it.fabricName || it.itemName || key, totalQty: 0, totalAmount: 0, count: 0 };
        prev.totalQty += lineQuantity(it);
        prev.totalAmount += lineTotalBaseFromInvoice(it, inv);
        prev.count++;
        itemMap.set(key, prev);
      }
    }
    const rows = [...itemMap.entries()]
      .sort((a, b) => b[1].totalQty - a[1].totalQty)
      .slice(0, limit)
      .map(([id, v], i) => ({ rank: i + 1, itemId: id, itemName: v.name, totalQty: roundMoney(v.totalQty), totalAmount: roundMoney(v.totalAmount), invoiceCount: v.count }));
    return { mode, rows, totals: { count: rows.length } };
  }

  if (mode === 'top_purchased') {
    const itemMap = new Map<string, { name: string; totalQty: number; totalAmount: number; count: number }>();
    for (const inv of dateFiltered.filter((i: any) => i.type === 'purchase')) {
      const items = normalizeInvoiceItems(inv.items);
      for (const it of items) {
        const key = it.itemId || it.fabricName || it.itemName || 'unknown';
        const prev = itemMap.get(key) || { name: it.fabricName || it.itemName || key, totalQty: 0, totalAmount: 0, count: 0 };
        prev.totalQty += lineQuantity(it);
        prev.totalAmount += lineTotalBaseFromInvoice(it, inv);
        prev.count++;
        itemMap.set(key, prev);
      }
    }
    const rows = [...itemMap.entries()]
      .sort((a, b) => b[1].totalQty - a[1].totalQty)
      .slice(0, limit)
      .map(([id, v], i) => ({ rank: i + 1, itemId: id, itemName: v.name, totalQty: roundMoney(v.totalQty), totalAmount: roundMoney(v.totalAmount), invoiceCount: v.count }));
    return { mode, rows, totals: { count: rows.length } };
  }

  if (mode === 'stagnant_items') {
    const allItems = scopeRows(await db.select().from(schema.items).all(), req, 'items');
    const movedItemIds = new Set<string>();
    for (const inv of dateFiltered) {
      let items: any[] = [];
      try { items = typeof inv.items === 'string' ? JSON.parse(inv.items) : (inv.items || []); } catch {}
      for (const it of items) {
        if (it.itemId) movedItemIds.add(it.itemId);
      }
    }
    const rows = allItems
      .filter((item: any) => !movedItemIds.has(item.id) && Number(item.quantity || 0) > 0)
      .map((item: any, i: number) => ({
        rank: i + 1,
        itemId: item.id,
        itemName: item.name,
        code: item.code || '',
        quantity: Number(item.quantity || 0),
        warehouseName: item.warehouseName || '-',
        costPrice: itemCostBase(item),
        stockValue: roundMoney(Number(item.quantity || 0) * itemCostBase(item))
      }))
      .slice(0, limit);
    return { mode, rows, totals: { count: rows.length, totalValue: roundMoney(rows.reduce((s: number, r: any) => s + r.stockValue, 0)) } };
  }

  if (mode === 'top_customers') {
    const partyMap = new Map<string, { name: string; totalAmount: number; count: number; type: string }>();
    for (const inv of dateFiltered) {
      const pid = inv.clientId || inv.partyId || '';
      if (!pid) continue;
      const prev = partyMap.get(pid) || { name: (inv as any).clientName || (inv as any).partyName || pid, totalAmount: 0, count: 0, type: inv.type || '' };
      prev.totalAmount += invoiceBaseAmount(inv, 'total');
      prev.count++;
      partyMap.set(pid, prev);
    }
    const rows = [...partyMap.entries()]
      .sort((a, b) => b[1].totalAmount - a[1].totalAmount)
      .slice(0, limit)
      .map(([id, v], i) => ({ rank: i + 1, partyId: id, partyName: v.name, totalAmount: roundMoney(v.totalAmount), invoiceCount: v.count }));
    return { mode, rows, totals: { count: rows.length } };
  }

  return { mode, rows: [], totals: {} };
});

api.get('/reports/cashbox', async (req) => {
  const q = req.query as any;
  const fromDate = q.from || q.fromDate || '2000-01-01';
  const toDate = q.to || q.toDate || '2100-12-31';
  const cashBoxId = String(q.cashBoxId || '');
  const currency = String(q.currency || 'all').toUpperCase();
  const status = String(q.status || 'all').toUpperCase();
  const useTransactionView = currency !== 'ALL' && currency !== BASE_CURRENCY;

  const rows = scopeRows(await db.select().from(schema.vouchers).all(), req, 'vouchers');
  const filtered = (rows || []).filter((v: any) => {
    if (!inDateRange(v.date, fromDate, toDate)) return false;
    if (cashBoxId && String(v.cashBoxId || '') !== cashBoxId) return false;
    if (currency !== 'ALL' && voucherCurrencyCode(v) !== currency) return false;
    if (status !== 'ALL' && String(v.status || 'DRAFT').toUpperCase() !== status) return false;
    return true;
  }).sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));

  let running = 0;
  let receipts = 0;
  let payments = 0;
  const mapped = filtered.map((v: any) => {
    const currentAmount = useTransactionView ? voucherTransactionAmount(v) : voucherBaseAmount(v);
    const debit = v.type === 'receipt' ? currentAmount : 0;
    const credit = v.type === 'payment' ? currentAmount : 0;
    receipts += debit;
    payments += credit;
    running += debit - credit;
    return {
      date: v.date,
      voucherNumber: v.referenceNumber || v.id,
      voucherType: v.type,
      status: String(v.status || 'DRAFT').toUpperCase(),
      partyName: v.clientName || '—',
      description: v.description || '',
      debit,
      credit,
      runningBalance: running,
      currency: useTransactionView ? voucherCurrencyCode(v) : BASE_CURRENCY,
      ref: { voucherId: v.id, partyId: v.clientId || null }
    };
  });

  return {
    rows: mapped,
    totals: {
      receipts: roundMoney(receipts),
      payments: roundMoney(payments),
      balance: roundMoney(running)
    }
  };
});

api.get('/reports/agents/sales', async (req) => {
  const query = req.query as any;
  const from = String(query.from || '');
  const to = String(query.to || '');
  const requestedAgentId = String(query.agentId || '').trim();
  const invoices = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
  const agents = scopeRows(await db.select().from(schema.agents).all(), req, 'agents');
  const agentMap = new Map((agents || []).map((a: any) => [String(a.id), a]));
  const rows = (invoices || [])
    .filter((inv: any) => String(inv.type || '').toLowerCase() === 'sale')
    .filter((inv: any) => !from || String(inv.date || '').slice(0, 10) >= from)
    .filter((inv: any) => !to || String(inv.date || '').slice(0, 10) <= to);

  const stats = new Map<string, { agentId: string; agentName: string; count: number; total: number; paid: number; remaining: number; soldQty: number }>();
  for (const inv of rows || []) {
    const agentId = String(inv.agentId || (String(inv.createdByRole || '').toLowerCase() === 'agent' ? inv.createdById : '') || '');
    if (!agentId) continue;
    if (requestedAgentId && requestedAgentId !== agentId) continue;
    const agentName = String(inv.agentName || agentMap.get(agentId)?.name || inv.createdByName || '');
    const current = stats.get(agentId) || { agentId, agentName, count: 0, total: 0, paid: 0, remaining: 0, soldQty: 0 };
    const lines = safeJsonParse(inv.items, []);
    const lineQty = (lines || []).reduce((sum: number, line: any) => sum + Number(line.baseQuantity ?? line.quantity ?? 0), 0);
    stats.set(agentId, {
      agentId,
      agentName,
      count: current.count + 1,
      total: current.total + Number(inv.totalAmount || 0),
      paid: current.paid + Number(inv.paidAmount || 0),
      remaining: current.remaining + Number(inv.remainingAmount || 0),
      soldQty: current.soldQty + lineQty,
    });
  }
  return Array.from(stats.values());
});

api.get('/reports/agents/stock', async (req) => {
  const query = req.query as any;
  const requestedAgentId = String(query.agentId || '').trim();
  const inventory = scopeRows(await db.select().from(schema.agentInventory).all(), req, 'agent-inventory');
  const agents = scopeRows(await db.select().from(schema.agents).all(), req, 'agents');
  const agentMap = new Map((agents || []).map((a: any) => [String(a.id), a]));
  const summary = new Map<string, { agentId: string; agentName: string; totalQty: number; itemCount: number }>();
  for (const row of inventory || []) {
    const agentId = String(row.agentId || '');
    if (!agentId) continue;
    if (requestedAgentId && requestedAgentId !== agentId) continue;
    const agentName = String(agentMap.get(agentId)?.name || '');
    const current = summary.get(agentId) || { agentId, agentName, totalQty: 0, itemCount: 0 };
    current.totalQty += Number(row.quantity || 0);
    current.itemCount += 1;
    summary.set(agentId, current);
  }
  return Array.from(summary.values());
});

api.get('/reports/agents/transfers', async (req) => {
  const query = req.query as any;
  const from = String(query.from || '');
  const to = String(query.to || '');
  const agentId = String(query.agentId || '');
  const transferType = String(query.transferType || '');
  const rows = scopeRows(await db.select().from(schema.agentTransfers).orderBy(desc(schema.agentTransfers.createdAt)).all(), req, 'agent-transfers');
  let filtered = rows.map((r: any) => ({ ...r, items: safeJsonParse(r.items, []) }));
  if (agentId) filtered = filtered.filter((r: any) => String(r.agentId) === agentId);
  if (transferType) filtered = filtered.filter((r: any) => String(r.transferType || '') === transferType);
  if (from) filtered = filtered.filter((r: any) => String(r.createdAt || '').slice(0, 10) >= from);
  if (to) filtered = filtered.filter((r: any) => String(r.createdAt || '').slice(0, 10) <= to);
  return filtered;
});

api.get('/reports/agents/activity', async (req) => {
  const query = req.query as any;
  const requestedAgentId = String(query.agentId || '').trim();
  const status = String(query.status || '').trim().toLowerCase();
  const settings = scopeRows(await db.select().from(schema.systemSettings).all(), req, 'system-settings');
  const agents = scopeRows(await db.select().from(schema.agents).all(), req, 'agents');
  const entry = (settings || []).find((row: any) => String(row.key || '') === 'agent_sync_interval');
  const syncIntervalSec = Number(entry?.value || 10) || 10;
  const onlineWindowMs = Math.max(5, syncIntervalSec) * 2000;
  return (agents || [])
    .filter((agent: any) => !requestedAgentId || String(agent.id) === requestedAgentId)
    .map((agent: any) => {
    const lastSeenAt = agent.lastSeenAt || null;
    const ts = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
    const online = Number.isFinite(ts) ? Date.now() - ts <= onlineWindowMs : false;
    const isActive = Number(agent.isActive ?? 1) !== 0;
    if (status === 'active' && !isActive) return null;
    if (status === 'inactive' && isActive) return null;
    if (status === 'online' && !online) return null;
    if (status === 'offline' && online) return null;
    return {
      id: agent.id,
      name: agent.name,
      isActive,
      lastSeenAt,
      lastLat: agent.lastLat,
      lastLng: agent.lastLng,
      online,
    };
  })
  .filter(Boolean);
});

await registerReportsHubRoute(api, ctx);

// --- UNIT MANAGEMENT ---
}
