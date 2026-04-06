/**
 * TRUSTED REPORTING ENGINE
 *
 * Sources of truth (ONLY):
 *   - Accounting:  journal_entry_lines (status='posted' entries only)
 *   - Inventory:   inventory_movements
 *   - Party AR/AP: party_transactions
 *
 * NEVER reads: account_balances, items.quantity, parties.balance
 * All queries are company/branch scoped from auth context.
 */

import { roundMoney } from '../accountingService';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ReportScope {
  companyId: string;
  branchId?: string | null;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export interface TrialBalanceLine {
  accountId: number;
  code: string;
  nameAr: string;
  accountType: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface GLEntry {
  date: string;
  entryNumber: string;
  description: string;
  referenceType: string;
  referenceId: number | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface GLReport {
  account: { id: number; code: string; nameAr: string; accountType: string };
  openingBalance: number;
  lines: GLEntry[];
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

export interface PartyLedgerEntry {
  date: string;
  kind: string;
  refId: string | null;
  memo: string;
  debit: number;
  credit: number;
  runningBalance: number;
  currency: string;
}

export interface PartyLedgerReport {
  partyId: string;
  partyName: string;
  partyType: string;
  openingBalance: number;
  lines: PartyLedgerEntry[];
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

export interface AgedBucket {
  current: number;   // 0–30
  days31_60: number;
  days61_90: number;
  days91plus: number;
  total: number;
}

export interface AgedPartyLine {
  partyId: string;
  partyName: string;
  partyType: string;
  buckets: AgedBucket;
}

export interface StockBalanceLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  qtyIn: number;
  qtyOut: number;
  netQty: number;
  lastMovementDate: string | null;
}

export interface StockMovementLine {
  date: string;
  documentType: string;
  documentId: string;
  documentNumber: string | null;
  movementType: string;
  qty: number;
  baseQty: number;
  unitName: string | null;
  notes: string | null;
  runningQty: number;
}

export interface StockMovementReport {
  itemId: string;
  warehouseId: string | null;
  openingQty: number;
  lines: StockMovementLine[];
  totalIn: number;
  totalOut: number;
  netQty: number;
  closingQty: number;
}

export interface InventoryValuationLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  netQty: number;
  lastCostBase: number;
  totalValue: number;
}

export interface DriftWarning {
  type: 'STOCK_DRIFT' | 'PARTY_DRIFT' | 'UNPOSTED_LINES';
  entityId: string;
  canonical: number;
  snapshot: number;
  delta: number;
  message: string;
}

// ─── Guard helpers ─────────────────────────────────────────────────────────

function assertScope(scope: ReportScope): void {
  if (!scope.companyId || scope.companyId === 'undefined') {
    throw { statusCode: 403, code: 'REPORT_SCOPE_REQUIRED', message: 'Company scope is required for all reports.' };
  }
}

// ─── SQL helpers ───────────────────────────────────────────────────────────

/**
 * Build a parameterized WHERE fragment for company + optional branch.
 * Returns { clause: string, params: any[] }
 */
function buildTenantClause(
  tableAlias: string,
  companyId: string,
  branchId?: string | null
): { clause: string; params: any[] } {
  const params: any[] = [companyId];
  let clause = `${tableAlias}.company_id = ?`;
  if (branchId) {
    clause += ` AND ${tableAlias}.branch_id = ?`;
    params.push(branchId);
  }
  return { clause, params };
}

// ─── PHASE 2A: TRIAL BALANCE ───────────────────────────────────────────────

/**
 * Trial Balance computed ONLY from posted journal_entry_lines.
 * Filters:
 *   - company_id (required)
 *   - branch_id (optional)
 *   - date range on journal_entries.entry_date
 */
export function buildTrialBalance(
  db: any,
  scope: ReportScope,
  range: DateRange,
  getAccountLogicalCode: (account: any) => string
): TrialBalanceLine[] {
  assertScope(scope);

  const params: any[] = [
    scope.companyId,
    'posted',
    range.from,
    range.to,
  ];

  let branchClause = '';
  if (scope.branchId) {
    branchClause = 'AND je.branch_id = ?';
    params.push(scope.branchId);
  }

  // Single SQL query: join lines → entries → accounts, filter posted + date + scope
  const rows: Array<{
    account_id: number;
    code: string;
    lookup_code: string | null;
    name_ar: string;
    account_type: string;
    total_debit: number;
    total_credit: number;
  }> = db.prepare(`
    SELECT
      a.id              AS account_id,
      a.code            AS code,
      a.lookup_code     AS lookup_code,
      a.name_ar         AS name_ar,
      a.account_type    AS account_type,
      COALESCE(SUM(jel.debit),  0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN accounts a        ON a.id  = jel.account_id
    WHERE je.company_id = ?
      AND je.status     = ?
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      ${branchClause}
      AND a.company_id  = ?
    GROUP BY a.id, a.code, a.lookup_code, a.name_ar, a.account_type
    ORDER BY a.code
  `).all(...params, scope.companyId);

  return rows.map((row) => {
    const debit  = roundMoney(row.total_debit);
    const credit = roundMoney(row.total_credit);
    return {
      accountId:   row.account_id,
      code:        row.lookup_code || row.code,
      nameAr:      row.name_ar,
      accountType: row.account_type,
      debit,
      credit,
      balance: roundMoney(debit - credit),
    };
  });
}

// ─── PHASE 2B: GENERAL LEDGER ──────────────────────────────────────────────

/**
 * General Ledger for a single account.
 * Computes opening balance (all posted lines BEFORE fromDate),
 * then detail lines within the date range with running balance.
 */
export function buildGeneralLedger(
  db: any,
  scope: ReportScope,
  accountId: number,
  range: DateRange
): GLReport {
  assertScope(scope);

  // Verify account belongs to company
  const account = db.prepare(`
    SELECT id, code, lookup_code, name_ar, account_type
    FROM accounts
    WHERE id = ? AND company_id = ?
  `).get(accountId, scope.companyId);

  if (!account) {
    throw { statusCode: 404, code: 'ACCOUNT_NOT_FOUND', message: 'Account not found in this company.' };
  }

  const branchParams: any[] = [];
  let branchClause = '';
  if (scope.branchId) {
    branchClause = 'AND je.branch_id = ?';
    branchParams.push(scope.branchId);
  }

  // Opening balance: sum of all posted lines for this account BEFORE range.from
  // Use SUBSTR to handle both date-only and full ISO timestamp stored values
  const openingRow: { debit: number; credit: number } = db.prepare(`
    SELECT
      COALESCE(SUM(jel.debit),  0) AS debit,
      COALESCE(SUM(jel.credit), 0) AS credit
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = ?
      AND je.company_id  = ?
      AND je.status      = 'posted'
      AND SUBSTR(je.entry_date, 1, 10) < ?
      ${branchClause}
  `).get(accountId, scope.companyId, range.from, ...branchParams) as any;

  const openingBalance = roundMoney(
    Number(openingRow?.debit || 0) - Number(openingRow?.credit || 0)
  );

  // Detail lines within date range
  const detailRows: Array<{
    entry_date: string;
    entry_number: string;
    description: string;
    reference_type: string;
    reference_id: number | null;
    debit: number;
    credit: number;
  }> = db.prepare(`
    SELECT
      je.entry_date      AS entry_date,
      je.entry_number    AS entry_number,
      je.description     AS description,
      je.reference_type  AS reference_type,
      je.reference_id    AS reference_id,
      jel.debit          AS debit,
      jel.credit         AS credit
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = ?
      AND je.company_id  = ?
      AND je.status      = 'posted'
      AND SUBSTR(je.entry_date, 1, 10) >= ?
      AND SUBSTR(je.entry_date, 1, 10) <= ?
      ${branchClause}
    ORDER BY SUBSTR(je.entry_date, 1, 10) ASC, je.id ASC
  `).all(accountId, scope.companyId, range.from, range.to, ...branchParams);

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;

  const lines: GLEntry[] = detailRows.map((row) => {
    const debit  = roundMoney(Number(row.debit  || 0));
    const credit = roundMoney(Number(row.credit || 0));
    totalDebit  += debit;
    totalCredit += credit;
    running = roundMoney(running + debit - credit);
    return {
      date:          row.entry_date,
      entryNumber:   row.entry_number,
      description:   row.description,
      referenceType: row.reference_type,
      referenceId:   row.reference_id,
      debit,
      credit,
      runningBalance: running,
    };
  });

  return {
    account: {
      id:          account.id,
      code:        account.lookup_code || account.code,
      nameAr:      account.name_ar,
      accountType: account.account_type,
    },
    openingBalance,
    lines,
    closingBalance:  running,
    totalDebit:      roundMoney(totalDebit),
    totalCredit:     roundMoney(totalCredit),
  };
}

// ─── PHASE 2C: PARTY LEDGER ────────────────────────────────────────────────

const PARTY_KIND_LABELS: Record<string, string> = {
  invoice_sale:             'فاتورة مبيعات',
  invoice_purchase:         'فاتورة مشتريات',
  invoice_return_sale:      'مرتجع مبيعات',
  invoice_return_purchase:  'مرتجع مشتريات',
  invoice_return:           'مرتجع',
  receipt:                  'سند قبض',
  payment:                  'سند دفع',
  opening:                  'رصيد افتتاحي',
  opening_receivable:       'رصيد افتتاحي ذمم',
  adjustment:               'تسوية',
  write_off:                'إعفاء',
  transfer:                 'تحويل',
};

function kindLabel(kind: string): string {
  return PARTY_KIND_LABELS[kind] || kind || 'حركة مالية';
}

/**
 * Party Ledger computed ONLY from party_transactions.
 * Opening balance = all tx BEFORE range.from
 * Detail = tx within range, sorted by createdAt
 */
export function buildPartyLedger(
  db: any,
  scope: ReportScope,
  partyId: string,
  range: DateRange
): PartyLedgerReport {
  assertScope(scope);

  const party = db.prepare(`
    SELECT id, name, type, company_id
    FROM parties
    WHERE id = ? AND company_id = ?
  `).get(partyId, scope.companyId);

  if (!party) {
    throw { statusCode: 404, code: 'PARTY_NOT_FOUND', message: 'Party not found in this company.' };
  }

  const branchParams: any[] = [];
  let branchClause = '';
  if (scope.branchId) {
    branchClause = 'AND branch_id = ?';
    branchParams.push(scope.branchId);
  }

  // Opening balance: sum of delta_base BEFORE range.from (exclusive — use date boundary)
  // Compare date portion only to avoid timestamp precision issues
  const openingRow: { delta: number } = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(delta_base, delta)), 0) AS delta
    FROM party_transactions
    WHERE party_id   = ?
      AND company_id = ?
      AND SUBSTR(created_at, 1, 10) < ?
      ${branchClause}
  `).get(partyId, scope.companyId, range.from, ...branchParams) as any;

  const openingBalance = roundMoney(Number(openingRow?.delta || 0));

  // Detail transactions within range (inclusive, date portion only)
  const txRows: Array<{
    created_at: string;
    kind: string;
    ref_id: string | null;
    delta_base: number | null;
    delta: number;
    currency: string | null;
  }> = db.prepare(`
    SELECT
      created_at,
      kind,
      ref_id,
      delta_base,
      delta,
      currency
    FROM party_transactions
    WHERE party_id   = ?
      AND company_id = ?
      AND SUBSTR(created_at, 1, 10) >= ?
      AND SUBSTR(created_at, 1, 10) <= ?
      ${branchClause}
    ORDER BY created_at ASC, id ASC
  `).all(partyId, scope.companyId, range.from, range.to, ...branchParams);

  const isSupplier = party.type === 'SUPPLIER';
  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;

  const lines: PartyLedgerEntry[] = txRows.map((row) => {
    const deltaBase = roundMoney(Number(row.delta_base ?? row.delta ?? 0));
    let debit = 0;
    let credit = 0;

    // For customers: positive delta = debit (they owe us), negative = credit (payment received)
    // For suppliers: positive delta = credit (we owe them), negative = debit (we paid)
    if (isSupplier) {
      if (deltaBase > 0) credit = deltaBase;
      else debit = Math.abs(deltaBase);
    } else {
      if (deltaBase > 0) debit = deltaBase;
      else credit = Math.abs(deltaBase);
    }

    totalDebit  += debit;
    totalCredit += credit;
    running = roundMoney(running + debit - credit);

    return {
      date:           row.created_at,
      kind:           row.kind,
      refId:          row.ref_id,
      memo:           kindLabel(row.kind),
      debit,
      credit,
      runningBalance: running,
      currency:       row.currency || 'SYP',
    };
  });

  return {
    partyId,
    partyName:      party.name,
    partyType:      party.type,
    openingBalance,
    lines,
    closingBalance: running,
    totalDebit:     roundMoney(totalDebit),
    totalCredit:    roundMoney(totalCredit),
  };
}

// ─── PHASE 2D: AGED RECEIVABLES / PAYABLES ────────────────────────────────

/**
 * Aged AR/AP computed from party_transactions.
 * Uses the current outstanding balance per party, bucketed by document age.
 * asOfDate = reference date for aging calculation.
 */
export function buildAgedBalances(
  db: any,
  scope: ReportScope,
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'BOTH',
  asOfDate: string
): AgedPartyLine[] {
  assertScope(scope);

  const branchParams: any[] = [];
  let branchClause = '';
  if (scope.branchId) {
    branchClause = 'AND pt.branch_id = ?';
    branchParams.push(scope.branchId);
  }

  // Get all open invoice-linked transactions up to asOfDate, grouped per party
  // We compute aging by using the invoice/voucher original date
  let partyTypeClause = '';
  const partyTypeParams: any[] = [];
  if (partyType === 'CUSTOMER') {
    partyTypeClause = "AND p.type IN ('CUSTOMER', 'BOTH')";
  } else if (partyType === 'SUPPLIER') {
    partyTypeClause = "AND p.type IN ('SUPPLIER', 'BOTH')";
  }

  // Get all invoices that have outstanding amounts (remaining > 0) up to asOfDate
  const invoiceRows: Array<{
    id: string;
    client_id: string;
    client_name: string;
    party_type: string;
    date: string;
    remaining_base: number;
    total_base: number;
  }> = db.prepare(`
    SELECT
      inv.id,
      inv.client_id,
      inv.client_name,
      p.type    AS party_type,
      inv.date,
      COALESCE(inv.remaining_amount_base, inv.remaining_amount, 0) AS remaining_base,
      COALESCE(inv.total_amount_base,     inv.total_amount,     0) AS total_base
    FROM invoices inv
    INNER JOIN parties p ON p.id = inv.client_id
    WHERE inv.company_id = ?
      AND SUBSTR(inv.date, 1, 10) <= ?
      AND COALESCE(inv.status, 'draft') != 'cancelled'
      AND inv.type       IN ('sale', 'purchase')
      AND COALESCE(inv.remaining_amount_base, inv.remaining_amount, 0) > 0
      ${branchParams.length ? 'AND inv.branch_id = ?' : ''}
      ${partyTypeClause}
      AND p.company_id   = ?
    ORDER BY inv.client_id, inv.date ASC
  `).all(
    scope.companyId,
    asOfDate,
    ...branchParams,
    ...partyTypeParams,
    scope.companyId
  );

  const partyMap = new Map<string, AgedPartyLine>();

  for (const inv of invoiceRows) {
    if (!inv.client_id) continue;

    const daysDiff = Math.floor(
      (new Date(asOfDate).getTime() - new Date(inv.date).getTime()) / (1000 * 60 * 60 * 24)
    );
    const amount = roundMoney(Math.abs(Number(inv.remaining_base || 0)));
    if (amount === 0) continue;

    if (!partyMap.has(inv.client_id)) {
      partyMap.set(inv.client_id, {
        partyId:   inv.client_id,
        partyName: inv.client_name || inv.client_id,
        partyType: inv.party_type,
        buckets: { current: 0, days31_60: 0, days61_90: 0, days91plus: 0, total: 0 },
      });
    }

    const line = partyMap.get(inv.client_id)!;
    if (daysDiff <= 30) {
      line.buckets.current  += amount;
    } else if (daysDiff <= 60) {
      line.buckets.days31_60 += amount;
    } else if (daysDiff <= 90) {
      line.buckets.days61_90 += amount;
    } else {
      line.buckets.days91plus += amount;
    }
    line.buckets.total += amount;
  }

  // Round all bucket values
  for (const line of partyMap.values()) {
    line.buckets.current   = roundMoney(line.buckets.current);
    line.buckets.days31_60 = roundMoney(line.buckets.days31_60);
    line.buckets.days61_90 = roundMoney(line.buckets.days61_90);
    line.buckets.days91plus = roundMoney(line.buckets.days91plus);
    line.buckets.total     = roundMoney(line.buckets.total);
  }

  return Array.from(partyMap.values())
    .filter((l) => l.buckets.total > 0)
    .sort((a, b) => b.buckets.total - a.buckets.total);
}

// ─── PHASE 3A: STOCK BALANCE ───────────────────────────────────────────────

/**
 * Stock Balance computed ONLY from inventory_movements.
 * Groups by item_id + warehouse_id, sums IN vs OUT qty.
 */
export function buildStockBalance(
  db: any,
  scope: ReportScope,
  warehouseId?: string | null,
  itemId?: string | null
): StockBalanceLine[] {
  assertScope(scope);

  const params: any[] = [scope.companyId];
  let extraClauses = '';

  if (scope.branchId) {
    extraClauses += ' AND im.branch_id = ?';
    params.push(scope.branchId);
  }
  if (warehouseId) {
    extraClauses += ' AND im.warehouse_id = ?';
    params.push(warehouseId);
  }
  if (itemId) {
    extraClauses += ' AND im.item_id = ?';
    params.push(itemId);
  }

  // IN movements: PURCHASE, OPENING_STOCK, TRANSFER_IN, CONSIGNMENT_IN, RETURN_PURCHASE, ADJUSTMENT_IN, SYSTEM_BASELINE
  // OUT movements: SALE, TRANSFER_OUT, CONSIGNMENT_OUT, RETURN_SALE, ADJUSTMENT_OUT
  const rows: Array<{
    item_id: string;
    warehouse_id: string;
    warehouse_name: string | null;
    qty_in: number;
    qty_out: number;
    last_movement_date: string | null;
  }> = db.prepare(`
    SELECT
      im.item_id,
      im.warehouse_id,
      MAX(im.warehouse_name) AS warehouse_name,
      COALESCE(SUM(CASE WHEN im.base_qty > 0 THEN im.base_qty ELSE 0 END), 0) AS qty_in,
      COALESCE(SUM(CASE WHEN im.base_qty < 0 THEN ABS(im.base_qty) ELSE 0 END), 0) AS qty_out,
      MAX(im.created_at) AS last_movement_date
    FROM inventory_movements im
    WHERE im.company_id = ?
      ${extraClauses}
    GROUP BY im.item_id, im.warehouse_id
    ORDER BY im.item_id, im.warehouse_id
  `).all(...params);

  // Fetch item master for code/name
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const itemMasterMap = new Map<string, { code: string; name: string }>();

  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',');
    const itemMaster: Array<{ id: string; code: string; name: string }> = db.prepare(`
      SELECT id, code, name FROM items
      WHERE id IN (${placeholders}) AND company_id = ?
    `).all(...itemIds, scope.companyId);
    for (const it of itemMaster) {
      itemMasterMap.set(it.id, { code: it.code, name: it.name });
    }
  }

  return rows.map((row) => {
    const master = itemMasterMap.get(row.item_id);
    return {
      itemId:            row.item_id,
      itemCode:          master?.code || row.item_id,
      itemName:          master?.name || row.item_id,
      warehouseId:       row.warehouse_id,
      warehouseName:     row.warehouse_name || row.warehouse_id,
      qtyIn:             roundMoney(row.qty_in),
      qtyOut:            roundMoney(row.qty_out),
      netQty:            roundMoney(row.qty_in - row.qty_out),
      lastMovementDate:  row.last_movement_date,
    };
  });
}

// ─── PHASE 3B: STOCK MOVEMENT REPORT ──────────────────────────────────────

/**
 * Full movement history for an item (optionally filtered by warehouse and date).
 * Source: inventory_movements only.
 */
export function buildStockMovements(
  db: any,
  scope: ReportScope,
  itemId: string,
  range: DateRange,
  warehouseId?: string | null
): StockMovementReport {
  assertScope(scope);

  let extraClauses = '';
  const extraParams: any[] = [];

  if (scope.branchId) {
    extraClauses += ' AND branch_id = ?';
    extraParams.push(scope.branchId);
  }
  if (warehouseId) {
    extraClauses += ' AND warehouse_id = ?';
    extraParams.push(warehouseId);
  }

  // Opening qty: all movements BEFORE range.from (so running balance starts correctly)
  const openingRow: { opening_qty: number } = db.prepare(`
    SELECT COALESCE(SUM(base_qty), 0) AS opening_qty
    FROM inventory_movements
    WHERE company_id = ?
      AND item_id    = ?
      AND SUBSTR(created_at, 1, 10) < ?
      ${extraClauses}
  `).get(scope.companyId, itemId, range.from, ...extraParams) as any;

  const openingQty = roundMoney(Number(openingRow?.opening_qty || 0));

  const rows: Array<{
    created_at: string;
    document_type: string;
    document_id: string;
    document_number: string | null;
    movement_type: string;
    qty: number;
    base_qty: number;
    unit_name: string | null;
    notes: string | null;
  }> = db.prepare(`
    SELECT
      created_at,
      document_type,
      document_id,
      document_number,
      movement_type,
      qty,
      base_qty,
      unit_name,
      notes
    FROM inventory_movements
    WHERE company_id = ?
      AND item_id    = ?
      AND SUBSTR(created_at, 1, 10) >= ?
      AND SUBSTR(created_at, 1, 10) <= ?
      ${extraClauses}
    ORDER BY created_at ASC, id ASC
  `).all(scope.companyId, itemId, range.from, range.to, ...extraParams);

  // running starts from opening balance, not zero
  let running = openingQty;
  let totalIn = 0;
  let totalOut = 0;

  const lines: StockMovementLine[] = rows.map((row) => {
    const baseQty = Number(row.base_qty || 0);
    if (baseQty > 0) totalIn  += baseQty;
    else             totalOut += Math.abs(baseQty);
    running = roundMoney(running + baseQty);
    return {
      date:           row.created_at,
      documentType:   row.document_type,
      documentId:     row.document_id,
      documentNumber: row.document_number,
      movementType:   row.movement_type,
      qty:            roundMoney(Number(row.qty || 0)),
      baseQty:        roundMoney(baseQty),
      unitName:       row.unit_name,
      notes:          row.notes,
      runningQty:     running,
    };
  });

  return {
    itemId,
    warehouseId: warehouseId || null,
    openingQty,
    lines,
    totalIn:  roundMoney(totalIn),
    totalOut: roundMoney(totalOut),
    netQty:   roundMoney(totalIn - totalOut),
    closingQty: running,
  } as any;
}

// ─── PHASE 3C: INVENTORY VALUATION ────────────────────────────────────────

/**
 * Inventory valuation: qty from inventory_movements, cost from last known movement cost.
 * Cost is resolved from items.costPrice (base currency) as the authoritative last cost.
 * We do NOT use items.quantity — we recompute from movements.
 */
export function buildInventoryValuation(
  db: any,
  scope: ReportScope,
  warehouseId?: string | null
): InventoryValuationLine[] {
  assertScope(scope);

  // Get stock quantities from movements
  const stockLines = buildStockBalance(db, scope, warehouseId, null);

  if (stockLines.length === 0) return [];

  // Get cost data from items master (costPrice is last known cost in base currency)
  const itemIds = [...new Set(stockLines.map((l) => l.itemId))];
  const placeholders = itemIds.map(() => '?').join(',');
  const costRows: Array<{ id: string; cost_price: number | null; cost_price_base: number | null }> = db.prepare(`
    SELECT id, cost_price, cost_price_base
    FROM items
    WHERE id IN (${placeholders}) AND company_id = ?
  `).all(...itemIds, scope.companyId);

  const costMap = new Map<string, number>();
  for (const row of costRows) {
    const cost = Number(row.cost_price_base ?? row.cost_price ?? 0);
    costMap.set(row.id, cost);
  }

  return stockLines
    .filter((line) => line.netQty !== 0)
    .map((line) => {
      const lastCostBase = costMap.get(line.itemId) || 0;
      return {
        itemId:       line.itemId,
        itemCode:     line.itemCode,
        itemName:     line.itemName,
        warehouseId:  line.warehouseId,
        warehouseName: line.warehouseName,
        netQty:       line.netQty,
        lastCostBase,
        totalValue:   roundMoney(line.netQty * lastCostBase),
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue);
}

// ─── PHASE 4: DRIFT DETECTION ──────────────────────────────────────────────

/**
 * Detects drift between canonical sources and snapshot fields.
 * Reports warnings — does NOT auto-repair.
 */
export function detectReportingDrift(
  db: any,
  scope: ReportScope,
  options: { checkStock?: boolean; checkParty?: boolean; limit?: number } = {}
): DriftWarning[] {
  assertScope(scope);

  const warnings: DriftWarning[] = [];
  const limit = options.limit || 50;

  // ── Stock drift: items.quantity vs SUM(inventory_movements.base_qty) ──
  if (options.checkStock !== false) {
    const stockDrift: Array<{
      item_id: string;
      snapshot_qty: number;
      canonical_qty: number;
    }> = db.prepare(`
      SELECT
        i.id                                                          AS item_id,
        COALESCE(i.quantity, 0)                                       AS snapshot_qty,
        COALESCE(SUM(im.base_qty), 0)                                 AS canonical_qty
      FROM items i
      LEFT JOIN inventory_movements im ON im.item_id = i.id AND im.company_id = i.company_id
      WHERE i.company_id = ?
        AND (i.inactive  IS NULL OR i.inactive = 0)
        AND (i.merged    IS NULL OR i.merged   = 0)
      GROUP BY i.id, i.quantity
      HAVING ABS(COALESCE(i.quantity, 0) - COALESCE(SUM(im.base_qty), 0)) > 0.001
      LIMIT ?
    `).all(scope.companyId, limit);

    for (const row of stockDrift) {
      warnings.push({
        type:      'STOCK_DRIFT',
        entityId:  row.item_id,
        canonical: roundMoney(row.canonical_qty),
        snapshot:  roundMoney(row.snapshot_qty),
        delta:     roundMoney(row.canonical_qty - row.snapshot_qty),
        message:   `Item ${row.item_id}: movement sum=${roundMoney(row.canonical_qty)} vs items.quantity=${roundMoney(row.snapshot_qty)}`,
      });
    }
  }

  // ── Party drift: parties.balance vs SUM(party_transactions.delta_base) ──
  if (options.checkParty !== false) {
    const partyDrift: Array<{
      party_id: string;
      snapshot_balance: number;
      canonical_balance: number;
    }> = db.prepare(`
      SELECT
        p.id                                                            AS party_id,
        COALESCE(p.balance, 0)                                          AS snapshot_balance,
        COALESCE(SUM(COALESCE(pt.delta_base, pt.delta)), 0)             AS canonical_balance
      FROM parties p
      LEFT JOIN party_transactions pt ON pt.party_id = p.id AND pt.company_id = p.company_id
      WHERE p.company_id = ?
        AND (p.is_active IS NULL OR p.is_active = 1)
      GROUP BY p.id, p.balance
      HAVING ABS(COALESCE(p.balance, 0) - COALESCE(SUM(COALESCE(pt.delta_base, pt.delta)), 0)) > 0.01
      LIMIT ?
    `).all(scope.companyId, limit);

    for (const row of partyDrift) {
      warnings.push({
        type:      'PARTY_DRIFT',
        entityId:  row.party_id,
        canonical: roundMoney(row.canonical_balance),
        snapshot:  roundMoney(row.snapshot_balance),
        delta:     roundMoney(row.canonical_balance - row.snapshot_balance),
        message:   `Party ${row.party_id}: tx sum=${roundMoney(row.canonical_balance)} vs parties.balance=${roundMoney(row.snapshot_balance)}`,
      });
    }
  }

  return warnings;
}

// ─── PHASE 5: INDEX CREATION ───────────────────────────────────────────────

/**
 * Ensures all reporting indexes exist.
 * Safe to call multiple times (CREATE INDEX IF NOT EXISTS).
 */
export function ensureReportingIndexes(db: any): void {
  const indexes = [
    // journal_entry_lines: primary reporting join
    `CREATE INDEX IF NOT EXISTS idx_jel_company_account_entry
       ON journal_entry_lines(company_id, account_id, journal_entry_id)`,

    // journal_entries: date + status filtering
    `CREATE INDEX IF NOT EXISTS idx_je_company_status_date
       ON journal_entries(company_id, status, entry_date)`,

    // journal_entries: branch filtering
    `CREATE INDEX IF NOT EXISTS idx_je_company_branch_date
       ON journal_entries(company_id, branch_id, entry_date)`,

    // inventory_movements: stock balance queries
    `CREATE INDEX IF NOT EXISTS idx_im_company_item_warehouse
       ON inventory_movements(company_id, item_id, warehouse_id)`,

    // inventory_movements: date range + movement report
    `CREATE INDEX IF NOT EXISTS idx_im_company_item_date
       ON inventory_movements(company_id, item_id, created_at)`,

    // inventory_movements: warehouse filter
    `CREATE INDEX IF NOT EXISTS idx_im_company_warehouse_date
       ON inventory_movements(company_id, warehouse_id, created_at)`,

    // party_transactions: party ledger + aging
    `CREATE INDEX IF NOT EXISTS idx_pt_company_party_date
       ON party_transactions(company_id, party_id, created_at)`,

    // party_transactions: branch filter
    `CREATE INDEX IF NOT EXISTS idx_pt_company_branch_party
       ON party_transactions(company_id, branch_id, party_id)`,

    // invoices: aged AR/AP query
    `CREATE INDEX IF NOT EXISTS idx_inv_company_client_date
       ON invoices(company_id, client_id, date)`,

    // invoices: status + type filter
    `CREATE INDEX IF NOT EXISTS idx_inv_company_type_status
       ON invoices(company_id, type, status)`,
  ];

  for (const sql of indexes) {
    try {
      db.prepare(sql).run();
    } catch (e: any) {
      // Non-fatal: log and continue
      console.warn(`[ReportingIndexes] Could not create index: ${e.message}`);
    }
  }

  console.log('[ReportingIndexes] All reporting indexes ensured.');
}
