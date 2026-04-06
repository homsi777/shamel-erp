/**
 * FX Settlement Engine — Unit Tests
 *
 * Test cases for computeFxDifference and computePartialPaymentFx.
 * Validates all required scenarios per the FX handling specification.
 */

import { computeFxDifference, computePartialPaymentFx } from '../backend/services/fxSettlement';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mkInvoice = (currency: string, exchangeRate: number, totalBase: number) => ({
  currency,
  exchangeRate,
  totalAmountBase: totalBase,
  totalAmountTransaction: Math.round(totalBase * exchangeRate * 100) / 100,
});

const mkPayment = (currency: string, exchangeRate: number, amountBase: number) => ({
  currency,
  exchangeRate,
  amountBase,
  amountTransaction: Math.round(amountBase * exchangeRate * 100) / 100,
});

const assertClose = (actual: number, expected: number, label: string, tol = 0.01) => {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`FAIL [${label}]: expected ${expected}, got ${actual} (diff=${Math.abs(actual - expected).toFixed(6)})`);
  }
  console.log(`  ✓ ${label}: ${actual.toFixed(4)}`);
};

const assert = (condition: boolean, label: string) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
};

// ─── Test Runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    console.log(`\n▶ ${name}`);
    fn();
    passed++;
  } catch (e: any) {
    console.error(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

// ─── Test 1: Full payment at same rate → NO FX difference ────────────────────
runTest('Case 1: Full payment same rate → no FX', () => {
  const invoice = mkInvoice('SYP', 15000, 100); // 100 USD = 1,500,000 SYP
  const payment = mkPayment('SYP', 15000, 100);
  const fx = computeFxDifference(invoice, payment, 100);

  assert(fx.type === 'none', 'type === none');
  assertClose(fx.fxAmount, 0, 'fxAmount = 0');
});

// ─── Test 2: Full payment at higher rate (SYP weakened) → FX LOSS ────────────
runTest('Case 2: Full payment higher rate (SYP weakened) → FX LOSS', () => {
  // Invoice: 100 USD at 15,000 SYP/USD = 1,500,000 SYP
  // Payment: customer pays 1,500,000 SYP at 16,000 rate = 93.75 USD
  // settlementAmountBase = the FULL invoice base = 100 USD (we are settling the full invoice)
  const invoice = mkInvoice('SYP', 15000, 100);
  const payment = mkPayment('SYP', 16000, 93.75);
  const fx = computeFxDifference(invoice, payment, 100); // 100 = full invoice base amount

  assert(fx.type === 'loss', 'type === loss');
  // proportion=1, settlementForeign=1,500,000, paymentBase=1,500,000/16,000=93.75
  // diff = 100 - 93.75 = 6.25 loss
  assertClose(fx.fxAmount, 6.25, 'fxAmount ≈ 6.25 USD', 0.02);
  assertClose(fx.invoiceRate, 15000, 'invoice rate = 15000');
  assertClose(fx.paymentRate, 16000, 'payment rate = 16000');
});

// ─── Test 3: Full payment at lower rate (SYP strengthened) → FX GAIN ─────────
runTest('Case 3: Full payment lower rate (SYP strengthened) → FX GAIN', () => {
  // Invoice: 100 USD at 15,000 SYP/USD = 1,500,000 SYP
  // Payment: customer pays 1,500,000 SYP at 14,000 rate = 107.14 USD
  // settlementAmountBase = 100 USD (full invoice)
  const invoice = mkInvoice('SYP', 15000, 100);
  const payment = mkPayment('SYP', 14000, 107.14);
  const fx = computeFxDifference(invoice, payment, 100); // 100 = full invoice base

  assert(fx.type === 'gain', 'type === gain');
  // proportion=1, settlementForeign=1,500,000, paymentBase=1,500,000/14,000=107.14
  // diff = 100 - 107.14 = -7.14 → gain of 7.14
  assertClose(fx.fxAmount, 7.14, 'fxAmount ≈ 7.14 USD', 0.05);
});

// ─── Test 4: Partial payment — multiple rates ─────────────────────────────────
runTest('Case 4: Partial payment multiple rates', () => {
  // Invoice: 100 USD at 15,000 SYP/USD = 1,500,000 SYP
  const invoice = mkInvoice('SYP', 15000, 100);

  // First partial payment: 750,000 SYP at 15,000 rate (50 USD)
  const fx1 = computePartialPaymentFx(invoice, 50, 15000, 750000);
  assert(fx1.type === 'none', 'P1: same rate → no FX');
  assertClose(fx1.fxAmount, 0, 'P1: fxAmount = 0');

  // Second partial payment: 750,000 SYP at 16,000 rate → 46.875 USD
  const fx2 = computePartialPaymentFx(invoice, 46.875, 16000, 750000);
  assert(fx2.type === 'loss', 'P2: rate increased → loss');
  // Expected: 750,000/15,000 = 50 expected, 750,000/16,000 = 46.875 actual → diff = 3.125
  assertClose(fx2.fxAmount, 3.125, 'P2: fxAmount ≈ 3.125 USD', 0.02);
});

// ─── Test 5: TRY currency settlement ─────────────────────────────────────────
runTest('Case 5: Multi-currency TRY settlement', () => {
  // Invoice: 100 USD at 32 TRY/USD = 3,200 TRY
  const invoice = mkInvoice('TRY', 32, 100);

  // Payment: 3,200 TRY at 34 TRY/USD → actual = 3,200/34 ≈ 94.12 USD
  // settlementAmountBase = 100 (full invoice base)
  const payment = mkPayment('TRY', 34, 94.12);
  const fx = computeFxDifference(invoice, payment, 100); // 100 = full invoice base

  assert(fx.type === 'loss', 'TRY: rate weakened → loss');
  // proportion=1, settlementForeign=3,200, paymentBase=3,200/34=94.12
  // diff = 100 - 94.12 = 5.88 loss
  assertClose(fx.fxAmount, 5.88, 'TRY: fxAmount ≈ 5.88 USD', 0.02);
  assertClose(fx.invoiceRate, 32, 'invoice rate = 32');
  assertClose(fx.paymentRate, 34, 'payment rate = 34');
});

// ─── Test 6: USD invoice → no FX ever ────────────────────────────────────────
runTest('Case 6: USD invoice → no FX regardless of rate', () => {
  const invoice = mkInvoice('USD', 1, 500);
  const payment = mkPayment('USD', 1, 500);
  const fx = computeFxDifference(invoice, payment, 500);

  assert(fx.type === 'none', 'USD invoice: no FX');
  assertClose(fx.fxAmount, 0, 'fxAmount = 0');
});

// ─── Test 7: Proportional partial FX for 3 payments ─────────────────────────
runTest('Case 7: 3 partial payments, each with different rates', () => {
  const invoice = mkInvoice('SYP', 15000, 300); // 300 USD = 4,500,000 SYP
  const payments = [
    { foreign: 1500000, rate: 15000 }, // 100 USD at same rate → no FX
    { foreign: 1500000, rate: 16000 }, // 100 USD at higher rate → loss
    { foreign: 1500000, rate: 14000 }, // 100 USD at lower rate → gain
  ];

  const results = payments.map(p => computePartialPaymentFx(invoice, p.foreign / p.rate, p.rate, p.foreign));

  assert(results[0].type === 'none', 'P1: same rate → none');
  assert(results[1].type === 'loss', 'P2: weakened → loss');
  assert(results[2].type === 'gain', 'P3: strengthened → gain');

  assertClose(results[0].fxAmount, 0, 'P1: 0 FX');
  // P2: 1,500,000/15,000 = 100 expected; 1,500,000/16,000 = 93.75 actual → 6.25 loss
  assertClose(results[1].fxAmount, 6.25, 'P2: 6.25 loss', 0.02);
  // P3: 1,500,000/15,000 = 100 expected; 1,500,000/14,000 = 107.14 actual → 7.14 gain
  assertClose(results[2].fxAmount, 7.14, 'P3: 7.14 gain', 0.05);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`FX Settlement Tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All FX tests passed ✓');
}
