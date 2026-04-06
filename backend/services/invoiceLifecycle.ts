import { resolvePrice } from '../pricingService';
import { BASE_CURRENCY, normalizeCurrencyCode, normalizeExchangeRate, normalizeInvoiceLineMoney, normalizeInvoiceMoney } from '../lib/currency';
import { computeLineCommission, validateCommissionRule, validateInvoiceDataIntegrity, validateInvoiceEdgeCases } from '../lib/invoiceValidation';
import { appError } from '../lib/errors';
import { buildCompensationAppError, runCriticalCompensation } from '../lib/compensation';
import { loadNormalizedSettingsMap } from '../lib/settings';
import { allocateNextQueueInTransaction, parseRestaurantQueueFromPrintSettings } from './queueService';
import { createVoucherLifecycleService } from './voucherLifecycle';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  normalizeTenantId,
  pickEffectiveBranchId,
  resolveEntityBranchId,
  resolveEntityCompanyId,
} from '../lib/tenantScope';
import { adjustTextileStock, normalizeTextileInvoiceLine } from './textileService';

const parseSerialNumbers = (line: any): string[] => {
  const source = line?.serialNumbers ?? line?.serials ?? [];
  if (Array.isArray(source)) return source.map((value: any) => String(value || '').trim()).filter(Boolean);
  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      return Array.isArray(parsed) ? parsed.map((value: any) => String(value || '').trim()).filter(Boolean) : [];
    } catch {
      return source.split(/\r?\n|,/).map((value) => String(value || '').trim()).filter(Boolean);
    }
  }
  return [];
};

const getQtySign = (type: string, returnType: string) => {
  const invType = String(type || '').toLowerCase();
  const retType = String(returnType || '').toLowerCase();
  if (invType === 'sale') return -1;
  if (invType === 'purchase' || invType === 'opening_stock') return 1;
  if (invType === 'return') return retType === 'purchase' ? -1 : 1;
  if (invType === 'exchange') return retType === 'purchase' ? -1 : 1;
  return 0;
};

const assertCompanyConsistency = (
  entityLabel: string,
  entity: any,
  companyId: string,
  notFoundMessage: string,
) => {
  const entityCompanyId = resolveEntityCompanyId(entity);
  if (!entityCompanyId) return;
  if (entityCompanyId !== companyId) {
    throw appError(404, 'ENTITY_OUTSIDE_COMPANY', notFoundMessage, {
      entity: entityLabel,
      expected_company_id: companyId,
      entity_company_id: entityCompanyId,
    });
  }
};

const assertBranchConsistency = (
  entityLabel: string,
  entity: any,
  branchId: string | null,
  message: string,
) => {
  if (!branchId) return;
  const entityBranchId = resolveEntityBranchId(entity);
  if (!entityBranchId) return;
  if (entityBranchId !== branchId) {
    throw appError(409, 'BRANCH_SCOPE_MISMATCH', message, {
      entity: entityLabel,
      expected_branch_id: branchId,
      entity_branch_id: entityBranchId,
    });
  }
};

const remapInvoiceCreateError = (error: any) => {
  if (error?.statusCode && error?.code) return error;
  const message = String(error?.message || '');
  if (message === 'NEGATIVE_STOCK_NOT_ALLOWED') {
    return appError(409, 'INSUFFICIENT_STOCK', 'الكمية المطلوبة غير متاحة في المخزون.');
  }
  if (message === 'MISSING_WAREHOUSE_ID_FOR_STOCK_MOVEMENT' || message === 'WAREHOUSE_REQUIRED') {
    return appError(400, 'WAREHOUSE_REQUIRED', 'المستودع مطلوب لتطبيق حركة المخزون.');
  }
  if (message === 'WAREHOUSE_NOT_FOUND_FOR_STOCK_MOVEMENT') {
    return appError(404, 'WAREHOUSE_NOT_FOUND', 'المستودع المحدد غير موجود.');
  }
  if (message.startsWith('ITEM_NOT_FOUND_FOR_STOCK_MOVEMENT')) {
    return appError(404, 'ITEM_NOT_FOUND', 'الصنف المحدد غير موجود أو غير صالح لحركة المخزون.');
  }
  if (message === 'STOCK_LEDGER_INVARIANT_BROKEN') {
    return appError(409, 'STOCK_LEDGER_INVARIANT_BROKEN', 'تم اكتشاف تعارض في رصيد المخزون. راجع حركة المادة وأعد المحاولة.');
  }
  return error;
};

const chooseAutoSaleMargin = (costBase: number) => {
  const cost = Number(costBase || 0);
  if (!Number.isFinite(cost) || cost <= 0) return 0.12;
  if (cost <= 2) return 0.18;
  if (cost <= 5) return 0.16;
  if (cost <= 10) return 0.14;
  if (cost <= 25) return 0.12;
  return 0.10;
};

const buildAutoPriceMatrix = (costBase: number, roundMoneyFn: (value: number) => number) => {
  const baseCost = Number(costBase || 0);
  const retailMargin = chooseAutoSaleMargin(baseCost);
  const wholesaleMargin = Math.max(0.08, retailMargin - 0.03);
  const bulkMargin = Math.max(0.06, retailMargin - 0.05);

  const salePrice = roundMoneyFn(baseCost * (1 + retailMargin));
  const wholesalePrice = roundMoneyFn(baseCost * (1 + wholesaleMargin));
  const bulkPrice = roundMoneyFn(baseCost * (1 + bulkMargin));

  return {
    salePrice,
    salePriceBase: salePrice,
    posPrice: salePrice,
    posPriceBase: salePrice,
    wholesalePrice,
    wholesalePriceBase: wholesalePrice,
    wholesaleWholesalePrice: bulkPrice,
    wholesaleWholesalePriceBase: bulkPrice,
    distributionPrice: bulkPrice,
    distributionPriceBase: bulkPrice,
    delegatePrice: wholesalePrice,
    delegatePriceBase: wholesalePrice,
  };
};

const lineHasExplicitPurchaseMoney = (line: any) => {
  const candidates = [
    line?.unitPriceBase,
    line?.unitPriceTransaction,
    line?.unitPrice,
    line?.price,
    line?.lineTotalBase,
    line?.lineTotalTransaction,
    line?.total,
  ];
  return candidates.some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    return true;
  });
};

export const createInvoiceLifecycleService = (ctx: any) => {
  const {
    db,
    schema,
    sql,
    eq,
    and,
    desc,
    safeJsonParse,
    stringifyOrEmpty,
    normalizePaymentTerm,
    roundMoney,
    computePartyDelta,
    applyPartyTransaction,
    ledgerIdForRef,
    buildInvoiceJournalLines,
    createJournalEntry,
    postJournalEntry,
    createVoucherWithAccounting,
    buildDescription,
    ACCOUNTING_LABELS,
    reverseJournalEntry,
    adjustItemStockWithMovement,
    getNextDocNumber,
    auditLogger,
    systemEventLogger,
  } = ctx;
  const voucherLifecycle = createVoucherLifecycleService(ctx);

  const findScopedAgentInventoryLine = async (
    tx: any,
    scope: { companyId: string; branchId: string; agentId: string; itemId: string },
  ) => {
    const scopedLine = await tx.select().from(schema.agentInventory).where(
      and(
        eq(schema.agentInventory.companyId, scope.companyId),
        eq(schema.agentInventory.branchId, scope.branchId),
        eq(schema.agentInventory.agentId, scope.agentId),
        eq(schema.agentInventory.itemId, scope.itemId),
      ),
    ).get();
    if (scopedLine) return scopedLine;

    const legacyLine = await tx.select().from(schema.agentInventory).where(
      and(
        eq(schema.agentInventory.agentId, scope.agentId),
        eq(schema.agentInventory.itemId, scope.itemId),
      ),
    ).get();
    if (!legacyLine) return null;

    const legacyCompanyId = normalizeTenantId((legacyLine as any)?.companyId);
    const legacyBranchId = normalizeTenantId((legacyLine as any)?.branchId);
    if (legacyCompanyId === scope.companyId && legacyBranchId === scope.branchId) return legacyLine;

    await tx.update(schema.agentInventory)
      .set({
        companyId: scope.companyId,
        branchId: scope.branchId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.agentInventory.id, legacyLine.id))
      .run();

    return tx.select().from(schema.agentInventory).where(eq(schema.agentInventory.id, legacyLine.id)).get();
  };

  const rollbackInvoice = async (payload: any, items: any[], reason: string, options?: { skipAudit?: boolean }) => {
    const invoiceId = String(payload.id || '').trim();
    if (!invoiceId) return;
    const vouchers = await db.select().from(schema.vouchers)
      .where(sql`${schema.vouchers.linkedInvoiceId} = ${invoiceId} OR ${schema.vouchers.id} = ${`v-opening-${invoiceId}`}`)
      .all();
    const voucherSnapshots = (vouchers || []).map((entry: any) => ({ ...entry }));
    for (const voucher of voucherSnapshots) {
      await voucherLifecycle.deleteVoucher(String(voucher.id), { userId: payload.createdById || 'system' }, {
        skipAudit: true,
        reason: `Invoice rollback ${invoiceId}`,
      });
    }

    const jeId = Number((payload as any).journalEntryId || 0);
    if (jeId > 0) {
      try {
        await reverseJournalEntry(jeId, `Invoice rollback ${invoiceId}`);
      } catch (error: any) {
        const compensation = await runCriticalCompensation({
          operationType: 'invoice.rollback',
          userId: payload.createdById || 'system',
          affectedDocumentType: 'invoice',
          affectedDocumentId: invoiceId,
          primaryError: error,
          auditLogger,
          systemEventLogger,
          steps: voucherSnapshots.map((voucher: any, index: number) => ({
            key: `voucher_restore_${index + 1}`,
            forceKey: `invoice.voucher_restore_${index + 1}`,
            failureCode: 'INVOICE_ROLLBACK_VOUCHER_RESTORE_FAILED',
            run: () => createVoucherWithAccounting({
              ...voucher,
              journalEntryId: null,
            }),
          })),
        });
        if (compensation.requiresManualReview) {
          throw buildCompensationAppError({
            statusCode: 500,
            code: 'INVOICE_ROLLBACK_COMPENSATION_FAILED',
            message: 'Failed to reverse invoice journal entry and voucher restoration needs manual review.',
            primaryError: error,
            compensation,
            affectedDocumentType: 'invoice',
            affectedDocumentId: invoiceId,
          });
        }
        throw appError(500, 'INVOICE_ROLLBACK_REVERSE_FAILED', error?.message || 'Failed to reverse invoice journal entry.', {
          main_error_code: String(error?.code || 'INVOICE_ROLLBACK_REVERSE_FAILED'),
          compensation_status: compensation.status,
          requires_manual_review: false,
          affected_document_type: 'invoice',
          affected_document_id: invoiceId,
          compensation: compensation.steps,
        });
      }
    }

    await db.transaction(async (tx: any) => {
      const agentMovements = await tx.select().from(schema.agentInventoryMovements)
        .where(eq(schema.agentInventoryMovements.documentId, invoiceId)).all();
      for (const movement of agentMovements || []) {
        const reverseQty = -Number((movement as any).qty || 0);
        if (!reverseQty) continue;
        const agentId = String((movement as any).agentId || '');
        const itemId = String((movement as any).itemId || '');
        if (!agentId || !itemId) continue;
        const scopedCompanyId = String((movement as any).companyId || payload.companyId || '').trim();
        const scopedBranchId = String((movement as any).branchId || payload.branchId || '').trim();
        const agentLine = scopedCompanyId && scopedBranchId
          ? await findScopedAgentInventoryLine(tx, {
              companyId: scopedCompanyId,
              branchId: scopedBranchId,
              agentId,
              itemId,
            })
          : await tx.select().from(schema.agentInventory).where(
              and(
                eq(schema.agentInventory.agentId, agentId),
                eq(schema.agentInventory.itemId, itemId),
              ),
            ).get();
        const currentQty = Number(agentLine?.quantity || 0);
        const nextQty = currentQty + reverseQty;
        if (agentLine) {
          await tx.update(schema.agentInventory)
            .set({ quantity: nextQty, updatedAt: new Date().toISOString() })
            .where(eq(schema.agentInventory.id, agentLine.id))
            .run();
        } else {
          await tx.insert(schema.agentInventory).values({
            id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            companyId: scopedCompanyId || null,
            branchId: scopedBranchId || null,
            agentId,
            itemId,
            itemName: (movement as any).itemName || null,
            unitName: (movement as any).unitName || null,
            quantity: nextQty,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).run();
        }
        await tx.insert(schema.agentInventoryMovements).values({
          id: `aim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          companyId: (movement as any).companyId || payload.companyId || null,
          branchId: (movement as any).branchId || payload.branchId || null,
          agentId,
          itemId,
          itemName: (movement as any).itemName || null,
          unitName: (movement as any).unitName || null,
          qty: reverseQty,
          baseQty: reverseQty,
          movementType: `ROLLBACK_${String((movement as any).movementType || 'UNKNOWN')}`,
          documentType: 'INVOICE_ROLLBACK',
          documentId: invoiceId,
          documentNumber: payload.invoiceNumber || null,
          documentLineId: (movement as any).documentLineId || null,
          warehouseId: (movement as any).warehouseId || null,
          warehouseName: (movement as any).warehouseName || null,
          userId: payload.createdById || null,
          userName: payload.createdByName || null,
          notes: reason || 'Invoice rollback',
          createdAt: new Date().toISOString(),
        }).run();
      }

      const movements = await tx.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.documentId, invoiceId)).all();
      for (const movement of movements || []) {
        const item = await tx.select().from(schema.items).where(eq(schema.items.id, movement.itemId)).get();
        if (!item) continue;
        const warehouseId = String((movement as any).warehouseId || (item as any).warehouseId || '').trim();
        if (!warehouseId) continue;
        await adjustItemStockWithMovement(tx, {
          itemId: String(movement.itemId),
          warehouseId,
          warehouseName: (movement as any).warehouseName || (item as any).warehouseName || null,
          unitId: (movement as any).unitId || null,
          unitName: (movement as any).unitName || null,
          qtyDelta: -Number((movement as any).qty || (movement as any).baseQty || 0),
          baseQtyDelta: -Number((movement as any).baseQty || 0),
          meta: {
            documentType: 'INVOICE_ROLLBACK',
            documentId: invoiceId,
            documentNumber: (payload as any).invoiceNumber || null,
            documentLineId: (movement as any).documentLineId || null,
            movementType: `ROLLBACK_${String((movement as any).movementType || 'UNKNOWN')}`,
            userId: payload.createdById || null,
            userName: payload.createdByName || null,
            notes: reason || 'Invoice rollback',
          },
        });
      }

      const invType = String(payload.type || '').toLowerCase();
      if (invType === 'purchase' || invType === 'opening_stock') {
        await tx.delete(schema.itemSerials).where(eq(schema.itemSerials.purchaseInvoiceId, invoiceId)).run();
      } else {
        for (const line of items) {
          for (const serialNumber of parseSerialNumbers(line)) {
            if (String(payload.type || '').toLowerCase() === 'return') {
              await tx.update(schema.itemSerials).set({
                status: 'sold',
                updatedAt: new Date().toISOString(),
              }).where(eq(schema.itemSerials.serialNumber, serialNumber)).run();
            } else {
              await tx.update(schema.itemSerials).set({
                status: 'available',
                salesInvoiceId: null,
                updatedAt: new Date().toISOString(),
              }).where(eq(schema.itemSerials.serialNumber, serialNumber)).run();
            }
          }
        }
      }

      await tx.delete(schema.partyTransactions).where(eq(schema.partyTransactions.refId, invoiceId)).run();
      if (payload.clientId) {
        const row = await tx.select({
          sum: sql<number>`coalesce(sum(coalesce(${schema.partyTransactions.deltaBase}, ${schema.partyTransactions.delta})), 0)`,
        }).from(schema.partyTransactions).where(eq(schema.partyTransactions.partyId, String(payload.clientId))).get();
        await tx.update(schema.parties)
          .set({ balance: Number(row?.sum || 0) })
          .where(eq(schema.parties.id, String(payload.clientId)))
          .run();
      }
      await tx.delete(schema.reconciliationMarks).where(eq(schema.reconciliationMarks.rowRefId, invoiceId)).run();
      await tx.delete(schema.invoiceMovements).where(eq(schema.invoiceMovements.invoiceId, invoiceId)).run();
      await tx.delete(schema.invoices).where(eq(schema.invoices.id, invoiceId)).run();
    });

    if (!options?.skipAudit) {
      await auditLogger.log({
        userId: payload.createdById || 'system',
        operationType: 'invoice.rollback',
        affectedItems: [{ invoiceId }],
        meta: { reason },
      });
    }
  };

  const createInvoice = async (data: any, authContext?: any) => {
    const id = data.id || `inv-${Date.now()}`;
    const invoiceType = String(data.type || '').toLowerCase();
    const invoiceCurrency = ['USD', 'SYP', 'TRY'].includes(String(data.currency || '').toUpperCase())
      ? String(data.currency || '').toUpperCase()
      : 'USD';
    if (!data?.invoiceNumber || !data?.type || !data?.date) {
      throw appError(400, 'INVOICE_REQUIRED_FIELDS', 'بيانات الفاتورة غير مكتملة (رقم الفاتورة/النوع/التاريخ).');
    }
    const sourceDocumentType = String(data.sourceDocumentType || '').trim().toLowerCase();
    const sourceDocumentId = String(data.sourceDocumentId || '').trim();
    if (invoiceType === 'sale' && sourceDocumentType === 'restaurant_session' && sourceDocumentId) {
      const existingBySource = await db
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.sourceDocumentType, 'restaurant_session'),
            eq(schema.invoices.sourceDocumentId, sourceDocumentId),
          ),
        )
        .orderBy(desc(schema.invoices.createdAt))
        .limit(1)
        .get();
      if (existingBySource) {
        const authCompanyId = normalizeTenantId(authContext?.companyId);
        if (authCompanyId) {
          assertEntityBelongsToCompany(existingBySource, authCompanyId, 'Invoice not found.');
          assertEntityBelongsToAllowedBranch(existingBySource, authContext || {}, 'Invoice not found.');
        }
        return {
          success: true,
          duplicate: true,
          id: existingBySource.id,
          invoiceNumber: existingBySource.invoiceNumber,
          sourceDocumentType: 'restaurant_session',
          sourceDocumentId,
        };
      }
    }
    if (data?.id) {
      const existing = await db.select().from(schema.invoices).where(eq(schema.invoices.id, data.id)).get();
      if (existing) {
        const authCompanyId = normalizeTenantId(authContext?.companyId);
        if (authCompanyId) {
          assertEntityBelongsToCompany(existing, authCompanyId, 'Invoice not found.');
          assertEntityBelongsToAllowedBranch(existing, authContext || {}, 'Invoice not found.');
        }
        return { success: true, duplicate: true, id: data.id };
      }
    }

    const rawItems = Array.isArray(data.items) ? data.items : safeJsonParse(data.items, []);
    const exchangeRate = normalizeExchangeRate(invoiceCurrency, data.exchangeRate);
    const preliminaryItems = (rawItems || []).map((line: any, idx: number) => {
      const lineId = String(line.lineId || line.id || `line-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`);
      const lineMoney = normalizeInvoiceLineMoney(line, invoiceCurrency, exchangeRate);
      const qty = Number(line.baseQuantity ?? line.quantity ?? lineMoney.quantity ?? 0);
      const baseQty = Number(line.baseQuantity ?? lineMoney.quantity ?? qty);
      return {
        ...line,
        lineId,
        quantity: qty,
        baseQuantity: baseQty,
        serialNumbers: parseSerialNumbers(line),
        unitPrice: lineMoney.unitPriceTransaction,
        unitPriceTransaction: lineMoney.unitPriceTransaction,
        unitPriceBase: lineMoney.unitPriceBase,
        total: lineMoney.lineTotalTransaction,
        lineTotalTransaction: lineMoney.lineTotalTransaction,
        lineTotalBase: lineMoney.lineTotalBase,
        currency: invoiceCurrency,
        exchangeRate,
      };
    });
    const scopedCompanyIdForTextile =
      normalizeTenantId(authContext?.companyId)
      || normalizeTenantId(data.companyId)
      || null;
    const items: any[] = [];
    for (const line of preliminaryItems) {
      const itemRecord = line?.itemId
        ? await db.select().from(schema.items).where(eq(schema.items.id, line.itemId)).get()
        : null;
      const normalizedLine = scopedCompanyIdForTextile
        ? await normalizeTextileInvoiceLine(db, schema, scopedCompanyIdForTextile, invoiceType, line, itemRecord)
        : { ...line };
      if (normalizedLine.isTextile) {
        const unitPriceBase = Number(normalizedLine.textileUnitPricePerLength || normalizedLine.unitPriceBase || 0);
        const unitPriceTransaction = Number(normalizedLine.textileUnitPricePerLength || normalizedLine.unitPriceTransaction || normalizedLine.unitPrice || 0);
        normalizedLine.quantity = Number(normalizedLine.textileTotalLength || normalizedLine.baseQuantity || normalizedLine.quantity || 0);
        normalizedLine.baseQuantity = normalizedLine.quantity;
        normalizedLine.unitName = normalizedLine.textileBaseUom;
        normalizedLine.lineTotalBase = roundMoney(unitPriceBase * normalizedLine.quantity);
        normalizedLine.lineTotalTransaction = roundMoney(unitPriceTransaction * normalizedLine.quantity);
        normalizedLine.total = normalizedLine.lineTotalTransaction;
      }
      items.push(normalizedLine);
    }
    const derivedTotalBase = roundMoney(items.reduce((sum: number, line: any) => sum + Number(line.lineTotalBase || 0), 0));
    const derivedTotalTransaction = roundMoney(items.reduce((sum: number, line: any) => sum + Number(line.lineTotalTransaction || 0), 0));
    const hasExplicitPaid =
      data.paidAmount !== undefined || data.paidAmountBase !== undefined || data.paidAmountTransaction !== undefined;
    const hasExplicitRemaining =
      data.remainingAmount !== undefined || data.remainingAmountBase !== undefined || data.remainingAmountTransaction !== undefined;
    const requestedPaymentTerm = normalizePaymentTerm(
      data.paymentType || (hasExplicitRemaining && Number(data.remainingAmountBase ?? data.remainingAmount ?? 0) > 0 ? 'credit' : 'cash')
    );
    let normalizedMoney = normalizeInvoiceMoney({
      ...data,
      currency: invoiceCurrency,
      exchangeRate,
      totalAmountBase: data.totalAmountBase ?? derivedTotalBase,
      totalAmountTransaction: data.totalAmountTransaction ?? data.originalAmount ?? derivedTotalTransaction,
      totalAmount: data.totalAmount ?? (invoiceCurrency === BASE_CURRENCY ? derivedTotalBase : derivedTotalTransaction),
    });
    if (!hasExplicitPaid && !hasExplicitRemaining) {
      normalizedMoney = requestedPaymentTerm === 'cash'
        ? {
            ...normalizedMoney,
            paidBase: normalizedMoney.totalBase,
            paidTransaction: normalizedMoney.totalTransaction,
            remainingBase: 0,
            remainingTransaction: 0,
          }
        : {
            ...normalizedMoney,
            paidBase: 0,
            paidTransaction: 0,
            remainingBase: normalizedMoney.totalBase,
            remainingTransaction: normalizedMoney.totalTransaction,
          };
    }

    const strictMode = process.env.ERP_STRICT_MODE === 'true' || process.env.ERP_STRICT_MODE === '1';
    const edgeResult = validateInvoiceEdgeCases(items, invoiceCurrency, strictMode);
    if (!edgeResult.ok) throw appError(400, 'INVOICE_EDGE_VALIDATION_FAILED', edgeResult.error);
    const allowMissingCatalogItems = invoiceType === 'purchase' || invoiceType === 'opening_stock';
    const existingItemIds = allowMissingCatalogItems
      ? new Set<string>()
      : new Set(
          (
            await Promise.all(
              items.map(async (line: any) => {
                const itemId = String(line?.itemId || '').trim();
                if (!itemId) return null;
                const row = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
                return row ? itemId : null;
              }),
            )
          ).filter(Boolean) as string[],
        );
    const dataIntegrity = validateInvoiceDataIntegrity(
      items,
      allowMissingCatalogItems ? undefined : (itemId: string) => existingItemIds.has(String(itemId || '').trim()),
    );
    if (!dataIntegrity.ok) throw appError(400, 'INVOICE_DATA_INTEGRITY_FAILED', dataIntegrity.error);

    const settingsMap = await loadNormalizedSettingsMap(db, schema);
    const pricingSettings = settingsMap.get('pricingSettings') || {};
    const purchaseSettings = (settingsMap.get('purchaseSettings') || {}) as { requireGoodsSubtotal?: boolean };
    const party = data.clientId ? await db.select().from(schema.parties).where(eq(schema.parties.id, data.clientId)).get() : null;
    const allowManualPriceEdit = party?.allowManualPriceEdit !== false;

    // Purchase AP accuracy check: goodsSubtotal must be provided separately from additionalCostsTotal
    // so that supplier AP balance is not inflated by shipping/customs charges.
    if (invoiceType === 'purchase' && data.goodsSubtotal == null) {
      if (purchaseSettings.requireGoodsSubtotal === true || strictMode) {
        throw appError(
          400,
          'PURCHASE_GOODS_SUBTOTAL_REQUIRED',
          'فاتورة الشراء يجب أن تتضمن حقل goodsSubtotal منفصلاً عن التكاليف الإضافية (additionalCostsTotal) لضمان دقة رصيد المورد.',
        );
      }
      // Warn-only mode: log system event but continue
      try {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.PURCHASE_MISSING_GOODS_SUBTOTAL,
          severity: 'warning',
          sourceModule: 'invoices',
          action: 'create',
          status: 'success',
          errorCode: 'PURCHASE_GOODS_SUBTOTAL_MISSING',
          metadata: {
            invoiceNumber: data.invoiceNumber,
            totalAmount: data.totalAmount,
            note: 'goodsSubtotal not provided â€” AP balance will equal totalAmount including extra costs. Set purchaseSettings.requireGoodsSubtotal=true to enforce.',
          },
        });
      } catch {}
    }

    for (let idx = 0; idx < items.length; idx++) {
      const commissionOk = validateCommissionRule(items[idx]);
      if (!commissionOk.ok) throw appError(400, 'INVOICE_COMMISSION_RULE_FAILED', commissionOk.error);
      items[idx] = { ...items[idx], commissionAmount: computeLineCommission(items[idx]) };
    }

    if (invoiceType === 'sale' && data.clientId && !allowManualPriceEdit) {
      for (let idx = 0; idx < items.length; idx++) {
        const line = items[idx];
        const resolved = resolvePrice(db, line.itemId, data.clientId, line.unitId, Number(line.baseQuantity ?? line.quantity), {
          enableCustomerSpecificPrices: pricingSettings.enableCustomerSpecificPrices !== false,
          enableLastSoldPriceRecall: pricingSettings.enableLastSoldPriceRecall !== false,
        });
        if (Math.abs(Number(line.unitPrice ?? 0) - resolved.unitPrice) > 0.01) {
          throw appError(400, 'INVOICE_PRICE_OVERRIDE_BLOCKED', `السعر المُدخل لا يطابق السعر المحسوب للصنف (سطر ${idx + 1}).`);
        }
      }
    }

    for (const line of items) {
      const itemRecord = await db.select().from(schema.items).where(eq(schema.items.id, line.itemId)).get();
      if (!itemRecord) continue;
      const tracking = String((itemRecord as any).serialTracking || 'none');
      const serialNumbers = parseSerialNumbers(line);
      const expectedCount = Math.round(Math.max(0, Number(line.baseQuantity ?? line.quantity ?? 0)));
      if (tracking === 'required' && expectedCount > 0 && serialNumbers.length !== expectedCount) {
        throw appError(400, 'SERIAL_COUNT_REQUIRED', `الصنف ${line.itemName} يتطلب ${expectedCount} أرقام سيريال.`);
      }
    }

    const targetWarehouse = data.targetWarehouseId
      ? await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, data.targetWarehouseId)).get()
      : null;

    const partyCompanyId = normalizeTenantId(party?.companyId);
    const warehouseCompanyId = normalizeTenantId(targetWarehouse?.companyId);
    const payloadCompanyId = normalizeTenantId(data.companyId);
    const authCompanyId = normalizeTenantId(authContext?.companyId);
    const enforceAuthScope = !!authCompanyId;
    const effectiveCompanyId = authCompanyId || payloadCompanyId || warehouseCompanyId || partyCompanyId;
    if (!effectiveCompanyId) {
      throw appError(400, 'INVOICE_COMPANY_SCOPE_REQUIRED', 'Company scope is required to create invoice.');
    }

    if (payloadCompanyId && payloadCompanyId !== effectiveCompanyId) {
      throw appError(403, 'INVOICE_SCOPE_COMPANY_MISMATCH', 'Invoice payload company does not match authenticated company scope.', {
        auth_company_id: authCompanyId,
        payload_company_id: payloadCompanyId,
      });
    }
    if (authCompanyId && authCompanyId !== effectiveCompanyId) {
      throw appError(403, 'INVOICE_SCOPE_COMPANY_MISMATCH', 'Invoice company is outside authenticated company scope.', {
        auth_company_id: authCompanyId,
        effective_company_id: effectiveCompanyId,
      });
    }

    if (party) {
      assertCompanyConsistency('party', party, effectiveCompanyId, 'العميل/المورد غير موجود ضمن المؤسسة الحالية.');
      if (enforceAuthScope) {
        assertEntityBelongsToAllowedBranch(party, authContext || {}, 'العميل/المورد خارج الفروع المسموح بها.');
      }
    }
    if (targetWarehouse) {
      assertCompanyConsistency('warehouse', targetWarehouse, effectiveCompanyId, 'المستودع غير موجود ضمن المؤسسة الحالية.');
      if (enforceAuthScope) {
        assertEntityBelongsToAllowedBranch(targetWarehouse, authContext || {}, 'المستودع خارج الفروع المسموح بها.');
      }
    }

    const warehouseBranchId = normalizeTenantId(targetWarehouse?.branchId);
    const payloadBranchId = normalizeTenantId(data.branchId);
    const authBranchId = normalizeTenantId(pickEffectiveBranchId(undefined, authContext || {}));
    const effectiveBranchId = payloadBranchId || warehouseBranchId || authBranchId || null;

    if (payloadBranchId && warehouseBranchId && payloadBranchId !== warehouseBranchId) {
      throw appError(409, 'INVOICE_SCOPE_BRANCH_MISMATCH', 'Invoice payload branch does not match warehouse branch.', {
        payload_branch_id: payloadBranchId,
        warehouse_branch_id: warehouseBranchId,
      });
    }
    if (effectiveBranchId && enforceAuthScope) {
      assertEntityBelongsToAllowedBranch(
        { companyId: effectiveCompanyId, branchId: effectiveBranchId },
        authContext || {},
        'الفرع خارج الفروع المسموح بها.',
      );
    }
    if (targetWarehouse) {
      assertBranchConsistency('warehouse', targetWarehouse, effectiveBranchId, 'فرع المستودع لا يطابق فرع الفاتورة.');
    }

      const payload: Record<string, any> & { agentId?: string; agentName?: string; agentUserId?: string | null } = {
        id,
        companyId: effectiveCompanyId,
        branchId: effectiveBranchId,
      invoiceNumber: data.invoiceNumber,
      type: data.type,
      clientId: data.clientId,
      clientName: data.clientName,
      date: data.date,
      items: stringifyOrEmpty(items),
      totalAmount: normalizedMoney.totalBase,
      totalAmountBase: normalizedMoney.totalBase,
      totalAmountTransaction: normalizedMoney.totalTransaction,
      discount: normalizedMoney.discountBase,
      discountBase: normalizedMoney.discountBase,
      discountTransaction: normalizedMoney.discountTransaction,
      originalAmount: normalizedMoney.totalTransaction,
      exchangeRate: normalizedMoney.exchangeRate,
      paidAmount: normalizedMoney.paidBase,
      paidAmountBase: normalizedMoney.paidBase,
      paidAmountTransaction: normalizedMoney.paidTransaction,
      remainingAmount: normalizedMoney.remainingBase,
      remainingAmountBase: normalizedMoney.remainingBase,
      remainingAmountTransaction: normalizedMoney.remainingTransaction,
      paymentType: data.paymentType,
      applyStock: data.applyStock === undefined ? 1 : Number(data.applyStock) ? 1 : 0,
      currency: invoiceCurrency,
      notes: data.notes,
      returnType: data.returnType || data.return_type || null,
      createdById: data.createdById,
      createdByName: data.createdByName,
      createdByRole: data.createdByRole,
      geoLat: data.geoLat,
      geoLng: data.geoLng,
      geoLabel: data.geoLabel,
      targetWarehouseId: data.targetWarehouseId,
      targetWarehouseName: data.targetWarehouseName,
      createdAt: data.createdAt || new Date().toISOString(),
      sourceDocumentType: data.sourceDocumentType || null,
      sourceDocumentId: data.sourceDocumentId || null,
      // Landed cost separation: goodsSubtotal drives supplier/AP; additionalCostsTotal goes to clearing
        goodsSubtotal: data.goodsSubtotal != null ? Number(data.goodsSubtotal) : null,
        additionalCostsTotal: data.additionalCostsTotal != null ? Number(data.additionalCostsTotal) : 0,
      };

      let resolvedAgent: any = null;
      const explicitAgentId = normalizeTenantId(data.agentId);
      if (explicitAgentId) {
        resolvedAgent = await db.select().from(schema.agents).where(eq(schema.agents.id, explicitAgentId)).get();
        if (!resolvedAgent) {
          throw appError(404, 'AGENT_NOT_FOUND', 'المندوب غير موجود.');
        }
      }
      if (!resolvedAgent && String(data.createdByRole || authContext?.role || '').toLowerCase() === 'agent') {
        const agentUserId = normalizeTenantId(data.createdById || authContext?.userId);
        if (agentUserId) {
          resolvedAgent = await db.select().from(schema.agents).where(eq(schema.agents.userId, agentUserId)).get();
          if (!resolvedAgent) {
            resolvedAgent = await db.select().from(schema.agents).where(eq(schema.agents.id, agentUserId)).get();
          }
        }
      }
      if (resolvedAgent) {
        assertCompanyConsistency('agent', resolvedAgent, effectiveCompanyId, 'Agent not found.');
        if (effectiveBranchId) {
          assertBranchConsistency('agent', resolvedAgent, effectiveBranchId, 'فرع المندوب لا يطابق فرع الفاتورة.');
        }
        if (enforceAuthScope) {
          assertEntityBelongsToAllowedBranch(resolvedAgent, authContext || {}, 'المندوب خارج الفروع المسموح بها.');
        }
        if (resolvedAgent?.isActive === false || Number(resolvedAgent?.isActive) === 0) {
          throw appError(409, 'INACTIVE_AGENT', 'المندوب غير مفعل.');
        }
        payload.agentId = String(resolvedAgent.id || '');
        payload.agentName = String(resolvedAgent.name || '');
        payload.agentUserId = String(resolvedAgent.userId || '') || null;
      }
    // Validate split payment totals against paidAmountBase to prevent drift.
    const rawPaymentSplit = Array.isArray(data.paymentSplit) ? data.paymentSplit : [];
    if (rawPaymentSplit.length > 0) {
      const splitBaseTotal = rawPaymentSplit.reduce((sum: number, line: any) => {
        const currencyCode = normalizeCurrencyCode(line?.currency || line?.currencyCode || line?.code);
        const rate = normalizeExchangeRate(currencyCode, line?.rate ?? line?.exchangeRate ?? line?.fxRate);
        const rawAmount = Number(line?.amount ?? line?.amountTransaction ?? line?.originalAmount ?? 0);
        const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
        if (!amount || amount <= 0) return sum;
        const rawBase = Number(line?.amountBase ?? (currencyCode === BASE_CURRENCY ? amount : (rate > 0 ? amount / rate : amount)));
        const amountBase = Number.isFinite(rawBase) ? rawBase : 0;
        return sum + amountBase;
      }, 0);
      const expectedBase = Number(payload.paidAmountBase || 0);
      const delta = Math.abs(roundMoney(splitBaseTotal) - roundMoney(expectedBase));
      if (delta > 0.01) {
        throw appError(409, 'PAYMENT_SPLIT_TOTAL_MISMATCH', 'إجمالي دفعات العملات لا يطابق إجمالي المدفوع. تحقق من أسعار الصرف والمبالغ.', {
          expectedPaidBase: roundMoney(expectedBase),
          splitPaidBase: roundMoney(splitBaseTotal),
        });
      }
    }

    if (String(payload.type || '').toLowerCase() === 'opening_stock' && !payload.targetWarehouseId) {
      throw appError(400, 'OPENING_STOCK_WAREHOUSE_REQUIRED', 'لا يمكن حفظ فاتورة افتتاح مخزون بدون مستودع مستهدف.');
    }

    const invType = String(payload.type || '').toLowerCase();
    const invoiceTotalBase = Number(payload.totalAmountBase || 0);
    const invoiceTotalTransaction = Number(payload.totalAmountTransaction || 0);
    // For AP: use goodsSubtotal if provided (new invoices), otherwise fall back to totalBase (legacy)
    const invoiceGoodsBase = (invType === 'purchase' && payload.goodsSubtotal != null)
      ? Number(payload.goodsSubtotal)
      : invoiceTotalBase;
    const invoiceGoodsTransaction = (invType === 'purchase' && payload.goodsSubtotal != null)
      ? (invoiceCurrency === BASE_CURRENCY ? invoiceGoodsBase : roundMoney(invoiceGoodsBase * Number(payload.exchangeRate || 1)))
      : invoiceTotalTransaction;
    if (invType === 'purchase' && payload.goodsSubtotal != null && !hasExplicitPaid && !hasExplicitRemaining) {
      const settlementBase = roundMoney(invoiceGoodsBase);
      const settlementTransaction = roundMoney(invoiceGoodsTransaction);
      const isCashTerm = requestedPaymentTerm === 'cash';
      const paidBase = isCashTerm ? settlementBase : 0;
      const paidTransaction = isCashTerm ? settlementTransaction : 0;
      const remainingBase = isCashTerm ? 0 : settlementBase;
      const remainingTransaction = isCashTerm ? 0 : settlementTransaction;
      payload.paidAmount = paidBase;
      payload.paidAmountBase = paidBase;
      payload.paidAmountTransaction = paidTransaction;
      payload.remainingAmount = remainingBase;
      payload.remainingAmountBase = remainingBase;
      payload.remainingAmountTransaction = remainingTransaction;
    }
    const paymentTerm = normalizePaymentTerm(data.paymentType || (Number(payload.remainingAmountBase || 0) > 0 ? 'credit' : 'cash'));
    const isCashInvoice = paymentTerm === 'cash';
    const qtySign = getQtySign(invType, String(payload.returnType || ''));

    let issuedQueue: { queueNumber?: string; queueScope?: string; queueDate?: string } = {};
    const ensureBaseUnitForLine = async (tx: any, line: any) => {
      const fallbackUnitName = String(line.unitName || '').trim() || 'وحدة';
      let resolvedUnitId = String(line.unitId || '').trim();
      let unitRow = resolvedUnitId
        ? await tx.select().from(schema.units).where(eq(schema.units.id, resolvedUnitId)).get()
        : null;

      if (!unitRow) {
        unitRow = await tx.select().from(schema.units).where(
          payload.companyId
            ? sql`lower(trim(${schema.units.name})) = lower(trim(${fallbackUnitName})) AND ${schema.units.companyId} = ${payload.companyId}`
            : sql`lower(trim(${schema.units.name})) = lower(trim(${fallbackUnitName})) AND ${schema.units.companyId} IS NULL`
        ).get();
      }

      if (!unitRow) {
        resolvedUnitId = resolvedUnitId || `unit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await tx.insert(schema.units).values({
          id: resolvedUnitId,
          companyId: payload.companyId || null,
          name: fallbackUnitName,
          isBase: 1,
          baseUnitId: null,
          factor: 1,
          multiplier: 1,
        }).run();
        unitRow = await tx.select().from(schema.units).where(eq(schema.units.id, resolvedUnitId)).get();
      }

      line.unitId = String((unitRow as any)?.id || resolvedUnitId || '').trim() || null;
      line.unitName = String((unitRow as any)?.name || fallbackUnitName).trim() || 'وحدة';
      return {
        unitId: line.unitId,
        unitName: line.unitName,
      };
    };

    try {
      await db.transaction(async (tx: any) => {
      let insertPayload: Record<string, any> = { ...payload };

      if (data.posSale && invType === 'sale') {
        const printSettings = settingsMap.get('print') || {};
        const qcfg = parseRestaurantQueueFromPrintSettings(printSettings);
        if (qcfg.queueEnabled) {
          const bizDate = String(insertPayload.date || '').split('T')[0] || new Date().toISOString().split('T')[0];
          issuedQueue = allocateNextQueueInTransaction(tx, {
            companyId: insertPayload.companyId,
            branchId: insertPayload.branchId,
            settings: qcfg,
            businessDate: bizDate,
          });
          insertPayload = {
            ...insertPayload,
            queueNumber: issuedQueue.queueNumber,
            queueScope: issuedQueue.queueScope,
            queueDate: issuedQueue.queueDate,
          };
        }
      }
      if (
        String(insertPayload.type || '').toLowerCase() === 'sale'
        && String(insertPayload.sourceDocumentType || '').trim().toLowerCase() === 'restaurant_session'
        && String(insertPayload.sourceDocumentId || '').trim()
      ) {
          const existingBySourceInTx = await tx
            .select()
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.sourceDocumentType, 'restaurant_session'),
              eq(schema.invoices.sourceDocumentId, String(insertPayload.sourceDocumentId || '').trim()),
            ),
          )
          .limit(1)
          .get();
        if (existingBySourceInTx) {
          throw appError(
            409,
            'RESTAURANT_SESSION_ALREADY_INVOICED',
            'This restaurant session already has an official sale invoice.',
            {
              existingInvoiceId: String(existingBySourceInTx.id || ''),
              existingInvoiceNumber: String(existingBySourceInTx.invoiceNumber || ''),
              sourceDocumentType: 'restaurant_session',
              sourceDocumentId: String(insertPayload.sourceDocumentId || ''),
            },
          );
        }
      }
      await tx.insert(schema.invoices).values(insertPayload).run();

      if (party && ['sale', 'purchase', 'return', 'exchange'].includes(invType) && !isCashInvoice) {
        const event = invType === 'sale' ? 'sale_invoice' : invType === 'purchase' ? 'purchase_invoice' : 'return';
        // Use goods subtotal only for AP â€” extra costs must NOT inflate supplier balance
        const apAmount = invType === 'purchase' ? invoiceGoodsBase : invoiceTotalBase;
        const apAmountTransaction = invType === 'purchase' ? invoiceGoodsTransaction : invoiceTotalTransaction;
        const delta = computePartyDelta({ partyType: party.type, event, paymentTerm, totalOrAmount: apAmount });
        if (delta !== 0) {
          await applyPartyTransaction(tx, {
            id: ledgerIdForRef(id),
            companyId: payload.companyId || party.companyId || null,
            branchId: payload.branchId || null,
            partyId: party.id,
            partyType: party.type,
            kind: invType === 'sale' ? 'invoice_sale' : invType === 'purchase' ? 'invoice_purchase' : 'invoice_return',
            refId: id,
            amount: apAmount,
            amountBase: apAmount,
            amountTransaction: apAmountTransaction,
            delta,
            deltaBase: delta,
            deltaTransaction: invoiceCurrency === BASE_CURRENCY ? delta : roundMoney(delta * Number(payload.exchangeRate || 1)),
            currency: invoiceCurrency,
            exchangeRate: Number(payload.exchangeRate || 1),
            createdAt: payload.createdAt,
          });
        }
      }

      // Compute per-unit landed cost allocation (by quantity) for purchase invoices
      const additionalCostsTotalForAlloc = invType === 'purchase' ? Number(payload.additionalCostsTotal || 0) : 0;
      const totalPurchaseQty = invType === 'purchase'
        ? items.reduce((sum: number, l: any) => sum + Math.abs(Number(l.baseQuantity ?? l.quantity ?? 0)), 0)
        : 0;
      const extraCostPerUnit = (additionalCostsTotalForAlloc > 0 && totalPurchaseQty > 0)
        ? additionalCostsTotalForAlloc / totalPurchaseQty
        : 0;

      const agentStockId = payload.agentId ? String(payload.agentId) : null;
      const applyAgentStock = Boolean(agentStockId)
        && (
          invType === 'sale'
          || (invType === 'return' && String(payload.returnType || '').toLowerCase() === 'sale')
        );

      if (qtySign !== 0 && Number(payload.applyStock || 0) === 1) {
        if (applyAgentStock) {
          for (const line of items) {
            const qty = Number(line.baseQuantity ?? line.quantity ?? 0);
            if (!qty) continue;
            const itemId = String(line.itemId || '').trim();
            if (!itemId) continue;
            const itemRow = await tx.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
            if (itemRow) {
              assertCompanyConsistency('item', itemRow, effectiveCompanyId, 'الصنف غير موجود ضمن المؤسسة الحالية.');
              assertBranchConsistency('item', itemRow, effectiveBranchId, 'فرع الصنف لا يطابق فرع الفاتورة.');
              if (enforceAuthScope) {
                assertEntityBelongsToAllowedBranch(itemRow, authContext || {}, 'الصنف خارج الفروع المسموح بها.');
              }
            }
            const itemType = (itemRow as any)?.itemType || (line as any).itemType || '';
            if (itemType === 'SERVICE' || itemType === 'NON_STOCK') continue;

            const movementQty = qtySign * qty;
            const scopedAgentBranchId = effectiveBranchId || String(payload.branchId || '').trim();
            const existingAgentItem = effectiveCompanyId && scopedAgentBranchId
              ? await findScopedAgentInventoryLine(tx, {
                  companyId: effectiveCompanyId,
                  branchId: scopedAgentBranchId,
                  agentId: agentStockId,
                  itemId,
                })
              : await tx.select().from(schema.agentInventory).where(
                  and(
                    eq(schema.agentInventory.agentId, agentStockId),
                    eq(schema.agentInventory.itemId, itemId),
                  ),
                ).get();
            const currentQty = Number(existingAgentItem?.quantity || 0);
            const nextQty = currentQty + movementQty;
            if (nextQty < 0) {
              await systemEventLogger?.log({
                eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
                severity: 'warning',
                sourceModule: 'agents',
                action: 'invoice.sale',
                status: 'failed',
                errorCode: 'AGENT_SALE_INSUFFICIENT_STOCK',
                affectedDocumentType: 'invoice',
                affectedDocumentId: id,
                metadata: {
                  agentId: agentStockId,
                  itemId,
                  requested: qty,
                  available: currentQty,
                },
              });
              throw appError(409, 'INSUFFICIENT_AGENT_STOCK', 'الكمية المطلوبة غير متاحة في مخزون المندوب.');
            }

            if (existingAgentItem) {
              await tx.update(schema.agentInventory)
                .set({
                  quantity: nextQty,
                  itemName: existingAgentItem.itemName || itemRow?.name || String(line.itemName || ''),
                  unitName: existingAgentItem.unitName || itemRow?.unitName || String(line.unitName || ''),
                  updatedAt: new Date().toISOString(),
                })
                .where(eq(schema.agentInventory.id, existingAgentItem.id))
                .run();
            } else {
              await tx.insert(schema.agentInventory).values({
                id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                companyId: effectiveCompanyId || null,
                branchId: scopedAgentBranchId || null,
                agentId: agentStockId,
                itemId,
                itemName: itemRow?.name || String(line.itemName || ''),
                unitName: itemRow?.unitName || String(line.unitName || ''),
                quantity: nextQty,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).run();
            }

            await tx.insert(schema.agentInventoryMovements).values({
              id: `aim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              companyId: payload.companyId || null,
              branchId: payload.branchId || null,
              agentId: agentStockId,
              itemId,
              itemName: itemRow?.name || String(line.itemName || ''),
              unitName: itemRow?.unitName || String(line.unitName || ''),
              qty: movementQty,
              baseQty: movementQty,
              movementType: invType === 'sale' ? 'AGENT_SALE' : 'AGENT_RETURN_IN',
              documentType: 'INVOICE',
              documentId: id,
              documentNumber: payload.invoiceNumber,
              documentLineId: String((line as any).lineId || (line as any).id || ''),
              warehouseId: payload.targetWarehouseId || null,
              warehouseName: payload.targetWarehouseName || null,
              userId: payload.createdById || null,
              userName: payload.createdByName || null,
              notes: payload.notes || null,
              createdAt: new Date().toISOString(),
            }).run();
          }
        } else {
          for (const line of items) {
            const warehouseId = String(line.warehouseId || payload.targetWarehouseId || '').trim();
            if (!warehouseId) throw appError(400, 'WAREHOUSE_REQUIRED', 'المستودع الهدف مطلوب لتطبيق حركة المخزون.');
            const resolvedUnit = (invType === 'purchase' || invType === 'opening_stock')
              ? await ensureBaseUnitForLine(tx, line)
              : {
                unitId: String(line.unitId || '').trim() || null,
                unitName: String(line.unitName || '').trim() || null,
              };
            let itemId = String(line.itemId || '').trim();
            let itemRow = await tx.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
            if (itemRow) {
              assertCompanyConsistency('item', itemRow, effectiveCompanyId, 'الصنف غير موجود ضمن المؤسسة الحالية.');
              assertBranchConsistency('item', itemRow, effectiveBranchId, 'فرع الصنف لا يطابق فرع الفاتورة.');
              if (enforceAuthScope) {
                assertEntityBelongsToAllowedBranch(itemRow, authContext || {}, 'الصنف خارج الفروع المسموح بها.');
              }
            }

            // Landed cost per unit for this line (based on quantity allocation)
            const landedCostPerUnit = extraCostPerUnit;
            const goodsUnitCost = Number(line.unitPriceBase || 0);
            const landedUnitCost = roundMoney(goodsUnitCost + landedCostPerUnit);
            const autoPriceMatrix = buildAutoPriceMatrix(landedUnitCost, roundMoney);

            if (!itemRow && (invType === 'purchase' || invType === 'opening_stock')) {
              itemId = line.itemId && !String(line.itemId).startsWith('NEW-') ? String(line.itemId) : `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              await tx.insert(schema.items).values({
                id: itemId,
                companyId: payload.companyId || null,
                branchId: payload.branchId || null,
                name: String(line.itemName || 'مادة'),
                code: String(line.itemCode || line.code || Date.now().toString().slice(-6)),
                barcode: '',
                unitId: resolvedUnit.unitId,
                unitName: String(line.unitName || 'وحدة'),
                quantity: 0,
                // New items: costPrice = goods unit price + landed cost per unit
                costPrice: landedUnitCost,
                costPriceBase: landedUnitCost,
                salePrice: autoPriceMatrix.salePrice,
                salePriceBase: autoPriceMatrix.salePriceBase,
                wholesalePrice: autoPriceMatrix.wholesalePrice,
                wholesalePriceBase: autoPriceMatrix.wholesalePriceBase,
                posPrice: autoPriceMatrix.posPrice,
                posPriceBase: autoPriceMatrix.posPriceBase,
                wholesaleWholesalePrice: autoPriceMatrix.wholesaleWholesalePrice,
                wholesaleWholesalePriceBase: autoPriceMatrix.wholesaleWholesalePriceBase,
                distributionPrice: autoPriceMatrix.distributionPrice,
                distributionPriceBase: autoPriceMatrix.distributionPriceBase,
                delegatePrice: autoPriceMatrix.delegatePrice,
                delegatePriceBase: autoPriceMatrix.delegatePriceBase,
                priceCurrency: BASE_CURRENCY,
                lastPurchasePriceTransaction: Number(line.unitPriceTransaction ?? line.unitPrice ?? 0),
                lastPurchaseCurrency: invoiceCurrency,
                lastPurchaseExchangeRate: Number(payload.exchangeRate || 1),
                lastPurchaseAt: String(payload.date || new Date().toISOString()),
                warehouseId,
                warehouseName: payload.targetWarehouseName || 'المستودع',
                lastUpdated: new Date().toISOString(),
              }).run();
              line.itemId = itemId;
              itemRow = await tx.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
            } else if (itemRow && invType === 'purchase' && lineHasExplicitPurchaseMoney(line)) {
              // Existing items must receive the posted purchase cost even when no extra landed cost exists.
              const itemPatch: Record<string, any> = {
                costPrice: landedUnitCost,
                costPriceBase: landedUnitCost,
                lastPurchasePriceTransaction: Number(line.unitPriceTransaction ?? line.unitPrice ?? 0),
                lastPurchaseCurrency: invoiceCurrency,
                lastPurchaseExchangeRate: Number(payload.exchangeRate || 1),
                lastPurchaseAt: String(payload.date || new Date().toISOString()),
                lastUpdated: new Date().toISOString(),
              };
              if (!String((itemRow as any).unitId || '').trim() && resolvedUnit.unitId) {
                itemPatch.unitId = resolvedUnit.unitId;
              }
              if (!String((itemRow as any).unitName || '').trim() && resolvedUnit.unitName) {
                itemPatch.unitName = resolvedUnit.unitName;
              }
              if (Number((itemRow as any).salePrice || 0) <= 0) {
                itemPatch.salePrice = autoPriceMatrix.salePrice;
                itemPatch.salePriceBase = autoPriceMatrix.salePriceBase;
              }
              if (Number((itemRow as any).posPrice || 0) <= 0) {
                itemPatch.posPrice = autoPriceMatrix.posPrice;
                itemPatch.posPriceBase = autoPriceMatrix.posPriceBase;
              }
              if (Number((itemRow as any).wholesalePrice || 0) <= 0) {
                itemPatch.wholesalePrice = autoPriceMatrix.wholesalePrice;
                itemPatch.wholesalePriceBase = autoPriceMatrix.wholesalePriceBase;
              }
              if (Number((itemRow as any).wholesaleWholesalePrice || 0) <= 0) {
                itemPatch.wholesaleWholesalePrice = autoPriceMatrix.wholesaleWholesalePrice;
                itemPatch.wholesaleWholesalePriceBase = autoPriceMatrix.wholesaleWholesalePriceBase;
              }
              if (Number((itemRow as any).distributionPrice || 0) <= 0) {
                itemPatch.distributionPrice = autoPriceMatrix.distributionPrice;
                itemPatch.distributionPriceBase = autoPriceMatrix.distributionPriceBase;
              }
              if (Number((itemRow as any).delegatePrice || 0) <= 0) {
                itemPatch.delegatePrice = autoPriceMatrix.delegatePrice;
                itemPatch.delegatePriceBase = autoPriceMatrix.delegatePriceBase;
              }
              await tx.update(schema.items).set(itemPatch).where(eq(schema.items.id, (itemRow as any).id)).run();
              // Re-read updated row
              itemRow = await tx.select().from(schema.items).where(eq(schema.items.id, (itemRow as any).id)).get();
            }

            if (itemRow) {
              assertCompanyConsistency('item', itemRow, effectiveCompanyId, 'الصنف غير موجود ضمن المؤسسة الحالية.');
              assertBranchConsistency('item', itemRow, effectiveBranchId, 'فرع الصنف لا يطابق فرع الفاتورة.');
              if (enforceAuthScope) {
                assertEntityBelongsToAllowedBranch(itemRow, authContext || {}, 'الصنف خارج الفروع المسموح بها.');
              }
            }

            const itemType = (itemRow as any)?.itemType || (line as any).itemType || '';
            if (itemType === 'SERVICE' || itemType === 'NON_STOCK') continue;
            await adjustItemStockWithMovement(tx, {
              itemId,
              warehouseId,
              warehouseName: payload.targetWarehouseName || null,
              unitId: resolvedUnit.unitId || null,
              unitName: resolvedUnit.unitName || null,
              qtyDelta: qtySign * Number(line.quantity || 0),
              baseQtyDelta: qtySign * Number(line.baseQuantity ?? line.quantity ?? 0),
              meta: {
                documentType: 'INVOICE',
                documentId: id,
                documentNumber: payload.invoiceNumber,
                movementType: invType,
                userId: payload.createdById || null,
                userName: payload.createdByName || null,
                notes: payload.notes || null,
              },
            });

            if (line.isTextile) {
              adjustTextileStock(tx, schema, {
                companyId: payload.companyId || null,
                branchId: payload.branchId || null,
                warehouseId,
                warehouseName: payload.targetWarehouseName || null,
                itemId,
                colorId: String(line.textileColorId || ''),
                baseUom: String(line.textileBaseUom || resolvedUnit.unitName || 'meter') as any,
                rollDelta: qtySign * Number(line.textileRollCount || 0),
                lengthDelta: qtySign * Number(line.textileTotalLength || line.baseQuantity || 0),
                documentType: 'INVOICE',
                documentId: id,
                documentNumber: payload.invoiceNumber,
                documentLineId: String(line.sourceDispatchLineId || ''),
                movementType: invType,
                userId: payload.createdById || null,
                userName: payload.createdByName || null,
                notes: payload.notes || null,
              });
            }
          }
        }
      }

        if (Number(payload.applyStock || 0) === 1) {
        for (const line of items) {
          const itemRecord = await tx.select().from(schema.items).where(eq(schema.items.id, String(line.itemId || ''))).get();
          if (!itemRecord) continue;
          assertCompanyConsistency('item', itemRecord, effectiveCompanyId, 'الصنف غير موجود ضمن المؤسسة الحالية.');
          assertBranchConsistency('item', itemRecord, effectiveBranchId, 'فرع الصنف لا يطابق فرع الفاتورة.');
          if (enforceAuthScope) {
            assertEntityBelongsToAllowedBranch(itemRecord, authContext || {}, 'الصنف خارج الفروع المسموح بها.');
          }
          const tracking = String((itemRecord as any).serialTracking || 'none');
          const serialNumbers = parseSerialNumbers(line);
          if (tracking === 'none' || serialNumbers.length === 0) continue;
          const targetWarehouseId = String(line.warehouseId || payload.targetWarehouseId || '');

          if (invType === 'purchase' || invType === 'opening_stock') {
            for (const serialNumber of serialNumbers) {
              const existingSerial = await tx.select().from(schema.itemSerials).where(eq(schema.itemSerials.serialNumber, serialNumber)).get();
              if (existingSerial) {
                throw appError(409, 'SERIAL_ALREADY_EXISTS', `رقم السيريال مستخدم مسبقاً: ${serialNumber}`);
              }
              await tx.insert(schema.itemSerials).values({
                id: `iserial-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                companyId: payload.companyId || null,
                branchId: payload.branchId || null,
                itemId: String(line.itemId || ''),
                serialNumber,
                warehouseId: targetWarehouseId || null,
                status: 'available',
                purchaseInvoiceId: id,
                salesInvoiceId: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).run();
            }
            continue;
          }

          if (invType === 'sale' || (invType === 'exchange' && String(payload.returnType || '').toLowerCase() !== 'purchase')) {
            for (const serialNumber of serialNumbers) {
              const serialRow = await tx.select().from(schema.itemSerials).where(eq(schema.itemSerials.serialNumber, serialNumber)).get();
              if (!serialRow || String(serialRow.itemId || '') !== String(line.itemId || '')) {
                throw appError(409, 'SERIAL_NOT_FOUND_FOR_ITEM', `رقم السيريال غير موجود على الصنف: ${serialNumber}`);
              }
              assertCompanyConsistency('serial', serialRow, effectiveCompanyId, 'رقم السيريال غير موجود ضمن المؤسسة الحالية.');
              assertBranchConsistency('serial', serialRow, effectiveBranchId, 'فرع رقم السيريال لا يطابق فرع الفاتورة.');
              if (enforceAuthScope) {
                assertEntityBelongsToAllowedBranch(serialRow, authContext || {}, 'رقم السيريال خارج الفروع المسموح بها.');
              }
              if (String(serialRow.status || '') !== 'available') {
                throw appError(409, 'SERIAL_NOT_AVAILABLE', `رقم السيريال غير متاح للبيع: ${serialNumber}`);
              }
              await tx.update(schema.itemSerials).set({
                status: 'sold',
                salesInvoiceId: id,
                updatedAt: new Date().toISOString(),
              }).where(eq(schema.itemSerials.id, serialRow.id)).run();
            }
            continue;
          }

          if (invType === 'return') {
            for (const serialNumber of serialNumbers) {
              const serialRow = await tx.select().from(schema.itemSerials).where(eq(schema.itemSerials.serialNumber, serialNumber)).get();
              if (!serialRow || String(serialRow.itemId || '') !== String(line.itemId || '')) {
                throw appError(409, 'SERIAL_NOT_FOUND_FOR_ITEM', `رقم السيريال غير موجود على الصنف: ${serialNumber}`);
              }
              assertCompanyConsistency('serial', serialRow, effectiveCompanyId, 'رقم السيريال غير موجود ضمن المؤسسة الحالية.');
              assertBranchConsistency('serial', serialRow, effectiveBranchId, 'فرع رقم السيريال لا يطابق فرع الفاتورة.');
              if (enforceAuthScope) {
                assertEntityBelongsToAllowedBranch(serialRow, authContext || {}, 'رقم السيريال خارج الفروع المسموح بها.');
              }
              await tx.update(schema.itemSerials).set({
                status: 'returned',
                updatedAt: new Date().toISOString(),
              }).where(eq(schema.itemSerials.id, serialRow.id)).run();
            }
          }
        }
      }

      if (invType === 'opening_stock') {
        await tx.insert(schema.vouchers).values({
          id: `v-opening-${id}`,
          companyId: payload.companyId || null,
          branchId: payload.branchId || null,
          type: 'adjustment',
          date: payload.date,
          amount: invoiceTotalBase,
          amountBase: invoiceTotalBase,
          amountTransaction: invoiceTotalTransaction,
          originalAmount: invoiceTotalTransaction,
          currency: invoiceCurrency,
          exchangeRate: Number(payload.exchangeRate || 1),
          category: 'رصيد أول مدة مخزون',
          description: `إثبات افتتاح مخزون فاتورة ${payload.invoiceNumber}`,
          referenceNumber: payload.invoiceNumber,
          linkedInvoiceId: id,
        }).run();
        await tx.insert(schema.reconciliationMarks).values({
          id: `rm-opening-${id}`,
          companyId: payload.companyId || null,
          branchId: payload.branchId || null,
          scopeType: 'inventory',
          scopeId: payload.targetWarehouseId || 'default',
          reportType: 'opening_stock',
          markAt: new Date().toISOString(),
          rowRefId: id,
          note: payload.notes
            ? `Opening stock posted: ${payload.invoiceNumber} | ${payload.notes}`
            : `Opening stock posted: ${payload.invoiceNumber}`,
        }).run();
      }
      });
    } catch (error: any) {
      throw remapInvoiceCreateError(error);
    }

    try {
      const lines = await buildInvoiceJournalLines(payload);
      if (lines.length > 0) {
        const entry = await createJournalEntry({
          description: buildDescription(invType === 'sale' ? ACCOUNTING_LABELS.SALE_INVOICE : invType === 'purchase' ? ACCOUNTING_LABELS.PURCHASE_INVOICE : invType === 'opening_stock' ? ACCOUNTING_LABELS.OPENING_STOCK : ACCOUNTING_LABELS.SALE_RETURN, ACCOUNTING_LABELS.NUMBER, payload.invoiceNumber),
          referenceType: 'invoice',
          referenceId: null,
          lines,
          companyId: payload.companyId || null,
          branchId: payload.branchId || null,
          currencyCode: payload.currency || 'USD',
        });
        await postJournalEntry(entry.id);
        await db.update(schema.invoices).set({ journalEntryId: entry.id }).where(eq(schema.invoices.id, id)).run();
      }
    } catch (error: any) {
      await rollbackInvoice(payload, items, error?.message || 'JOURNAL_FAILED');
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
        severity: 'critical',
        sourceModule: 'invoices',
        action: 'create',
        status: 'failed',
        errorCode: 'INVOICE_JOURNAL_CREATION_FAILED',
        affectedDocumentType: 'invoice',
        affectedDocumentId: id,
        metadata: {
          stage: 'journal',
          invoiceNumber: payload.invoiceNumber,
          message: error?.message || 'Failed to create journal entry',
        },
      });
      throw appError(500, 'INVOICE_JOURNAL_CREATION_FAILED', error?.message || 'Failed to create journal entry');
    }

    try {
      const rawPaymentSplit = Array.isArray(data.paymentSplit) ? data.paymentSplit : [];
      const normalizedSplit = rawPaymentSplit
        .map((line: any, index: number) => {
          const currencyCode = normalizeCurrencyCode(line?.currency || line?.currencyCode || line?.code);
          const rate = normalizeExchangeRate(currencyCode, line?.rate ?? line?.exchangeRate ?? line?.fxRate);
          const rawAmount = Number(line?.amount ?? line?.amountTransaction ?? line?.originalAmount ?? 0);
          const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
          if (!amount || amount <= 0) return null;
          const rawBase = Number(line?.amountBase ?? (currencyCode === BASE_CURRENCY ? amount : (rate > 0 ? amount / rate : amount)));
          const amountBase = Number.isFinite(rawBase) ? rawBase : 0;
          if (!amountBase || amountBase <= 0) return null;
          return {
            currency: currencyCode,
            amount: roundMoney(amount),
            amountBase: roundMoney(amountBase),
            rate,
            index,
          };
        })
        .filter(Boolean) as Array<{ currency: string; amount: number; amountBase: number; rate: number; index: number }>;
      const paidBaseTotal = Number(payload.paidAmountBase || 0);

      if (['sale', 'purchase'].includes(invType) && paidBaseTotal > 0) {
        // Scope cashbox lookup to the invoice's company (and branch if set) to prevent cross-company cashbox pickup
        const defaultBox = data.cashBoxId ? null : await db
          .select()
          .from(schema.cashBoxes)
          .where(
            effectiveBranchId
              ? sql`${schema.cashBoxes.companyId} = ${effectiveCompanyId} AND ${schema.cashBoxes.branchId} = ${effectiveBranchId}`
              : sql`${schema.cashBoxes.companyId} = ${effectiveCompanyId}`
          )
          .limit(1)
          .get();
        const cashBoxId = data.cashBoxId || defaultBox?.id;
        const cashBoxName = data.cashBoxName || defaultBox?.name;
        if (!cashBoxId) throw appError(409, 'CASH_BOX_REQUIRED', 'لا يوجد صندوق متاح للفواتير النقدية.');
        const voucherLines = normalizedSplit.length > 0 ? normalizedSplit : [{
          currency: invoiceCurrency,
          amount: invoiceCurrency === BASE_CURRENCY
            ? roundMoney(paidBaseTotal)
            : roundMoney(paidBaseTotal * Number(payload.exchangeRate || 1)),
          amountBase: roundMoney(paidBaseTotal),
          rate: Number(payload.exchangeRate || 1),
          index: 0,
        }];

        for (const [idx, line] of voucherLines.entries()) {
          const suffix = voucherLines.length > 1 ? `-${line.currency.toLowerCase()}-${idx + 1}` : '';
          const voucherId = `v-inv-${id}${suffix}`;
          const voucherDescription = `${invType === 'sale' ? 'فاتورة مبيعات' : 'فاتورة مشتريات'} ${line.currency} رقم ${payload.invoiceNumber}`;
          await createVoucherWithAccounting({
            id: voucherId,
            companyId: payload.companyId || null,
            branchId: payload.branchId || null,
            type: invType === 'sale' ? 'receipt' : 'payment',
            date: payload.date,
            amount: line.amountBase,
            amountBase: line.amountBase,
            amountTransaction: line.amount,
            originalAmount: line.amount,
            currency: line.currency,
            exchangeRate: line.rate,
            cashBoxId,
            cashBoxName,
            clientId: payload.clientId || null,
            clientName: payload.clientName || null,
            category: invType === 'sale' ? 'مبيعات نقدية' : 'مشتريات نقدية',
            description: voucherDescription,
            referenceNumber: await getNextDocNumber('voucher'),
            linkedInvoiceId: id,
          });
        }
      }
    } catch (error: any) {
      await rollbackInvoice(payload, items, error?.message || 'VOUCHER_FAILED');
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
        severity: 'critical',
        sourceModule: 'invoices',
        action: 'create',
        status: 'failed',
        errorCode: 'INVOICE_VOUCHER_CREATION_FAILED',
        affectedDocumentType: 'invoice',
        affectedDocumentId: id,
        metadata: {
          stage: 'voucher',
          invoiceNumber: payload.invoiceNumber,
          message: error?.message || 'Failed to create linked voucher',
        },
      });
      throw appError(500, 'INVOICE_VOUCHER_CREATION_FAILED', error?.message || 'Failed to create linked voucher');
    }

    try {
      await auditLogger.log({
        userId: payload.createdById || 'system',
        operationType: 'invoice.create',
        affectedItems: [{ invoiceId: id, invoiceNumber: payload.invoiceNumber }],
        newValues: { payload: { ...payload, items } },
        meta: { sourceDocumentType: payload.sourceDocumentType, sourceDocumentId: payload.sourceDocumentId },
        mandatory: true,
      });
    } catch (error: any) {
      let rollbackError: any = null;
      try {
        await rollbackInvoice(
          { ...payload, journalEntryId: (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get())?.journalEntryId || null },
          items,
          'AUDIT_FAILED',
          { skipAudit: true },
        );
      } catch (cleanupError: any) {
        rollbackError = cleanupError;
      }
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
        severity: rollbackError ? 'critical' : 'critical',
        sourceModule: 'invoices',
        action: 'create',
        status: rollbackError ? 'partial' : 'failed',
        errorCode: 'MANDATORY_AUDIT_FAILED',
        requiresManualReview: true,
        affectedDocumentType: 'invoice',
        affectedDocumentId: id,
        metadata: {
          stage: 'audit',
          invoiceNumber: payload.invoiceNumber,
          message: error?.message || 'Mandatory audit logging failed.',
          rollbackError: rollbackError?.message || null,
        },
      });
      throw appError(500, 'MANDATORY_AUDIT_FAILED', error?.message || 'Mandatory audit logging failed.', rollbackError ? {
        requires_manual_review: true,
        affected_document_type: 'invoice',
        affected_document_id: id,
        cleanup_error_code: String(rollbackError?.code || 'AUDIT_ROLLBACK_FAILED'),
        cleanup_error_message: rollbackError?.message || 'Invoice rollback after audit failure did not complete cleanly.',
      } : undefined);
    }
    try {
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.INVOICE_CREATED,
        severity: 'info',
        sourceModule: 'invoices',
        action: 'create',
        status: 'success',
        affectedDocumentType: 'invoice',
        affectedDocumentId: id,
        metadata: {
          invoiceNumber: payload.invoiceNumber,
          invoiceType: invType,
          totalAmountBase: invoiceTotalBase,
          totalAmountTransaction: invoiceTotalTransaction,
          currency: invoiceCurrency,
          paymentType: payload.paymentType || null,
          sourceDocumentType: payload.sourceDocumentType || null,
        },
      });
      const posFlag = String(payload.sourceDocumentType || payload.source || payload.channel || '').toLowerCase() === 'pos'
        || Boolean((payload as any).isPos);
      if (invType === 'sale' && posFlag) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.POS_SALE_COMPLETED,
          severity: 'info',
          sourceModule: 'pos',
          action: 'sale.complete',
          status: 'success',
          affectedDocumentType: 'invoice',
          affectedDocumentId: id,
          metadata: {
            invoiceNumber: payload.invoiceNumber,
            totalAmountBase: invoiceTotalBase,
            currency: invoiceCurrency,
          },
        });
      }
    } catch {}
    return {
      success: true,
      id,
      queueNumber: issuedQueue.queueNumber,
      queueScope: issuedQueue.queueScope,
      queueDate: issuedQueue.queueDate,
    };
  };

  const postInvoice = async (id: string, auditContext?: any) => {
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get();
    if (!invoice) throw appError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
    if ((invoice as any).journalEntryId) return { success: true, journalEntryId: (invoice as any).journalEntryId };
    const lines = await buildInvoiceJournalLines(invoice);
    if (lines.length === 0) return { success: true, journalEntryId: null };
    const invoiceType = String((invoice as any).type || '').toLowerCase();
    const descriptionLabel =
      invoiceType === 'purchase'
        ? ACCOUNTING_LABELS.PURCHASE_INVOICE
        : invoiceType === 'opening_stock'
          ? ACCOUNTING_LABELS.OPENING_STOCK
          : ACCOUNTING_LABELS.SALE_INVOICE;
    const entry = await createJournalEntry({
      description: buildDescription(descriptionLabel, ACCOUNTING_LABELS.NUMBER, (invoice as any).invoiceNumber),
      referenceType: 'invoice',
      referenceId: null,
      lines,
      companyId: (invoice as any).companyId || null,
      branchId: (invoice as any).branchId || null,
      currencyCode: (invoice as any).currency || BASE_CURRENCY,
    });
    await postJournalEntry(entry.id);
    await db.update(schema.invoices).set({ journalEntryId: entry.id }).where(eq(schema.invoices.id, id)).run();
    await auditLogger.log({ userId: auditContext?.userId || 'system', operationType: 'invoice.post', affectedItems: [{ invoiceId: id }], newValues: { journalEntryId: entry.id } });
    await systemEventLogger?.log({
      eventType: SYSTEM_EVENT_TYPES.INVOICE_POSTED,
      severity: 'info',
      sourceModule: 'invoices',
      action: 'post',
      status: 'success',
      affectedDocumentType: 'invoice',
      affectedDocumentId: id,
      metadata: {
        invoiceNumber: (invoice as any).invoiceNumber || null,
        journalEntryId: entry.id,
        invoiceType: invoiceType,
      },
    });
    return { success: true, journalEntryId: entry.id };
  };

  const cancelInvoice = async (id: string, auditContext?: any) => {
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get();
    if (!invoice) throw appError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
    const jeId = Number((invoice as any).journalEntryId || 0);
    if (jeId > 0) await reverseJournalEntry(jeId, 'إلغاء فاتورة');
    await auditLogger.log({ userId: auditContext?.userId || 'system', operationType: 'invoice.cancel', affectedItems: [{ invoiceId: id }], oldValues: invoice });
    return { success: true };
  };

  const cancelInvoiceHard = async (id: string, auditContext?: any) => {
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get();
    if (!invoice) throw appError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
    const items = safeJsonParse((invoice as any).items, []);
    try {
      await rollbackInvoice(invoice, items, 'INVOICE_CANCELLED', { skipAudit: true });
      await auditLogger.log({
        userId: auditContext?.userId || 'system',
        operationType: 'invoice.cancel',
        affectedItems: [{ invoiceId: id }],
        oldValues: invoice,
      });
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.INVOICE_CANCEL,
        severity: 'info',
        sourceModule: 'invoices',
        action: 'cancel',
        status: 'success',
        affectedDocumentType: 'invoice',
        affectedDocumentId: id,
        metadata: {
          invoiceNumber: (invoice as any).invoiceNumber || null,
          cancelledBy: auditContext?.userId || 'system',
        },
      });
      return { success: true, hardDeleted: true };
    } catch (error: any) {
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.INVOICE_CANCEL,
        severity: 'critical',
        sourceModule: 'invoices',
        action: 'cancel',
        status: 'failed',
        errorCode: String(error?.code || 'INVOICE_CANCEL_FAILED'),
        requiresManualReview: Boolean(error?.details?.requires_manual_review),
        affectedDocumentType: 'invoice',
        affectedDocumentId: id,
        compensationStatus: error?.details?.compensation || null,
        metadata: {
          invoiceNumber: (invoice as any).invoiceNumber || null,
          message: error?.message || 'Invoice cancel failed.',
          details: error?.details || null,
        },
      });
      throw error;
    }
  };

  return { createInvoice, postInvoice, cancelInvoice: cancelInvoiceHard };
};
