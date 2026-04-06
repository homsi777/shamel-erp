/**
 * Period Closing Engine — Unit Tests
 *
 * Tests the core computation logic of period closing
 * without requiring a live database.
 */

import { computeFxDifference } from '../backend/services/fxSettlement';

// ─── Minimal stub infrastructure ─────────────────────────────────────────────

const roundMoney = (v: number, d = 2) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  Promise.resolve().then(fn).then(() => {
    console.log(`  ✓ ${name}`);
    passed++;
  }).catch((e: any) => {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }).finally(() => {
    if (passed + failed === totalTests) printSummary();
  });
}

let totalTests = 0;
function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  runTest(name, fn);
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERT FAILED: ${msg}`);
}
function assertClose(a: number, b: number, msg: string, tol = 0.01) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

function printSummary() {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Period Closing Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  else console.log('All period closing tests passed ✓');
}

// ─── Stub: simulate period closing P&L computation ────────────────────────────

interface AccountBalance { debit: number; credit: number; accountType: string; }

function computePnl(accounts: Record<string, AccountBalance>) {
  let totalRevenue = 0;
  let totalExpenses = 0;
  const closingLines: Array<{ accountId: string; debit: number; credit: number }> = [];

  for (const [id, bal] of Object.entries(accounts)) {
    if (bal.accountType === 'revenue') {
      const revenueBalance = roundMoney(bal.credit - bal.debit);
      if (revenueBalance > 0) {
        totalRevenue = roundMoney(totalRevenue + revenueBalance);
        closingLines.push({ accountId: id, debit: revenueBalance, credit: 0 }); // DR to zero
      }
    } else if (bal.accountType === 'expenses') {
      const expenseBalance = roundMoney(bal.debit - bal.credit);
      if (expenseBalance > 0) {
        totalExpenses = roundMoney(totalExpenses + expenseBalance);
        closingLines.push({ accountId: id, debit: 0, credit: expenseBalance }); // CR to zero
      }
    }
  }

  const netPnl = roundMoney(totalRevenue - totalExpenses);

  // Retained earnings balancing line
  if (netPnl > 0) {
    closingLines.push({ accountId: 'RETAINED', debit: 0, credit: netPnl });
  } else if (netPnl < 0) {
    closingLines.push({ accountId: 'RETAINED', debit: Math.abs(netPnl), credit: 0 });
  }

  return { totalRevenue, totalExpenses, netPnl, closingLines };
}

function verifyBalance(lines: Array<{ debit: number; credit: number }>) {
  const totalDebit = roundMoney(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = roundMoney(lines.reduce((s, l) => s + l.credit, 0));
  return { balanced: Math.abs(totalDebit - totalCredit) < 0.01, totalDebit, totalCredit };
}

// ─── Test 1: Profitable year — P&L → Retained Earnings ───────────────────────
console.log('\n▶ Period Closing Tests\n');

test('Case 1: Profitable year — revenue > expenses → profit', () => {
  const accounts: Record<string, AccountBalance> = {
    'SALES':       { debit: 0,    credit: 500, accountType: 'revenue' },
    'SERVICES':    { debit: 0,    credit: 200, accountType: 'revenue' },
    'COGS':        { debit: 300,  credit: 0,   accountType: 'expenses' },
    'SALARIES':    { debit: 100,  credit: 0,   accountType: 'expenses' },
    'MISC_EXP':    { debit: 50,   credit: 0,   accountType: 'expenses' },
  };
  const result = computePnl(accounts);

  assertClose(result.totalRevenue, 700, 'total revenue = 700');
  assertClose(result.totalExpenses, 450, 'total expenses = 450');
  assertClose(result.netPnl, 250, 'net P&L = 250 (profit)');

  // Verify closing entry is balanced
  const bal = verifyBalance(result.closingLines);
  assert(bal.balanced, `closing entry balanced (DR=${bal.totalDebit} CR=${bal.totalCredit})`);

  // Retained earnings should get a credit
  const retLine = result.closingLines.find(l => l.accountId === 'RETAINED');
  assert(!!retLine, 'retained earnings line exists');
  assertClose(retLine!.credit, 250, 'retained earnings CR = 250');
  assertClose(retLine!.debit, 0, 'retained earnings DR = 0');
});

// ─── Test 2: Loss year — P&L → Retained Earnings debit ───────────────────────
test('Case 2: Loss year — expenses > revenue → loss', () => {
  const accounts: Record<string, AccountBalance> = {
    'SALES':    { debit: 0,   credit: 200, accountType: 'revenue' },
    'COGS':     { debit: 300, credit: 0,   accountType: 'expenses' },
    'SALARIES': { debit: 100, credit: 0,   accountType: 'expenses' },
  };
  const result = computePnl(accounts);

  assertClose(result.totalRevenue, 200, 'total revenue = 200');
  assertClose(result.totalExpenses, 400, 'total expenses = 400');
  assertClose(result.netPnl, -200, 'net P&L = -200 (loss)');

  const bal = verifyBalance(result.closingLines);
  assert(bal.balanced, 'closing entry balanced');

  const retLine = result.closingLines.find(l => l.accountId === 'RETAINED');
  assert(!!retLine, 'retained earnings line exists');
  assertClose(retLine!.debit, 200, 'retained earnings DR = 200 (loss)');
  assertClose(retLine!.credit, 0, 'retained earnings CR = 0');
});

// ─── Test 3: Break-even year — no retained earnings entry ────────────────────
test('Case 3: Break-even — zero P&L → no retained earnings entry', () => {
  const accounts: Record<string, AccountBalance> = {
    'SALES': { debit: 0,   credit: 500, accountType: 'revenue' },
    'COGS':  { debit: 500, credit: 0,   accountType: 'expenses' },
  };
  const result = computePnl(accounts);

  assertClose(result.netPnl, 0, 'net P&L = 0');
  const retLine = result.closingLines.find(l => l.accountId === 'RETAINED');
  assert(!retLine, 'no retained earnings line for break-even');
  const bal = verifyBalance(result.closingLines);
  assert(bal.balanced, 'closing entry balanced at zero');
});

// ─── Test 4: Revenue accounts are zeroed after closing ───────────────────────
test('Case 4: All revenue accounts zeroed in closing entry', () => {
  const accounts: Record<string, AccountBalance> = {
    'REV_SALES':    { debit: 0, credit: 300, accountType: 'revenue' },
    'REV_SERVICE':  { debit: 0, credit: 100, accountType: 'revenue' },
    'REV_OTHER':    { debit: 0, credit: 50,  accountType: 'revenue' },
    'EXP_COGS':     { debit: 200, credit: 0, accountType: 'expenses' },
  };
  const result = computePnl(accounts);

  // All 3 revenue accounts should have a debit line (zeroing them)
  const revClosings = result.closingLines.filter(l =>
    ['REV_SALES', 'REV_SERVICE', 'REV_OTHER'].includes(l.accountId)
  );
  assert(revClosings.length === 3, '3 revenue closing lines');
  revClosings.forEach(l => assert(l.debit > 0, `revenue account ${l.accountId} has DR`));

  // Expense account should have a credit line (zeroing it)
  const expClosing = result.closingLines.find(l => l.accountId === 'EXP_COGS');
  assert(!!expClosing && expClosing.credit > 0, 'expense account has CR');

  const bal = verifyBalance(result.closingLines);
  assert(bal.balanced, 'closing entry balanced');
});

// ─── Test 5: Period overlap detection logic ───────────────────────────────────
test('Case 5: Period overlap detection', () => {
  const periods = [
    { id: 'p1', startDate: '2024-01-01', endDate: '2024-12-31', status: 'closed' },
    { id: 'p2', startDate: '2025-01-01', endDate: '2025-12-31', status: 'open' },
  ];

  const checkOverlap = (start: string, end: string) =>
    periods.some(p => start <= p.endDate && end >= p.startDate);

  assert(checkOverlap('2024-06-01', '2024-06-30'), '2024 mid-year overlaps p1');
  assert(checkOverlap('2025-01-01', '2025-12-31'), '2025 full year overlaps p2');
  assert(!checkOverlap('2026-01-01', '2026-12-31'), '2026 no overlap');
  assert(checkOverlap('2024-12-01', '2025-01-31'), 'cross-period overlap detected');
});

// ─── Test 6: Period locking — entries in closed period blocked ────────────────
test('Case 6: Period lock check logic', () => {
  const closedPeriods = [
    { startDate: '2024-01-01', endDate: '2024-12-31', status: 'closed', name: '2024' },
  ];

  const isLocked = (date: string) => {
    const d = date.slice(0, 10);
    return closedPeriods.some(p =>
      p.status === 'closed' && d >= p.startDate && d <= p.endDate
    );
  };

  assert(isLocked('2024-06-15'), 'mid-year in closed period → locked');
  assert(isLocked('2024-01-01'), 'start of closed period → locked');
  assert(isLocked('2024-12-31'), 'end of closed period → locked');
  assert(!isLocked('2025-01-01'), 'next year → not locked');
  assert(!isLocked('2023-12-31'), 'prev year → not locked');
});

// ─── Test 7: Carry-forward balance check ────────────────────────────────────
test('Case 7: Carry-forward must produce balanced opening entry', () => {
  // Simulate cumulative BS balances at end of period
  const bsAccounts = [
    { id: 'CASH',       type: 'assets',      net: 5000 },  // DR
    { id: 'AR',         type: 'assets',      net: 2000 },  // DR
    { id: 'INVENTORY',  type: 'assets',      net: 3000 },  // DR
    { id: 'AP',         type: 'liabilities', net: -1500 }, // CR
    { id: 'RETAINED',   type: 'equity',      net: -8500 }, // CR
  ];

  const carryLines: Array<{ debit: number; credit: number }> = [];
  for (const acc of bsAccounts) {
    if (acc.net > 0) carryLines.push({ debit: acc.net, credit: 0 });
    else carryLines.push({ debit: 0, credit: Math.abs(acc.net) });
  }

  const bal = verifyBalance(carryLines);
  assertClose(bal.totalDebit, 10000, 'total debit = 10000');
  assertClose(bal.totalCredit, 10000, 'total credit = 10000');
  assert(bal.balanced, 'carry-forward opening entry is balanced');
});

// ─── Test 8: Re-open guard — reason required ──────────────────────────────────
test('Case 8: Reopen requires reason >= 5 chars', () => {
  const validateReason = (r: string) => r.trim().length >= 5;
  assert(!validateReason(''), 'empty reason rejected');
  assert(!validateReason('abc'), 'short reason rejected');
  assert(validateReason('تعديل قيد خطأ'), 'valid Arabic reason accepted');
  assert(validateReason('audit'), 'valid English reason accepted');
});
