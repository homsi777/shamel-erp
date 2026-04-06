import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { appError } from '../lib/errors';
import {
  BASE_CURRENCY,
  normalizeCurrencyCode,
  normalizeExchangeRate,
  toBaseAmount,
  toTransactionAmount,
} from '../lib/currency';
import {
  filterRowsByTenantScope,
  hasBranchAccess,
  resolveEntityBranchId,
} from '../lib/tenantScope';
import { getAccountLogicalCode } from '../accountingService';

const inDateRange = (dateStr: string, from: string, to: string) => {
  const d = String(dateStr || '').slice(0, 10);
  return d >= from && d <= to;
};

const monthKey = (dateStr: string) => String(dateStr || '').slice(0, 7);

const parseItems = (rawItems: unknown): any[] => {
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
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
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

  if (currency === BASE_CURRENCY) return raw;
  if (!raw) return 0;
  return toBaseAmount(raw, currency, rate);
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

const voucherCurrencyCode = (voucher: any): string => normalizeCurrencyCode(voucher?.currency || BASE_CURRENCY);
const voucherRate = (voucher: any): number => normalizeExchangeRate(voucherCurrencyCode(voucher), voucher?.exchangeRate);

const voucherBaseAmount = (voucher: any): number => {
  const explicitBase = toNum(voucher?.amountBase);
  if (explicitBase) return explicitBase;
  const currency = voucherCurrencyCode(voucher);
  const raw = toNum(voucher?.amount);
  if (currency === BASE_CURRENCY) return raw;
  if (!raw) return 0;
  return toBaseAmount(raw, currency, voucherRate(voucher));
};

const voucherTransactionAmount = (voucher: any): number => {
  const explicitTxn = toNum(voucher?.amountTransaction ?? voucher?.originalAmount);
  if (explicitTxn) return explicitTxn;
  const base = voucherBaseAmount(voucher);
  if (!base) return 0;
  const currency = voucherCurrencyCode(voucher);
  return currency === BASE_CURRENCY ? base : toTransactionAmount(base, currency, voucherRate(voucher));
};

const partyDeltaBase = (tx: any): number => toNum(tx?.deltaBase ?? tx?.delta);
const partyDeltaTransaction = (tx: any): number => {
  const explicitTxn = toNum(tx?.deltaTransaction);
  if (explicitTxn) return explicitTxn;
  const deltaBase = partyDeltaBase(tx);
  if (!deltaBase) return 0;
  const currency = normalizeCurrencyCode(tx?.currency || BASE_CURRENCY);
  const rate = normalizeExchangeRate(currency, tx?.exchangeRate);
  return currency === BASE_CURRENCY ? deltaBase : toTransactionAmount(deltaBase, currency, rate);
};

const itemCostBase = (item: any): number => toNum(item?.costPriceBase ?? item?.costPrice);

const lineQuantity = (line: any): number => toNum(line?.baseQuantity ?? line?.quantity);
const lineUnitBase = (line: any, inv: any): number => {
  const explicitBase = toNum(line?.unitPriceBase);
  if (explicitBase) return explicitBase;
  const currency = invoiceCurrencyCode(inv);
  const rate = invoiceRate(inv);
  const raw = toNum(line?.unitPrice ?? line?.priceAtSale ?? line?.price);
  if (currency === BASE_CURRENCY) return raw;
  return raw ? toBaseAmount(raw, currency, rate) : 0;
};
const lineUnitTransaction = (line: any, inv: any): number => {
  const explicitTxn = toNum(line?.unitPriceTransaction ?? line?.priceAtSale);
  if (explicitTxn) return explicitTxn;
  const base = lineUnitBase(line, inv);
  if (!base) return 0;
  const currency = invoiceCurrencyCode(inv);
  return currency === BASE_CURRENCY ? base : toTransactionAmount(base, currency, invoiceRate(inv));
};
const lineTotalBase = (line: any, inv: any): number => {
  const explicitBase = toNum(line?.lineTotalBase ?? line?.totalBase);
  if (explicitBase) return explicitBase;
  return lineUnitBase(line, inv) * lineQuantity(line);
};
const lineTotalTransaction = (line: any, inv: any): number => {
  const explicitTxn = toNum(line?.lineTotalTransaction ?? line?.totalTransaction ?? line?.total);
  if (explicitTxn) return explicitTxn;
  return lineUnitTransaction(line, inv) * lineQuantity(line);
};

type CanonicalLevel = 'accounting_canonical' | 'operational_estimate';
type Completeness = 'complete' | 'partial' | 'requires_dataset';

type ModeAudit = {
  canonicalLevel: CanonicalLevel;
  completeness: Completeness;
  printReady: boolean;
  excelReady: boolean;
  dataSource: string;
  backendLogicSource: string;
  totalsLogic: string;
  missingDataset?: string;
};

const REPORTS_HUB_SOURCE = 'backend/routes/reports.hub.ts';

const OPERATIONAL_ESTIMATE_MODES = new Set([
  'sales_profit',
  'financial_balances_summary',
  'financial_net_sales_purchases_cash',
  'financial_ending_inventory_value',
  'financial_profit_by_period',
  'inventory_cost',
  'inventory_value',
  'inventory_current_stock',
  'users_activity',
  'users_delegate_sales',
  'users_activity_by_user',
  'users_performance',
  'users_sales_by_seller',
  'analytics_overview',
  'analytics_overview_print',
  'analytics_sales',
  'analytics_purchases',
  'analytics_items',
  'analytics_customers',
  'analytics_commercial_flow',
  'analytics_dashboards',
  'misc_unclassified',
  'misc_operational',
  'misc_quick',
  'restaurant_tables',
  'restaurant_sessions',
  'restaurant_orders',
  'restaurant_qr_activity',
  'restaurant_session_request_timeline',
  'restaurant_qr_menu_usage',
  'partners_profit_sharing',
  'partners_profit_by_period',
  'partners_profit_distribution',
  'partners_capital_contributions',
]);

const PARTIAL_MODES = new Set([
  'sales_profit',
  'financial_balances_summary',
  'financial_net_sales_purchases_cash',
  'financial_ending_inventory_value',
  'financial_profit_by_period',
  'inventory_cost',
  'inventory_value',
  'partners_profit_sharing',
  'partners_profit_by_period',
  'partners_profit_distribution',
  'partners_capital_contributions',
]);

const REQUIRES_DATASET_MODES = new Set([
  'parties_reconciliation_future',
  'users_delegate_collections',
  'misc_future',
]);

const modeDataSource = (mode: string): string => {
  if (mode.startsWith('financial_') || mode.startsWith('parties_')) return 'journal_entries + journal_entry_lines + party_transactions';
  if (mode.startsWith('inventory_')) return 'invoices.items + items';
  if (mode.startsWith('sales_') || mode.startsWith('purchases_')) return 'invoices + invoice lines';
  if (mode.startsWith('analytics_')) return 'invoices + items + parties';
  if (mode.startsWith('users_')) return 'invoices.createdById';
  if (mode.startsWith('partners_')) return 'partners + partner_transactions + invoices';
  if (mode.startsWith('misc_')) return 'invoices + vouchers + items + parties';
  if (mode.startsWith('restaurant_')) return 'restaurant_tables + restaurant_table_sessions';
  return 'reports_hub_dataset';
};

const modeTotalsLogic = (mode: string): string => {
  if (mode === 'sales_profit') return 'sum(revenue) - sum(quantity * current item cost)';
  if (mode === 'financial_ending_inventory_value') return 'sum(current quantity * current cost)';
  if (mode === 'financial_profit_by_period') return 'sum(month sales - month purchases)';
  if (mode === 'financial_net_sales_purchases_cash') return 'sales total + purchases total + (receipts - payments)';
  if (mode.startsWith('parties_')) return 'opening + period debit/credit movement = closing';
  if (mode.startsWith('inventory_')) return 'server-side aggregation over filtered movement/stock rows';
  if (mode.startsWith('sales_') || mode.startsWith('purchases_')) return 'server-side aggregation over filtered invoice rows';
  return 'server-side aggregation over filtered rows';
};

const resolveModeAudit = (mode: string, status: string, note: string): ModeAudit => {
  const isRequiresDataset = status === 'requires_dataset' || REQUIRES_DATASET_MODES.has(mode);
  if (isRequiresDataset) {
    return {
      canonicalLevel: 'operational_estimate',
      completeness: 'requires_dataset',
      printReady: false,
      excelReady: false,
      dataSource: modeDataSource(mode),
      backendLogicSource: REPORTS_HUB_SOURCE,
      totalsLogic: 'not_applicable',
      missingDataset: note || 'يتطلب بيانات إضافية غير متوفرة.',
    };
  }

  return {
    canonicalLevel: OPERATIONAL_ESTIMATE_MODES.has(mode) ? 'operational_estimate' : 'accounting_canonical',
    completeness: PARTIAL_MODES.has(mode) ? 'partial' : 'complete',
    printReady: true,
    excelReady: true,
    dataSource: modeDataSource(mode),
    backendLogicSource: REPORTS_HUB_SOURCE,
    totalsLogic: modeTotalsLogic(mode),
  };
};

const buildNumericColumnTotals = (rows: any[][]): Record<number, number> => {
  const totals: Record<number, number> = {};
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    row.forEach((cell, colIdx) => {
      const numeric = Number(cell);
      if (Number.isFinite(numeric)) {
        totals[colIdx] = (totals[colIdx] || 0) + numeric;
      }
    });
  }
  return totals;
};

const validateReportConsistency = (mode: string, summary: any[], tableRows: any[]) => {
  if (!Array.isArray(summary) || !Array.isArray(tableRows) || !summary.length || !tableRows.length) return;
  let summaryIdx = 0;
  let expected = 0;
  if (mode.startsWith('sales_') || mode.startsWith('purchases_')) {
    if (mode.includes('invoices_aggregate')) {
      summaryIdx = 1;
      expected = tableRows.reduce((s: number, row: any) => s + Number(row[4] ?? 0), 0);
    } else if (mode.includes('operations_aggregate')) {
      summaryIdx = 2;
      expected = tableRows.reduce((s: number, row: any) => s + Number(row[2] ?? 0), 0);
    } else if (mode.includes('detail')) {
      summaryIdx = 2;
      expected = tableRows.reduce((s: number, row: any) => s + Number(row[7] ?? 0), 0);
    } else if (mode.includes('by_customer') || mode.includes('by_supplier') || mode.includes('top_customers') || mode.includes('top_suppliers')) {
      summaryIdx = 1;
      expected = tableRows.reduce((s: number, row: any) => s + Number(row[2] ?? 0), 0);
    } else if (mode.includes('by_item') || mode.includes('top_items') || mode.includes('fast_moving')) {
      summaryIdx = 2;
      expected = tableRows.reduce((s: number, row: any) => s + Number(row[3] ?? 0), 0);
    } else {
      return;
    }
  } else if (mode.startsWith('inventory_')) {
    if (mode.includes('current_stock') || mode.includes('available_qty') || mode === 'inventory_value' || mode === 'inventory_cost') {
      summaryIdx = 0;
      expected = tableRows.reduce((s: number, row: any) => s + Number(row[3] ?? 0), 0);
    } else {
      return;
    }
  } else {
    return;
  }
  const mainTotal = Number(summary[summaryIdx]?.value ?? 0);
  if (!Number.isFinite(mainTotal)) return;
  const diff = Math.abs(expected - mainTotal);
  if (diff <= 0.01) {
    console.info('[REPORT_VALIDATED]', { type: mode, rows: tableRows.length, total: mainTotal, expected, diff });
  } else {
    console.error('[REPORT_MISMATCH]', { type: mode, expected, actual: mainTotal, diff });
  }
};

export async function registerReportsHubRoute(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, roundMoney, getTrialBalance } = ctx as any;
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

  api.get('/reports/hub', async (req) => {
    const q = req.query as any;
    const mode = String(q.mode || '');
    const fromDate = String(q.from || q.fromDate || '2000-01-01');
    const toDate = String(q.to || q.toDate || '2100-12-31');
    const asOfDate = String(q.asOfDate || q.asOf || toDate);
    const branchId = String(q.branchId || 'all');
    const warehouseId = String(q.warehouseId || 'all');
    const partyId = String(q.partyId || '');
    const partyType = String(q.partyType || 'all').toUpperCase();
    const itemId = String(q.itemId || '');
    const category = String(q.category || '');
    const userId = String(q.userId || '');
    const delegateId = String(q.delegateId || '');
    const accountId = String(q.accountId || '');
    const currency = String(q.currency || 'all').toUpperCase();
    const status = String(q.status || 'all').toLowerCase();
    const topN = Math.max(1, Math.min(Number(q.topN || q.limit || 20), 100));

    const nowIso = new Date().toISOString();
    const baseMeta = {
      generatedAt: nowIso,
      generatedBy: 'reports_hub',
      filters: { fromDate, toDate, asOfDate, branchId, warehouseId, partyId, partyType, itemId, category, userId, delegateId, accountId, currency, status, topN },
      filtersSummary: `${fromDate} → ${toDate} | الفرع: ${branchId} | المستودع: ${warehouseId} | الحساب: ${accountId || 'الكل'} | العملة: ${currency}`,
    };

    const done = (payload: any) => {
      const statusValue = String(payload.status || 'ok');
      const summary = Array.isArray(payload.summary) ? payload.summary : [];
      const tableRows = Array.isArray(payload.tableRows) ? payload.tableRows : [];
      const note = String(payload.note || '');
      const audit = resolveModeAudit(mode, statusValue, note);
      const numericColumnTotals = buildNumericColumnTotals(tableRows);

      const entityRefs = Array.isArray(payload.meta?.entityRefs) ? payload.meta.entityRefs : [];
      const normalizedRefs = entityRefs.map((ref: any) => {
        const referenceId = ref.referenceId ?? ref.invoiceId ?? ref.voucherId ?? ref.partyId ?? ref.itemId ?? ref.settlementId ?? ref.documentId ?? null;
        const referenceType = ref.referenceType ?? (ref.invoiceId ? 'invoice' : ref.voucherId ? 'voucher' : ref.partyId ? 'party' : ref.itemId ? 'product' : ref.settlementId ? 'settlement' : ref.documentId ? 'consignment' : null);
        return { ...ref, referenceId, referenceType };
      });

      validateReportConsistency(mode, summary, tableRows);

      return {
        mode,
        status: statusValue,
        title: payload.title || 'تقرير',
        subtitle: payload.subtitle || `من ${fromDate} إلى ${toDate}`,
        summary,
        tableHeaders: payload.tableHeaders || [],
        tableRows,
        note,
        meta: {
          ...baseMeta,
          ...(payload.meta || {}),
          entityRefs: normalizedRefs.length > 0 ? normalizedRefs : payload.meta?.entityRefs,
          audit,
          canonicalLevel: audit.canonicalLevel,
          completeness: audit.completeness,
          exportCapabilities: {
            print: audit.printReady,
            pdf: audit.printReady,
            excel: audit.excelReady,
          },
          missingDataset: audit.missingDataset || payload.meta?.missingDataset || '',
          validation: {
            reportKey: mode,
            rowCount: tableRows.length,
            summaryCount: summary.length,
            hasDataset: tableRows.length > 0 || summary.length > 0,
            numericColumnTotals,
          },
        },
        generatedAt: nowIso,
      };
    };

    const requiresDataset = (title: string, note: string, missingDataset?: string) => done({
      status: 'requires_dataset',
      title,
      note,
      tableHeaders: [],
      tableRows: [],
      meta: {
        missingDataset: missingDataset || note,
      },
    });

    const allInvoices = scopeRows(await db.select().from(schema.invoices).all(), req, 'invoices');
    const allItems = scopeRows(await db.select().from(schema.items).all(), req, 'items');
    const allParties = scopeRows(await db.select().from(schema.parties).all(), req, 'parties');
    const allVouchers = scopeRows(await db.select().from(schema.vouchers).all(), req, 'vouchers');
    const allPartyTx = scopeRows(await db.select().from(schema.partyTransactions).all(), req, 'party-transactions');
    const allAccounts = scopeRows(await db.select().from(schema.accounts).all(), req, 'accounts')
      .map((account: any) => ({ ...account, code: getAccountLogicalCode(account), storageCode: account.code }));
    const allEntries = scopeRows(await db.select().from(schema.journalEntries).all(), req, 'journal-entries');
    const allEntryLines = await db.select().from(schema.journalEntryLines).all();
    const allPartners = scopeRows(await db.select().from(schema.partners).all(), req, 'partners');
    const allPartnerTx = scopeRows(await db.select().from(schema.partnerTransactions).all(), req, 'partner-transactions');

    const itemMap: Map<string, any> = new Map((allItems || []).map((x: any) => [String(x.id), x]));
    const useTransactionView = currency !== 'ALL' && currency !== BASE_CURRENCY;
    const viewCurrency = useTransactionView ? currency : BASE_CURRENCY;

    const matchesCurrency = (v: any) => currency === 'ALL' || normalizeCurrencyCode(v || BASE_CURRENCY) === currency;
    const invoiceAmountForView = (inv: any, kind: 'total' | 'paid' | 'remaining' | 'discount' = 'total') =>
      useTransactionView ? invoiceTransactionAmount(inv, kind) : invoiceBaseAmount(inv, kind);
    const lineUnitForView = (line: any, inv: any) =>
      useTransactionView ? lineUnitTransaction(line, inv) : lineUnitBase(line, inv);
    const lineTotalForView = (line: any, inv: any) =>
      useTransactionView ? lineTotalTransaction(line, inv) : lineTotalBase(line, inv);
    const voucherAmountForView = (voucher: any) =>
      useTransactionView ? voucherTransactionAmount(voucher) : voucherBaseAmount(voucher);
    const partyDeltaForView = (tx: any) =>
      useTransactionView ? partyDeltaTransaction(tx) : partyDeltaBase(tx);
    const openClosed = (inv: any) => invoiceBaseAmount(inv, 'remaining') > 0 ? 'open' : 'closed';
    const txDate = (tx: any) => String(tx.createdAt || tx.date || '').slice(0, 10);
    const beforeFrom = (date: string) => date < fromDate;
    const deltaToDebitCredit = (delta: number, isSupplier: boolean) => {
      if (isSupplier) {
        return {
          debit: delta < 0 ? Math.abs(delta) : 0,
          credit: delta > 0 ? delta : 0,
        };
      }
      return {
        debit: delta > 0 ? delta : 0,
        credit: delta < 0 ? Math.abs(delta) : 0,
      };
    };
    const balanceLabel = (delta: number, isSupplier: boolean) => {
      const dc = deltaToDebitCredit(delta, isSupplier);
      if (dc.debit === 0 && dc.credit === 0) return '0';
      if (dc.debit >= dc.credit) return `${roundMoney(dc.debit - dc.credit)} مدين`;
      return `${roundMoney(dc.credit - dc.debit)} دائن`;
    };

    const invoicesByType = (type: 'all' | 'sale' | 'purchase') => {
      return (allInvoices || []).filter((inv: any) => {
        if (!inDateRange(inv.date, fromDate, toDate)) return false;
        const invType = String(inv.type || '').toLowerCase();
        if (type !== 'all' && invType !== type) return false;
        if (partyId && String(inv.clientId || '') !== partyId) return false;
        if (branchId !== 'all' && String(inv.branchId || '') !== branchId) return false;
        if (warehouseId !== 'all' && String(inv.targetWarehouseId || '') !== warehouseId) return false;
        if (!matchesCurrency(inv.currency)) return false;
        if (userId && String(inv.createdById || '') !== userId) return false;
        if (delegateId && String(inv.createdById || '') !== delegateId) return false;
        if (status !== 'all') {
          if (status === 'open' || status === 'closed') {
            if (openClosed(inv) !== status) return false;
          } else if (String(inv.status || '').toLowerCase() !== status) {
            return false;
          }
        }
        return true;
      });
    };

    const flattenLines = (invoices: any[]) => {
      const lines: any[] = [];
      for (const inv of invoices) {
        for (const ln of parseItems(inv.items)) {
          const currentItemId = String(ln.itemId || '');
          const item = itemMap.get(currentItemId);
          const currentCategory = String(ln.categoryId || item?.categoryId || '');
          if (itemId && currentItemId !== itemId) continue;
          if (category && currentCategory !== category) continue;
          const qty = lineQuantity(ln);
          const price = lineUnitForView(ln, inv);
          const total = lineTotalForView(ln, inv);
          lines.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber || inv.id,
            invoiceType: String(inv.type || '').toLowerCase(),
            date: inv.date,
            partyId: inv.clientId || '',
            partyName: inv.clientName || '—',
            warehouseName: ln.warehouseName || inv.targetWarehouseName || '—',
            itemId: currentItemId,
            itemName: ln.itemName || ln.fabricName || item?.name || currentItemId || 'مادة',
            categoryId: currentCategory || 'uncategorized',
            categoryName: ln.categoryName || item?.categoryName || currentCategory || 'غير مصنف',
            qty,
            unitPrice: price,
            unitPriceBase: lineUnitBase(ln, inv),
            unitPriceTransaction: lineUnitTransaction(ln, inv),
            total,
            totalBase: lineTotalBase(ln, inv),
            totalTransaction: lineTotalTransaction(ln, inv),
            costPrice: itemCostBase(item),
            currency: useTransactionView ? invoiceCurrencyCode(inv) : BASE_CURRENCY,
            createdById: inv.createdById || '',
            createdByName: inv.createdByName || '',
          });
        }
      }
      return lines;
    };

    const grouped = (rows: any[], keyFn: (r: any) => string) => {
      const map = new Map<string, any[]>();
      for (const row of rows) {
        const key = keyFn(row);
        const arr = map.get(key) || [];
        arr.push(row);
        map.set(key, arr);
      }
      return map;
    };

    const salesInvoices = invoicesByType('sale');
    const purchaseInvoices = invoicesByType('purchase');
    const scopedInvoices = invoicesByType('all');
    const salesLines = flattenLines(salesInvoices);
    const purchaseLines = flattenLines(purchaseInvoices);
    const allLines = flattenLines(scopedInvoices);

    const invoicesAggregate = (rows: any[], title: string) => {
      const totalAmount = roundMoney(rows.reduce((s: number, r: any) => s + invoiceAmountForView(r, 'total'), 0));
      const totalPaid = roundMoney(rows.reduce((s: number, r: any) => s + invoiceAmountForView(r, 'paid'), 0));
      const totalRemaining = roundMoney(rows.reduce((s: number, r: any) => s + invoiceAmountForView(r, 'remaining'), 0));
      return done({
        title,
        summary: [
          { title: 'عدد الفواتير', value: rows.length, color: 'blue' },
          { title: 'الإجمالي', value: totalAmount, color: 'green' },
          { title: 'المدفوع', value: totalPaid, color: 'teal' },
          { title: 'المتبقي', value: totalRemaining, color: 'red' },
        ],
        tableHeaders: ['التاريخ', 'رقم الفاتورة', 'الطرف', 'المستودع', 'الإجمالي', 'المدفوع', 'المتبقي', 'العملة', 'الحالة'],
        tableRows: rows.map((inv: any) => [
          inv.date,
          inv.invoiceNumber || inv.id,
          inv.clientName || '—',
          inv.targetWarehouseName || '—',
          roundMoney(invoiceAmountForView(inv, 'total')),
          roundMoney(invoiceAmountForView(inv, 'paid')),
          roundMoney(invoiceAmountForView(inv, 'remaining')),
          useTransactionView ? invoiceCurrencyCode(inv) : viewCurrency,
          openClosed(inv)
        ]),
        meta: {
          entityRefs: rows.map((inv: any) => ({ invoiceId: inv.id, partyId: inv.clientId || null, referenceId: inv.id, referenceType: 'invoice' })),
          smartLinkMap: { 1: { type: 'invoice', idKey: 'invoiceId' }, 2: { type: 'party', idKey: 'partyId' } },
          totals: { totalAmount, totalPaid, totalRemaining, count: rows.length },
        },
      });
    };

    const operationsAggregate = (rows: any[], title: string) => {
      const g = grouped(rows, (r) => String(r.date || '').slice(0, 10));
      const tableRows = Array.from(g.entries()).map(([day, list]) => {
        const amount = list.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0);
        return [day, list.length, roundMoney(amount)];
      }).sort((a: any, b: any) => String(a[0]).localeCompare(String(b[0])));
      return done({
        title,
        summary: [
          { title: 'عدد الأيام', value: tableRows.length, color: 'blue' },
          { title: 'عدد العمليات', value: rows.length, color: 'teal' },
          { title: 'إجمالي القيمة', value: roundMoney(rows.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0)), color: 'green' },
        ],
        tableHeaders: ['اليوم', 'عدد العمليات', 'الإجمالي'],
        tableRows,
      });
    };

    const detailReport = (lines: any[], title: string) => {
      const totalQty = roundMoney(lines.reduce((s: number, x: any) => s + Number(x.qty || 0), 0));
      const totalAmount = roundMoney(lines.reduce((s: number, x: any) => s + Number(x.total || 0), 0));
      return done({
        title,
        summary: [
          { title: 'عدد السطور', value: lines.length, color: 'blue' },
          { title: 'إجمالي الكمية', value: totalQty, color: 'teal' },
          { title: 'إجمالي المبلغ', value: totalAmount, color: 'green' },
        ],
        tableHeaders: ['التاريخ', 'رقم الفاتورة', 'الطرف', 'المادة', 'التصنيف', 'الكمية', 'السعر', 'الإجمالي', 'العملة'],
        tableRows: lines.map((x: any) => [x.date, x.invoiceNumber, x.partyName, x.itemName, x.categoryName, roundMoney(x.qty), roundMoney(x.unitPrice), roundMoney(x.total), x.currency]),
        meta: {
          entityRefs: lines.map((x: any) => ({ invoiceId: x.invoiceId, partyId: x.partyId, itemId: x.itemId, referenceId: x.invoiceId, referenceType: 'invoice' })),
          smartLinkMap: {
            1: { type: 'invoice', idKey: 'invoiceId' },
            2: { type: 'party', idKey: 'partyId' },
            3: { type: 'product', idKey: 'itemId' },
          },
          totals: { totalQty, totalAmount, lineCount: lines.length },
        },
      });
    };

    const groupByParty = (rows: any[], title: string) => {
      const g = grouped(rows, (x) => String(x.clientId || x.partyId || 'unknown'));
      const agg = Array.from(g.entries()).map(([key, list]) => ({
        key,
        name: list[0]?.clientName || list[0]?.partyName || key,
        count: list.length,
        amount: roundMoney(list.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0)),
      })).sort((a: any, b: any) => b.amount - a.amount).slice(0, topN);
      return done({
        title,
        summary: [
          { title: 'عدد الأطراف', value: agg.length, color: 'blue' },
          { title: 'الإجمالي', value: roundMoney(agg.reduce((s: number, x: any) => s + x.amount, 0)), color: 'green' },
        ],
        tableHeaders: ['الطرف', 'عدد العمليات', 'الإجمالي', 'الترتيب'],
        tableRows: agg.map((x, idx) => [x.name, x.count, x.amount, idx + 1]),
        meta: { entityRefs: agg.map((x: any) => ({ partyId: x.key, referenceId: x.key, referenceType: 'party' })), smartLinkMap: { 0: { type: 'party', idKey: 'partyId' } } }
      });
    };

    const groupByItem = (rows: any[], title: string) => {
      const g = grouped(rows, (x) => String(x.itemId || x.itemName || 'unknown'));
      const agg = Array.from(g.entries()).map(([key, list]) => ({
        key,
        name: list[0]?.itemName || key,
        count: list.length,
        qty: roundMoney(list.reduce((s: number, x: any) => s + Number(x.qty || 0), 0)),
        amount: roundMoney(list.reduce((s: number, x: any) => s + Number(x.total || 0), 0)),
      })).sort((a: any, b: any) => b.qty - a.qty).slice(0, topN);
      return done({
        title,
        summary: [
          { title: 'عدد المواد', value: agg.length, color: 'blue' },
          { title: 'إجمالي الكمية', value: roundMoney(agg.reduce((s: number, x: any) => s + x.qty, 0)), color: 'teal' },
          { title: 'إجمالي القيمة', value: roundMoney(agg.reduce((s: number, x: any) => s + x.amount, 0)), color: 'green' },
        ],
        tableHeaders: ['المادة', 'عدد العمليات', 'الكمية', 'الإجمالي', 'الترتيب'],
        tableRows: agg.map((x, idx) => [x.name, x.count, x.qty, x.amount, idx + 1]),
        meta: { entityRefs: agg.map((x: any) => ({ itemId: x.key, referenceId: x.key, referenceType: 'product' })), smartLinkMap: { 0: { type: 'product', idKey: 'itemId' } } }
      });
    };

    const groupByCategory = (rows: any[], title: string) => {
      const g = grouped(rows, (x) => String(x.categoryId || 'uncategorized'));
      const agg = Array.from(g.entries()).map(([key, list]) => ({
        key,
        name: list[0]?.categoryName || key,
        count: list.length,
        qty: roundMoney(list.reduce((s: number, x: any) => s + Number(x.qty || 0), 0)),
        amount: roundMoney(list.reduce((s: number, x: any) => s + Number(x.total || 0), 0)),
      })).sort((a: any, b: any) => b.amount - a.amount).slice(0, topN);
      return done({
        title,
        summary: [
          { title: 'عدد التصنيفات', value: agg.length, color: 'blue' },
          { title: 'إجمالي الكمية', value: roundMoney(agg.reduce((s: number, x: any) => s + x.qty, 0)), color: 'teal' },
          { title: 'إجمالي القيمة', value: roundMoney(agg.reduce((s: number, x: any) => s + x.amount, 0)), color: 'green' },
        ],
        tableHeaders: ['التصنيف', 'عدد السطور', 'الكمية', 'الإجمالي'],
        tableRows: agg.map((x: any) => [x.name, x.count, x.qty, x.amount]),
      });
    };

    const byUser = (rows: any[], title: string) => {
      const g = grouped(rows, (x) => String(x.createdById || x.createdByName || 'unknown'));
      const agg = Array.from(g.entries()).map(([key, list]) => ({
        key,
        name: list[0]?.createdByName || key,
        count: list.length,
        amount: roundMoney(list.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0)),
      })).sort((a: any, b: any) => b.amount - a.amount).slice(0, topN);
      return done({
        title,
        summary: [{ title: 'عدد المستخدمين', value: agg.length, color: 'blue' }],
        tableHeaders: ['المستخدم', 'عدد العمليات', 'الإجمالي', 'الترتيب'],
        tableRows: agg.map((x, idx) => [x.name, x.count, x.amount, idx + 1]),
      });
    };

    const inventoryStock = (title: string, style: 'full' | 'qty' | 'cost' | 'value') => {
      const scoped = (allItems || []).filter((it: any) => {
        if (warehouseId !== 'all' && String(it.warehouseId || '') !== warehouseId) return false;
        if (category && String(it.categoryId || '') !== category) return false;
        if (itemId && String(it.id || '') !== itemId) return false;
        return true;
      });
      const rows = scoped.map((it: any) => ({
        itemId: it.id,
        name: it.name,
        code: it.code || '',
        warehouse: it.warehouseName || '—',
        qty: Number(it.quantity || 0),
        cost: itemCostBase(it),
        value: roundMoney(Number(it.quantity || 0) * itemCostBase(it)),
      }));

      if (style === 'qty') {
        return done({
          title,
          summary: [{ title: 'إجمالي الكمية', value: roundMoney(rows.reduce((s: number, x: any) => s + x.qty, 0)), color: 'blue' }],
          tableHeaders: ['المادة', 'الكود', 'المستودع', 'الكمية'],
          tableRows: rows.map((x: any) => [x.name, x.code, x.warehouse, roundMoney(x.qty)]),
          meta: { entityRefs: rows.map((x: any) => ({ itemId: x.itemId })), smartLinkMap: { 0: { type: 'product', idKey: 'itemId' } } }
        });
      }
      if (style === 'cost') {
        return done({
          title,
          summary: [{ title: 'إجمالي التكلفة', value: roundMoney(rows.reduce((s: number, x: any) => s + x.value, 0)), color: 'green' }],
          tableHeaders: ['المادة', 'الكمية', 'تكلفة الوحدة', 'التكلفة الإجمالية'],
          tableRows: rows.map((x: any) => [x.name, roundMoney(x.qty), roundMoney(x.cost), roundMoney(x.value)]),
          meta: { entityRefs: rows.map((x: any) => ({ itemId: x.itemId })), smartLinkMap: { 0: { type: 'product', idKey: 'itemId' } } }
        });
      }
      if (style === 'value') {
        return done({
          title,
          summary: [{ title: 'القيمة الإجمالية', value: roundMoney(rows.reduce((s: number, x: any) => s + x.value, 0)), color: 'green' }],
          tableHeaders: ['المادة', 'المستودع', 'الكمية', 'القيمة'],
          tableRows: rows.map((x: any) => [x.name, x.warehouse, roundMoney(x.qty), roundMoney(x.value)]),
          meta: { entityRefs: rows.map((x: any) => ({ itemId: x.itemId })), smartLinkMap: { 0: { type: 'product', idKey: 'itemId' } } }
        });
      }
      return done({
        title,
        summary: [
          { title: 'عدد المواد', value: rows.length, color: 'blue' },
          { title: 'إجمالي الكمية', value: roundMoney(rows.reduce((s: number, x: any) => s + x.qty, 0)), color: 'teal' },
          { title: 'إجمالي القيمة', value: roundMoney(rows.reduce((s: number, x: any) => s + x.value, 0)), color: 'green' },
        ],
        tableHeaders: ['المادة', 'الكود', 'المستودع', 'الكمية', 'تكلفة الوحدة', 'القيمة'],
        tableRows: rows.map((x: any) => [x.name, x.code, x.warehouse, roundMoney(x.qty), roundMoney(x.cost), roundMoney(x.value)]),
        meta: { entityRefs: rows.map((x: any) => ({ itemId: x.itemId })), smartLinkMap: { 0: { type: 'product', idKey: 'itemId' } } }
      });
    };

    if (mode === 'sales_invoices_aggregate') return invoicesAggregate(salesInvoices, 'تقرير فواتير المبيعات التجميعي');
    if (mode === 'purchases_invoices_aggregate') return invoicesAggregate(purchaseInvoices, 'تقرير فواتير المشتريات التجميعي');
    if (mode === 'sales_operations_aggregate') return operationsAggregate(salesInvoices, 'تقرير عمليات البيع التجميعي');
    if (mode === 'purchases_operations_aggregate') return operationsAggregate(purchaseInvoices, 'تقرير عمليات الشراء التجميعي');
    if (mode === 'sales_detail') return detailReport(salesLines, 'تقرير المبيعات التفصيلي');
    if (mode === 'purchases_detail') return detailReport(purchaseLines, 'تقرير المشتريات التفصيلي');
    if (mode === 'sales_by_customer') return groupByParty(salesInvoices, 'تقرير المبيعات حسب العميل');
    if (mode === 'purchases_by_supplier') return groupByParty(purchaseInvoices, 'تقرير المشتريات حسب المورد');
    if (mode === 'sales_top_customers') return groupByParty(salesInvoices, 'تقرير العملاء الأكثر شراءً / الأكثر مبيعًا');
    if (mode === 'purchases_top_suppliers') return groupByParty(purchaseInvoices, 'تقرير الموردين الأكثر توريدًا');
    if (mode === 'sales_by_item') return groupByItem(salesLines, 'تقرير المبيعات حسب المادة');
    if (mode === 'purchases_by_item') return groupByItem(purchaseLines, 'تقرير المشتريات حسب المادة');
    if (mode === 'sales_top_items') return groupByItem(salesLines, 'تقرير المواد الأكثر بيعًا');
    if (mode === 'inventory_fast_moving') return groupByItem(allLines, 'تقرير المواد سريعة الحركة');
    if (mode === 'sales_by_category') return groupByCategory(salesLines, 'تقرير المبيعات حسب التصنيف');
    if (mode === 'purchases_by_category') return groupByCategory(purchaseLines, 'تقرير المشتريات حسب التصنيف');
    if (mode === 'inventory_category_stats') return groupByCategory(allLines, 'إحصائيات تصنيفات المواد');
    if (mode === 'sales_by_user' || mode === 'users_sales_by_seller' || mode === 'users_delegate_sales') return byUser(salesInvoices, mode === 'users_delegate_sales' ? 'تقرير مبيعات المندوبين' : 'تقرير المبيعات حسب المستخدم / البائع');
    if (mode === 'users_activity' || mode === 'users_activity_by_user' || mode === 'users_performance') return byUser(scopedInvoices, mode === 'users_performance' ? 'تقرير أداء المستخدمين' : 'تقرير حركة المستخدمين');

    if (mode === 'sales_profit') {
      const rows = salesLines.map((ln: any) => {
        const revenue = Number(ln.totalBase || 0);
        const cost = Number(ln.qty || 0) * Number(ln.costPrice || 0);
        return { ...ln, revenue: roundMoney(revenue), cost: roundMoney(cost), profit: roundMoney(revenue - cost) };
      });
      return done({
        title: 'تقرير الأرباح من المبيعات',
        note: 'تنبيه: هذا التقرير تشغيلي تقديري ويعتمد على تكلفة المادة الحالية، وليس على محرك تكلفة محاسبي مرجّح للفترة.',
        summary: [
          { title: 'إجمالي الإيراد', value: roundMoney(rows.reduce((s: number, x: any) => s + x.revenue, 0)), color: 'green' },
          { title: 'إجمالي التكلفة', value: roundMoney(rows.reduce((s: number, x: any) => s + x.cost, 0)), color: 'red' },
          { title: 'صافي الربح', value: roundMoney(rows.reduce((s: number, x: any) => s + x.profit, 0)), color: 'blue' },
        ],
        tableHeaders: ['التاريخ', 'رقم الفاتورة', 'المادة', 'الكمية', 'الإيراد', 'التكلفة', 'الربح'],
        tableRows: rows.map((x: any) => [x.date, x.invoiceNumber, x.itemName, x.qty, x.revenue, x.cost, x.profit]),
        meta: {
          profitabilityBasis: 'current_item_cost',
        },
      });
    }

    if (mode === 'purchases_last_prices') {
      const g = grouped(purchaseLines, (x) => String(x.itemId || x.itemName || 'unknown'));
      const rows = Array.from(g.entries()).map(([key, list]) => {
        const sorted = list.sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')));
        const last = sorted[0];
        return [last?.itemName || key, last?.partyName || '—', roundMoney(Number(last?.unitPrice || 0)), last?.date || ''];
      });
      return done({
        title: 'تقرير آخر أسعار شراء',
        summary: [{ title: 'عدد المواد', value: rows.length, color: 'blue' }],
        tableHeaders: ['المادة', 'المورد', 'آخر سعر', 'التاريخ'],
        tableRows: rows,
      });
    }

    if (mode === 'inventory_total_movement' || mode === 'inventory_item_movement') {
      const source = mode === 'inventory_item_movement' && itemId ? allLines.filter((x: any) => String(x.itemId || '') === itemId) : allLines;
      const typed = source.map((x: any) => {
        const isIn = x.invoiceType === 'purchase' || x.invoiceType === 'opening_stock';
        return { ...x, direction: isIn ? 'in' : 'out', inQty: isIn ? x.qty : 0, outQty: isIn ? 0 : x.qty };
      }).filter((x: any) => String(q.movementType || 'all') === 'all' || x.direction === String(q.movementType || 'all'));

      if (mode === 'inventory_total_movement') {
        const g = grouped(typed, (x) => String(x.itemId || x.itemName || 'unknown'));
        const rows = Array.from(g.entries()).map(([key, list]) => {
          const label = list[0]?.itemName || key;
          const inQty = list.reduce((s: number, x: any) => s + Number(x.inQty || 0), 0);
          const outQty = list.reduce((s: number, x: any) => s + Number(x.outQty || 0), 0);
          return [label, roundMoney(inQty), roundMoney(outQty), roundMoney(inQty - outQty)];
        });
        return done({
          title: 'إجمالي حركة المواد',
          summary: [
            { title: 'عدد المواد', value: rows.length, color: 'blue' },
            { title: 'إجمالي الوارد', value: roundMoney(rows.reduce((s, x: any) => s + Number(x[1] || 0), 0)), color: 'green' },
            { title: 'إجمالي الصادر', value: roundMoney(rows.reduce((s, x: any) => s + Number(x[2] || 0), 0)), color: 'red' },
          ],
          tableHeaders: ['المادة', 'وارد', 'صادر', 'الصافي'],
          tableRows: rows,
        });
      }

      return done({
        title: 'كشف حركة مادة',
        summary: [{ title: 'عدد الحركات', value: typed.length, color: 'blue' }],
        tableHeaders: ['التاريخ', 'المرجع', 'المستودع', 'المادة', 'الحركة', 'الكمية'],
        tableRows: typed.map((x: any) => [x.date, x.invoiceNumber, x.warehouseName, x.itemName, x.direction === 'in' ? 'وارد' : 'صادر', roundMoney(x.qty)]),
      });
    }

    if (mode === 'inventory_current_stock') return inventoryStock('تقرير الجرد الحالي', 'full');
    if (mode === 'inventory_available_qty') return inventoryStock('تقرير الكميات المتوفرة', 'qty');
    if (mode === 'inventory_cost') return inventoryStock('تقرير تكلفة المخزون', 'cost');
    if (mode === 'inventory_value') return inventoryStock('تقرير قيمة المخزون', 'value');

    if (mode === 'inventory_stagnant') {
      const moved = new Set(allLines.map((x: any) => String(x.itemId || '')));
      const rows = (allItems || []).filter((it: any) => Number(it.quantity || 0) > 0 && !moved.has(String(it.id)))
        .slice(0, topN)
        .map((it: any) => [it.name, it.code || '', roundMoney(Number(it.quantity || 0)), roundMoney(itemCostBase(it)), roundMoney(Number(it.quantity || 0) * itemCostBase(it))]);
      return done({
        title: 'تقرير المواد الراكدة',
        summary: [{ title: 'عدد المواد الراكدة', value: rows.length, color: 'red' }],
        tableHeaders: ['المادة', 'الكود', 'الكمية', 'تكلفة الوحدة', 'القيمة'],
        tableRows: rows,
      });
    }

    if (mode === 'inventory_last_movement') {
      const g = grouped(allLines, (x) => String(x.itemId || x.itemName || 'unknown'));
      const rows = Array.from(g.entries()).map(([key, list]) => {
        const sorted = list.sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')));
        const last = sorted[0];
        return [last?.itemName || key, last?.date || '', last?.invoiceNumber || '', last?.warehouseName || '—', last?.partyName || '—'];
      });
      return done({
        title: 'تقرير آخر حركة على المواد',
        summary: [{ title: 'عدد المواد', value: rows.length, color: 'blue' }],
        tableHeaders: ['المادة', 'آخر تاريخ', 'المرجع', 'المستودع', 'الطرف'],
        tableRows: rows,
      });
    }

    if (mode === 'inventory_near_out') {
      const rows = (allItems || []).filter((it: any) => Number(it.quantity || 0) <= Number(it.minStockAlert || 0))
        .map((it: any) => [it.name, it.code || '', roundMoney(Number(it.quantity || 0)), Number(it.minStockAlert || 0), it.warehouseName || '—']);
      return done({
        title: 'تقرير المواد التي نفدت أو قاربت على النفاد',
        summary: [{ title: 'عدد المواد الحرجة', value: rows.length, color: 'red' }],
        tableHeaders: ['المادة', 'الكود', 'الكمية الحالية', 'حد التنبيه', 'المستودع'],
        tableRows: rows,
      });
    }

    if (mode === 'inventory_commercial_flow_chart' || mode === 'analytics_commercial_flow') {
      const s = grouped(salesInvoices, (x) => monthKey(x.date));
      const p = grouped(purchaseInvoices, (x) => monthKey(x.date));
      const months = new Set([...s.keys(), ...p.keys()]);
      const rows = Array.from(months).sort().map((m) => {
        const sv = (s.get(m) || []).reduce((acc: number, x: any) => acc + invoiceAmountForView(x, 'total'), 0);
        const pv = (p.get(m) || []).reduce((acc: number, x: any) => acc + invoiceAmountForView(x, 'total'), 0);
        return [m, roundMoney(sv), roundMoney(pv), roundMoney(sv - pv)];
      });
      return done({
        title: 'مخطط الحركة التجارية',
        summary: [{ title: 'عدد الفترات', value: rows.length, color: 'blue' }],
        tableHeaders: ['الشهر', 'المبيعات', 'المشتريات', 'الصافي'],
        tableRows: rows,
      });
    }

    if (mode === 'financial_balances_summary') {
      const scopedParties = (allParties || []).filter((x: any) => {
        if (partyId && String(x.id || '') !== partyId) return false;
        return true;
      });

      const sumSection = (targetType: 'customer' | 'supplier') => {
        let opening = 0;
        let movementDebit = 0;
        let movementCredit = 0;
        let closing = 0;

        for (const p of scopedParties) {
          const pType = String(p.type || '').toUpperCase();
          const match = targetType === 'customer'
            ? ['CUSTOMER', 'BOTH'].includes(pType)
            : ['SUPPLIER', 'BOTH'].includes(pType);
          if (!match) continue;

          const isSupplier = targetType === 'supplier';
          const tx = (allPartyTx || [])
            .filter((t: any) => String(t.partyId || '') === String(p.id || ''))
            .filter((t: any) => {
              const d = txDate(t);
              if (!d) return false;
              if (!matchesCurrency(t.currency || 'USD')) return false;
              return true;
            });

          const openingDelta = tx
            .filter((t: any) => beforeFrom(txDate(t)))
            .reduce((s: number, t: any) => s + partyDeltaForView(t), 0);
          const periodTx = tx.filter((t: any) => inDateRange(txDate(t), fromDate, toDate));
          const periodDelta = periodTx.reduce((s: number, t: any) => s + partyDeltaForView(t), 0);
          const periodDc = periodTx.reduce((acc: { debit: number; credit: number }, t: any) => {
            const dc = deltaToDebitCredit(partyDeltaForView(t), isSupplier);
            acc.debit += dc.debit;
            acc.credit += dc.credit;
            return acc;
          }, { debit: 0, credit: 0 });

          opening += openingDelta;
          movementDebit += periodDc.debit;
          movementCredit += periodDc.credit;
          closing += openingDelta + periodDelta;
        }

        return {
          opening: roundMoney(opening),
          movementDebit: roundMoney(movementDebit),
          movementCredit: roundMoney(movementCredit),
          closing: roundMoney(closing),
        };
      };

      const customer = sumSection('customer');
      const supplier = sumSection('supplier');
      return done({
        title: 'ملخص الأرصدة (مدينون / دائنون)',
        note: 'يعرض الرصيد الافتتاحي، حركة الفترة، والرصيد الختامي بالاعتماد على دفتر حركات الأطراف.',
        summary: [
          { title: 'ذمم العملاء (ختامي)', value: customer.closing, color: 'green' },
          { title: 'ذمم الموردين (ختامي)', value: supplier.closing, color: 'red' },
        ],
        tableHeaders: ['القسم', 'افتتاحي', 'مدين الفترة', 'دائن الفترة', 'ختامي'],
        tableRows: [
          ['ذمم العملاء', customer.opening, customer.movementDebit, customer.movementCredit, customer.closing],
          ['ذمم الموردين', supplier.opening, supplier.movementDebit, supplier.movementCredit, supplier.closing],
        ],
      });
    }

    if (mode === 'financial_net_sales_purchases_cash') {
      const sale = salesInvoices.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0);
      const purchase = purchaseInvoices.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0);
      const vouchers = (allVouchers || []).filter((v: any) => {
        if (!inDateRange(v.date, fromDate, toDate)) return false;
        if (!matchesCurrency(v.currency)) return false;
        const vStatus = String(v.status || '').toLowerCase();
        if (vStatus && !['posted', 'approved'].includes(vStatus)) return false;
        return true;
      });
      const receipts = vouchers
        .filter((v: any) => String(v.type || '').toLowerCase() === 'receipt')
        .reduce((s: number, v: any) => s + voucherAmountForView(v), 0);
      const payments = vouchers
        .filter((v: any) => String(v.type || '').toLowerCase() === 'payment')
        .reduce((s: number, v: any) => s + voucherAmountForView(v), 0);
      return done({
        title: 'صافي المبيعات والمشتريات والنقدية',
        note: 'مؤشر تشغيلي: يعتمد على الفواتير ضمن الفترة وعلى سندات الصندوق المرحّلة/المعتمدة.',
        summary: [
          { title: 'صافي المبيعات', value: roundMoney(sale), color: 'green' },
          { title: 'صافي المشتريات', value: roundMoney(purchase), color: 'blue' },
          { title: 'صافي النقدية', value: roundMoney(receipts - payments), color: 'teal' },
        ],
        tableHeaders: ['البند', 'القيمة'],
        tableRows: [['المبيعات', roundMoney(sale)], ['المشتريات', roundMoney(purchase)], ['المقبوضات', roundMoney(receipts)], ['المدفوعات', roundMoney(payments)], ['صافي النقدية', roundMoney(receipts - payments)]],
      });
    }

    if (mode === 'financial_ending_inventory_value') {
      const scoped = (allItems || []).filter((it: any) => (warehouseId === 'all' || String(it.warehouseId || '') === warehouseId) && (!category || String(it.categoryId || '') === category));
      const value = scoped.reduce((s: number, it: any) => s + Number(it.quantity || 0) * itemCostBase(it), 0);
      return done({
        title: 'تقرير قيمة بضاعة آخر المدة',
        subtitle: `حتى تاريخ ${asOfDate}`,
        note: 'يعتمد هذا المؤشر على لقطة المخزون الحالية (الكمية والتكلفة الحالية) وليس على محرك تكلفة زمني مرجّح.',
        summary: [{ title: 'القيمة الإجمالية', value: roundMoney(value), color: 'green' }],
        tableHeaders: ['المادة', 'الكمية', 'تكلفة الوحدة', 'القيمة'],
        tableRows: scoped.map((it: any) => [it.name, roundMoney(Number(it.quantity || 0)), roundMoney(itemCostBase(it)), roundMoney(Number(it.quantity || 0) * itemCostBase(it))]),
      });
    }

    if (mode === 'financial_profit_by_period') {
      const s = grouped(salesInvoices, (x) => monthKey(x.date));
      const p = grouped(purchaseInvoices, (x) => monthKey(x.date));
      const months = new Set([...s.keys(), ...p.keys()]);
      const rows = Array.from(months).sort().map((m) => {
        const sv = (s.get(m) || []).reduce((acc: number, x: any) => acc + invoiceAmountForView(x, 'total'), 0);
        const pv = (p.get(m) || []).reduce((acc: number, x: any) => acc + invoiceAmountForView(x, 'total'), 0);
        return [m, roundMoney(sv), roundMoney(pv), roundMoney(sv - pv)];
      });
      return done({
        title: 'تقرير الأرباح حسب الفترة',
        note: 'هذا التقرير تشغيلي ويحسب صافيًا مبسطًا (مبيعات - مشتريات) دون تسويات محاسبية كاملة.',
        summary: [{ title: 'صافي الربح للفترة', value: roundMoney(rows.reduce((s: number, r: any) => s + Number(r[3] || 0), 0)), color: 'blue' }],
        tableHeaders: ['الشهر', 'المبيعات', 'المشتريات', 'صافي الربح'],
        tableRows: rows,
      });
    }

    if (mode === 'financial_accounts_balances') {
      const trial = await getTrialBalance(asOfDate, String(getAuthContext(req).companyId || '').trim() || null);
      const rows = (trial || [])
        .filter((r: any) => !accountId || String(r.accountId || r.id || '') === accountId)
        .map((r: any) => [r.code || '', r.nameAr || r.name || '', roundMoney(Number(r.debit || 0)), roundMoney(Number(r.credit || 0)), r.accountType || '']);
      return done({
        title: 'تقرير أرصدة الحسابات',
        subtitle: `حتى تاريخ ${asOfDate}`,
        summary: [
          { title: 'إجمالي المدين', value: roundMoney(rows.reduce((s: number, x: any) => s + Number(x[2] || 0), 0)), color: 'green' },
          { title: 'إجمالي الدائن', value: roundMoney(rows.reduce((s: number, x: any) => s + Number(x[3] || 0), 0)), color: 'red' },
        ],
        tableHeaders: ['الكود', 'الحساب', 'مدين', 'دائن', 'النوع'],
        tableRows: rows,
      });
    }

    if (mode === 'financial_expense_revenue_detail' || mode === 'financial_accounts_movement') {
      const postedIds = new Set((allEntries || [])
        .filter((e: any) => String(e.status || '').toLowerCase() === 'posted' && inDateRange(String(e.entryDate || ''), fromDate, toDate))
        .map((e: any) => Number(e.id)));
      const accountById: Map<number, any> = new Map((allAccounts || []).map((a: any) => [Number(a.id), a]));
      const scopedLines = (allEntryLines || []).filter((l: any) => postedIds.has(Number(l.journalEntryId)));
      const g = new Map<number, { account: any; debit: number; credit: number; balance: number }>();
      for (const ln of scopedLines) {
        if (accountId && String(ln.accountId || '') !== accountId) continue;
        const acc = accountById.get(Number(ln.accountId));
        if (!acc) continue;
        const type = String(acc.accountType || '').toLowerCase();
        if (mode === 'financial_expense_revenue_detail' && !['revenue', 'expenses'].includes(type)) continue;
        const row = g.get(Number(ln.accountId)) || { account: acc, debit: 0, credit: 0, balance: 0 };
        row.debit += Number(ln.debit || 0);
        row.credit += Number(ln.credit || 0);
        row.balance += mode === 'financial_expense_revenue_detail'
          ? (type === 'revenue' ? (Number(ln.credit || 0) - Number(ln.debit || 0)) : (Number(ln.debit || 0) - Number(ln.credit || 0)))
          : (Number(ln.debit || 0) - Number(ln.credit || 0));
        g.set(Number(ln.accountId), row);
      }
      const rows = Array.from(g.values()).map((x: any) => [getAccountLogicalCode(x.account), x.account.nameAr || '', x.account.accountType || '', roundMoney(x.debit), roundMoney(x.credit), roundMoney(x.balance)]);
      return done({
        title: mode === 'financial_expense_revenue_detail' ? 'تقرير المصروفات والإيرادات التفصيلي' : 'تقرير حركة الحسابات',
        summary: [{ title: 'عدد الحسابات', value: rows.length, color: 'blue' }],
        tableHeaders: ['الكود', 'الحساب', 'النوع', 'مدين', 'دائن', 'الصافي'],
        tableRows: rows,
      });
    }

    if (mode === 'parties_customer_statement' || mode === 'parties_supplier_statement') {
      const isSupplier = mode === 'parties_supplier_statement';
      const parties = (allParties || []).filter((p: any) => {
        if (partyId && String(p.id) !== partyId) return false;
        const t = String(p.type || '').toUpperCase();
        return isSupplier ? ['SUPPLIER', 'BOTH'].includes(t) : ['CUSTOMER', 'BOTH'].includes(t);
      });
      const rows: any[] = [];
      let td = 0;
      let tc = 0;
      let openingDebit = 0;
      let openingCredit = 0;
      for (const p of parties) {
        const partyTx = (allPartyTx || [])
          .filter((t: any) => String(t.partyId || '') === String(p.id))
          .filter((t: any) => {
            const d = txDate(t);
            if (!d) return false;
            return matchesCurrency(t.currency || 'USD');
          });

        const openingDelta = partyTx
          .filter((t: any) => beforeFrom(txDate(t)))
          .reduce((s: number, t: any) => s + partyDeltaForView(t), 0);
        const openingDc = deltaToDebitCredit(openingDelta, isSupplier);
        openingDebit += openingDc.debit;
        openingCredit += openingDc.credit;

        let running = roundMoney(openingDc.debit - openingDc.credit);
        if (openingDc.debit !== 0 || openingDc.credit !== 0) {
          rows.push([
            fromDate,
            p.name,
            'رصيد افتتاحي',
            '',
            roundMoney(openingDc.debit),
            roundMoney(openingDc.credit),
            roundMoney(running),
            currency === 'ALL' ? 'متعدد' : currency,
          ]);
        }

        const tx = partyTx
          .filter((t: any) => inDateRange(txDate(t), fromDate, toDate))
          .sort((a: any, b: any) => txDate(a).localeCompare(txDate(b)));

        for (const t of tx) {
          const delta = partyDeltaForView(t);
          const dc = deltaToDebitCredit(delta, isSupplier);
          const debit = dc.debit;
          const credit = dc.credit;
          running += debit - credit;
          td += debit;
          tc += credit;
          rows.push([
            txDate(t),
            p.name,
            t.kind || 'حركة',
            t.refId || '',
            roundMoney(debit),
            roundMoney(credit),
            roundMoney(running),
            useTransactionView ? normalizeCurrencyCode(t.currency || viewCurrency) : BASE_CURRENCY
          ]);
        }
      }
      return done({
        title: isSupplier ? 'كشف حساب مورد' : 'كشف حساب عميل',
        summary: [
          { title: 'افتتاحي مدين', value: roundMoney(openingDebit), color: 'teal' },
          { title: 'افتتاحي دائن', value: roundMoney(openingCredit), color: 'orange' },
          { title: 'إجمالي مدين الفترة', value: roundMoney(td), color: 'green' },
          { title: 'إجمالي دائن الفترة', value: roundMoney(tc), color: 'red' },
          { title: 'الرصيد الختامي', value: roundMoney((openingDebit + td) - (openingCredit + tc)), color: 'blue' },
        ],
        tableHeaders: ['التاريخ', 'الطرف', 'نوع الحركة', 'المرجع', 'مدين', 'دائن', 'الرصيد', 'العملة'],
        tableRows: rows,
      });
    }

    if (mode === 'parties_customer_receivables_summary' || mode === 'parties_supplier_payables_summary' || mode === 'parties_customer_balances' || mode === 'parties_supplier_balances' || mode === 'parties_customer_movement' || mode === 'parties_supplier_movement') {
      const forCustomers = mode.includes('customer');
      const rows = (allParties || []).filter((p: any) => {
        if (partyId && String(p.id) !== partyId) return false;
        const t = String(p.type || '').toUpperCase();
        return forCustomers ? ['CUSTOMER', 'BOTH'].includes(t) : ['SUPPLIER', 'BOTH'].includes(t);
      }).map((p: any) => {
        const isSupplier = !forCustomers;
        const tx = (allPartyTx || [])
          .filter((t: any) => String(t.partyId || '') === String(p.id))
          .filter((t: any) => matchesCurrency(t.currency || 'USD'));
        const openingDelta = tx.filter((t: any) => beforeFrom(txDate(t))).reduce((s: number, t: any) => s + partyDeltaForView(t), 0);
        const periodTx = tx.filter((t: any) => inDateRange(txDate(t), fromDate, toDate));
        const periodDc = periodTx.reduce((acc: { debit: number; credit: number }, t: any) => {
          const dc = deltaToDebitCredit(partyDeltaForView(t), isSupplier);
          acc.debit += dc.debit;
          acc.credit += dc.credit;
          return acc;
        }, { debit: 0, credit: 0 });
        const closingDelta = openingDelta + periodTx.reduce((s: number, t: any) => s + partyDeltaForView(t), 0);
        return [
          p.name,
          balanceLabel(openingDelta, isSupplier),
          roundMoney(periodDc.debit),
          roundMoney(periodDc.credit),
          balanceLabel(closingDelta, isSupplier),
          p.type || ''
        ];
      });
      return done({
        title: mode.includes('receivables') ? 'ملخص ذمم العملاء' : mode.includes('payables') ? 'ملخص ذمم الموردين' : mode.includes('balances') ? (forCustomers ? 'أرصدة العملاء' : 'أرصدة الموردين') : (forCustomers ? 'تقرير حركة العملاء' : 'تقرير حركة الموردين'),
        summary: [{ title: 'عدد الأطراف', value: rows.length, color: 'blue' }],
        tableHeaders: ['الطرف', 'افتتاحي', 'مدين الفترة', 'دائن الفترة', 'ختامي', 'النوع'],
        tableRows: rows,
      });
    }

    if (mode === 'parties_aging_debts') {
      const targetTypes = partyType === 'SUPPLIER'
        ? ['purchase']
        : partyType === 'CUSTOMER'
          ? ['sale']
          : ['sale', 'purchase'];
      const invs = (allInvoices || []).filter((inv: any) => {
        if (!targetTypes.includes(String(inv.type || '').toLowerCase())) return false;
        if (invoiceAmountForView(inv, 'remaining') <= 0) return false;
        if (!inDateRange(String(inv.date || ''), '2000-01-01', asOfDate)) return false;
        if (partyId && String(inv.clientId || '') !== partyId) return false;
        if (!matchesCurrency(inv.currency)) return false;
        return true;
      });
      const asOf = new Date(asOfDate);
      const rows = invs.map((inv: any) => {
        const d = new Date(String(inv.date || '').slice(0, 10));
        const ageDays = Math.max(0, Math.floor((asOf.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
        const bucket = ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+';
        return [
          inv.clientName || '—',
          inv.invoiceNumber || inv.id,
          inv.date,
          ageDays,
          bucket,
          roundMoney(invoiceAmountForView(inv, 'remaining')),
          useTransactionView ? invoiceCurrencyCode(inv) : BASE_CURRENCY
        ];
      });
      return done({
        title: 'تقرير أعمار الديون',
        subtitle: `حتى تاريخ ${asOfDate}`,
        summary: [{ title: 'إجمالي الذمم غير المسددة', value: roundMoney(rows.reduce((s: number, x: any) => s + Number(x[5] || 0), 0)), color: 'red' }],
        tableHeaders: ['الطرف', 'المرجع', 'التاريخ', 'العمر بالأيام', 'فئة العمر', 'المتبقي', 'العملة'],
        tableRows: rows,
      });
    }

    if (mode === 'analytics_overview' || mode === 'analytics_overview_print' || mode === 'analytics_sales' || mode === 'analytics_purchases' || mode === 'analytics_items' || mode === 'analytics_customers' || mode === 'analytics_dashboards') {
      const sales = salesInvoices.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0);
      const purchases = purchaseInvoices.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0);
      const inventoryValue = (allItems || []).reduce((s: number, it: any) => s + Number(it.quantity || 0) * itemCostBase(it), 0);
      return done({
        title: mode === 'analytics_overview_print' ? 'طباعة تقرير الإحصائيات الشامل' : 'تقرير الإحصائيات الشامل',
        summary: [
          { title: 'إجمالي المبيعات', value: roundMoney(sales), color: 'green' },
          { title: 'إجمالي المشتريات', value: roundMoney(purchases), color: 'blue' },
          { title: 'صافي الحركة', value: roundMoney(sales - purchases), color: 'teal' },
          { title: 'قيمة المخزون', value: roundMoney(inventoryValue), color: 'purple' },
        ],
        tableHeaders: ['المؤشر', 'القيمة'],
        tableRows: [['عدد فواتير المبيعات', salesInvoices.length], ['عدد فواتير المشتريات', purchaseInvoices.length], ['عدد المواد', (allItems || []).length], ['عدد الأطراف', (allParties || []).length]],
      });
    }

    if (mode === 'misc_unclassified' || mode === 'misc_operational' || mode === 'misc_quick') {
      const sales = salesInvoices.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0);
      const purchases = purchaseInvoices.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0);
      const vouchers = (allVouchers || [])
        .filter((v: any) => inDateRange(v.date, fromDate, toDate))
        .reduce((s: number, v: any) => s + voucherAmountForView(v), 0);
      return done({
        title: mode === 'misc_quick' ? 'تقارير مجمعة سريعة' : mode === 'misc_operational' ? 'تقارير تشغيلية عامة' : 'تقارير لا تنتمي بوضوح إلى قسم واحد',
        summary: [
          { title: 'المبيعات', value: roundMoney(sales), color: 'green' },
          { title: 'المشتريات', value: roundMoney(purchases), color: 'blue' },
          { title: 'حركة السندات', value: roundMoney(vouchers), color: 'teal' },
        ],
        tableHeaders: ['المؤشر', 'القيمة'],
        tableRows: [['عدد الفواتير', scopedInvoices.length], ['عدد المواد', (allItems || []).length], ['عدد الأطراف', (allParties || []).length]],
      });
    }

    if (mode === 'partners_profit_sharing' || mode === 'partners_profit_by_period' || mode === 'partners_profit_distribution' || mode === 'partners_capital_contributions') {
      if (!(allPartners || []).length) {
        return requiresDataset('تقارير الشركاء والأرباح', 'لا توجد بيانات شركاء في النظام حتى الآن.');
      }
      if (mode === 'partners_capital_contributions') {
        const rows = (allPartnerTx || []).filter((t: any) => inDateRange(String(t.date || ''), fromDate, toDate))
          .filter((t: any) => ['capital_injection', 'capital_withdrawal'].includes(String(t.type || '')))
          .map((t: any) => [t.date, t.partnerName || t.partnerId, t.type, roundMoney(Number(t.amount || 0)), t.description || '']);
        return done({
          title: 'تقرير مساهمات الشركاء / رأس المال',
          summary: [{ title: 'إجمالي الحركات', value: rows.length, color: 'blue' }],
          tableHeaders: ['التاريخ', 'الشريك', 'النوع', 'المبلغ', 'الوصف'],
          tableRows: rows,
        });
      }
      const net = roundMoney(
        salesInvoices.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0) -
        purchaseInvoices.reduce((s: number, x: any) => s + invoiceAmountForView(x, 'total'), 0)
      );
      const rows = (allPartners || []).map((p: any) => [p.name, `${Number(p.percentage || 0)}%`, roundMoney((net * Number(p.percentage || 0)) / 100), p.status || 'active']);
      return done({
        title: mode === 'partners_profit_by_period' ? 'تقرير أرباح الشركاء حسب الفترة' : mode === 'partners_profit_distribution' ? 'تقرير توزيع الأرباح' : 'تقرير الشركاء وتقاسم الأرباح',
        summary: [{ title: 'صافي الربح للفترة', value: net, color: 'green' }],
        tableHeaders: ['الشريك', 'النسبة', 'حصة الربح', 'الحالة'],
        tableRows: rows,
      });
    }

    if (mode === 'parties_reconciliation_future' || mode === 'users_delegate_collections' || mode === 'misc_future') {
      if (mode === 'parties_reconciliation_future') {
        // Redirect to live reconciliation report endpoint
        return {
          mode,
          redirect: '/api/reconciliation/report',
          message: 'استخدم endpoint /api/reconciliation/report للحصول على تقرير المطابقة الكامل.',
          reportAvailable: true,
        };
      }
      if (mode === 'users_delegate_collections') {
        return requiresDataset(
          'تقرير يتطلب بيانات إضافية',
          'يتطلب هذا التقرير بيانات تحصيلات المندوبين غير متوفرة حاليًا.',
          'مطلوب dataset تحصيلات مرتبط بالمندوب/المستخدم ومرجع الفاتورة.'
        );
      }
      return requiresDataset(
        'تقرير يتطلب بيانات إضافية',
        'يتطلب هذا التقرير بيانات مستقبلية غير متوفرة حاليًا.',
        'مطلوب تعريف dataset تشغيلي للتقرير المستقبلي.'
      );
    }

    if (mode === 'restaurant_tables' || mode === 'restaurant_sessions' || mode === 'restaurant_orders') {
      const allRestaurantTables = scopeRows(await db.select().from(schema.restaurantTables).all(), req, 'restaurant-tables');
      const allRestaurantSessions = scopeRows(await db.select().from(schema.restaurantTableSessions).all(), req, 'restaurant-table-sessions');

      const rangeStart = Date.parse(`${fromDate}T00:00:00.000Z`);
      const rangeEnd = Date.parse(`${toDate}T23:59:59.999Z`);
      const overlapsRange = (s: any) => {
        const op = Date.parse(String(s.openedAt || ''));
        const clRaw = s.closedAt ? Date.parse(String(s.closedAt)) : Date.now();
        if (!Number.isFinite(op) || !Number.isFinite(clRaw)) return false;
        return op <= rangeEnd && clRaw >= rangeStart;
      };
      const overlapMinutes = (s: any) => {
        const op = Date.parse(String(s.openedAt || ''));
        const cl = s.closedAt ? Date.parse(String(s.closedAt)) : Date.now();
        if (!Number.isFinite(op) || !Number.isFinite(cl)) return 0;
        const a = Math.max(op, rangeStart);
        const b = Math.min(cl, rangeEnd);
        return Math.max(0, (b - a) / 60000);
      };

      const tableById = new Map((allRestaurantTables || []).map((t: any) => [String(t.id), t]));

      if (mode === 'restaurant_tables') {
        const active = (allRestaurantTables || []).filter((t: any) => t.isActive !== false && Number(t.isActive ?? 1) !== 0);
        const live = (allRestaurantSessions || []).filter((s: any) => String(s.sessionStatus || '') !== 'closed');
        const openCount = live.length;
        let sumMin = 0;
        let n = 0;
        const now = Date.now();
        for (const s of live) {
          const opened = Date.parse(String(s.openedAt || ''));
          if (Number.isFinite(opened)) {
            sumMin += (now - opened) / 60000;
            n += 1;
          }
        }
        const avgOpen = n ? roundMoney(sumMin / n) : 0;
        const occupiedTables = new Set(live.map((s: any) => String(s.tableId))).size;
        const available = Math.max(0, active.length - occupiedTables);
        const pending = live.filter((s: any) => String(s.sessionStatus) === 'pending_review').length;
        const ready = live.filter((s: any) => String(s.sessionStatus) === 'ready_to_close').length;
        const rows = active.map((t: any) => {
          const s = live.find((x: any) => String(x.tableId) === String(t.id));
          return [
            t.code,
            t.name,
            t.zoneName || '',
            s ? String(s.sessionStatus) : 'متاحة',
            s?.guestCount ?? '',
            s ? String(s.openedAt || '').slice(0, 19).replace('T', ' ') : '',
            s ? roundMoney(Number(s.preliminaryTotal || 0)) : '',
          ];
        });
        return done({
          title: 'لقطة إشغال الطاولات (مطعم)',
          subtitle: `فرع التقرير: ${branchId} — مرجع ${asOfDate}`,
          summary: [
            { title: 'طاولات نشطة', value: active.length, color: 'blue' },
            { title: 'متاحة', value: available, color: 'emerald' },
            { title: 'مشغولة (طاولات)', value: occupiedTables, color: 'rose' },
            { title: 'جلسات غير مغلقة', value: openCount, color: 'purple' },
            { title: 'بانتظار المراجعة', value: pending, color: 'amber' },
            { title: 'جاهزة للإغلاق', value: ready, color: 'orange' },
            { title: 'متوسط مدة الجلسات المفتوحة (دقيقة)', value: avgOpen, color: 'slate' },
          ],
          tableHeaders: ['الرمز', 'الاسم', 'المنطقة', 'حالة الجلسة', 'الضيوف', 'بداية الجلسة', 'إجمالي تقديري'],
          tableRows: rows,
        });
      }

      if (mode === 'restaurant_sessions') {
        const scoped = (allRestaurantSessions || []).filter(overlapsRange);
        const rows = scoped
          .sort((a: any, b: any) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')))
          .map((s: any) => {
            const t = tableById.get(String(s.tableId));
            const op = Date.parse(String(s.openedAt || ''));
            const cl = s.closedAt ? Date.parse(String(s.closedAt)) : NaN;
            const durMin = Number.isFinite(op) && Number.isFinite(cl)
              ? roundMoney(Math.max(0, (cl - op) / 60000))
              : '';
            return [
              t?.code || s.tableId,
              String(s.openedAt || '').slice(0, 19).replace('T', ' '),
              s.closedAt ? String(s.closedAt).slice(0, 19).replace('T', ' ') : '',
              durMin,
              s.guestCount ?? '',
              roundMoney(Number(s.preliminaryTotal || 0)),
              String(s.sessionStatus || ''),
            ];
          });
        return done({
          title: 'سجل جلسات الطاولات',
          subtitle: `من ${fromDate} إلى ${toDate}`,
          summary: [
            { title: 'عدد الجلسات في الفترة', value: scoped.length, color: 'blue' },
            { title: 'جلسات مفتوحة (غير مغلقة)', value: scoped.filter((s: any) => String(s.sessionStatus) !== 'closed').length, color: 'amber' },
          ],
          tableHeaders: ['الطاولة', 'فتحت في', 'أغلقت في', 'المدة (د)', 'الضيوف', 'إجمالي تقديري', 'الحالة'],
          tableRows: rows,
        });
      }

      if (mode === 'restaurant_orders') {
        const scoped = (allRestaurantSessions || []).filter(overlapsRange);
        const byTable = new Map<string, { count: number; minutes: number }>();
        for (const s of scoped) {
          const tid = String(s.tableId || '');
          const prev = byTable.get(tid) || { count: 0, minutes: 0 };
          prev.count += 1;
          prev.minutes += overlapMinutes(s);
          byTable.set(tid, prev);
        }
        const rows = (allRestaurantTables || [])
          .filter((t: any) => t.isActive !== false)
          .map((t: any) => {
            const agg = byTable.get(String(t.id)) || { count: 0, minutes: 0 };
            return [t.code, t.name, agg.count, roundMoney(agg.minutes)];
          })
          .sort((a: any, b: any) => Number(b[2] || 0) - Number(a[2] || 0));
        const most = rows[0] || null;
        const least = rows.length ? rows[rows.length - 1] : null;
        return done({
          title: 'استخدام الطاولات (مطعم)',
          subtitle: `من ${fromDate} إلى ${toDate} — وضع تقرير قديم: restaurant_orders`,
          summary: [
            { title: 'إجمالي الجلسات في الفترة', value: scoped.length, color: 'blue' },
            { title: 'أكثر طاولة استخدامًا (جلسات)', value: most ? String(most[0]) : '—', color: 'emerald' },
            { title: 'أقل طاولة استخدامًا (جلسات)', value: least ? String(least[0]) : '—', color: 'slate' },
          ],
          tableHeaders: ['الرمز', 'الاسم', 'عدد الجلسات', 'دقائق مفتوحة ضمن الفترة'],
          tableRows: rows,
        });
      }
    }

    if (mode === 'restaurant_qr_activity' || mode === 'restaurant_session_request_timeline' || mode === 'restaurant_qr_menu_usage') {
      const rangeStart = Date.parse(`${fromDate}T00:00:00.000Z`);
      const rangeEnd = Date.parse(`${toDate}T23:59:59.999Z`);
      const allRestaurantTables = scopeRows(await db.select().from(schema.restaurantTables).all(), req, 'restaurant-tables');
      const allRestaurantSessions = scopeRows(await db.select().from(schema.restaurantTableSessions).all(), req, 'restaurant-table-sessions');
      const allReq = scopeRows(await db.select().from(schema.restaurantTableRequests).all(), req, 'restaurant-table-requests');
      const allReqItems = scopeRows(await db.select().from(schema.restaurantTableRequestItems).all(), req, 'restaurant-table-request-items');
      const tableById = new Map((allRestaurantTables || []).map((t: any) => [String(t.id), t]));
      const sessionById = new Map((allRestaurantSessions || []).map((s: any) => [String(s.id), s]));

      const inRangeReq = (r: any) => {
        const t = Date.parse(String(r.submittedAt || '').slice(0, 19).replace(' ', 'T'));
        return Number.isFinite(t) && t >= rangeStart && t <= rangeEnd;
      };
      const scopedReq = (allReq || []).filter(inRangeReq);

      if (mode === 'restaurant_qr_activity') {
        const byStatus: Record<string, number> = {};
        for (const r of scopedReq) {
          const k = String(r.requestStatus || 'unknown');
          byStatus[k] = (byStatus[k] || 0) + 1;
        }
        const byTable: Record<string, number> = {};
        for (const r of scopedReq) {
          const tc = tableById.get(String(r.tableId))?.code || r.tableId;
          byTable[tc] = (byTable[tc] || 0) + 1;
        }
        const accepted = (scopedReq || []).filter((r: any) => String(r.requestStatus) === 'accepted').length;
        const rejected = (scopedReq || []).filter((r: any) => String(r.requestStatus) === 'rejected').length;
        const pending = (scopedReq || []).filter((r: any) => ['new', 'seen'].includes(String(r.requestStatus))).length;
        const rows = Object.entries(byStatus).map(([status, count]) => [status, count]);
        return done({
          title: 'نشاط طلبات QR (مطعم)',
          subtitle: `من ${fromDate} إلى ${toDate}`,
          summary: [
            { title: 'إجمالي الطلبات', value: scopedReq.length, color: 'blue' },
            { title: 'مقبولة', value: accepted, color: 'emerald' },
            { title: 'مرفوضة', value: rejected, color: 'rose' },
            { title: 'قيد المعالجة', value: pending, color: 'amber' },
          ],
          tableHeaders: ['حالة الطلب', 'العدد'],
          tableRows: rows,
          note: `توزيع حسب الطاولة (أعلى 15): ${Object.entries(byTable).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}=${v}`).join(' | ')}`,
        });
      }

      if (mode === 'restaurant_session_request_timeline') {
        const bySession = new Map<string, any[]>();
        for (const r of scopedReq) {
          const sid = String(r.sessionId);
          if (!bySession.has(sid)) bySession.set(sid, []);
          bySession.get(sid)!.push(r);
        }
        const rows: any[] = [];
        for (const [sid, list] of bySession.entries()) {
          list.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
          const s = sessionById.get(sid);
          const t = tableById.get(String(s?.tableId || list[0]?.tableId));
          const first = list[0]?.submittedAt;
          const last = list[list.length - 1]?.submittedAt;
          rows.push([
            t?.code || '',
            sid,
            list.length,
            String(first || '').slice(0, 19).replace('T', ' '),
            String(last || '').slice(0, 19).replace('T', ' '),
            s ? Number(s.unreadRequestCount || 0) : '',
          ]);
        }
        rows.sort((a, b) => String(b[3]).localeCompare(String(a[3])));
        return done({
          title: 'خط زمني لطلبات الجلسات',
          subtitle: `من ${fromDate} إلى ${toDate}`,
          summary: [{ title: 'جلسات لها طلبات', value: rows.length, color: 'blue' }],
          tableHeaders: ['طاولة', 'جلسة', 'عدد الطلبات', 'أول طلب', 'آخر طلب', 'غير المقروء (حالي)'],
          tableRows: rows,
        });
      }

      if (mode === 'restaurant_qr_menu_usage') {
        const qtyByItem = new Map<string, { qty: number; name: string }>();
        for (const line of allReqItems || []) {
          const parent = (allReq || []).find((r: any) => String(r.id) === String(line.requestId));
          if (!parent || !inRangeReq(parent)) continue;
          const id = String(line.itemId);
          const prev = qtyByItem.get(id) || { qty: 0, name: String(line.itemNameSnapshot || id) };
          prev.qty += Number(line.quantity || 0);
          qtyByItem.set(id, prev);
        }
        const sorted = Array.from(qtyByItem.entries()).sort((a, b) => b[1].qty - a[1].qty);
        const top = sorted.slice(0, 20).map(([id, v]) => [id, v.name, roundMoney(v.qty)]);
        const bottom = sorted.length ? sorted.slice(-10).map(([id, v]) => [id, v.name, roundMoney(v.qty)]) : [];
        const hourBucket: Record<string, number> = {};
        for (const r of scopedReq) {
          const h = String(r.submittedAt || '').slice(11, 13) || '--';
          hourBucket[h] = (hourBucket[h] || 0) + 1;
        }
        const hourRows = Object.entries(hourBucket).sort((a, b) => a[0].localeCompare(b[0]));
        return done({
          title: 'استخدام منيو QR',
          subtitle: `من ${fromDate} إلى ${toDate}`,
          summary: [
            { title: 'طلبات في الفترة', value: scopedReq.length, color: 'blue' },
            { title: 'مواد مختلفة طُلبت', value: qtyByItem.size, color: 'purple' },
          ],
          tableHeaders: ['معرف المادة', 'الاسم', 'الكمية المطلوبة'],
          tableRows: top,
          note: `أقل الطلب (عينة): ${bottom.map((r) => `${r[1]}:${r[2]}`).join(' | ')} — نشاط بالساعة: ${hourRows.map(([h, c]) => `${h}h=${c}`).join(', ')}`,
        });
      }
    }

    return requiresDataset(
      'تقرير غير مدعوم بعد',
      `لم يتم تعريف mode='${mode}' ضمن مركز التقارير حتى الآن.`,
      `وضع التقرير '${mode}' غير معرف في سجل التقارير الخلفي.`
    );
  });
}
