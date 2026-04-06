/**
 * FX Journal Service — Shamel ERP
 *
 * Orchestrates FX difference detection and journal posting when a voucher
 * (receipt or payment) settles a foreign-currency invoice.
 *
 * Rules:
 * 1. Never modify the original invoice journal entry.
 * 2. FX difference is always a SEPARATE journal entry.
 * 3. FX is calculated ONLY at settlement time.
 * 4. Partial payments compute proportional FX per payment.
 * 5. AR/AP are closed at the original base value; FX absorbs the gap.
 */

import { computeFxDifference, buildFxJournalLines } from './fxSettlement';
import { SYSTEM_ACCOUNTS, resolveAccountByCode, roundMoney } from '../accountingService';

export interface FxPostingInput {
  /** The voucher that is settling an invoice */
  voucher: {
    id: string;
    type: string; // 'receipt' | 'payment'
    currency: string;
    exchangeRate: number;
    amountBase: number;
    amountTransaction: number;
    clientId?: string | null;
    linkedInvoiceId?: string | null;
    date?: string;
    companyId?: string | null;
    branchId?: string | null;
  };
  /** The invoice being settled */
  invoice: {
    id: string;
    type: string; // 'sale' | 'purchase'
    currency: string;
    exchangeRate: number;
    totalAmountBase: number;
    totalAmountTransaction: number;
    remainingAmountBase: number;
  };
  /** Amount being settled in this payment (base currency, USD) */
  settlementAmountBase: number;
  /** Amount being settled in foreign currency */
  settlementAmountForeign: number;
}

export interface FxPostingResult {
  posted: boolean;
  fxAmount: number;
  fxType: 'gain' | 'loss' | 'none';
  fxJournalEntryId: number | null;
  detail: string;
}

/**
 * Post FX difference journal entry for a settlement.
 *
 * Called after a voucher is saved, when it is linked to a foreign-currency invoice
 * and the payment rate differs from the invoice rate.
 */
export const createFxJournalPostingService = (ctx: {
  db: any;
  schema: any;
  eq: any;
  createJournalEntry: (data: any) => Promise<any>;
  postJournalEntry: (id: number) => Promise<void>;
}) => {
  const { db, schema, eq, createJournalEntry, postJournalEntry } = ctx;

  const postFxDifference = async (input: FxPostingInput): Promise<FxPostingResult> => {
    const { voucher, invoice, settlementAmountBase, settlementAmountForeign } = input;

    // Only applies to foreign-currency invoices
    const invoiceCurrency = String(invoice.currency || 'USD').toUpperCase();
    if (invoiceCurrency === 'USD') {
      return { posted: false, fxAmount: 0, fxType: 'none', fxJournalEntryId: null, detail: 'Base currency — no FX difference' };
    }

    const fx = computeFxDifference(
      {
        exchangeRate: invoice.exchangeRate,
        totalAmountBase: invoice.totalAmountBase,
        totalAmountTransaction: invoice.totalAmountTransaction,
        currency: invoice.currency,
      },
      {
        exchangeRate: voucher.exchangeRate,
        amountBase: voucher.amountBase,
        amountTransaction: voucher.amountTransaction,
        currency: voucher.currency,
      },
      settlementAmountBase
    );

    if (fx.type === 'none' || fx.fxAmount === 0) {
      return { posted: false, fxAmount: 0, fxType: 'none', fxJournalEntryId: null, detail: 'No FX difference (same rate)' };
    }

    // Resolve party accounts
    const party = voucher.clientId
      ? await db.select().from(schema.parties).where(eq(schema.parties.id, voucher.clientId)).get()
      : null;

    const receivableAccountId = await resolveAccountByCode(db, SYSTEM_ACCOUNTS.RECEIVABLE, voucher.companyId || null);
    const payableAccountId = await resolveAccountByCode(db, SYSTEM_ACCOUNTS.PAYABLE, voucher.companyId || null);

    const toAccountId = (value: any): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const arAccountId = toAccountId(party?.arAccountId) ?? toAccountId(party?.accountId) ?? receivableAccountId;
    const apAccountId = toAccountId(party?.apAccountId) ?? toAccountId(party?.accountId) ?? payableAccountId;

    const invoiceType = String(invoice.type || 'sale').toLowerCase() === 'purchase' ? 'purchase' : 'sale';

    const fxLines = await buildFxJournalLines(
      fx,
      invoiceType,
      arAccountId,
      apAccountId,
      (code) => resolveAccountByCode(db, code, voucher.companyId || null)
    );

    if (fxLines.length === 0) {
      return { posted: false, fxAmount: 0, fxType: 'none', fxJournalEntryId: null, detail: 'No FX lines built' };
    }

    const fxTypeAr = fx.type === 'loss' ? 'خسارة فرق سعر الصرف' : 'ربح فرق سعر الصرف';
    const description = `${fxTypeAr} — تسوية فاتورة ${invoice.id} بسند ${voucher.id}`;

    const fxEntry = await createJournalEntry({
      description,
      referenceType: 'fx_settlement',
      referenceId: null,
      lines: fxLines.map(l => ({
        accountId: l.accountId,
        debit: roundMoney(l.debit),
        credit: roundMoney(l.credit),
        description: l.description,
        currencyCode: invoiceCurrency,
        exchangeRate: voucher.exchangeRate,
        amountInCurrency: roundMoney((l.debit + l.credit) * voucher.exchangeRate),
        partyId: party ? (Number.isFinite(Number(party.id)) ? Number(party.id) : null) : null,
        partnerRefId: party ? String((party as any).id || '') : null,
      })),
      companyId: voucher.companyId || null,
      branchId: voucher.branchId || null,
      currencyCode: invoiceCurrency,
      entryDate: voucher.date || new Date().toISOString(),
    });

    await postJournalEntry(fxEntry.id);

    // Tag the voucher with FX settlement metadata
    await db.update(schema.vouchers)
      .set({
        settlementExchangeRate: voucher.exchangeRate,
        fxDifferenceAmount: fx.fxAmount,
        fxDifferenceType: fx.type,
        fxJournalEntryId: fxEntry.id,
      })
      .where(eq(schema.vouchers.id, voucher.id))
      .run();

    return {
      posted: true,
      fxAmount: fx.fxAmount,
      fxType: fx.type,
      fxJournalEntryId: fxEntry.id,
      detail: `${fxTypeAr}: ${fx.fxAmount.toFixed(4)} USD (rate ${fx.invoiceRate} → ${fx.paymentRate})`,
    };
  };

  return { postFxDifference };
};
