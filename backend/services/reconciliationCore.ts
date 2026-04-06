/**
 * Reconciliation Core — pure matching logic (no DB dependencies)
 *
 * Supports:
 *   - Exact match (debit == credit, same currency)
 *   - Partial match (one side partially covers the other)
 *   - Tolerance-based match (small difference ≤ tolerance → auto-write-off)
 *   - Multi-to-one and one-to-many matching
 *   - Aging analysis of open items (1–30, 31–60, 61–90, 91–180, 180+)
 *
 * SAP-style rules:
 *   - Items marked as "matched" cannot be re-matched
 *   - Every match produces a matchGroupId shared by all items in the group
 *   - Difference ≤ tolerance → write-off; difference > tolerance → partial match only
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationItem {
  id: string;
  side: 'debit' | 'credit';
  itemType: string;
  refId?: string;
  refNumber?: string;
  refDate?: string;
  partyId?: string;
  partyName?: string;
  currency: string;
  amountBase: number;
  allocatedBase: number;
  remainingBase: number;
  matchGroupId?: string | null;
  matchStatus: 'unmatched' | 'matched' | 'partial' | 'written_off';
  matchMethod?: 'auto' | 'manual' | null;
  matchDifference?: number;
}

export interface MatchGroup {
  matchGroupId: string;
  debitItems: ReconciliationItem[];
  creditItems: ReconciliationItem[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
  differenceType: 'gain' | 'loss' | 'none';
  isExact: boolean;
  isWithinTolerance: boolean;
  matchMethod: 'auto' | 'manual';
}

export interface AutoMatchResult {
  groups: MatchGroup[];
  unmatchedDebits: ReconciliationItem[];
  unmatchedCredits: ReconciliationItem[];
  totalMatched: number;
  totalUnmatched: number;
}

export interface AgingBucket {
  label: string;
  fromDays: number;
  toDays: number | null;
  items: ReconciliationItem[];
  totalAmount: number;
  count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateMatchGroupId(prefix = 'mg'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function daysBetween(dateStr: string, asOf: string): number {
  const a = new Date(asOf).getTime();
  const b = new Date(dateStr).getTime();
  return Math.floor((a - b) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-matching engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to auto-match debits against credits using the following priority:
 *   1. Exact amount match (1-to-1)
 *   2. Reference number match (invoice# in payment description)
 *   3. Many-to-one / one-to-many sweep
 *   4. Within-tolerance match
 *
 * Returns the match groups formed plus remaining unmatched items.
 */
export function autoMatch(
  debits: ReconciliationItem[],
  credits: ReconciliationItem[],
  toleranceAmount = 0,
): AutoMatchResult {
  const groups: MatchGroup[] = [];

  // Work on mutable copies with remaining amounts
  const pendingDebits: ReconciliationItem[]  = debits.map(d => ({ ...d, remainingBase: d.remainingBase || d.amountBase, allocatedBase: d.allocatedBase || 0 }));
  const pendingCredits: ReconciliationItem[] = credits.map(c => ({ ...c, remainingBase: c.remainingBase || c.amountBase, allocatedBase: c.allocatedBase || 0 }));

  const usedDebitIds  = new Set<string>();
  const usedCreditIds = new Set<string>();

  // ── Pass 1: Exact 1-to-1 match by amount ──────────────────────────────────
  for (const d of pendingDebits) {
    if (usedDebitIds.has(d.id) || d.remainingBase <= 0) continue;
    for (const c of pendingCredits) {
      if (usedCreditIds.has(c.id) || c.remainingBase <= 0) continue;
      if (Math.abs(d.remainingBase - c.remainingBase) < 0.001) {
        const mgId = generateMatchGroupId('exact');
        const group = buildGroup(mgId, [d], [c], 'auto', toleranceAmount);
        if (group) {
          groups.push(group);
          usedDebitIds.add(d.id);
          usedCreditIds.add(c.id);
          d.remainingBase  = 0; d.allocatedBase  = d.amountBase; d.matchStatus = 'matched'; d.matchGroupId = mgId;
          c.remainingBase  = 0; c.allocatedBase  = c.amountBase; c.matchStatus = 'matched'; c.matchGroupId = mgId;
          break;
        }
      }
    }
  }

  // ── Pass 2: Reference number cross-match ──────────────────────────────────
  for (const d of pendingDebits) {
    if (usedDebitIds.has(d.id) || d.remainingBase <= 0 || !d.refNumber) continue;
    for (const c of pendingCredits) {
      if (usedCreditIds.has(c.id) || c.remainingBase <= 0 || !c.refNumber) continue;
      const dRef = String(d.refNumber).toLowerCase().trim();
      const cRef = String(c.refNumber).toLowerCase().trim();
      if (dRef === cRef || dRef.includes(cRef) || cRef.includes(dRef)) {
        const allocated = Math.min(d.remainingBase, c.remainingBase);
        const mgId = generateMatchGroupId('ref');
        updateItem(d, allocated, mgId, 'auto');
        updateItem(c, allocated, mgId, 'auto');
        const diff = round2(d.remainingBase - c.remainingBase);
        const group: MatchGroup = {
          matchGroupId: mgId,
          debitItems:   [d],
          creditItems:  [c],
          totalDebit:   d.amountBase,
          totalCredit:  c.amountBase,
          difference:   Math.abs(diff),
          differenceType: diff > 0 ? 'loss' : diff < 0 ? 'gain' : 'none',
          isExact:             Math.abs(diff) < 0.001,
          isWithinTolerance:   Math.abs(diff) <= toleranceAmount,
          matchMethod: 'auto',
        };
        groups.push(group);
        usedDebitIds.add(d.id);
        usedCreditIds.add(c.id);
        break;
      }
    }
  }

  // ── Pass 3: Many credits → one large debit (consolidation match) ──────────
  for (const d of pendingDebits) {
    if (usedDebitIds.has(d.id) || d.remainingBase <= 0) continue;
    const matchingCredits: ReconciliationItem[] = [];
    let accumulated = 0;

    for (const c of pendingCredits) {
      if (usedCreditIds.has(c.id) || c.remainingBase <= 0) continue;
      if (accumulated + c.remainingBase <= d.remainingBase + toleranceAmount) {
        matchingCredits.push(c);
        accumulated = round2(accumulated + c.remainingBase);
      }
      if (Math.abs(accumulated - d.remainingBase) < 0.001) break;
    }

    if (matchingCredits.length > 1 && accumulated > 0) {
      const mgId = generateMatchGroupId('multi');
      const allocated = Math.min(d.remainingBase, accumulated);
      updateItem(d, allocated, mgId, 'auto');
      for (const c of matchingCredits) {
        updateItem(c, c.remainingBase, mgId, 'auto');
        usedCreditIds.add(c.id);
      }
      const diff = round2(d.amountBase - matchingCredits.reduce((s, c) => s + c.amountBase, 0));
      groups.push({
        matchGroupId: mgId,
        debitItems:   [d],
        creditItems:  matchingCredits,
        totalDebit:   d.amountBase,
        totalCredit:  accumulated,
        difference:   Math.abs(diff),
        differenceType: diff > 0 ? 'loss' : diff < 0 ? 'gain' : 'none',
        isExact:            Math.abs(diff) < 0.001,
        isWithinTolerance:  Math.abs(diff) <= toleranceAmount,
        matchMethod: 'auto',
      });
      usedDebitIds.add(d.id);
    }
  }

  // ── Pass 4: Tolerance match on remaining ────────────────────────────────
  if (toleranceAmount > 0) {
    for (const d of pendingDebits) {
      if (usedDebitIds.has(d.id) || d.remainingBase <= 0) continue;
      for (const c of pendingCredits) {
        if (usedCreditIds.has(c.id) || c.remainingBase <= 0) continue;
        const diff = Math.abs(d.remainingBase - c.remainingBase);
        if (diff > 0 && diff <= toleranceAmount) {
          const mgId = generateMatchGroupId('tol');
          const allocated = Math.min(d.remainingBase, c.remainingBase);
          updateItem(d, allocated, mgId, 'auto');
          updateItem(c, allocated, mgId, 'auto');
          groups.push({
            matchGroupId: mgId,
            debitItems:   [d],
            creditItems:  [c],
            totalDebit:   d.amountBase,
            totalCredit:  c.amountBase,
            difference:   diff,
            differenceType: d.amountBase > c.amountBase ? 'loss' : 'gain',
            isExact:            false,
            isWithinTolerance:  true,
            matchMethod: 'auto',
          });
          usedDebitIds.add(d.id);
          usedCreditIds.add(c.id);
          break;
        }
      }
    }
  }

  const unmatchedDebits  = pendingDebits.filter(d  => !usedDebitIds.has(d.id)  && d.remainingBase > 0.001);
  const unmatchedCredits = pendingCredits.filter(c => !usedCreditIds.has(c.id) && c.remainingBase > 0.001);

  const totalMatched   = groups.reduce((s, g) => s + g.totalDebit, 0);
  const totalUnmatched = unmatchedDebits.reduce((s, d) => s + d.remainingBase, 0);

  return { groups, unmatchedDebits, unmatchedCredits, totalMatched: round2(totalMatched), totalUnmatched: round2(totalUnmatched) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual match
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manually match a list of debit items against a list of credit items.
 * Validates that amounts balance (within tolerance) before creating the group.
 */
export function manualMatch(
  debitItems: ReconciliationItem[],
  creditItems: ReconciliationItem[],
  toleranceAmount = 0,
): MatchGroup {
  const totalDebit  = round2(debitItems.reduce((s, d) => s + d.remainingBase, 0));
  const totalCredit = round2(creditItems.reduce((s, c) => s + c.remainingBase, 0));
  const diff = round2(totalDebit - totalCredit);

  if (Math.abs(diff) > toleranceAmount + 0.001) {
    throw new Error(
      `MATCH_IMBALANCED: الفرق ${Math.abs(diff).toFixed(2)} USD يتجاوز حد التسامح ${toleranceAmount.toFixed(2)} USD. لا يمكن إتمام المطابقة.`
    );
  }

  const mgId = generateMatchGroupId('manual');
  const group = buildGroup(mgId, debitItems, creditItems, 'manual', toleranceAmount);
  if (!group) throw new Error('MATCH_FAILED: فشل بناء مجموعة المطابقة.');
  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aging analysis
// ─────────────────────────────────────────────────────────────────────────────

const AGING_BUCKETS = [
  { label: '1-30 يوم',   fromDays: 1,   toDays: 30  },
  { label: '31-60 يوم',  fromDays: 31,  toDays: 60  },
  { label: '61-90 يوم',  fromDays: 61,  toDays: 90  },
  { label: '91-180 يوم', fromDays: 91,  toDays: 180 },
  { label: '+180 يوم',   fromDays: 181, toDays: null },
  { label: 'بدون تاريخ', fromDays: -1,  toDays: -1  },
] as const;

/**
 * Bucket unmatched open items by age (days since document date).
 */
export function analyzeAging(
  unmatchedItems: ReconciliationItem[],
  asOfDate: string = new Date().toISOString().slice(0, 10),
): AgingBucket[] {
  const buckets: AgingBucket[] = AGING_BUCKETS.map(b => ({
    label: b.label, fromDays: b.fromDays, toDays: b.toDays ?? null,
    items: [], totalAmount: 0, count: 0,
  }));

  for (const item of unmatchedItems) {
    if (!item.refDate) {
      buckets[buckets.length - 1].items.push(item);
      buckets[buckets.length - 1].totalAmount = round2(buckets[buckets.length - 1].totalAmount + item.remainingBase);
      buckets[buckets.length - 1].count++;
      continue;
    }
    const days = daysBetween(item.refDate, asOfDate);
    const bucket = buckets.find(b => {
      if (b.fromDays === -1) return false;
      if (b.toDays === null) return days >= b.fromDays;
      return days >= b.fromDays && days <= b.toDays;
    }) ?? buckets[buckets.length - 1];
    bucket.items.push(item);
    bucket.totalAmount = round2(bucket.totalAmount + item.remainingBase);
    bucket.count++;
  }

  return buckets;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (internal)
// ─────────────────────────────────────────────────────────────────────────────

function buildGroup(
  mgId: string,
  debitItems: ReconciliationItem[],
  creditItems: ReconciliationItem[],
  method: 'auto' | 'manual',
  toleranceAmount: number,
): MatchGroup | null {
  const totalDebit  = round2(debitItems.reduce((s, d) => s + d.remainingBase, 0));
  const totalCredit = round2(creditItems.reduce((s, c) => s + c.remainingBase, 0));
  const diff        = round2(totalDebit - totalCredit);

  return {
    matchGroupId:      mgId,
    debitItems,
    creditItems,
    totalDebit,
    totalCredit,
    difference:        Math.abs(diff),
    differenceType:    diff > 0 ? 'loss' : diff < 0 ? 'gain' : 'none',
    isExact:           Math.abs(diff) < 0.001,
    isWithinTolerance: Math.abs(diff) <= toleranceAmount,
    matchMethod:       method,
  };
}

function updateItem(
  item: ReconciliationItem,
  allocated: number,
  mgId: string,
  method: 'auto' | 'manual',
): void {
  item.allocatedBase = round2((item.allocatedBase || 0) + allocated);
  item.remainingBase = round2(item.amountBase - item.allocatedBase);
  item.matchGroupId  = mgId;
  item.matchMethod   = method;
  item.matchStatus   = item.remainingBase < 0.001 ? 'matched' : 'partial';
}
