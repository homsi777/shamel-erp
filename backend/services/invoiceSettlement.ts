import { and, eq } from 'drizzle-orm';
import * as schema from '../db/schema';

const normalizeText = (value: unknown) => String(value ?? '').trim();
const roundMoney = (value: number, decimals = 2) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

const normalizeCurrencyCode = (value: unknown) => {
  const code = normalizeText(value).toUpperCase();
  if (code === 'SYP' || code === 'TRY' || code === 'USD') return code;
  return 'USD';
};

const normalizeExchangeRate = (currency: string, value: unknown) => {
  const rate = Number(value || 0);
  if (currency === 'USD') return 1;
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
};

export const getInvoiceSettlementExposure = (invoice: any) => {
  const type = normalizeText((invoice as any)?.type).toLowerCase();
  const currency = normalizeCurrencyCode((invoice as any)?.currency);
  const exchangeRate = normalizeExchangeRate(currency, (invoice as any)?.exchangeRate);
  const totalBase = roundMoney(Number((invoice as any)?.totalAmountBase ?? (invoice as any)?.totalAmount ?? 0));
  const totalTransactionRaw = Number((invoice as any)?.totalAmountTransaction ?? (invoice as any)?.originalAmount ?? 0);
  const totalTransaction = roundMoney(
    totalTransactionRaw > 0 ? totalTransactionRaw : (currency === 'USD' ? totalBase : totalBase * exchangeRate),
  );

  if (type === 'purchase') {
    const goodsSubtotal = Number((invoice as any)?.goodsSubtotal ?? (invoice as any)?.goods_subtotal);
    if (Number.isFinite(goodsSubtotal) && goodsSubtotal >= 0) {
      const base = roundMoney(goodsSubtotal);
      return {
        base,
        transaction: roundMoney(currency === 'USD' ? base : base * exchangeRate),
      };
    }
  }

  return {
    base: totalBase,
    transaction: totalTransaction,
  };
};

const isRelevantVoucherForInvoice = (invoice: any, voucher: any) => {
  const voucherStatus = normalizeText((voucher as any)?.status).toUpperCase();
  if (voucherStatus && voucherStatus !== 'POSTED') return false;
  const invoiceType = normalizeText((invoice as any)?.type).toLowerCase();
  const voucherType = normalizeText((voucher as any)?.type).toLowerCase();
  if (invoiceType === 'sale') return voucherType === 'receipt';
  if (invoiceType === 'purchase') return voucherType === 'payment';
  return false;
};

export const recomputeInvoiceSettlementTx = async (tx: any, invoiceId: string) => {
  const invoice = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
  if (!invoice) throw new Error(`INVOICE_NOT_FOUND_FOR_SETTLEMENT:${invoiceId}`);

  const currency = normalizeCurrencyCode((invoice as any)?.currency);
  const exchangeRate = normalizeExchangeRate(currency, (invoice as any)?.exchangeRate);
  const exposure = getInvoiceSettlementExposure(invoice);
  const linkedVouchers = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.linkedInvoiceId, invoiceId)).all();
  const relevantVouchers = (linkedVouchers || []).filter((voucher: any) => isRelevantVoucherForInvoice(invoice, voucher));

  const settledBase = roundMoney(
    relevantVouchers.reduce(
      (sum: number, voucher: any) => sum + Number((voucher as any).amountBase ?? (voucher as any).amount ?? 0),
      0
    )
  );

  const paidBase = Math.min(exposure.base, settledBase);
  const paidTransactionRaw = roundMoney(currency === 'USD' ? paidBase : paidBase * exchangeRate);
  const paidTransaction = Math.min(exposure.transaction, paidTransactionRaw);
  const remainingBase = roundMoney(Math.max(exposure.base - paidBase, 0));
  const remainingTransaction = roundMoney(Math.max(exposure.transaction - paidTransaction, 0));
  const paymentType = remainingBase > 0.0001 ? 'credit' : 'cash';

  await tx.update(schema.invoices).set({
    paidAmount: paidBase,
    paidAmountBase: paidBase,
    paidAmountTransaction: paidTransaction,
    remainingAmount: remainingBase,
    remainingAmountBase: remainingBase,
    remainingAmountTransaction: remainingTransaction,
    paymentType,
  }).where(eq(schema.invoices.id, invoiceId)).run();

  return {
    invoiceId,
    exposureBase: exposure.base,
    exposureTransaction: exposure.transaction,
    paidBase,
    paidTransaction,
    remainingBase,
    remainingTransaction,
    paymentType,
  };
};

export const recomputeInvoiceSettlement = async (db: any, invoiceId: string) => {
  return db.transaction(async (tx: any) => recomputeInvoiceSettlementTx(tx, invoiceId));
};
