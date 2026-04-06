import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { getNextDocNumber } from './_common';
import { appError, isAppError } from '../lib/errors';
import {
  assertDispatchStatus,
  buildDispatchLineInvoicePayload,
  buildTextileDispatchPrintPayload,
  ensureTextileColor,
  findDispatchWithDetails,
  getTextileInventoryBalances,
  isTextileItem,
  sumTextileDecomposition,
} from '../services/textileService';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  assertWarehouseAccess,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
  resolveWarehouseForContext,
} from '../lib/tenantScope';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import { createInvoiceLifecycleService } from '../services/invoiceLifecycle';

const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeStatus = (value: any) => String(value || '').trim().toLowerCase();

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, and, desc, auditLogger, systemEventLogger } = ctx as any;
  const invoiceLifecycle = createInvoiceLifecycleService(ctx as any);

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const scopedCompanyId = (req: any) => {
    const companyId = String(getAuthContext(req).companyId || '').trim();
    if (!companyId) throw appError(401, 'NO_COMPANY_CONTEXT', 'Company context is required.');
    return companyId;
  };

  const scopedBranchId = (req: any) =>
    String(pickEffectiveBranchId(undefined, getAuthContext(req)) || '').trim() || null;

  const withScopedDispatch = async (id: string, req: any) => {
    const bundle = await findDispatchWithDetails(db, schema, id);
    if (!bundle) return null;
    const authContext = getAuthContext(req);
    const companyId = scopedCompanyId(req);
    assertEntityBelongsToCompany(bundle.notice, companyId, 'Dispatch not found.');
    assertEntityBelongsToAllowedBranch(bundle.notice, authContext, 'Dispatch not found.');
    return bundle;
  };

  const ensureWarehouse = async (warehouseId: string, req: any) => {
    const warehouse = await resolveWarehouseForContext(db, schema, eq, warehouseId);
    const authContext = getAuthContext(req);
    assertWarehouseAccess(warehouse, authContext);
    assertEntityBelongsToCompany(warehouse, scopedCompanyId(req), 'Warehouse not found.');
    return warehouse;
  };

  api.get('/textile/colors', async (req, reply) => {
    try {
      const companyId = scopedCompanyId(req);
      const rows = await db.select().from(schema.textileColors)
        .where(eq(schema.textileColors.companyId, companyId))
        .orderBy(desc(schema.textileColors.updatedAt))
        .all();
      return rows;
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_COLORS_FETCH_FAILED' });
    }
  });

  api.post('/textile/colors', async (req, reply) => {
    try {
      const body = (req.body || {}) as any;
      const companyId = scopedCompanyId(req);
      const color = await ensureTextileColor(db, schema, companyId, body);
      return reply.status(201).send(color);
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_COLOR_CREATE_FAILED' });
    }
  });

  api.get('/textile/inventory', async (req, reply) => {
    try {
      const query = (req.query || {}) as any;
      const balances = await getTextileInventoryBalances(db, schema, {
        companyId: scopedCompanyId(req),
        branchId: String(query.branchId || scopedBranchId(req) || '').trim() || undefined,
        warehouseId: String(query.warehouseId || '').trim() || undefined,
        itemId: String(query.itemId || '').trim() || undefined,
        colorId: String(query.colorId || '').trim() || undefined,
        textileOnly: true,
      });
      return balances;
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_INVENTORY_FETCH_FAILED' });
    }
  });

  api.get('/textile/dispatches', async (req, reply) => {
    try {
      const query = (req.query || {}) as any;
      const rows = filterRowsByTenantScope(
        await db.select().from(schema.warehouseDispatchNotices).orderBy(desc(schema.warehouseDispatchNotices.createdAt)).all(),
        getAuthContext(req),
        'warehouse-dispatch-notices',
      );
      const status = normalizeStatus(query.status);
      return rows.filter((row: any) => !status || normalizeStatus(row.status) === status);
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCHES_FETCH_FAILED' });
    }
  });

  api.get('/textile/dispatches/:id', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      return {
        ...bundle.notice,
        lines: bundle.lines,
        decompositions: bundle.decompositions,
      };
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_FETCH_FAILED' });
    }
  });

  api.post('/textile/dispatches', async (req, reply) => {
    try {
      const body = (req.body || {}) as any;
      const companyId = scopedCompanyId(req);
      const authContext = getAuthContext(req);
      const warehouse = await ensureWarehouse(String(body.warehouseId || ''), req);
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length) {
        throw appError(400, 'TEXTILE_DISPATCH_LINES_REQUIRED', 'At least one textile dispatch line is required.');
      }

      const now = new Date().toISOString();
      const noticeId = uniqueId('tdn');
      const dispatchNumber = String(body.dispatchNumber || await getNextDocNumber('sale', {
        companyId,
        branchId: String((warehouse as any)?.branchId || scopedBranchId(req) || '').trim() || null,
      }));

      await db.insert(schema.warehouseDispatchNotices).values({
        id: noticeId,
        companyId,
        branchId: String((warehouse as any)?.branchId || scopedBranchId(req) || '').trim() || null,
        warehouseId: String(warehouse.id),
        warehouseName: warehouse.name || null,
        customerId: String(body.customerId || '').trim() || null,
        customerName: String(body.customerName || '').trim() || null,
        sourceDocumentType: String(body.sourceDocumentType || '').trim() || null,
        sourceDocumentId: String(body.sourceDocumentId || '').trim() || null,
        dispatchNumber,
        status: 'draft',
        requestedBy: String(authContext.userId || body.requestedBy || '').trim() || null,
        requestedByName: String(authContext.username || body.requestedByName || '').trim() || null,
        requestedAt: now,
        notes: String(body.notes || '').trim() || null,
        createdAt: now,
        updatedAt: now,
      }).run();

      for (const rawLine of lines) {
        const item = await db.select().from(schema.items).where(eq(schema.items.id, String(rawLine.itemId || ''))).get();
        if (!item) throw appError(404, 'TEXTILE_ITEM_NOT_FOUND', 'Textile item not found.');
        assertEntityBelongsToCompany(item, companyId, 'Textile item not found.');
        assertEntityBelongsToAllowedBranch(item, authContext, 'Textile item not found.');
        if (!isTextileItem(item)) {
          throw appError(400, 'TEXTILE_ITEM_REQUIRED', 'Only textile items can be used in textile dispatch notices.');
        }
        const color = await ensureTextileColor(db, schema, companyId, {
          id: rawLine.colorId,
          name: rawLine.colorName,
          code: rawLine.colorCode,
        });
        await db.insert(schema.warehouseDispatchNoticeLines).values({
          id: uniqueId('tdnl'),
          noticeId,
          companyId,
          branchId: String((warehouse as any)?.branchId || scopedBranchId(req) || '').trim() || null,
          warehouseId: String(warehouse.id),
          itemId: String(item.id),
          itemName: String(item.name || rawLine.itemName || ''),
          colorId: String(color.id),
          colorName: String(color.name || ''),
          requestedRollCount: Number(rawLine.requestedRollCount || rawLine.rollCount || 0),
          fulfilledRollCount: 0,
          fulfilledTotalLength: 0,
          baseUom: String((item as any).textileBaseUom || rawLine.baseUom || 'meter'),
          textileUnitPricePerLength: Number(rawLine.textileUnitPricePerLength || rawLine.unitPrice || 0),
          lineStatus: 'draft',
          notes: String(rawLine.notes || '').trim() || null,
          createdAt: now,
          updatedAt: now,
        }).run();
      }

      await auditLogger?.log({
        userId: String(authContext.userId || 'system'),
        operationType: 'textile.dispatch.create',
        affectedItems: [{ dispatchId: noticeId, dispatchNumber }],
        newValues: body,
      });
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.ITEM_CREATED,
        severity: 'info',
        sourceModule: 'textile_dispatch',
        action: 'dispatch.create',
        status: 'success',
        affectedDocumentType: 'warehouse_dispatch_notice',
        affectedDocumentId: noticeId,
        metadata: { dispatchNumber },
      });

      return reply.status(201).send({ success: true, id: noticeId, dispatchNumber });
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_CREATE_FAILED' });
    }
  });

  api.post('/textile/dispatches/:id/send', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      assertDispatchStatus(bundle.notice.status, ['draft', 'rejected'], 'Only draft or rejected dispatches can be sent to warehouse.');
      const now = new Date().toISOString();
      await db.update(schema.warehouseDispatchNotices).set({
        status: 'sent_to_warehouse',
        updatedAt: now,
      }).where(eq(schema.warehouseDispatchNotices.id, bundle.notice.id)).run();
      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_SEND_FAILED' });
    }
  });

  api.post('/textile/dispatches/:id/start-preparation', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      assertDispatchStatus(bundle.notice.status, ['sent_to_warehouse', 'in_preparation'], 'Dispatch cannot enter preparation from this status.');
      const auth = getAuthContext(req);
      const now = new Date().toISOString();
      await db.update(schema.warehouseDispatchNotices).set({
        status: 'in_preparation',
        preparedBy: String(auth.userId || '').trim() || bundle.notice.preparedBy || null,
        preparedByName: String(auth.username || '').trim() || bundle.notice.preparedByName || null,
        updatedAt: now,
      }).where(eq(schema.warehouseDispatchNotices.id, bundle.notice.id)).run();
      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_START_FAILED' });
    }
  });

  api.post('/textile/dispatches/:id/prepare', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      assertDispatchStatus(bundle.notice.status, ['sent_to_warehouse', 'in_preparation', 'rejected'], 'Dispatch cannot be prepared from this status.');
      const body = (req.body || {}) as any;
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length) throw appError(400, 'TEXTILE_PREPARATION_REQUIRED', 'Prepared lines are required.');

      const auth = getAuthContext(req);
      const now = new Date().toISOString();
      await db.transaction(async (tx: any) => {
        for (const linePatch of lines) {
          const existingLine = bundle.lines.find((entry: any) => String(entry.id) === String(linePatch.lineId || ''));
          if (!existingLine) throw appError(404, 'TEXTILE_DISPATCH_LINE_NOT_FOUND', 'Dispatch line not found.');
          const decomposition = sumTextileDecomposition(linePatch.decomposition, existingLine.baseUom);
          const requestedRollCount = Number(existingLine.requestedRollCount || 0);
          if (decomposition.count !== Math.round(requestedRollCount)) {
            throw appError(400, 'TEXTILE_DECOMPOSITION_INCOMPLETE', 'Decomposition rows must match requested roll count.');
          }
          if (decomposition.entries.some((entry: any) => !entry.unit || entry.length <= 0)) {
            throw appError(400, 'TEXTILE_DECOMPOSITION_INVALID', 'Each decomposed roll must have a valid positive length.');
          }
          await tx.delete(schema.warehouseDispatchNoticeLineDecompositions).where(eq(schema.warehouseDispatchNoticeLineDecompositions.lineId, existingLine.id)).run();
          for (const entry of decomposition.entries) {
            await tx.insert(schema.warehouseDispatchNoticeLineDecompositions).values({
              id: uniqueId('tdnd'),
              noticeId: bundle.notice.id,
              lineId: existingLine.id,
              companyId: bundle.notice.companyId || null,
              branchId: bundle.notice.branchId || null,
              sequence: Number(entry.sequence || 0),
              lengthValue: Number(entry.length || 0),
              unit: String(entry.unit || existingLine.baseUom || ''),
              rollLabel: entry.rollLabel || null,
              createdAt: now,
              updatedAt: now,
            }).run();
          }
          await tx.update(schema.warehouseDispatchNoticeLines).set({
            fulfilledRollCount: requestedRollCount,
            fulfilledTotalLength: Number(decomposition.totalLength || 0),
            lineStatus: 'prepared',
            updatedAt: now,
          }).where(eq(schema.warehouseDispatchNoticeLines.id, existingLine.id)).run();
        }
        await tx.update(schema.warehouseDispatchNotices).set({
          status: 'awaiting_approval',
          preparedBy: String(auth.userId || bundle.notice.preparedBy || '').trim() || null,
          preparedByName: String(auth.username || bundle.notice.preparedByName || '').trim() || null,
          preparedAt: now,
          updatedAt: now,
        }).where(eq(schema.warehouseDispatchNotices.id, bundle.notice.id)).run();
      });

      await auditLogger?.log({
        userId: String(auth.userId || 'system'),
        operationType: 'textile.dispatch.prepare',
        affectedItems: [{ dispatchId: bundle.notice.id }],
        newValues: body,
      });

      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_PREPARE_FAILED' });
    }
  });

  api.post('/textile/dispatches/:id/approve', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      assertDispatchStatus(bundle.notice.status, ['awaiting_approval', 'prepared'], 'Dispatch is not ready for approval.');
      if (bundle.lines.some((line: any) => Number(line.fulfilledRollCount || 0) <= 0 || Number(line.fulfilledTotalLength || 0) <= 0)) {
        throw appError(400, 'TEXTILE_PREPARATION_REQUIRED', 'All textile lines must be fully prepared before approval.');
      }
      const auth = getAuthContext(req);
      const now = new Date().toISOString();
      await db.update(schema.warehouseDispatchNotices).set({
        status: 'approved',
        approvedBy: String(auth.userId || '').trim() || null,
        approvedByName: String(auth.username || '').trim() || null,
        approvedAt: now,
        updatedAt: now,
      }).where(eq(schema.warehouseDispatchNotices.id, bundle.notice.id)).run();
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.DELIVERY_CONFIRM,
        severity: 'info',
        sourceModule: 'textile_dispatch',
        action: 'dispatch.approve',
        status: 'success',
        affectedDocumentType: 'warehouse_dispatch_notice',
        affectedDocumentId: bundle.notice.id,
      });
      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_APPROVE_FAILED' });
    }
  });

  api.post('/textile/dispatches/:id/reject', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      assertDispatchStatus(bundle.notice.status, ['awaiting_approval', 'prepared', 'sent_to_warehouse', 'in_preparation'], 'Dispatch cannot be rejected from this status.');
      const body = (req.body || {}) as any;
      if (!String(body.reason || '').trim()) throw appError(400, 'TEXTILE_REJECT_REASON_REQUIRED', 'Reject reason is required.');
      const auth = getAuthContext(req);
      const now = new Date().toISOString();
      await db.update(schema.warehouseDispatchNotices).set({
        status: 'rejected',
        rejectedBy: String(auth.userId || '').trim() || null,
        rejectedByName: String(auth.username || '').trim() || null,
        rejectedAt: now,
        rejectedReason: String(body.reason || '').trim(),
        updatedAt: now,
      }).where(eq(schema.warehouseDispatchNotices.id, bundle.notice.id)).run();
      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_REJECT_FAILED' });
    }
  });

  api.post('/textile/dispatches/:id/convert-to-invoice', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      assertDispatchStatus(bundle.notice.status, ['approved'], 'Only approved dispatches can be converted to invoice.');
      if (bundle.notice.linkedInvoiceId) {
        throw appError(409, 'TEXTILE_DISPATCH_ALREADY_CONVERTED', 'Dispatch has already been converted to invoice.', {
          linked_invoice_id: bundle.notice.linkedInvoiceId,
        });
      }

      const auth = getAuthContext(req);
      const body = (req.body || {}) as any;
      const invoiceItems = bundle.lines.map((line: any) =>
        buildDispatchLineInvoicePayload(line, bundle.decompositionsByLine.get(String(line.id)) || []),
      );
      const totalAmount = invoiceItems.reduce((sum: number, line: any) => sum + Number(line.total || 0), 0);
      const invoiceNumber = String(body.invoiceNumber || await getNextDocNumber('sale', {
        companyId: bundle.notice.companyId || scopedCompanyId(req),
        branchId: bundle.notice.branchId || scopedBranchId(req),
      }));

      const result = await invoiceLifecycle.createInvoice({
        invoiceNumber,
        type: 'sale',
        date: body.date || new Date().toISOString().slice(0, 10),
        clientId: bundle.notice.customerId || null,
        clientName: bundle.notice.customerName || null,
        currency: body.currency || 'USD',
        paymentType: body.paymentType || 'cash',
        paidAmount: body.paidAmount ?? totalAmount,
        remainingAmount: body.remainingAmount ?? 0,
        totalAmount,
        targetWarehouseId: bundle.notice.warehouseId,
        targetWarehouseName: bundle.notice.warehouseName,
        companyId: bundle.notice.companyId || scopedCompanyId(req),
        branchId: bundle.notice.branchId || scopedBranchId(req),
        sourceDocumentType: 'warehouse_dispatch_notice',
        sourceDocumentId: bundle.notice.id,
        notes: body.notes || bundle.notice.notes || null,
        items: invoiceItems,
        createdById: String(auth.userId || '').trim() || null,
        createdByName: String(auth.username || '').trim() || null,
        createdByRole: String(auth.role || '').trim() || null,
      }, auth);

      const now = new Date().toISOString();
      await db.update(schema.warehouseDispatchNotices).set({
        status: 'converted_to_invoice',
        linkedInvoiceId: String(result.id || ''),
        convertedBy: String(auth.userId || '').trim() || null,
        convertedByName: String(auth.username || '').trim() || null,
        convertedAt: now,
        updatedAt: now,
      }).where(eq(schema.warehouseDispatchNotices.id, bundle.notice.id)).run();

      return { success: true, linkedInvoiceId: result.id, invoiceNumber };
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_CONVERT_FAILED' });
    }
  });

  api.post('/textile/dispatches/:id/cancel', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      assertDispatchStatus(bundle.notice.status, ['draft', 'rejected', 'sent_to_warehouse'], 'Dispatch cannot be cancelled from this status.');
      await db.update(schema.warehouseDispatchNotices).set({
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.warehouseDispatchNotices.id, bundle.notice.id)).run();
      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_CANCEL_FAILED' });
    }
  });

  api.get('/textile/dispatches/:id/print-payload', async (req, reply) => {
    try {
      const bundle = await withScopedDispatch(String((req.params as any).id || ''), req);
      if (!bundle) return reply.status(404).send({ error: 'Dispatch not found.' });
      return buildTextileDispatchPrintPayload(bundle.notice, bundle.lines, bundle.decompositionsByLine);
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      return reply.status(500).send({ error: error?.message || 'TEXTILE_DISPATCH_PRINT_FAILED' });
    }
  });
}
