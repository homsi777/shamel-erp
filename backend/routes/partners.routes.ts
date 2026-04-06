import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, appendAudit, buildPartyStatement, getBackupDir, buildBackupPayload, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, fs, path, getResolvedDbPath, closeDb, bcrypt, server, getLocalIp } = ctx as any;

api.post('/partners/transaction', async (req, reply) => {
    try {
        const data = req.body as any;
        const partnerId = data.partnerId;
        const transaction = data.transaction;
        if (!partnerId || !transaction) return reply.status(400).send({ error: 'Missing partner transaction data.' });
        const partner = await db.select().from(schema.partners).where(eq(schema.partners.id, partnerId)).get();
        if (!partner) return reply.status(404).send({ error: 'Partner not found.' });

        const amount = Number(transaction.amount || 0);
        const type = String(transaction.type || '');
        const isWithdraw = type.includes('withdraw');
        const newBalance = (Number(partner.currentBalance || 0) + (isWithdraw ? -amount : amount));
        await db.update(schema.partners).set({ currentBalance: newBalance }).where(eq(schema.partners.id, partnerId)).run();

        await db.insert(schema.partnerTransactions).values({
            id: transaction.id || `pt-${Date.now()}`,
            partnerId,
            partnerName: transaction.partnerName || partner.name,
            type,
            amount,
            date: transaction.date || new Date().toISOString(),
            description: transaction.description
        }).run();

        if (data.cashBoxUpdate && data.voucher) {
            const voucher = data.voucher;
            await createVoucherWithAccounting({
                ...voucher,
                id: voucher.id || `v-${Date.now()}`,
                date: voucher.date || new Date().toISOString(),
                amount: Number(voucher.amount || amount),
                originalAmount: Number(voucher.originalAmount || voucher.amount || amount),
            });
        }

        return { success: true };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});

// Opening balances for parties (AR/AP)
}
