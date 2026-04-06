import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { DOC_RANGES, getNextDocNumber } from './_common';
import { resolvePrice } from '../pricingService';
import { computeLineCommission, validateCommissionRule, validateInvoiceDataIntegrity, validateInvoiceEdgeCases } from '../lib/invoiceValidation';
import { createInvoiceLifecycleService } from '../services/invoiceLifecycle';
import { monitorPartnerPilotOperation } from '../services/partnerPilotService';
import { getInvoiceCorrectionPolicy, loadNormalizedSettingsMap } from '../lib/settings';
import { isAppError } from '../lib/errors';
import { systemEmit } from '../lib/restaurantSocket';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  assertWarehouseAccess,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
  resolveWarehouseForContext,
} from '../lib/tenantScope';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const {
    db,
    schema,
    sql,
    eq,
    safeJsonParse,
    stringifyOrEmpty,
    adjustItemStockWithMovement,
    auditLogger,
    systemEventLogger,
  } = ctx as any;

  const invoiceLifecycle = createInvoiceLifecycleService(ctx as any);

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const assertInvoiceAccess = (invoice: any, req: any) => {
    const authContext = getAuthContext(req);
    const companyId = String(authContext.companyId || '').trim();
    if (!invoice || !companyId) return;
    assertEntityBelongsToCompany(invoice, companyId, 'Invoice not found.');
    assertEntityBelongsToAllowedBranch(invoice, authContext, 'Invoice not found.');
  };

  const withScopedInvoice = async (invoiceId: string, req: any) => {
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
    if (!invoice) return null;
    assertInvoiceAccess(invoice, req);
    return invoice;
  };

  api.get('/next-number/:type', async (req, reply) => {
    const { type } = req.params as { type: string };
    if (!DOC_RANGES[type]) return reply.status(400).send({ error: 'Invalid type' });
    const authContext = getAuthContext(req);
    return {
      number: await getNextDocNumber(type as any, {
        companyId: String(authContext.companyId || '').trim() || null,
        branchId: String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null,
      }),
    };
  });

  api.get('/invoices/:id', async (req, reply) => {
    try {
      const invoice = await withScopedInvoice(String((req.params as any).id || ''), req);
      if (!invoice) return reply.status(404).send({ error: 'الفاتورة غير موجودة.' });
      return invoice;
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'INVOICE_FETCH_FAILED' });
    }
  });

  api.post('/invoices', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const payload = { ...(req.body as any) };
      const targetWarehouseId = String(payload.targetWarehouseId || payload.warehouseId || '').trim();
      if (targetWarehouseId) {
        const warehouse = await resolveWarehouseForContext(db, schema, eq, targetWarehouseId);
        assertWarehouseAccess(warehouse, authContext);
        payload.targetWarehouseId = targetWarehouseId;
        payload.companyId = String(warehouse?.companyId || authContext.companyId || '').trim() || null;
        payload.branchId = String(warehouse?.branchId || pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
      } else {
        payload.companyId = String(authContext.companyId || '').trim() || null;
        payload.branchId = String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
      }
      const result = await invoiceLifecycle.createInvoice(payload, authContext);
      if (result?.id) {
        systemEmit.sync({
          companyId: String(payload.companyId || authContext.companyId || '').trim() || '',
          branchId: String(payload.branchId || authContext.branchId || '').trim() || null,
          reason: 'invoice.create',
          scope: 'inventory',
        });
      }
      if (payload.clientId && result?.id) {
        const pilotReview = await monitorPartnerPilotOperation({
          db,
          schema,
          scope: {
            companyId: String(payload.companyId || authContext.companyId || '').trim(),
            branchId: String(payload.branchId || authContext.branchId || '').trim() || null,
          },
          partyId: String(payload.clientId || '').trim(),
          documentType: 'invoice',
          documentId: String(result.id),
          action: 'invoice.create',
          userId: String(authContext.userId || authContext.id || payload.createdById || 'system'),
          companyId: String(payload.companyId || authContext.companyId || '').trim() || null,
          branchId: String(payload.branchId || authContext.branchId || '').trim() || null,
          metadata: {
            invoiceNumber: payload.invoiceNumber || null,
            invoiceType: payload.type || null,
            paymentType: payload.paymentType || null,
          },
          systemEventLogger,
          auditLogger,
        });
        return pilotReview ? { ...result, partnerPilotReview: pilotReview } : result;
      }
      return result;
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Unexpected invoice error', code: 'INVOICE_CREATE_FAILED' });
    }
  });

  const handleUpdateInvoice = async (req: any, reply: any) => {
    try {
      const { id } = req.params as any;
      const data = req.body as any;
      const existing = await withScopedInvoice(String(id || ''), req);
      if (!existing) return reply.status(404).send({ error: 'الفاتورة غير موجودة.' });

      const postedPolicy = await getInvoiceCorrectionPolicy(db, schema, {
        companyId: String(getAuthContext(req).companyId || '').trim() || null,
        branchId: String(getAuthContext(req).branchId || '').trim() || null,
      });
      if (Number((existing as any).journalEntryId || 0) > 0) {
        return reply.status(409).send({
          error: `تعديل الفاتورة المرحلة محظور حالياً من الخادم. السياسة الحالية: ${postedPolicy.postedInvoiceCorrectionMode}. استخدم العكس أو إعادة الإصدار.`,
          code: 'POSTED_INVOICE_DIRECT_EDIT_BLOCKED',
        });
      }

      const rawItems = Array.isArray(data.items) ? data.items : safeJsonParse(data.items, []);
      const currency = ['USD', 'SYP', 'TRY'].includes(String(data.currency || existing.currency || '').toUpperCase())
        ? String(data.currency || existing.currency || '').toUpperCase()
        : 'USD';
      const strictMode = process.env.ERP_STRICT_MODE === 'true' || process.env.ERP_STRICT_MODE === '1';
      const edgeResult = validateInvoiceEdgeCases(rawItems, currency, strictMode);
      if (!edgeResult.ok) return reply.status(400).send({ error: edgeResult.error, code: 'INVOICE_EDGE_VALIDATION_FAILED' });

      const existingItemIds = new Set(
        (
          await Promise.all(
            rawItems.map(async (line: any) => {
              const itemId = String(line?.itemId || '').trim();
              if (!itemId) return null;
              const row = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
              return row ? itemId : null;
            }),
          )
        ).filter(Boolean) as string[],
      );
      const dataIntegrity = validateInvoiceDataIntegrity(
        rawItems,
        (itemId: string) => existingItemIds.has(String(itemId || '').trim()),
      );
      if (!dataIntegrity.ok) return reply.status(400).send({ error: dataIntegrity.error, code: 'INVOICE_DATA_INTEGRITY_FAILED' });

      const settingsMap = await loadNormalizedSettingsMap(db, schema, {
        companyId: String(getAuthContext(req).companyId || '').trim() || null,
        branchId: String(getAuthContext(req).branchId || '').trim() || null,
      });
      const pricingSettings = settingsMap.get('pricingSettings') || {};
      const party = data.clientId ? await db.select().from(schema.parties).where(eq(schema.parties.id, data.clientId)).get() : null;
      const allowManualPriceEdit = party?.allowManualPriceEdit !== false;

      for (let idx = 0; idx < rawItems.length; idx++) {
        const line = rawItems[idx];
        const commissionOk = validateCommissionRule(line);
        if (!commissionOk.ok) return reply.status(400).send({ error: commissionOk.error, code: 'INVOICE_COMMISSION_RULE_FAILED' });
        rawItems[idx] = { ...line, commissionAmount: computeLineCommission(line) };
      }

      if (String(data.type || existing.type || '').toLowerCase() === 'sale' && data.clientId && !allowManualPriceEdit) {
        for (let idx = 0; idx < rawItems.length; idx++) {
          const line = rawItems[idx];
          const resolved = resolvePrice(db, line.itemId, data.clientId, line.unitId, Number(line.baseQuantity ?? line.quantity), {
            enableCustomerSpecificPrices: pricingSettings.enableCustomerSpecificPrices !== false,
            enableLastSoldPriceRecall: pricingSettings.enableLastSoldPriceRecall !== false,
          });
          const unitPrice = Number(line.unitPrice ?? line.unitPriceTransaction ?? 0);
          if (Math.abs(unitPrice - resolved.unitPrice) > 0.01) {
            return reply.status(400).send({
              error: `السعر المدخل لا يطابق السعر المحسوب للصنف (سطر ${idx + 1}).`,
              code: 'INVOICE_PRICE_OVERRIDE_BLOCKED',
            });
          }
        }
      }

      const updatePayload: Record<string, any> = {
        clientId: data.clientId ?? existing.clientId,
        clientName: data.clientName ?? (existing as any).clientName,
        date: data.date ?? (existing as any).date,
        items: stringifyOrEmpty(rawItems),
        totalAmount: data.totalAmount != null ? Number(data.totalAmount) : Number((existing as any).totalAmount ?? 0),
        totalAmountBase: data.totalAmountBase != null ? Number(data.totalAmountBase) : (existing as any).totalAmountBase,
        totalAmountTransaction: data.totalAmountTransaction != null ? Number(data.totalAmountTransaction) : (existing as any).totalAmountTransaction,
        discount: data.discount != null ? Number(data.discount) : (existing as any).discount,
        discountBase: data.discountBase != null ? Number(data.discountBase) : (existing as any).discountBase,
        discountTransaction: data.discountTransaction != null ? Number(data.discountTransaction) : (existing as any).discountTransaction,
        paidAmount: data.paidAmount != null ? Number(data.paidAmount) : (existing as any).paidAmount,
        paidAmountBase: data.paidAmountBase != null ? Number(data.paidAmountBase) : (existing as any).paidAmountBase,
        paidAmountTransaction: data.paidAmountTransaction != null ? Number(data.paidAmountTransaction) : (existing as any).paidAmountTransaction,
        remainingAmount: data.remainingAmount != null ? Number(data.remainingAmount) : (existing as any).remainingAmount,
        remainingAmountBase: data.remainingAmountBase != null ? Number(data.remainingAmountBase) : (existing as any).remainingAmountBase,
        remainingAmountTransaction: data.remainingAmountTransaction != null ? Number(data.remainingAmountTransaction) : (existing as any).remainingAmountTransaction,
        currency,
        exchangeRate: data.exchangeRate != null ? Number(data.exchangeRate) : (existing as any).exchangeRate,
        notes: data.notes ?? (existing as any).notes,
        companyId: existing.companyId ?? getAuthContext(req).companyId ?? null,
        branchId: existing.branchId ?? getAuthContext(req).branchId ?? null,
      };

      await db.update(schema.invoices).set(updatePayload).where(eq(schema.invoices.id, id)).run();
      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'فشل تحديث الفاتورة', code: 'INVOICE_UPDATE_FAILED' });
    }
  };

  api.put('/invoices/:id', handleUpdateInvoice);
  api.patch('/invoices/:id', handleUpdateInvoice);

  /**
   * POST /invoices/:id/post
   *
   * Business rule: Invoices are auto-posted on creation (journal entry created and posted
   * immediately inside createInvoice). This endpoint exists for legacy compatibility and
   * for any future draft-invoice workflow.
   *
   * Behavior:
   *   - If the invoice already has a journalEntryId → returns success (idempotent no-op).
   *   - If the invoice has no journalEntryId (e.g. accounts were misconfigured at creation
   *     time) → posts the journal entry now (recovery path).
   */
  api.post('/invoices/:id/post', async (req, reply) => {
    try {
      const invoice = await withScopedInvoice(String((req.params as any).id || ''), req);
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found.' });
      const result = await invoiceLifecycle.postInvoice(String(invoice.id), getAuthContext(req));
      systemEmit.sync({
        companyId: String(getAuthContext(req).companyId || '').trim() || '',
        branchId: String(getAuthContext(req).branchId || '').trim() || null,
        reason: 'invoice.post',
        scope: 'inventory',
      });
      return {
        ...result,
        alreadyPosted: !!(invoice as any).journalEntryId,
        note: (invoice as any).journalEntryId
          ? 'الفاتورة مرحّلة مسبقاً عند الإنشاء — لا حاجة لاستدعاء هذا المسار في الحالة الاعتيادية.'
          : undefined,
      };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to post invoice', code: 'INVOICE_POST_FAILED' });
    }
  });

  api.post('/invoices/:id/cancel', async (req, reply) => {
    try {
      const invoice = await withScopedInvoice(String((req.params as any).id || ''), req);
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found.' });
      const result = await invoiceLifecycle.cancelInvoice(String(invoice.id), getAuthContext(req));
      systemEmit.sync({
        companyId: String(getAuthContext(req).companyId || '').trim() || '',
        branchId: String(getAuthContext(req).branchId || '').trim() || null,
        reason: 'invoice.cancel',
        scope: 'inventory',
      });
      return result;
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to cancel invoice', code: 'INVOICE_CANCEL_FAILED' });
    }
  });

  api.get('/invoices/:id/journal', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const invoice = await withScopedInvoice(String(id || ''), req);
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found.' });
      const jeId = Number((invoice as any).journalEntryId);
      if (!Number.isFinite(jeId)) return { entry: null, lines: [] };
      const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, jeId)).get();
      const lines = await db.select().from(schema.journalEntryLines).where(eq(schema.journalEntryLines.journalEntryId, jeId)).all();
      return { entry, lines };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e?.message || 'Failed to fetch journal' });
    }
  });

  api.post('/invoices/:id/stock-toggle', async (req, reply) => {
    try {
      const stockToggleEnabled = ['1', 'true', 'yes'].includes(String(process.env.ERP_ENABLE_STOCK_TOGGLE || '').trim().toLowerCase());
      if (!stockToggleEnabled) {
        return reply.status(410).send({
          error: 'INVOICE_STOCK_TOGGLE_DISABLED',
          code: 'INVOICE_STOCK_TOGGLE_DISABLED',
          message: 'Stock toggle is disabled by policy. Use canonical cancellation/reissue flow.',
        });
      }
      const { id } = req.params as any;
      const data = req.body as any;
      const invoice = await withScopedInvoice(String(id || ''), req);
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found.' });
      if (invoice.type !== 'purchase') return reply.status(400).send({ error: 'Only purchase invoices can be toggled.' });

      const currentStatus = Number((invoice as any).applyStock ?? 1) === 1 ? 'ACTIVE' : 'LOCKED';
      const action = data.action === 'activate' ? 'activate' : 'lock';
      const nextStatus = action === 'activate' ? 'ACTIVE' : 'LOCKED';
      if (currentStatus === nextStatus) return { success: true };

      const items = safeJsonParse((invoice as any).items, []);
      const targetWarehouseId = (invoice as any).targetWarehouseId;
      const sign = action === 'activate' ? 1 : -1;

      await db.transaction(async (tx: any) => {
        for (const line of items) {
          const itemId = String(line?.itemId || '').trim();
          const qty = Number(line?.baseQuantity ?? line?.quantity ?? 0);
          if (!itemId || !qty) continue;
          const invItem = await tx.select().from(schema.items)
            .where(sql`${schema.items.id} = ${itemId} AND (${schema.items.warehouseId} = ${targetWarehouseId} OR ${targetWarehouseId} IS NULL)`)
            .get();
          if (!invItem) continue;
          const warehouseId = String((invItem as any).warehouseId || targetWarehouseId || '').trim();
          if (!warehouseId) {
            throw new Error('INVOICE_STOCK_TOGGLE_WAREHOUSE_REQUIRED');
          }
          await adjustItemStockWithMovement(tx, {
            itemId: String((invItem as any).id || itemId),
            warehouseId,
            warehouseName: (invItem as any).warehouseName || (invoice as any).targetWarehouseName || null,
            unitId: line?.unitId || (invItem as any).unitId || null,
            unitName: line?.unitName || (invItem as any).unitName || null,
            qtyDelta: sign * qty,
            baseQtyDelta: sign * qty,
            meta: {
              documentType: 'INVOICE_STOCK_TOGGLE',
              documentId: String(id),
              documentNumber: (invoice as any).invoiceNumber || null,
              movementType: action === 'activate' ? 'INVOICE_STOCK_ACTIVATE' : 'INVOICE_STOCK_LOCK',
              userId: String(getAuthContext(req).userId || data.userId || '') || null,
              userName: String(data.userName || '') || null,
              notes: data.reason || 'Manual stock toggle',
            },
          });
        }

        await tx.update(schema.invoices).set({ applyStock: action === 'activate' ? 1 : 0 }).where(eq(schema.invoices.id, id)).run();
        await tx.insert(schema.invoiceMovements).values({
          id: `im-${Date.now()}`,
          companyId: (invoice as any).companyId || getAuthContext(req).companyId || null,
          branchId: (invoice as any).branchId || getAuthContext(req).branchId || null,
          invoiceId: id,
          invoiceNumber: (invoice as any).invoiceNumber,
          action,
          fromStatus: currentStatus,
          toStatus: nextStatus,
          reason: data.reason || 'Manual toggle',
          userId: data.userId,
          userName: data.userName,
        }).run();
      });

      systemEmit.sync({
        companyId: String(getAuthContext(req).companyId || '').trim() || '',
        branchId: String(getAuthContext(req).branchId || '').trim() || null,
        reason: 'invoice.stock-toggle',
        scope: 'inventory',
      });
      return { success: true };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  });

  api.get('/invoices/movements', async (req) => {
    try {
      const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.type, 'purchase')).all();
      const scopedInvoices = filterRowsByTenantScope(invoices, getAuthContext(req), 'invoices');
      return scopedInvoices.map((inv: any) => ({
        id: inv.id,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceType: inv.type,
        clientId: inv.clientId,
        clientName: inv.clientName,
        date: inv.date,
        totalAmount: inv.totalAmount,
        currency: inv.currency,
        stockStatus: Number(inv.applyStock ?? 1) === 1 ? 'ACTIVE' : 'LOCKED',
        warehouseId: inv.targetWarehouseId,
        warehouseName: inv.targetWarehouseName,
        createdAt: inv.createdAt,
      }));
    } catch {
      return [];
    }
  });

  api.get('/invoices/:id/movement-logs', async (req) => {
    try {
      const { id } = req.params as any;
      const invoice = await withScopedInvoice(String(id || ''), req);
      if (!invoice) return [];
      return await db.select().from(schema.invoiceMovements)
        .where(sql`${schema.invoiceMovements.invoiceId} = ${id}`)
        .orderBy(sql`${schema.invoiceMovements.createdAt} DESC`)
        .all();
    } catch {
      return [];
    }
  });
}
