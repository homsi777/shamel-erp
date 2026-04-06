/**
 * FX Settlement Engine — Shamel ERP
 *
 * Computes and posts foreign exchange differences at settlement time.
 * FX differences arise when the exchange rate at payment differs from
 * the rate at which the original invoice was recorded.
 *
 * SAP-style accounting: explicit, traceable, auditable — never hidden in totals.
 *
 * Base currency: USD
 * Supported transaction currencies: SYP, TRY
 */

import { SYSTEM_ACCOUNTS } from '../accountingService';

const BASE_CURRENCY = 'USD';

/**
 * Result of an FX difference computation.
 */
export interface FxDifferenceResult {
  /** Absolute FX difference in base currency (USD) */
  fxAmount: number;
  /** 'gain' | 'loss' | 'none' */
  type: 'gain' | 'loss' | 'none';
  /** Base amount that was expected from this settlement portion */
  invoiceBasePortionExpected: number;
  /** Actual base amount received/paid using the payment rate */
  paymentBaseActual: number;
  /** Invoice exchange rate */
  invoiceRate: number;
  /** Payment (settlement) exchange rate */
  paymentRate: number;
  /** Foreign-currency amount being settled in this payment */
  settlementForeignAmount: number;
}

/**
 * Compute the FX difference for a settlement.
 *
 * Supports partial payments: only the proportional portion of the invoice
 * that this payment covers is used for the FX calculation.
 *
 * @param invoice      - The invoice being settled (must have exchangeRate, totalAmountBase, totalAmountTransaction, currency)
 * @param payment      - The payment/voucher being applied (must have exchangeRate, amountBase, amountTransaction, currency)
 * @param settlementAmountBase - The USD base amount being settled in this specific payment
 *                               (for partial payments, this is less than invoice total)
 */
export function computeFxDifference(
  invoice: {
    exchangeRate: number;
    totalAmountBase: number;
    totalAmountTransaction: number;
    currency: string;
  },
  payment: {
    exchangeRate: number;
    amountBase: number;
    amountTransaction: number;
    currency: string;
  },
  settlementAmountBase: number
): FxDifferenceResult {
  const invoiceCurrency = String(invoice.currency || BASE_CURRENCY).toUpperCase();

  // No FX difference if transaction is in base currency
  if (invoiceCurrency === BASE_CURRENCY) {
    return {
      fxAmount: 0,
      type: 'none',
      invoiceBasePortionExpected: settlementAmountBase,
      paymentBaseActual: settlementAmountBase,
      invoiceRate: 1,
      paymentRate: 1,
      settlementForeignAmount: settlementAmountBase,
    };
  }

  const invoiceRate = Number(invoice.exchangeRate) || 1;
  const paymentRate = Number(payment.exchangeRate) || 1;

  // No FX difference if rates are identical (within rounding tolerance)
  if (Math.abs(invoiceRate - paymentRate) < 0.0001) {
    return {
      fxAmount: 0,
      type: 'none',
      invoiceBasePortionExpected: settlementAmountBase,
      paymentBaseActual: settlementAmountBase,
      invoiceRate,
      paymentRate,
      settlementForeignAmount: roundMoney(settlementAmountBase * invoiceRate),
    };
  }

  const invoiceTotalBase = Number(invoice.totalAmountBase) || 0;
  const invoiceTotalTransaction = Number(invoice.totalAmountTransaction) || 0;

  // Proportion of the invoice covered by this settlement
  const proportion = invoiceTotalBase > 0 ? settlementAmountBase / invoiceTotalBase : 1;

  // Foreign-currency amount being settled (proportional slice of invoice transaction amount)
  const settlementForeignAmount = roundMoney(invoiceTotalTransaction * proportion);

  // Expected base value: what we recorded on the invoice for this portion
  const invoiceBasePortionExpected = roundMoney(settlementAmountBase);

  // Actual base value: convert the foreign amount at the payment rate
  // Convention: amountBase = amountForeign / exchangeRate (SYP → USD = SYP / rate)
  const paymentBaseActual = roundMoney(settlementForeignAmount / paymentRate);

  const diff = roundMoney(invoiceBasePortionExpected - paymentBaseActual);

  if (Math.abs(diff) < 0.005) {
    return {
      fxAmount: 0,
      type: 'none',
      invoiceBasePortionExpected,
      paymentBaseActual,
      invoiceRate,
      paymentRate,
      settlementForeignAmount,
    };
  }

  // For a RECEIVABLE (sale invoice):
  //   If paymentBaseActual < invoiceBasePortionExpected → we received LESS USD → FX LOSS
  //   If paymentBaseActual > invoiceBasePortionExpected → we received MORE USD → FX GAIN
  //
  // For a PAYABLE (purchase invoice):
  //   Logic is inverted — paying LESS USD than expected is a GAIN
  //   This is handled at posting time by the caller based on invoice type.
  //   Here we always return from the perspective of: positive diff = loss for receivables.
  const type: 'gain' | 'loss' = diff > 0 ? 'loss' : 'gain';

  return {
    fxAmount: roundMoney(Math.abs(diff)),
    type,
    invoiceBasePortionExpected,
    paymentBaseActual,
    invoiceRate,
    paymentRate,
    settlementForeignAmount,
  };
}

/**
 * Build journal lines for an FX difference posting.
 *
 * For a SALE invoice (receivable):
 *   LOSS:  DR FX_LOSS (5810),  CR none  (cash already debited at full foreign → we get less base)
 *          Full entry: DR Cash = paymentBaseActual, DR FX_LOSS = fxAmount, CR AR = invoicePortionBase
 *   GAIN:  CR FX_GAIN (4310)
 *          Full entry: DR Cash = paymentBaseActual, CR AR = invoicePortionBase, CR FX_GAIN = fxAmount ... (inverted)
 *
 * This function returns ONLY the FX lines (the balancing CR/DR for the difference).
 * The main voucher lines (Cash DR, AR CR) are already posted by the voucher journal.
 *
 * SAP pattern: a SEPARATE journal entry for FX, referencing the settlement voucher.
 *
 * @param fx              - Result from computeFxDifference
 * @param invoiceType     - 'sale' | 'purchase'
 * @param arAccountId     - Accounts Receivable account ID
 * @param apAccountId     - Accounts Payable account ID
 * @param resolveAccount  - Async function to resolve account ID from code
 */
export async function buildFxJournalLines(
  fx: FxDifferenceResult,
  invoiceType: 'sale' | 'purchase',
  arAccountId: number,
  apAccountId: number,
  resolveAccount: (code: string) => Promise<number>
): Promise<Array<{ accountId: number; debit: number; credit: number; description: string }>> {
  if (fx.type === 'none' || fx.fxAmount === 0) return [];

  const fxGainAccountId = await resolveAccount(SYSTEM_ACCOUNTS.FX_GAIN);
  const fxLossAccountId = await resolveAccount(SYSTEM_ACCOUNTS.FX_LOSS);
  const partyAccountId = invoiceType === 'sale' ? arAccountId : apAccountId;

  const lines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [];

  if (invoiceType === 'sale') {
    /**
     * Sale Invoice — Receivable settlement:
     *
     * Invoice: DR AR = 100 USD  |  CR Sales = 100 USD
     * Payment at different rate, e.g. received 93.75 USD worth of SYP:
     *
     * LOSS scenario (payment rate > invoice rate → fewer USD received):
     *   DR Cash          = 93.75
     *   DR FX_LOSS (5810) = 6.25   ← balancing line
     *   CR AR             = 100.00
     *
     * GAIN scenario (payment rate < invoice rate → more USD received):
     *   DR Cash          = 106.25
     *   CR AR             = 100.00
     *   CR FX_GAIN (4310) = 6.25   ← balancing line
     */
    if (fx.type === 'loss') {
      // AR closed at full invoice amount, cash received less → FX Loss absorbs the gap
      lines.push({ accountId: fxLossAccountId, debit: fx.fxAmount, credit: 0, description: 'خسارة فرق سعر الصرف' });
      lines.push({ accountId: partyAccountId, debit: 0, credit: fx.fxAmount, description: 'إغلاق فرق الذمة المدينة - فرق العملة' });
    } else {
      // Cash received more than AR balance → FX Gain absorbs the gap
      lines.push({ accountId: partyAccountId, debit: fx.fxAmount, credit: 0, description: 'إغلاق فرق الذمة المدينة - فرق العملة' });
      lines.push({ accountId: fxGainAccountId, debit: 0, credit: fx.fxAmount, description: 'ربح فرق سعر الصرف' });
    }
  } else {
    /**
     * Purchase Invoice — Payable settlement:
     *
     * Invoice: DR Inventory = 100 USD  |  CR AP = 100 USD
     * Payment at different rate:
     *
     * LOSS scenario (payment rate < invoice rate → paying more USD than expected):
     *   DR AP              = 100.00
     *   DR FX_LOSS (5810)  = 6.25
     *   CR Cash            = 106.25
     *
     * GAIN scenario (payment rate > invoice rate → paying fewer USD than expected):
     *   DR AP              = 100.00
     *   CR Cash            = 93.75
     *   CR FX_GAIN (4310)  = 6.25
     */
    if (fx.type === 'loss') {
      // AP closed, but we paid more cash → FX Loss
      lines.push({ accountId: fxLossAccountId, debit: fx.fxAmount, credit: 0, description: 'خسارة فرق سعر الصرف' });
      lines.push({ accountId: partyAccountId, debit: 0, credit: fx.fxAmount, description: 'إغلاق فرق الذمة الدائنة - فرق العملة' });
    } else {
      // AP closed, but we paid less cash → FX Gain
      lines.push({ accountId: partyAccountId, debit: fx.fxAmount, credit: 0, description: 'إغلاق فرق الذمة الدائنة - فرق العملة' });
      lines.push({ accountId: fxGainAccountId, debit: 0, credit: fx.fxAmount, description: 'ربح فرق سعر الصرف' });
    }
  }

  return lines;
}

/**
 * Compute FX difference for a partial payment scenario.
 *
 * When an invoice is partially paid multiple times, each payment uses its
 * own exchange rate. This computes the FX difference for the amount being
 * settled in this specific payment only.
 *
 * @param invoice           - The invoice (with total amounts and rate)
 * @param paymentAmountBase - The USD base amount being settled in THIS payment
 * @param paymentRate       - The exchange rate at THIS payment time
 * @param paymentAmountForeign - The foreign-currency amount received/paid in this payment
 */
export function computePartialPaymentFx(
  invoice: {
    exchangeRate: number;
    totalAmountBase: number;
    totalAmountTransaction: number;
    currency: string;
  },
  paymentAmountBase: number,
  paymentRate: number,
  paymentAmountForeign: number
): FxDifferenceResult {
  const invoiceCurrency = String(invoice.currency || BASE_CURRENCY).toUpperCase();

  if (invoiceCurrency === BASE_CURRENCY) {
    return { fxAmount: 0, type: 'none', invoiceBasePortionExpected: paymentAmountBase, paymentBaseActual: paymentAmountBase, invoiceRate: 1, paymentRate: 1, settlementForeignAmount: paymentAmountBase };
  }

  const invoiceRate = Number(invoice.exchangeRate) || 1;
  const pRate = paymentRate || 1;

  // Base amount we SHOULD have received for this foreign amount (at invoice rate)
  const invoiceBasePortionExpected = roundMoney(paymentAmountForeign / invoiceRate);

  // Base amount we ACTUALLY received/paid (at payment rate)
  const paymentBaseActual = roundMoney(paymentAmountForeign / pRate);

  const diff = roundMoney(invoiceBasePortionExpected - paymentBaseActual);

  if (Math.abs(diff) < 0.005) {
    return { fxAmount: 0, type: 'none', invoiceBasePortionExpected, paymentBaseActual, invoiceRate, paymentRate: pRate, settlementForeignAmount: paymentAmountForeign };
  }

  return {
    fxAmount: roundMoney(Math.abs(diff)),
    type: diff > 0 ? 'loss' : 'gain',
    invoiceBasePortionExpected,
    paymentBaseActual,
    invoiceRate,
    paymentRate: pRate,
    settlementForeignAmount: paymentAmountForeign,
  };
}

function roundMoney(value: number, decimals = 4): number {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}
