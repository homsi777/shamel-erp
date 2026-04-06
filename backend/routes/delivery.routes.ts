import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { BASE_CURRENCY, normalizeCurrencyCode, normalizeExchangeRate, toBaseAmount, toTransactionAmount } from '../lib/currency';
import { createInvoiceLifecycleService } from '../services/invoiceLifecycle';
import { appError, isAppError } from '../lib/errors';
import { buildCompensationAppError, runCriticalCompensation } from '../lib/compensation';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  assertWarehouseAccess,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
  resolveWarehouseForContext,
} from '../lib/tenantScope';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, buildPartyStatement, getBackupDir, buildBackupPayload, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, adjustItemStockWithMovement, fs, path, getResolvedDbPath, closeDb, bcrypt, server, getLocalIp, auditLogger, systemEventLogger } = ctx as any;
  const invoiceLifecycle = createInvoiceLifecycleService(ctx as any);
  const getAuthContext = (req: any) => (req as any).authContext || {};

  const withScopedNotice = async (id: string, req: any) => {
    const notice = await db.select().from(schema.deliveryNotices).where(eq(schema.deliveryNotices.id, id)).get();
    if (!notice) return null;
    const authContext = getAuthContext(req);
    const companyId = String(authContext.companyId || '').trim();
    if (companyId) {
      assertEntityBelongsToCompany(notice, companyId, 'Not found');
      assertEntityBelongsToAllowedBranch(notice, authContext, 'Not found');
    }
    return notice;
  };

  const bindNoticePayloadToTenant = async (req: any, payload: Record<string, any>) => {
    const authContext = getAuthContext(req);
    const nextPayload = { ...payload };
    const scopedCompanyId = String(authContext.companyId || '').trim() || null;
    if (!scopedCompanyId) {
      throw appError(401, 'NO_COMPANY_CONTEXT', 'Company context is required.');
    }
    const warehouseId = String(nextPayload.warehouseId || '').trim();
    const contextBranchId = String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
    if (warehouseId) {
      const warehouse = await resolveWarehouseForContext(db, schema, eq, warehouseId);
      assertWarehouseAccess(warehouse, authContext);
      nextPayload.warehouseId = warehouseId;
      nextPayload.warehouseName = nextPayload.warehouseName || warehouse?.name || null;
      nextPayload.companyId = scopedCompanyId;
      nextPayload.branchId = String(warehouse?.branchId || contextBranchId || '').trim() || null;
    } else {
      nextPayload.companyId = scopedCompanyId;
      nextPayload.branchId = contextBranchId;
    }
    return nextPayload;
  };

const appendAudit = (notice: any, entry: any) => {
    const existing = safeJsonParse(notice.audit, []);
    return stringifyOrEmpty([...existing, entry]);
};

api.get('/delivery-notices', async (req) => {
    const q = req.query as any;
    const rows = filterRowsByTenantScope(
        await db.select().from(schema.deliveryNotices).orderBy(desc(schema.deliveryNotices.createdAt)).all(),
        getAuthContext(req),
        'delivery-notices',
    );
    let mapped = (rows || []).map((r: any) => ({ ...r, items: safeJsonParse(r.items, []), audit: safeJsonParse(r.audit, []) }));
    if (q?.status) {
      mapped = mapped.filter((r: any) => String(r.status || '').toUpperCase() === String(q.status).toUpperCase());
    }
    if (q?.createdById) {
      mapped = mapped.filter((r: any) => String(r.createdById || '') === String(q.createdById || ''));
    }
    if (q?.warehouseId) {
      mapped = mapped.filter((r: any) => String(r.warehouseId || '') === String(q.warehouseId || ''));
    }
    return mapped;
});

api.get('/reconciliation-marks', async (req) => {
    const q = req.query as any;
    let rows = filterRowsByTenantScope(
        await db.select().from(schema.reconciliationMarks).orderBy(desc(schema.reconciliationMarks.markAt)).all(),
        getAuthContext(req),
        'reconciliation-marks',
    );
    if (q?.scopeType) rows = rows.filter((r: any) => r.scopeType === q.scopeType);
    if (q?.scopeId) rows = rows.filter((r: any) => r.scopeId === q.scopeId);
    if (q?.reportType) rows = rows.filter((r: any) => r.reportType === q.reportType);
    return rows;
});

api.post('/delivery-notices', async (req, reply) => {
    try {
        const data = await bindNoticePayloadToTenant(req, req.body as any);
        const id = data.id || `dn-${Date.now()}`;
        const now = new Date().toISOString();
        const auditEntry = {
            action: 'CREATED',
            byId: data.createdById,
            byName: data.createdByName,
            at: now
        };
        await db.insert(schema.deliveryNotices).values({
            id,
            companyId: data.companyId || null,
            branchId: data.branchId || null,
            status: data.status || 'DRAFT',
            warehouseId: data.warehouseId,
            warehouseName: data.warehouseName,
            receiverType: data.receiverType,
            receiverId: data.receiverId,
            receiverName: data.receiverName,
            notes: data.notes,
            date: data.date || now,
            items: stringifyOrEmpty(data.items),
            audit: stringifyOrEmpty([auditEntry]),
            createdById: data.createdById,
            createdByName: data.createdByName,
            createdAt: now,
            updatedAt: now
        }).run();
        return { success: true, id };
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});


api.post('/reconciliation-marks', async (req, reply) => {
    try {
        const data = req.body as any;
        const authContext = getAuthContext(req);
        const scopedCompanyId = String(authContext.companyId || '').trim() || null;
        if (!scopedCompanyId) {
            return reply.status(401).send({ error: 'NO_COMPANY_CONTEXT' });
        }
        const id = data.id || `rm-${Date.now()}`;
        await db.insert(schema.reconciliationMarks).values({
            id,
            companyId: scopedCompanyId,
            branchId: String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null,
            scopeType: data.scopeType,
            scopeId: data.scopeId,
            reportType: data.reportType,
            markAt: data.markAt,
            rowRefId: data.rowRefId,
            note: data.note
        }).run();
        return { success: true, id };
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});


api.put('/delivery-notices/:id', async (req, reply) => {
    try {
        const { id } = req.params as any;
        const existing = await withScopedNotice(String(id || ''), req);
        if (!existing) return reply.status(404).send({ error: 'Not found' });
        if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
            return reply.status(400).send({ error: 'Cannot edit submitted notice.' });
        }
        const data = await bindNoticePayloadToTenant(req, req.body as any);
        const now = new Date().toISOString();
        const auditEntry = {
            action: 'UPDATED',
            byId: data.updatedById,
            byName: data.updatedByName,
            at: now
        };
        await db.update(schema.deliveryNotices).set({
            companyId: existing.companyId ?? data.companyId ?? null,
            branchId: existing.branchId ?? data.branchId ?? null,
            warehouseId: data.warehouseId,
            warehouseName: data.warehouseName,
            receiverType: data.receiverType,
            receiverId: data.receiverId,
            receiverName: data.receiverName,
            notes: data.notes,
            date: data.date,
            items: stringifyOrEmpty(data.items),
            managerNotes: data.managerNotes,
            referenceNumber: data.referenceNumber,
            operationType: data.operationType,
            convertToInvoice: data.convertToInvoice ? 1 : 0,
            updatedAt: now,
            audit: appendAudit(existing, auditEntry)
        }).where(eq(schema.deliveryNotices.id, id)).run();
        return { success: true };
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});


api.post('/delivery-notices/:id/submit', async (req, reply) => {
    try {
        const { id } = req.params as any;
        const existing = await withScopedNotice(String(id || ''), req);
        if (!existing) return reply.status(404).send({ error: 'Not found' });
        if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
            return reply.status(400).send({ error: 'Invalid status transition.' });
        }
        const data = req.body as any;
        const now = new Date().toISOString();
        const auditEntry = {
            action: 'SUBMITTED',
            byId: data.submittedById,
            byName: data.submittedByName,
            at: now
        };
        await db.update(schema.deliveryNotices).set({
            status: 'SUBMITTED',
            submittedById: data.submittedById,
            submittedByName: data.submittedByName,
            submittedAt: now,
            updatedAt: now,
            audit: appendAudit(existing, auditEntry)
        }).where(eq(schema.deliveryNotices.id, id)).run();
        return { success: true };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});


api.post('/delivery-notices/:id/reject', async (req, reply) => {
    try {
        const { id } = req.params as any;
        const data = req.body as any;
        if (!data.reason) return reply.status(400).send({ error: 'Reject reason required.' });
        const existing = await withScopedNotice(String(id || ''), req);
        if (!existing) return reply.status(404).send({ error: 'Not found' });
        if (existing.status !== 'SUBMITTED') {
            return reply.status(400).send({ error: 'Invalid status transition.' });
        }
        const now = new Date().toISOString();
        const auditEntry = {
            action: 'REJECTED',
            byId: data.rejectedById,
            byName: data.rejectedByName,
            at: now,
            reason: data.reason
        };
        await db.update(schema.deliveryNotices).set({
            status: 'REJECTED',
            rejectedById: data.rejectedById,
            rejectedByName: data.rejectedByName,
            rejectedAt: now,
            rejectReason: data.reason,
            updatedAt: now,
            audit: appendAudit(existing, auditEntry)
        }).where(eq(schema.deliveryNotices.id, id)).run();
        return { success: true };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});


api.post('/delivery-notices/:id/confirm', async (req, reply) => {
    try {
        const { id } = req.params as any;
        const data = req.body as any;
        const existing = await withScopedNotice(String(id || ''), req);
        if (!existing) return reply.status(404).send({ error: 'Not found' });
        if (existing.status !== 'SUBMITTED') {
            return reply.status(400).send({ error: 'Invalid status transition.' });
        }

        const authContext = getAuthContext(req);
        const warehouse = await resolveWarehouseForContext(db, schema, eq, String(existing.warehouseId || ''));
        assertWarehouseAccess(warehouse, authContext);
        const eventCompanyId = String(existing.companyId || authContext.companyId || '').trim() || null;
        const eventBranchId = String(existing.branchId || existing.branch_id || warehouse?.branchId || authContext.branchId || '').trim() || null;

        const items = safeJsonParse(existing.items, []);
        const incompleteTextileLines = items.filter((item: any) => {
            if (!item?.isTextile) return false;
            const rollCount = Number(item.textileRollCount || item.quantity || 0);
            const decomposition = Array.isArray(item.textileDecomposition) ? item.textileDecomposition : [];
            if (rollCount <= 0) return true;
            if (decomposition.length !== rollCount) return true;
            return decomposition.some((entry: any) => Number(entry?.length || 0) <= 0);
        });
        if (incompleteTextileLines.length > 0) {
            return reply.status(400).send({
                error: 'TEXTILE_DECOMPOSITION_REQUIRED',
                lines: incompleteTextileLines.map((item: any) => ({ itemId: item.itemId, itemName: item.itemName })),
            });
        }
        const shortages: any[] = [];
        for (const item of items) {
            const invItem = await db.select().from(schema.items)
                .where(sql`${schema.items.id} = ${item.itemId} AND ${schema.items.warehouseId} = ${existing.warehouseId}`)
                .get();
            if (invItem) {
                assertEntityBelongsToCompany(invItem, String(authContext.companyId || ''), 'Item not found.');
                assertEntityBelongsToAllowedBranch(invItem, authContext, 'Item not found.');
            }
            const available = Number(invItem?.quantity || 0);
            if (!invItem || available < Number(item.quantity || 0)) {
                shortages.push({ itemId: item.itemId, itemName: item.itemName, available, requested: Number(item.quantity || 0) });
            }
        }
        if (shortages.length > 0) {
            return reply.status(409).send({ error: 'INSUFFICIENT_STOCK', shortages });
        }

        const now = new Date().toISOString();
        const auditEntry = {
            action: 'CONFIRMED',
            byId: data.confirmedById,
            byName: data.confirmedByName,
            at: now
        };
        const noticePatch = {
            status: 'CONFIRMED',
            managerNotes: data.managerNotes,
            referenceNumber: data.referenceNumber,
            operationType: data.operationType,
            convertToInvoice: data.convertToInvoice ? 1 : 0,
            confirmedById: data.confirmedById,
            confirmedByName: data.confirmedByName,
            confirmedAt: now,
            updatedAt: now,
            audit: appendAudit(existing, auditEntry)
        } as any;
        const restoreNotice = async () => {
            await db.update(schema.deliveryNotices).set({
                companyId: existing.companyId || null,
                branchId: existing.branchId || null,
                status: existing.status,
                managerNotes: existing.managerNotes || null,
                referenceNumber: existing.referenceNumber || null,
                operationType: existing.operationType || null,
                convertToInvoice: Number(existing.convertToInvoice || 0),
                linkedInvoiceId: existing.linkedInvoiceId || null,
                confirmedById: existing.confirmedById || null,
                confirmedByName: existing.confirmedByName || null,
                confirmedAt: existing.confirmedAt || null,
                updatedAt: existing.updatedAt || null,
                audit: existing.audit || null,
            }).where(eq(schema.deliveryNotices.id, id)).run();
        };

        let linkedInvoiceId: string | undefined = data.linkedInvoiceId;
        let createdInvoiceId: string | undefined;
        if (data.convertToInvoice && data.receiverId) {
            const inventory = filterRowsByTenantScope(await db.select().from(schema.items).all(), authContext, 'items');
            const invoiceItems = items.map((it: any) => {
                let unitPrice = Number(it.unitPrice || 0);
                if (!unitPrice && it.itemId) {
                    const invItem = inventory.find((i: any) => i.id === it.itemId);
                    unitPrice = Number(invItem?.salePrice || 0);
                }
                const textileTotalLength = Number(
                    it.textileTotalLength
                    || (Array.isArray(it.textileDecomposition) ? it.textileDecomposition.reduce((sum: number, entry: any) => sum + Number(entry?.length || 0), 0) : 0)
                    || 0
                );
                const quantity = it.isTextile ? textileTotalLength : Number(it.quantity || 0);
                return {
                    itemId: it.itemId,
                    itemName: it.itemName,
                    unitName: it.isTextile ? (it.textileBaseUom === 'yard' ? 'ياردة' : 'متر') : it.unitName,
                    quantity,
                    unitPrice,
                    total: quantity * unitPrice,
                    isTextile: Boolean(it.isTextile),
                    textileColorId: it.textileColorId || undefined,
                    textileColorName: it.textileColorName || undefined,
                    textileRollCount: Number(it.textileRollCount || it.quantity || 0),
                    textileTotalLength,
                    textileBaseUom: it.textileBaseUom || 'meter',
                    textileDecompositionPayload: Array.isArray(it.textileDecomposition)
                        ? it.textileDecomposition.map((entry: any, index: number) => ({
                            sequence: Number(entry?.idx || index + 1),
                            lengthValue: Number(entry?.length || 0),
                            unit: entry?.unit || it.textileBaseUom || 'meter',
                            rollLabel: entry?.rollLabel || undefined,
                        }))
                        : undefined,
                };
            });
            const currency = normalizeCurrencyCode(data.currency || BASE_CURRENCY);
            const exchangeRate = normalizeExchangeRate(currency, data.exchangeRate);
            const created = await invoiceLifecycle.createInvoice({
                id: `inv-${Date.now()}`,
                invoiceNumber: data.invoiceNumber,
                type: 'sale',
                clientId: data.receiverId,
                clientName: data.receiverName,
                date: now,
                items: invoiceItems,
                paymentType: 'credit',
                currency,
                exchangeRate,
                targetWarehouseId: existing.warehouseId,
                targetWarehouseName: existing.warehouseName,
                createdById: data.confirmedById,
                createdByName: data.confirmedByName,
                notes: data.notes || existing.notes || '',
                companyId: existing.companyId || authContext.companyId || null,
                branchId: existing.branchId || existing.branch_id || warehouse?.branchId || authContext.branchId || null,
                sourceDocumentType: 'delivery_notice',
                sourceDocumentId: id,
            }, authContext);
            linkedInvoiceId = created.id;
            createdInvoiceId = created.id;
            try {
                await db.update(schema.deliveryNotices).set({
                    ...noticePatch,
                    linkedInvoiceId,
                }).where(eq(schema.deliveryNotices.id, id)).run();
                await auditLogger.log({
                    userId: data.confirmedById || 'system',
                    operationType: 'delivery.confirm',
                    affectedItems: [{ deliveryNoticeId: id }],
                    oldValues: { status: existing.status, linkedInvoiceId: existing.linkedInvoiceId || null },
                    newValues: { status: 'CONFIRMED', linkedInvoiceId: linkedInvoiceId || null },
                    meta: { convertToInvoice: true, receiverId: data.receiverId || null },
                    mandatory: true,
                });
            } catch (error: any) {
                const compensation = await runCriticalCompensation({
                    operationType: 'delivery.confirm',
                    userId: data.confirmedById || 'system',
                    companyId: eventCompanyId,
                    branchId: eventBranchId,
                    affectedDocumentType: 'delivery_notice',
                    affectedDocumentId: id,
                    primaryError: error,
                    auditLogger,
                    systemEventLogger,
                    steps: [
                        {
                            key: 'notice_restore',
                            forceKey: 'delivery.notice_restore',
                            failureCode: 'DELIVERY_NOTICE_RESTORE_FAILED',
                            run: () => restoreNotice(),
                        },
                        ...(createdInvoiceId ? [{
                            key: 'invoice_cancel',
                            forceKey: 'delivery.invoice_cancel',
                            failureCode: 'DELIVERY_INVOICE_CANCEL_FAILED',
                            run: () => invoiceLifecycle.cancelInvoice(createdInvoiceId, { userId: data.confirmedById || 'system' }),
                        }] : []),
                    ],
                });
                if (compensation.requiresManualReview) {
                    throw buildCompensationAppError({
                        statusCode: 500,
                        code: 'DELIVERY_CONFIRM_COMPENSATION_FAILED',
                        message: 'Delivery confirmation failed and compensation requires manual review.',
                        primaryError: error,
                        compensation,
                        affectedDocumentType: 'delivery_notice',
                        affectedDocumentId: id,
                    });
                }
                throw error;
            }
        } else {
            let stockCommitted = false;
            try {
                await db.transaction(async (tx: any) => {
                    for (const item of items) {
                        await adjustItemStockWithMovement(tx, {
                            itemId: String(item.itemId || ''),
                            warehouseId: String(existing.warehouseId || ''),
                            warehouseName: existing.warehouseName || null,
                            unitId: item.unitId || null,
                            unitName: item.unitName || null,
                            qtyDelta: -Number(item.quantity || 0),
                            baseQtyDelta: -Number(item.baseQuantity ?? item.quantity ?? 0),
                            meta: {
                                documentType: 'DELIVERY_NOTICE',
                                documentId: id,
                                documentNumber: existing.referenceNumber || existing.id,
                                movementType: 'delivery_confirm',
                                userId: data.confirmedById || null,
                                userName: data.confirmedByName || null,
                                notes: existing.notes || null,
                            },
                        });
                    }
                    await tx.update(schema.deliveryNotices).set({
                        ...noticePatch,
                        linkedInvoiceId: linkedInvoiceId || null,
                    }).where(eq(schema.deliveryNotices.id, id)).run();
                });
                stockCommitted = true;
                await auditLogger.log({
                    userId: data.confirmedById || 'system',
                    operationType: 'delivery.confirm',
                    affectedItems: [{ deliveryNoticeId: id }],
                    oldValues: { status: existing.status, linkedInvoiceId: existing.linkedInvoiceId || null },
                    newValues: { status: 'CONFIRMED', linkedInvoiceId: linkedInvoiceId || null },
                    meta: { convertToInvoice: false, receiverId: data.receiverId || null },
                    mandatory: true,
                });
            } catch (error: any) {
                const compensation = await runCriticalCompensation({
                    operationType: 'delivery.confirm',
                    userId: data.confirmedById || 'system',
                    companyId: eventCompanyId,
                    branchId: eventBranchId,
                    affectedDocumentType: 'delivery_notice',
                    affectedDocumentId: id,
                    primaryError: error,
                    auditLogger,
                    systemEventLogger,
                    steps: [
                        ...(stockCommitted ? [{
                            key: 'stock_rollback',
                            forceKey: 'delivery.stock_rollback',
                            failureCode: 'DELIVERY_STOCK_ROLLBACK_FAILED',
                            run: () => db.transaction(async (tx: any) => {
                                for (const item of items) {
                                    await adjustItemStockWithMovement(tx, {
                                        itemId: String(item.itemId || ''),
                                        warehouseId: String(existing.warehouseId || ''),
                                        warehouseName: existing.warehouseName || null,
                                        unitId: item.unitId || null,
                                        unitName: item.unitName || null,
                                        qtyDelta: Number(item.quantity || 0),
                                        baseQtyDelta: Number(item.baseQuantity ?? item.quantity ?? 0),
                                        meta: {
                                            documentType: 'DELIVERY_NOTICE',
                                            documentId: id,
                                            documentNumber: existing.referenceNumber || existing.id,
                                            movementType: 'delivery_confirm_rollback',
                                            userId: data.confirmedById || null,
                                            userName: data.confirmedByName || null,
                                            notes: existing.notes || null,
                                        },
                                    });
                                }
                            }),
                        }] : []),
                        {
                            key: 'notice_restore',
                            forceKey: 'delivery.notice_restore',
                            failureCode: 'DELIVERY_NOTICE_RESTORE_FAILED',
                            run: () => restoreNotice(),
                        },
                    ],
                });
                if (compensation.requiresManualReview) {
                    throw buildCompensationAppError({
                        statusCode: 500,
                        code: 'DELIVERY_CONFIRM_COMPENSATION_FAILED',
                        message: 'Delivery confirmation failed and compensation requires manual review.',
                        primaryError: error,
                        compensation,
                        affectedDocumentType: 'delivery_notice',
                        affectedDocumentId: id,
                    });
                }
                throw error;
            }
        }

        await systemEventLogger?.log({
            eventType: 'DELIVERY_CONFIRM',
            companyId: eventCompanyId,
            branchId: eventBranchId,
            severity: 'info',
            sourceModule: 'delivery',
            action: 'confirm',
            status: 'success',
            affectedDocumentType: 'delivery_notice',
            affectedDocumentId: id,
            metadata: {
                convertToInvoice: Boolean(data.convertToInvoice),
                linkedInvoiceId: linkedInvoiceId || null,
                receiverId: data.receiverId || null,
            },
        });
        return { success: true, linkedInvoiceId };
    } catch (e: any) {
        await auditLogger.log({
            userId: String((req as any)?.authContext?.userId || (req.body as any)?.confirmedById || 'system'),
            operationType: 'delivery.confirm.failed',
            affectedItems: [{ deliveryNoticeId: (req.params as any)?.id || null }],
            meta: { error: e?.message || 'UNKNOWN' },
        });
        await systemEventLogger?.log({
            eventType: 'DELIVERY_CONFIRM',
            companyId: String((req as any)?.authContext?.companyId || '').trim() || null,
            branchId: String((req as any)?.authContext?.branchId || '').trim() || null,
            severity: e?.details?.requires_manual_review ? 'critical' : 'error',
            sourceModule: 'delivery',
            action: 'confirm',
            status: e?.details?.compensation_status === 'completed'
                ? 'compensated'
                : e?.details?.compensation_status === 'partial_failure' || e?.details?.compensation_status === 'partial'
                    ? 'partial'
                    : 'failed',
            errorCode: String(e?.code || 'DELIVERY_CONFIRM_FAILED'),
            requiresManualReview: Boolean(e?.details?.requires_manual_review),
            affectedDocumentType: 'delivery_notice',
            affectedDocumentId: String((req.params as any)?.id || ''),
            compensationStatus: e?.details?.compensation || null,
            metadata: {
                message: e?.message || 'Delivery confirmation failed.',
                details: e?.details || null,
                convertToInvoice: Boolean((req.body as any)?.convertToInvoice),
            },
        });
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});

api.post('/delivery-notices/:id/warehouse-prepare', async (req, reply) => {
    try {
        const { id } = req.params as any;
        const data = req.body as any;
        const existing = await withScopedNotice(String(id || ''), req);
        if (!existing) return reply.status(404).send({ error: 'Not found' });
        if (existing.status !== 'SUBMITTED') {
            return reply.status(400).send({ error: 'Invalid status transition.' });
        }
        const now = new Date().toISOString();
        const auditEntry = {
            action: 'WAREHOUSE_PREPARED',
            byId: data.preparedById,
            byName: data.preparedByName,
            at: now
        };
        await db.update(schema.deliveryNotices).set({
            items: stringifyOrEmpty(Array.isArray(data.items) ? data.items : safeJsonParse(existing.items, [])),
            updatedAt: now,
            audit: appendAudit(existing, auditEntry)
        }).where(eq(schema.deliveryNotices.id, id)).run();
        return { success: true };
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});

// --- Agents (Mobile Warehouses) ---
}
