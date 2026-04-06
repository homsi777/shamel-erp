import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { createVoucherLifecycleService } from '../services/voucherLifecycle';
import { monitorPartnerPilotOperation } from '../services/partnerPilotService';
import { isAppError } from '../lib/errors';
import { computeFxDifference } from '../services/fxSettlement';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import {
  assertCashBoxAccess,
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
  resolveCashBoxForContext,
} from '../lib/tenantScope';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, createVoucherWithAccounting, auditLogger, systemEventLogger } = ctx as any;
  const voucherLifecycle = createVoucherLifecycleService(ctx as any);
  const getAuthContext = (req: any) => (req as any).authContext || {};

  const withScopedVoucher = async (id: string, req: any) => {
    const voucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id)).get();
    if (!voucher) return null;
    const authContext = getAuthContext(req);
    const companyId = String(authContext.companyId || '').trim();
    if (companyId) {
      assertEntityBelongsToCompany(voucher, companyId, 'Voucher not found.');
      assertEntityBelongsToAllowedBranch(voucher, authContext, 'Voucher not found.');
    }
    return voucher;
  };

  const assertInvoiceScope = (invoice: any, req: any, notFoundMessage = 'Invoice not found.') => {
    const authContext = getAuthContext(req);
    const companyId = String(authContext.companyId || '').trim();
    if (!companyId) return;
    assertEntityBelongsToCompany(invoice, companyId, notFoundMessage);
    assertEntityBelongsToAllowedBranch(invoice, authContext, notFoundMessage);
  };

  const bindVoucherPayloadToTenant = async (req: any, payload: Record<string, any>, existing?: any) => {
    const authContext = getAuthContext(req);
    const nextPayload = { ...payload };
    const cashBoxId = String(nextPayload.cashBoxId || existing?.cashBoxId || '').trim();
    if (cashBoxId) {
      const cashBox = await resolveCashBoxForContext(db, schema, eq, cashBoxId);
      assertCashBoxAccess(cashBox, authContext);
      nextPayload.cashBoxId = cashBoxId;
      nextPayload.cashBoxName = nextPayload.cashBoxName || cashBox?.name || existing?.cashBoxName || null;
      nextPayload.companyId = String(
        existing?.companyId
        || cashBox?.companyId
        || authContext.companyId
        || '',
      ).trim() || null;
      nextPayload.branchId = String(
        existing?.branchId
        || cashBox?.branchId
        || pickEffectiveBranchId(undefined, authContext)
        || '',
      ).trim() || null;
      return nextPayload;
    }

    nextPayload.companyId = String(existing?.companyId || authContext.companyId || '').trim() || null;
    nextPayload.branchId = String(
      existing?.branchId
      || pickEffectiveBranchId(undefined, authContext)
      || '',
    ).trim() || null;
    return nextPayload;
  };

  api.get('/vouchers/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const voucher = await withScopedVoucher(String(id || ''), req);
      if (!voucher) return reply.status(404).send({ error: 'السند غير موجود.' });
      return voucher;
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Voucher fetch failed.' });
    }
  });

  const createVoucherRoute = async (req: any, reply: any, typeOverride?: string) => {
    try {
      const rawData = typeOverride ? { ...(req.body as any), type: typeOverride } : { ...(req.body as any) };
      const data = await bindVoucherPayloadToTenant(req, rawData);
      const res = await createVoucherWithAccounting(data);
      await auditLogger.log({
        userId: String((req as any)?.authContext?.userId || data?.userId || 'system'),
        operationType: 'voucher.create',
        affectedItems: [{ voucherId: res?.id || data?.id || null }],
        newValues: data,
      });
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.VOUCHER_CREATED,
        severity: 'info',
        sourceModule: 'vouchers',
        action: 'create',
        status: 'success',
        affectedDocumentType: 'voucher',
        affectedDocumentId: String(res?.id || data?.id || ''),
        metadata: {
          voucherType: data.type || null,
          amountBase: data.amountBase ?? data.amount ?? null,
          currency: data.currency || null,
          linkedInvoiceId: data.linkedInvoiceId || null,
        },
      });
      if (res?.journalEntryId || String(res?.status || data?.status || '').toUpperCase() === 'POSTED') {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.VOUCHER_POSTED,
          severity: 'info',
          sourceModule: 'vouchers',
          action: 'post',
          status: 'success',
          affectedDocumentType: 'voucher',
          affectedDocumentId: String(res?.id || data?.id || ''),
          metadata: {
            journalEntryId: res?.journalEntryId || null,
          },
        });
      }
      if (data.clientId && res?.id) {
        const authContext = getAuthContext(req);
        const pilotReview = await monitorPartnerPilotOperation({
          db,
          schema,
          scope: {
            companyId: String(data.companyId || authContext.companyId || '').trim(),
            branchId: String(data.branchId || authContext.branchId || '').trim() || null,
          },
          partyId: String(data.clientId || '').trim(),
          documentType: 'voucher',
          documentId: String(res.id),
          action: data.linkedInvoiceId ? 'settlement.post' : 'voucher.create',
          userId: String(authContext.userId || authContext.id || data?.userId || 'system'),
          companyId: String(data.companyId || authContext.companyId || '').trim() || null,
          branchId: String(data.branchId || authContext.branchId || '').trim() || null,
          metadata: {
            voucherType: data.type || null,
            linkedInvoiceId: data.linkedInvoiceId || null,
            referenceNumber: data.referenceNumber || null,
          },
          systemEventLogger,
          auditLogger,
        });
        return pilotReview ? { ...res, partnerPilotReview: pilotReview } : res;
      }
      return res;
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(Number(error?.statusCode || 500)).send({
        error: error?.message || 'Voucher create failed.',
        code: error?.code,
        details: error?.details,
      });
    }
  };

  api.post('/vouchers', async (req, reply) => createVoucherRoute(req, reply));
  api.post('/receipts', async (req, reply) => createVoucherRoute(req, reply, 'receipt'));
  api.post('/payments', async (req, reply) => createVoucherRoute(req, reply, 'payment'));

  const handleUpdateVoucher = async (req: any, reply: any) => {
    try {
      const { id } = req.params as any;
      const existing = await withScopedVoucher(String(id || ''), req);
      if (!existing) return reply.status(404).send({ error: 'Voucher not found.' });
      const body = await bindVoucherPayloadToTenant(req, req.body as any, existing);
      return await voucherLifecycle.updateVoucher(id, body, getAuthContext(req));
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(Number(error?.statusCode || 500)).send({
        error: error?.message || 'Voucher update failed.',
        code: error?.code,
        details: error?.details,
      });
    }
  };

  api.put('/vouchers/:id', handleUpdateVoucher);
  api.patch('/vouchers/:id', handleUpdateVoucher);

  api.delete('/vouchers/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const existing = await withScopedVoucher(String(id || ''), req);
      if (!existing) return reply.status(404).send({ error: 'Voucher not found.' });
      return await voucherLifecycle.deleteVoucher(id, getAuthContext(req));
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(Number(error?.statusCode || 500)).send({
        error: error?.message || 'Voucher delete failed.',
        code: error?.code,
        details: error?.details,
      });
    }
  });

  /**
   * GET /fx-preview
   * Preview the FX difference before posting a payment.
   * Used by the payment screen UI to show "فرق سعر الصرف" in real time.
   *
   * Query params:
   *   invoiceId       - ID of the invoice being settled
   *   paymentRate     - Exchange rate at payment time
   *   paymentAmountForeign - Amount being paid in foreign currency
   */
  api.get('/fx-preview', async (req, reply) => {
    try {
      const { invoiceId, paymentRate, paymentAmountForeign } = req.query as any;
      if (!invoiceId) return reply.status(400).send({ error: 'invoiceId is required' });

      const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
      assertInvoiceScope(invoice, req, 'Invoice not found');

      const invCurrency = String((invoice as any).currency || 'USD').toUpperCase();
      if (invCurrency === 'USD') {
        return reply.send({ fxAmount: 0, type: 'none', currency: 'USD', message: 'No FX difference for base-currency invoices' });
      }

      const pRate = Number(paymentRate) || Number((invoice as any).exchangeRate) || 1;
      const pAmountForeign = Number(paymentAmountForeign) || Number((invoice as any).totalAmountTransaction) || 0;

      const invoiceTotalBase = Number((invoice as any).totalAmountBase) || 0;
      const paymentAmountBase = pAmountForeign / pRate;

      const fx = computeFxDifference(
        {
          exchangeRate: Number((invoice as any).exchangeRate) || 1,
          totalAmountBase: invoiceTotalBase,
          totalAmountTransaction: Number((invoice as any).totalAmountTransaction) || 0,
          currency: invCurrency,
        },
        {
          exchangeRate: pRate,
          amountBase: paymentAmountBase,
          amountTransaction: pAmountForeign,
          currency: invCurrency,
        },
        paymentAmountBase
      );

      return reply.send({
        invoiceRate: fx.invoiceRate,
        paymentRate: fx.paymentRate,
        fxAmount: fx.fxAmount,
        fxType: fx.type,
        invoiceBaseExpected: fx.invoiceBasePortionExpected,
        paymentBaseActual: fx.paymentBaseActual,
        settlementForeignAmount: fx.settlementForeignAmount,
        currency: invCurrency,
        label: fx.type === 'loss'
          ? `خسارة فرق سعر الصرف: -${fx.fxAmount.toFixed(2)} USD`
          : fx.type === 'gain'
            ? `ربح فرق سعر الصرف: +${fx.fxAmount.toFixed(2)} USD`
            : 'لا يوجد فرق في سعر الصرف',
      });
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'FX preview failed.' });
    }
  });

  /**
   * GET /fx-report
   * FX gain/loss report per customer or per invoice.
   */
  api.get('/fx-report', async (req, reply) => {
    try {
      const { partyId, fromDate, toDate } = req.query as any;
      const authContext = getAuthContext(req);

      const allVouchers = filterRowsByTenantScope(
        await db.select().from(schema.vouchers).all(),
        authContext,
        'vouchers',
      );
      const fxVouchers = allVouchers.filter((v: any) =>
        v.fxDifferenceAmount != null &&
        Number(v.fxDifferenceAmount) > 0 &&
        (!partyId || String(v.clientId || '') === partyId) &&
        (!fromDate || String(v.date || '') >= fromDate) &&
        (!toDate || String(v.date || '') <= toDate)
      );

      const totalGain = fxVouchers
        .filter((v: any) => v.fxDifferenceType === 'gain')
        .reduce((s: number, v: any) => s + Number(v.fxDifferenceAmount || 0), 0);
      const totalLoss = fxVouchers
        .filter((v: any) => v.fxDifferenceType === 'loss')
        .reduce((s: number, v: any) => s + Number(v.fxDifferenceAmount || 0), 0);

      return reply.send({
        lines: fxVouchers.map((v: any) => ({
          voucherId: v.id,
          date: v.date,
          clientId: v.clientId,
          clientName: v.clientName,
          linkedInvoiceId: v.linkedInvoiceId,
          invoiceRate: v.exchangeRate,
          settlementRate: v.settlementExchangeRate,
          fxAmount: v.fxDifferenceAmount,
          fxType: v.fxDifferenceType,
          fxJournalEntryId: v.fxJournalEntryId,
        })),
        summary: {
          totalGain: Math.round(totalGain * 100) / 100,
          totalLoss: Math.round(totalLoss * 100) / 100,
          net: Math.round((totalGain - totalLoss) * 100) / 100,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'FX report failed.' });
    }
  });
}
