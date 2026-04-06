/**
 * FX Revaluation Engine — Unit Tests
 *
 * Tests for computeUnrealizedFx covering:
 *   1.  AR — no FX change (same rate)
 *   2.  AR — foreign currency weakened → LOSS (rate rose)
 *   3.  AR — foreign currency strengthened → GAIN (rate fell)
 *   4.  AP — foreign currency weakened → GAIN (we owe less in USD)
 *   5.  AP — foreign currency strengthened → LOSS (we owe more in USD)
 *   6.  USD invoice → always 'none'
 *   7.  Zero remaining → 'none'
 *   8.  Partial settlement still applies revaluation on residual
 *   9.  TRY revaluation
 *   10. Negligible diff rounds to 'none'
 */

import assert from 'assert';
import { computeUnrealizedFx } from '../backend/services/fxRevaluationCore';

function approxEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) <= epsilon;
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 1: AR — same rate — no FX impact
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(
    100_000, // outstandingForeign (SYP)
    'SYP',
    15_000,  // originalRate
    15_000,  // currentRate (unchanged)
    'receivable',
  );
  assert.strictEqual(result.diffType, 'none', 'Case 1: should be none when rates equal');
  assert.strictEqual(result.unrealizedDiff, 0, 'Case 1: diff should be 0');
  console.log('✅ Case 1 passed — AR same rate → none');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 2: AR — SYP weakened (rate rose: 15000 → 16000) → LOSS
//   bookValue  = 100,000 / 15,000 = 6.67 USD
//   revalued   = 100,000 / 16,000 = 6.25 USD
//   diff       = 6.25 − 6.67 = −0.42 → LOSS of 0.42 USD
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(100_000, 'SYP', 15_000, 16_000, 'receivable');
  assert.strictEqual(result.diffType, 'loss', 'Case 2: AR SYP weakened → loss');
  assert.ok(approxEqual(result.unrealizedDiff, 0.42), `Case 2: expected ~0.42 got ${result.unrealizedDiff}`);
  assert.ok(approxEqual(result.bookValueBase,  6.67), `Case 2: bookValue ~6.67 got ${result.bookValueBase}`);
  assert.ok(approxEqual(result.revaluedBase,   6.25), `Case 2: revalued ~6.25 got ${result.revaluedBase}`);
  console.log('✅ Case 2 passed — AR SYP weakened → loss 0.42 USD');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 3: AR — SYP strengthened (rate fell: 15000 → 14000) → GAIN
//   bookValue  = 100,000 / 15,000 = 6.67 USD
//   revalued   = 100,000 / 14,000 = 7.14 USD
//   diff       = 7.14 − 6.67 = +0.47 → GAIN of 0.47 USD
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(100_000, 'SYP', 15_000, 14_000, 'receivable');
  assert.strictEqual(result.diffType, 'gain', 'Case 3: AR SYP strengthened → gain');
  assert.ok(approxEqual(result.unrealizedDiff, 0.47), `Case 3: expected ~0.47 got ${result.unrealizedDiff}`);
  console.log('✅ Case 3 passed — AR SYP strengthened → gain 0.47 USD');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 4: AP — SYP weakened (rate rose: 15000 → 16000) → GAIN for us
//   We owe 100,000 SYP; in USD terms we owe LESS → GAIN
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(100_000, 'SYP', 15_000, 16_000, 'payable');
  assert.strictEqual(result.diffType, 'gain', 'Case 4: AP SYP weakened → gain (owe less)');
  assert.ok(approxEqual(result.unrealizedDiff, 0.42), `Case 4: expected ~0.42 got ${result.unrealizedDiff}`);
  console.log('✅ Case 4 passed — AP SYP weakened → gain');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 5: AP — SYP strengthened (rate fell: 15000 → 14000) → LOSS for us
//   We owe 100,000 SYP; in USD terms we owe MORE → LOSS
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(100_000, 'SYP', 15_000, 14_000, 'payable');
  assert.strictEqual(result.diffType, 'loss', 'Case 5: AP SYP strengthened → loss (owe more)');
  assert.ok(approxEqual(result.unrealizedDiff, 0.47), `Case 5: expected ~0.47 got ${result.unrealizedDiff}`);
  console.log('✅ Case 5 passed — AP SYP strengthened → loss');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 6: USD invoice — always 'none'
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(1_000, 'USD', 1, 1.05, 'receivable');
  assert.strictEqual(result.diffType, 'none', 'Case 6: USD invoice always none');
  console.log('✅ Case 6 passed — USD invoice → none');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 7: Zero outstanding — no revaluation
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(0, 'SYP', 15_000, 16_000, 'receivable');
  assert.strictEqual(result.diffType, 'none', 'Case 7: zero outstanding → none');
  console.log('✅ Case 7 passed — zero outstanding → none');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 8: Partial residual — only open portion is revalued
//   Invoice 500,000 SYP; paid 300,000 SYP; residual 200,000 SYP
//   originalRate = 15,000; currentRate = 16,000
//   bookValue  = 200,000 / 15,000 = 13.33 USD
//   revalued   = 200,000 / 16,000 = 12.50 USD
//   diff       = 0.83 USD LOSS
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(200_000, 'SYP', 15_000, 16_000, 'receivable');
  assert.strictEqual(result.diffType, 'loss', 'Case 8: partial residual → loss');
  assert.ok(approxEqual(result.unrealizedDiff, 0.83), `Case 8: expected ~0.83 got ${result.unrealizedDiff}`);
  console.log('✅ Case 8 passed — partial residual revaluation');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 9: TRY (Turkish Lira) revaluation
//   AR 50,000 TRY; originalRate = 32; currentRate = 35 → TRY weakened → LOSS
//   bookValue  = 50,000 / 32  = 1,562.50 USD
//   revalued   = 50,000 / 35  = 1,428.57 USD
//   diff       = ~133.93 USD LOSS
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = computeUnrealizedFx(50_000, 'TRY', 32, 35, 'receivable');
  assert.strictEqual(result.diffType, 'loss', 'Case 9: TRY AR weakened → loss');
  assert.ok(approxEqual(result.unrealizedDiff, 133.93, 0.1), `Case 9: expected ~133.93 got ${result.unrealizedDiff}`);
  console.log('✅ Case 9 passed — TRY AR weakened → loss');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 10: Negligible difference (< 0.001) → rounded to 'none'
// ─────────────────────────────────────────────────────────────────────────────
{
  // 1 SYP, rate 15000 vs 15001 → diff ≈ 0.0000044 → negligible
  const result = computeUnrealizedFx(1, 'SYP', 15_000, 15_001, 'receivable');
  assert.strictEqual(result.diffType, 'none', 'Case 10: negligible diff → none');
  console.log('✅ Case 10 passed — negligible diff rounds to none');
}

console.log('\n🎯 All 10 FX Revaluation tests passed.');
