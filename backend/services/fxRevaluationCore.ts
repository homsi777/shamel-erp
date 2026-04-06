/**
 * FX Revaluation Core — pure computation functions (no DB dependencies)
 *
 * Exchange rate convention (same as rest of Shamel):
 *   amountBase = amountForeign / exchangeRate
 *
 * BASE CURRENCY: USD
 */

const BASE_CURRENCY = 'USD';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface UnrealizedFxResult {
  bookValueBase:   number;
  revaluedBase:    number;
  unrealizedDiff:  number;
  diffType:        'gain' | 'loss' | 'none';
}

/**
 * Compute unrealized FX gain/loss for a single open item.
 *
 * @param outstandingForeign  Remaining foreign-currency balance (SYP / TRY)
 * @param currency            e.g. 'SYP', 'TRY'
 * @param originalRate        Rate at which the balance was originally booked
 * @param currentRate         Current market rate (revaluation rate)
 * @param itemType            'receivable' | 'payable'
 *
 * AR logic:
 *   - revalued > book → we're owed more USD → GAIN
 *   - revalued < book → we're owed less USD → LOSS
 *
 * AP logic (reversed):
 *   - revalued > book → we owe more USD → LOSS
 *   - revalued < book → we owe less USD → GAIN
 */
export function computeUnrealizedFx(
  outstandingForeign: number,
  currency: string,
  originalRate: number,
  currentRate: number,
  itemType: 'receivable' | 'payable',
): UnrealizedFxResult {
  if (
    currency === BASE_CURRENCY ||
    outstandingForeign <= 0 ||
    originalRate <= 0 ||
    currentRate <= 0
  ) {
    return { bookValueBase: outstandingForeign, revaluedBase: outstandingForeign, unrealizedDiff: 0, diffType: 'none' };
  }

  const bookValueBase = round2(outstandingForeign / originalRate);
  const revaluedBase  = round2(outstandingForeign / currentRate);
  const rawDiff       = round2(revaluedBase - bookValueBase);

  if (Math.abs(rawDiff) < 0.001) {
    return { bookValueBase, revaluedBase, unrealizedDiff: 0, diffType: 'none' };
  }

  let diffType: 'gain' | 'loss' | 'none';

  if (itemType === 'receivable') {
    diffType = rawDiff > 0 ? 'gain' : 'loss';
  } else {
    // payable: if revalued > book → we owe more → loss
    diffType = rawDiff > 0 ? 'loss' : 'gain';
  }

  return {
    bookValueBase,
    revaluedBase,
    unrealizedDiff: Math.abs(rawDiff),
    diffType,
  };
}
