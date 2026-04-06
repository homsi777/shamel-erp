export const BASE_CURRENCY = 'USD' as const;

export type CurrencyCode = 'USD' | 'SYP' | 'TRY';
type AmountKind = 'total' | 'paid' | 'remaining' | 'discount';

const SUPPORTED = new Set(['USD', 'SYP', 'TRY']);

const toNum = (value: unknown): number => {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
};

export const normalizeCurrencyCode = (value?: unknown): CurrencyCode => {
  const code = String(value || '').trim().toUpperCase();
  if (SUPPORTED.has(code)) return code as CurrencyCode;
  return BASE_CURRENCY;
};

export const normalizeExchangeRate = (currency?: unknown, rate?: unknown): number => {
  const code = normalizeCurrencyCode(currency);
  if (code === BASE_CURRENCY) return 1;
  const n = toNum(rate);
  return n > 0 ? n : 1;
};

export const toBaseAmount = (amount: number, currency?: unknown, exchangeRate?: unknown): number => {
  const code = normalizeCurrencyCode(currency);
  const rate = normalizeExchangeRate(code, exchangeRate);
  const raw = toNum(amount);
  if (!raw) return 0;
  return code === BASE_CURRENCY ? raw : (raw / rate);
};

export const toTransactionAmount = (amountBase: number, currency?: unknown, exchangeRate?: unknown): number => {
  const code = normalizeCurrencyCode(currency);
  const rate = normalizeExchangeRate(code, exchangeRate);
  const raw = toNum(amountBase);
  if (!raw) return 0;
  return code === BASE_CURRENCY ? raw : (raw * rate);
};

export const currencySymbol = (currency?: unknown): string => {
  const code = normalizeCurrencyCode(currency);
  if (code === 'SYP') return '\u0644.\u0633';
  if (code === 'TRY') return '\u20BA';
  return '$';
};

export const invoiceCurrencyCode = (inv: any): CurrencyCode =>
  normalizeCurrencyCode(inv?.currency || BASE_CURRENCY);

export const invoiceExchangeRate = (inv: any): number =>
  normalizeExchangeRate(invoiceCurrencyCode(inv), inv?.exchangeRate);

export const invoiceAmountBase = (inv: any, kind: AmountKind = 'total'): number => {
  const currency = invoiceCurrencyCode(inv);
  const rate = invoiceExchangeRate(inv);
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

export const invoiceAmountTransaction = (inv: any, kind: AmountKind = 'total'): number => {
  const currency = invoiceCurrencyCode(inv);
  const rate = invoiceExchangeRate(inv);
  const explicitTxn = kind === 'total'
    ? toNum(inv?.totalAmountTransaction ?? inv?.originalAmount)
    : kind === 'paid'
      ? toNum(inv?.paidAmountTransaction ?? inv?.paidAmountOriginal)
      : kind === 'remaining'
        ? toNum(inv?.remainingAmountTransaction)
        : toNum(inv?.discountTransaction);
  if (explicitTxn) return explicitTxn;
  const base = invoiceAmountBase(inv, kind);
  if (!base) return 0;
  return currency === BASE_CURRENCY ? base : toTransactionAmount(base, currency, rate);
};

export const invoiceOpenState = (inv: any): 'open' | 'closed' =>
  invoiceAmountBase(inv, 'remaining') > 0 ? 'open' : 'closed';

export const lineQuantity = (line: any): number =>
  toNum(line?.baseQuantity ?? line?.quantity);

export const lineUnitBase = (line: any, inv: any): number => {
  const explicitBase = toNum(line?.unitPriceBase);
  if (explicitBase) return explicitBase;
  const raw = toNum(line?.unitPrice ?? line?.priceAtSale ?? line?.price);
  if (!raw) return 0;
  const currency = invoiceCurrencyCode(inv);
  return currency === BASE_CURRENCY ? raw : toBaseAmount(raw, currency, invoiceExchangeRate(inv));
};

export const lineUnitTransaction = (line: any, inv: any): number => {
  const explicitTxn = toNum(line?.unitPriceTransaction ?? line?.priceAtSale);
  if (explicitTxn) return explicitTxn;
  const base = lineUnitBase(line, inv);
  if (!base) return 0;
  const currency = invoiceCurrencyCode(inv);
  return currency === BASE_CURRENCY ? base : toTransactionAmount(base, currency, invoiceExchangeRate(inv));
};

export const lineTotalBase = (line: any, inv: any): number => {
  const explicitBase = toNum(line?.lineTotalBase ?? line?.totalBase);
  if (explicitBase) return explicitBase;
  return lineUnitBase(line, inv) * lineQuantity(line);
};

export const lineTotalTransaction = (line: any, inv: any): number => {
  const explicitTxn = toNum(line?.lineTotalTransaction ?? line?.totalTransaction ?? line?.total);
  if (explicitTxn) return explicitTxn;
  return lineUnitTransaction(line, inv) * lineQuantity(line);
};

export const itemCostBase = (item: any): number =>
  toNum(item?.costPriceBase ?? item?.costPrice);
