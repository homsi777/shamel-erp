export const BASE_CURRENCY = 'USD';
const SUPPORTED_CURRENCIES = new Set(['USD', 'SYP', 'TRY']);

const toFinite = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const approx = (a: number, b: number, epsilon = 0.05): boolean => Math.abs(a - b) <= epsilon;

export const roundMoneyValue = (value: number, decimals = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
};

export const normalizeCurrencyCode = (value?: unknown): string => {
  const code = String(value || '').trim().toUpperCase();
  if (SUPPORTED_CURRENCIES.has(code)) return code;
  return BASE_CURRENCY;
};

export const normalizeExchangeRate = (currency?: unknown, rate?: unknown): number => {
  const code = normalizeCurrencyCode(currency);
  if (code === BASE_CURRENCY) return 1;
  const n = toFinite(rate);
  return n > 0 ? n : 1;
};

export const toBaseAmount = (amount: number, currency?: unknown, exchangeRate?: unknown): number => {
  const code = normalizeCurrencyCode(currency);
  const rate = normalizeExchangeRate(code, exchangeRate);
  const raw = toFinite(amount);
  if (!raw) return 0;
  if (code === BASE_CURRENCY) return roundMoneyValue(raw);
  return roundMoneyValue(raw / rate);
};

export const toTransactionAmount = (amountBase: number, currency?: unknown, exchangeRate?: unknown): number => {
  const code = normalizeCurrencyCode(currency);
  const rate = normalizeExchangeRate(code, exchangeRate);
  const raw = toFinite(amountBase);
  if (!raw) return 0;
  if (code === BASE_CURRENCY) return roundMoneyValue(raw);
  return roundMoneyValue(raw * rate);
};

type InvoiceMoneyNormalization = {
  currency: string;
  exchangeRate: number;
  totalBase: number;
  totalTransaction: number;
  paidBase: number;
  paidTransaction: number;
  remainingBase: number;
  remainingTransaction: number;
  discountBase: number;
  discountTransaction: number;
};

export const normalizeInvoiceMoney = (raw: any): InvoiceMoneyNormalization => {
  const currency = normalizeCurrencyCode(raw?.currency);
  const exchangeRate = normalizeExchangeRate(currency, raw?.exchangeRate);

  const totalAmount = toFinite(raw?.totalAmount);
  const originalAmount = toFinite(raw?.originalAmount);
  const explicitTotalBase = toFinite(raw?.totalAmountBase ?? raw?.totalBase);
  const explicitTotalTxn = toFinite(raw?.totalAmountTransaction ?? raw?.totalTransaction);

  let totalBase = explicitTotalBase;
  let totalTransaction = explicitTotalTxn || originalAmount;

  if (!totalBase) {
    if (currency === BASE_CURRENCY) {
      totalBase = totalAmount || totalTransaction;
    } else if (totalAmount > 0 && totalTransaction > 0 && approx(totalAmount, toBaseAmount(totalTransaction, currency, exchangeRate))) {
      totalBase = totalAmount;
    } else if (totalAmount > 0 && originalAmount > 0 && totalAmount < originalAmount) {
      totalBase = totalAmount;
    } else if (totalAmount > 0 && originalAmount > 0 && approx(totalAmount, originalAmount)) {
      totalBase = toBaseAmount(totalAmount, currency, exchangeRate);
    } else if (totalAmount > 0) {
      totalBase = toBaseAmount(totalAmount, currency, exchangeRate);
    }
  }

  if (!totalTransaction) {
    if (currency === BASE_CURRENCY) totalTransaction = totalBase || totalAmount;
    else if (originalAmount > 0) totalTransaction = originalAmount;
    else if (totalBase > 0) totalTransaction = toTransactionAmount(totalBase, currency, exchangeRate);
    else totalTransaction = totalAmount;
  }

  if (!totalBase) {
    totalBase = currency === BASE_CURRENCY ? totalTransaction : toBaseAmount(totalTransaction, currency, exchangeRate);
  }

  const paidRaw = toFinite(raw?.paidAmount);
  const paidOriginal = toFinite(raw?.paidAmountOriginal ?? raw?.paidAmountTransaction);
  const paidBaseExplicit = toFinite(raw?.paidAmountBase);
  let paidBase = paidBaseExplicit;
  if (!paidBase) {
    if (currency === BASE_CURRENCY) paidBase = paidRaw;
    else if (paidRaw > 0) {
      paidBase = paidRaw <= totalBase + 0.01 ? paidRaw : toBaseAmount(paidRaw, currency, exchangeRate);
    }
  }
  let paidTransaction = paidOriginal;
  if (!paidTransaction) {
    paidTransaction = currency === BASE_CURRENCY ? paidBase : toTransactionAmount(paidBase, currency, exchangeRate);
  }

  const remainingRaw = toFinite(raw?.remainingAmount);
  const remainingOriginal = toFinite(raw?.remainingAmountTransaction);
  const remainingBaseExplicit = toFinite(raw?.remainingAmountBase);
  let remainingBase = remainingBaseExplicit;
  if (!remainingBase) {
    if (currency === BASE_CURRENCY) remainingBase = remainingRaw;
    else if (remainingRaw > 0) {
      remainingBase = remainingRaw <= totalBase + 0.01 ? remainingRaw : toBaseAmount(remainingRaw, currency, exchangeRate);
    } else {
      remainingBase = roundMoneyValue(Math.max(totalBase - paidBase, 0));
    }
  }
  let remainingTransaction = remainingOriginal;
  if (!remainingTransaction) {
    remainingTransaction = currency === BASE_CURRENCY ? remainingBase : toTransactionAmount(remainingBase, currency, exchangeRate);
  }

  // When frontend sends only total + remaining on credit invoices,
  // infer paid amount explicitly to keep posting/statement semantics consistent.
  if (paidBase <= 0 && totalBase > 0 && remainingBase >= 0 && remainingBase < totalBase) {
    paidBase = roundMoneyValue(Math.max(totalBase - remainingBase, 0));
  }
  if (paidTransaction <= 0 && totalTransaction > 0 && remainingTransaction >= 0 && remainingTransaction < totalTransaction) {
    paidTransaction = roundMoneyValue(Math.max(totalTransaction - remainingTransaction, 0));
  }

  const discountRaw = toFinite(raw?.discount);
  const discountBaseExplicit = toFinite(raw?.discountBase);
  const discountTxnExplicit = toFinite(raw?.discountTransaction);
  let discountBase = discountBaseExplicit;
  let discountTransaction = discountTxnExplicit;
  if (!discountBase) {
    if (currency === BASE_CURRENCY) discountBase = discountRaw;
    else if (discountRaw > 0) {
      discountBase = discountRaw <= totalBase + 0.01 ? discountRaw : toBaseAmount(discountRaw, currency, exchangeRate);
    }
  }
  if (!discountTransaction) {
    discountTransaction = currency === BASE_CURRENCY ? discountBase : toTransactionAmount(discountBase, currency, exchangeRate);
  }

  return {
    currency,
    exchangeRate,
    totalBase: roundMoneyValue(totalBase),
    totalTransaction: roundMoneyValue(totalTransaction),
    paidBase: roundMoneyValue(paidBase),
    paidTransaction: roundMoneyValue(paidTransaction),
    remainingBase: roundMoneyValue(Math.max(remainingBase, 0)),
    remainingTransaction: roundMoneyValue(Math.max(remainingTransaction, 0)),
    discountBase: roundMoneyValue(discountBase),
    discountTransaction: roundMoneyValue(discountTransaction),
  };
};

type LineMoneyNormalization = {
  quantity: number;
  unitPriceBase: number;
  unitPriceTransaction: number;
  lineTotalBase: number;
  lineTotalTransaction: number;
};

export const normalizeInvoiceLineMoney = (line: any, currency?: unknown, exchangeRate?: unknown): LineMoneyNormalization => {
  const code = normalizeCurrencyCode(currency);
  const rate = normalizeExchangeRate(code, exchangeRate);
  const quantity = toFinite(line?.baseQuantity ?? line?.quantity);

  const explicitUnitBase = toFinite(line?.unitPriceBase);
  const explicitUnitTxn = toFinite(line?.unitPriceTransaction);
  const rawUnit = toFinite(line?.unitPrice ?? line?.price);

  let unitPriceBase = explicitUnitBase;
  let unitPriceTransaction = explicitUnitTxn;

  if (!unitPriceBase && !unitPriceTransaction) {
    if (code === BASE_CURRENCY) {
      unitPriceBase = rawUnit;
      unitPriceTransaction = rawUnit;
    } else {
      unitPriceTransaction = rawUnit;
      unitPriceBase = toBaseAmount(rawUnit, code, rate);
    }
  } else {
    if (!unitPriceBase) unitPriceBase = code === BASE_CURRENCY ? unitPriceTransaction : toBaseAmount(unitPriceTransaction, code, rate);
    if (!unitPriceTransaction) unitPriceTransaction = code === BASE_CURRENCY ? unitPriceBase : toTransactionAmount(unitPriceBase, code, rate);
  }

  const explicitTotalBase = toFinite(line?.lineTotalBase ?? line?.totalBase);
  const explicitTotalTxn = toFinite(line?.lineTotalTransaction ?? line?.totalTransaction ?? line?.total);

  let lineTotalBase = explicitTotalBase;
  let lineTotalTransaction = explicitTotalTxn;

  if (!lineTotalBase && !lineTotalTransaction) {
    lineTotalBase = roundMoneyValue(unitPriceBase * quantity);
    lineTotalTransaction = roundMoneyValue(unitPriceTransaction * quantity);
  } else {
    if (!lineTotalBase) lineTotalBase = code === BASE_CURRENCY ? lineTotalTransaction : toBaseAmount(lineTotalTransaction, code, rate);
    if (!lineTotalTransaction) lineTotalTransaction = code === BASE_CURRENCY ? lineTotalBase : toTransactionAmount(lineTotalBase, code, rate);
  }

  return {
    quantity: roundMoneyValue(quantity, 6),
    unitPriceBase: roundMoneyValue(unitPriceBase),
    unitPriceTransaction: roundMoneyValue(unitPriceTransaction),
    lineTotalBase: roundMoneyValue(lineTotalBase),
    lineTotalTransaction: roundMoneyValue(lineTotalTransaction),
  };
};

export const itemCostBase = (item: any): number => roundMoneyValue(toFinite(item?.costPriceBase ?? item?.costPrice));
export const itemSaleBase = (item: any): number => roundMoneyValue(toFinite(item?.salePriceBase ?? item?.salePrice));
export const itemWholesaleBase = (item: any): number => roundMoneyValue(toFinite(item?.wholesalePriceBase ?? item?.wholesalePrice));
