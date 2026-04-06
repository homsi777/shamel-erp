import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { BULK_PRICE_FIELD_MAP, buildBulkPricePreview, getNumeric, inferSystemCurrency, type CurrencyRatesMap } from '../../src/lib/bulkPriceEngine';
import type { BulkPriceUpdatePayload, InventoryItem } from '../../src/types';
import { loadNormalizedSettingsMap } from '../lib/settings';
import { appError, isAppError } from '../lib/errors';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  assertWarehouseAccess,
  filterRowsByTenantScope,
  hasBranchAccess,
  pickEffectiveBranchId,
  resolveWarehouseForContext,
} from '../lib/tenantScope';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, appendAudit, buildPartyStatement, getBackupDir, buildBackupPayload, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, fs, path, getResolvedDbPath, closeDb, bcrypt, server, getLocalIp, adjustItemStockWithMovement } = ctx as any;
  const getAuthContext = (req: any) => (req as any).authContext || {};
  const scopeRows = (rows: any[], req: any, collection: string) =>
    filterRowsByTenantScope(rows, getAuthContext(req), collection);
  const getRequestUser = async (req: any) => {
    try {
      await req.jwtVerify();
      if (req?.user?.id) {
        const jwtUser = await db.select().from(schema.users).where(eq(schema.users.id, String(req.user.id))).get();
        if (jwtUser) return jwtUser;
      }
    } catch {}
    const bodyUserId = String(req?.body?.userId || '').trim();
    if (!bodyUserId) return null;
    return db.select().from(schema.users).where(eq(schema.users.id, bodyUserId)).get();
  };

  const assertItemScope = (item: any, req: any, notFoundMessage = 'المادة غير موجودة ضمن النطاق الحالي.') => {
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(item, String(authContext.companyId || ''), notFoundMessage);
    assertEntityBelongsToAllowedBranch(item, authContext, notFoundMessage);
  };

  const validateTransferBranchAccess = async (req: any, fromWarehouseId: string, toWarehouseId: string) => {
    const authContext = getAuthContext(req);
    const fromWarehouse = await resolveWarehouseForContext(db, schema, eq, String(fromWarehouseId || ''));
    const toWarehouse = await resolveWarehouseForContext(db, schema, eq, String(toWarehouseId || ''));
    assertWarehouseAccess(fromWarehouse, authContext);
    assertWarehouseAccess(toWarehouse, authContext);
    const companyId = String(authContext.companyId || '').trim();
    assertEntityBelongsToCompany(fromWarehouse, companyId, 'المستودع المصدر غير موجود.');
    assertEntityBelongsToCompany(toWarehouse, companyId, 'المستودع الهدف غير موجود.');
    const fromBranchId = String((fromWarehouse as any)?.branchId || '').trim();
    const toBranchId = String((toWarehouse as any)?.branchId || '').trim();
    if (fromBranchId && !hasBranchAccess(authContext, fromBranchId)) {
      throw appError(403, 'BRANCH_ACCESS_DENIED', 'المستودع المصدر خارج الفروع المسموح بها.');
    }
    if (toBranchId && !hasBranchAccess(authContext, toBranchId)) {
      throw appError(403, 'BRANCH_ACCESS_DENIED', 'المستودع الهدف خارج الفروع المسموح بها.');
    }
    return { fromWarehouse, toWarehouse };
  };

  const hasAnyPermission = (user: any, permissions: string[]) => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'admin') return true;
    const perms = String(user.permissions || '')
      .split(',')
      .map((value: string) => String(value || '').trim())
      .filter(Boolean);
    return permissions.some((perm) => perms.includes(perm) || perms.includes('*'));
  };

  const getCurrencyRatesFromSettings = async (req: any) => {
    const settingsMap = await loadNormalizedSettingsMap(db, schema, {
      companyId: String(getAuthContext(req).companyId || '').trim() || null,
      branchId: String(getAuthContext(req).branchId || '').trim() || null,
    });
    const parsed = settingsMap.get('currencyRates') || {};
    return { USD: 1, ...(parsed || {}) } as CurrencyRatesMap;
  };

  const getBulkPriceUpdatePermissions = (payload: BulkPriceUpdatePayload) => {
    const permissions = new Set<string>();
    if (payload.scope === 'single') {
      permissions.add('price_edit');
    } else {
      permissions.add('price_bulk_edit');
    }
    if (payload.useDailyExchangeRate || payload.operation === 'adjust_exchange_rate') {
      permissions.add('exchange_rate_update');
    }
    return Array.from(permissions);
  };

  const buildBulkPriceFieldPatch = (targetField: BulkPriceUpdatePayload['targetField'], value: number, timestamp: string) => {
    const fieldMeta = BULK_PRICE_FIELD_MAP[targetField];
    return {
      [fieldMeta.key]: value,
      lastUpdated: timestamp,
    };
  };

  const parseJsonArray = (value: any): string[] => {
    if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const resolvePromotionForLine = async (itemId: string, quantity: number, referenceDate?: string) => {
    const promotions = await db.select().from(schema.promotions).all();
    const today = String(referenceDate || new Date().toISOString().slice(0, 10));
    const activePromotion = (promotions || []).find((promotion: any) => {
      const itemIds = parseJsonArray(promotion.itemIds);
      return String(promotion.status || 'active') === 'active'
        && itemIds.includes(itemId)
        && String(promotion.startDate || '') <= today
        && String(promotion.endDate || '') >= today;
    });
    if (!activePromotion) return null;

    return {
      id: String(activePromotion.id),
      name: String(activePromotion.name || ''),
      discountType: String(activePromotion.discountType || ''),
      discountPercent: Number(activePromotion.discountPercent || 0),
      discountValue: Number(activePromotion.discountValue || 0),
      specialPrice: Number(activePromotion.specialPrice || 0),
      buyQuantity: Number(activePromotion.buyQuantity || 0),
      getDiscountPercent: Number(activePromotion.getDiscountPercent || 0),
      quantity: Number(quantity || 0),
    };
  };

api.get('/inventory/transfers', async (req) => {
    try { return scopeRows(await db.select().from(schema.stockTransfers).all(), req, 'stock-transfers'); } catch (e) { return []; }
});

api.get('/parties/transfers', async (req) => {
    try { return scopeRows(await db.select().from(schema.partyTransfers).all(), req, 'party-transfers'); } catch (e) { return []; }
});

api.post('/inventory/transfer', async (req, reply) => {
    try {
        const data = req.body as any;
        const authContext = getAuthContext(req);
        const id = `st-${Date.now()}`;
        const qty = Number(data.baseQuantity ?? data.quantity ?? 0);
        const fromWarehouseId = data.fromWarehouseId || data.fromWH;
        const toWarehouseId = data.toWarehouseId || data.toWH;
        const transferDate = data.date || new Date().toISOString();
        const payload: any = {
            id,
            transferNumber: data.transferNumber || data.transferNo || Date.now().toString().slice(-6),
            itemId: data.itemId,
            itemName: data.itemName,
            itemCode: data.itemCode,
            fromItemId: data.itemId,
            toItemId: null,
            fromWarehouseId,
            fromWarehouseName: data.fromWarehouseName,
            toWarehouseId,
            toWarehouseName: data.toWarehouseName,
            quantity: qty,
            unitName: data.unitName,
            date: transferDate,
            notes: data.notes,
        };
        if (!payload.itemId || !fromWarehouseId || !toWarehouseId || !qty) {
            return reply.status(400).send({ error: 'البيانات المطلوبة للمناقلة غير مكتملة.' });
        }
if (fromWarehouseId === toWarehouseId) {
            return reply.status(400).send({ error: 'لا يمكن المناقلة لنفس المستودع.' });
        }

        const { fromWarehouse, toWarehouse } = await validateTransferBranchAccess(req, String(fromWarehouseId), String(toWarehouseId));

        const sourceItem = await db.select().from(schema.items).where(eq(schema.items.id, payload.itemId)).get();
        if (!sourceItem) return reply.status(404).send({ error: 'المادة غير موجودة.' });
        assertItemScope(sourceItem, req);
        const srcType = (sourceItem as any).itemType || '';
        if (srcType === 'SERVICE' || srcType === 'NON_STOCK') {
            return reply.status(400).send({ error: 'لا يمكن مناقلة مخزون صنف خدمة أو صنف غير مخزني.' });
        }
        if (sourceItem.warehouseId && String(sourceItem.warehouseId) !== String(fromWarehouseId)) {
            return reply.status(409).send({ error: 'المستودع المصدر لا يطابق مستودع المادة.' });
        }
        const available = Number(sourceItem.quantity || 0);
        if (available < qty) {
            return reply.status(409).send({ error: `الكمية غير كافية في المستودع المصدر. المتاح: ${available}` });
        }

        const nowIso = new Date().toISOString();

        // Pre-check destination item type before entering transaction
        const existingDestPre = await db.select().from(schema.items)
            .where(sql`${schema.items.code} = ${sourceItem.code} AND ${schema.items.warehouseId} = ${toWarehouseId}`)
            .get();
        if (existingDestPre) {
            assertItemScope(existingDestPre, req);
            const destType = (existingDestPre as any).itemType || '';
            if (destType === 'SERVICE' || destType === 'NON_STOCK') {
                return reply.status(400).send({ error: 'لا يمكن مناقلة مخزون إلى صنف خدمة أو صنف غير مخزني.' });
            }
        }

        // Wrap both stock movements and the transfer record in a single atomic transaction
        let destItemId: string = '';
        await db.transaction(async (tx: any) => {
            // TRANSFER_OUT from source
            await adjustItemStockWithMovement(tx, {
                itemId: String(payload.itemId),
                warehouseId: String(fromWarehouseId),
                warehouseName: payload.fromWarehouseName || sourceItem.warehouseName || fromWarehouse?.name || null,
                unitId: (sourceItem as any).unitId || null,
                unitName: payload.unitName || sourceItem.unitName || null,
                qtyDelta: -qty,
                baseQtyDelta: -qty,
                meta: {
                    documentType: 'TRANSFER',
                    documentId: id,
                    documentNumber: payload.transferNumber,
                    movementType: 'TRANSFER_OUT',
                    userId: String(authContext.userId || '') || null,
                    userName: String(authContext.username || '') || null,
                    notes: payload.notes || null,
                },
            });

            const existingDest = await tx.select().from(schema.items)
                .where(sql`${schema.items.code} = ${sourceItem.code} AND ${schema.items.warehouseId} = ${toWarehouseId}`)
                .get();

            if (existingDest) {
                destItemId = existingDest.id;
            } else {
                destItemId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const whName = payload.toWarehouseName || toWarehouse?.name || '';
                await tx.insert(schema.items).values({
                    id: destItemId,
                    companyId: (fromWarehouse as any)?.companyId || (sourceItem as any)?.companyId || authContext.companyId || null,
                    branchId: (toWarehouse as any)?.branchId || (sourceItem as any)?.branchId || authContext.branchId || null,
                    name: sourceItem.name,
                    code: sourceItem.code,
                    barcode: sourceItem.barcode || '',
                    serialNumber: sourceItem.serialNumber || null,
                    unitName: sourceItem.unitName || payload.unitName || null,
                    unitId: sourceItem.unitId || null,
                    quantity: 0,
                    costPrice: Number(sourceItem.costPrice || 0),
                    costPriceBase: Number((sourceItem as any).costPriceBase || sourceItem.costPrice || 0),
                    salePrice: Number(sourceItem.salePrice || 0),
                    salePriceBase: Number((sourceItem as any).salePriceBase || sourceItem.salePrice || 0),
                    wholesalePrice: Number((sourceItem as any).wholesalePrice || 0),
                    wholesalePriceBase: Number((sourceItem as any).wholesalePriceBase || (sourceItem as any).wholesalePrice || 0),
                    posPrice: Number((sourceItem as any).posPrice ?? sourceItem.salePrice ?? 0),
                    posPriceBase: Number((sourceItem as any).posPriceBase ?? (sourceItem as any).posPrice ?? sourceItem.salePrice ?? 0),
                    pricePerMeter: Number((sourceItem as any).pricePerMeter || 0),
                    priceCurrency: (sourceItem as any).priceCurrency || 'USD',
                    lastPurchasePriceTransaction: Number((sourceItem as any).lastPurchasePriceTransaction || 0),
                    lastPurchaseCurrency: (sourceItem as any).lastPurchaseCurrency || null,
                    lastPurchaseExchangeRate: Number((sourceItem as any).lastPurchaseExchangeRate || 1),
                    lastPurchaseAt: (sourceItem as any).lastPurchaseAt || null,
                    warehouseId: toWarehouseId,
                    warehouseName: whName,
                    categoryId: (sourceItem as any).categoryId || null,
                    subCategoryId: (sourceItem as any).subCategoryId || null,
                    imageUrl: (sourceItem as any).imageUrl || null,
                    minStockAlert: Number((sourceItem as any).minStockAlert || 5),
                    model: (sourceItem as any).model || null,
                    dimensions: (sourceItem as any).dimensions || null,
                    color: (sourceItem as any).color || null,
                    origin: (sourceItem as any).origin || null,
                    manufacturer: (sourceItem as any).manufacturer || null,
                    grossWeight: Number((sourceItem as any).grossWeight || 0),
                    netWeight: Number((sourceItem as any).netWeight || 0),
                    isScaleItem: Boolean((sourceItem as any).isScaleItem),
                    scalePluCode: (sourceItem as any).scalePluCode || null,
                    scaleBarcodePrefix: (sourceItem as any).scaleBarcodePrefix || null,
                    scaleBarcodeMode: (sourceItem as any).scaleBarcodeMode || null,
                    scaleUnit: (sourceItem as any).scaleUnit || null,
                    scalePricePerKg: Number((sourceItem as any).scalePricePerKg || 0) || null,
                    scaleItemCodeLength: Number((sourceItem as any).scaleItemCodeLength || 0) || null,
                    scaleValueLength: Number((sourceItem as any).scaleValueLength || 0) || null,
                    scaleDecimals: Number((sourceItem as any).scaleDecimals || 0) || 0,
                    notes: (sourceItem as any).notes || null,
                    lastUpdated: nowIso,
                }).run();
            }

            // TRANSFER_IN to destination
            await adjustItemStockWithMovement(tx, {
                itemId: String(destItemId),
                warehouseId: String(toWarehouseId),
                warehouseName: payload.toWarehouseName || toWarehouse?.name || null,
                unitId: (sourceItem as any).unitId || null,
                unitName: payload.unitName || sourceItem.unitName || null,
                qtyDelta: qty,
                baseQtyDelta: qty,
                meta: {
                    documentType: 'TRANSFER',
                    documentId: id,
                    documentNumber: payload.transferNumber,
                    movementType: 'TRANSFER_IN',
                    userId: String(authContext.userId || '') || null,
                    userName: String(authContext.username || '') || null,
                    notes: payload.notes || null,
                },
            });

            payload.toItemId = destItemId;
            payload.companyId = (fromWarehouse as any)?.companyId || authContext.companyId || null;
            payload.branchId = (fromWarehouse as any)?.branchId || authContext.branchId || null;
            payload.itemCode = payload.itemCode || sourceItem.code;
            payload.itemName = payload.itemName || sourceItem.name;
            payload.fromWarehouseName = payload.fromWarehouseName || sourceItem.warehouseName || null;
            payload.toWarehouseName = payload.toWarehouseName || toWarehouse?.name || null;

            await tx.insert(schema.stockTransfers).values(payload).run();
            await tx.insert(schema.reconciliationMarks).values({
                id: `rm-xfer-${Date.now()}`,
                companyId: payload.companyId || null,
                branchId: payload.branchId || null,
                scopeType: 'WAREHOUSE_TRANSFER',
                scopeId: String(toWarehouseId),
                reportType: 'STOCK_TRANSFER',
                markAt: transferDate,
                rowRefId: id,
                note: `مناقلة ${payload.transferNumber}`,
            }).run();
        });

        return { success: true };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});


api.put('/inventory/transfers/:id', async (req, reply) => {
    try {
        return reply.status(410).send({
            error: 'TRANSFER_UPDATE_DISABLED',
            code: 'TRANSFER_UPDATE_DISABLED',
            message: 'Editing stock transfers is disabled to preserve movement-ledger integrity. Create a compensating transfer instead.',
        });
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});

api.post('/inventory/bulk-price-update', async (req, reply) => {
    try {
        const currentUser = await getRequestUser(req);
        if (!currentUser) return reply.status(401).send({ error: 'غير مصرح.' });

        const data = (req.body || {}) as { mode?: 'preview' | 'execute'; payload?: BulkPriceUpdatePayload; currencyRates?: CurrencyRatesMap };
        const mode = data.mode === 'execute' ? 'execute' : 'preview';
        const payload = data.payload as BulkPriceUpdatePayload | undefined;
        if (!payload) return reply.status(400).send({ error: 'بيانات تعديل الأسعار غير مكتملة.' });

        const requiredPermissions = getBulkPriceUpdatePermissions(payload);
        if (!hasAnyPermission(currentUser, requiredPermissions)) {
            return reply.status(403).send({ error: 'صلاحيات غير كافية لتعديل الأسعار.' });
        }

        const currencyRates = payload.useDailyExchangeRate
            ? { ...(await getCurrencyRatesFromSettings(req)), ...((data.currencyRates || {}) as CurrencyRatesMap) }
            : ((data.currencyRates || { USD: 1 }) as CurrencyRatesMap);
        const systemCurrency = inferSystemCurrency(currencyRates);
        if (payload.operation === 'adjust_exchange_rate') {
            const exchangeRate = payload.useDailyExchangeRate
                ? Object.entries(currencyRates || {}).some(([code, rate]) => String(code || '').toUpperCase() !== systemCurrency && getNumeric(rate) > 0)
                : getNumeric(payload.exchangeRate) > 0;
            if (!exchangeRate) {
                return reply.status(400).send({ error: 'سعر الصرف غير صالح.' });
            }
        }

        const scopedItems = scopeRows(
          await db.select().from(schema.items).all(),
          req,
          'items',
        ) as InventoryItem[];
        const preview = buildBulkPricePreview(scopedItems, payload, currencyRates);

        if (mode === 'preview' || preview.affectedCount === 0) {
            return preview;
        }

        const changedById = new Map(preview.rows.map((row) => [row.itemId, row]));
        const timestamp = new Date().toISOString();

        await db.transaction(async (tx: any) => {
            for (const item of scopedItems) {
                const change = changedById.get(String(item.id));
                if (!change) continue;
                await tx.update(schema.items)
                    .set(buildBulkPriceFieldPatch(payload.targetField, change.newValue, timestamp))
                    .where(eq(schema.items.id, String(item.id)))
                    .run();
            }

            await tx.insert(schema.auditLogs).values({
                id: `audit-bulk-price-${Date.now()}`,
                userId: String(currentUser.id || 'system'),
                timestamp,
                operationType: payload.useDailyExchangeRate ? 'exchange_rate_update' : 'bulk_price_update',
                affectedItems: JSON.stringify(preview.rows.map((row) => row.itemId)),
                oldValues: JSON.stringify(Object.fromEntries(preview.rows.map((row) => [row.itemId, row.oldValue]))),
                newValues: JSON.stringify(Object.fromEntries(preview.rows.map((row) => [row.itemId, row.newValue]))),
                meta: JSON.stringify({
                    scope: payload.scope,
                    targetField: payload.targetField,
                    operation: payload.operation,
                    useDailyExchangeRate: Boolean(payload.useDailyExchangeRate),
                    sourceField: payload.sourceField || null,
                    categoryId: payload.categoryId || null,
                    unitId: payload.unitId || null,
                    groupId: payload.groupId || null,
                    amount: payload.amount ?? null,
                    amountMode: payload.amountMode || null,
                    percentage: payload.percentage ?? null,
                    marginPercent: payload.marginPercent ?? null,
                    exchangeRate: payload.exchangeRate ?? null,
                    currencyRates: payload.useDailyExchangeRate ? currencyRates : null,
                    notes: payload.notes || '',
                    affectedCount: preview.affectedCount,
                }),
            }).run();
        });

        return preview;
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});

api.get('/inventory/serials', async (req, reply) => {
    try {
        const query = (req.query || {}) as any;
        const itemId = String(query.itemId || '').trim();
        const warehouseId = String(query.warehouseId || '').trim();
        const status = String(query.status || '').trim();
        const search = String(query.search || '').trim().toLowerCase();
        const page = Math.max(1, Number(query.page || 1));
        const pageSize = Math.max(1, Math.min(200, Number(query.pageSize || 50)));

        if (itemId) {
          const item = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
          if (!item) return reply.status(404).send({ error: 'المادة غير موجودة.' });
          assertItemScope(item, req);
        }
        if (warehouseId) {
          const warehouse = await resolveWarehouseForContext(db, schema, eq, warehouseId);
          assertWarehouseAccess(warehouse, getAuthContext(req));
        }

        let rows = scopeRows(await db.select().from(schema.itemSerials).all(), req, 'item-serials');
        rows = rows.filter((row: any) => {
            if (itemId && String(row.itemId || '') !== itemId) return false;
            if (warehouseId && String(row.warehouseId || '') !== warehouseId) return false;
            if (status && String(row.status || '') !== status) return false;
            if (search && !String(row.serialNumber || '').toLowerCase().includes(search)) return false;
            return true;
        });
        rows.sort((a: any, b: any) => String(a.serialNumber || '').localeCompare(String(b.serialNumber || '')));
        const total = rows.length;
        const start = (page - 1) * pageSize;
        const paged = rows.slice(start, start + pageSize);
        return {
            rows: paged,
            total,
            page,
            pageSize,
            hasMore: start + pageSize < total,
        };
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});

api.post('/inventory/serials/import', async (req, reply) => {
    try {
        const currentUser = await getRequestUser(req);
        if (!currentUser) return reply.status(401).send({ error: 'غير مصرح.' });
        const authContext = getAuthContext(req);
        const data = (req.body || {}) as any;
        const itemId = String(data.itemId || '').trim();
        const warehouseId = String(data.warehouseId || '').trim() || null;
        const purchaseInvoiceId = String(data.purchaseInvoiceId || '').trim() || null;
        const serialNumbers = Array.isArray(data.serialNumbers)
            ? data.serialNumbers.map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

        if (!itemId) return reply.status(400).send({ error: 'معرف المادة مطلوب.' });
        if (serialNumbers.length === 0) return reply.status(400).send({ error: 'لا توجد أرقام سيريال للاستيراد.' });

        const item = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
        if (!item) return reply.status(404).send({ error: 'المادة غير موجودة.' });
        assertItemScope(item, req);

        let scopedWarehouseId = warehouseId;
        let scopedWarehouseName: string | null = null;
        let scopedWarehouseBranchId: string | null = null;
        if (warehouseId) {
          const warehouse = await resolveWarehouseForContext(db, schema, eq, warehouseId);
          assertWarehouseAccess(warehouse, authContext);
          scopedWarehouseName = String((warehouse as any)?.name || '').trim() || null;
          scopedWarehouseBranchId = String((warehouse as any)?.branchId || '').trim() || null;
        }
        if (!scopedWarehouseId) {
          scopedWarehouseId = String((item as any).warehouseId || '').trim() || null;
          if (scopedWarehouseId) {
            const fallbackWarehouse = await resolveWarehouseForContext(db, schema, eq, scopedWarehouseId);
            if (fallbackWarehouse) {
              assertWarehouseAccess(fallbackWarehouse, authContext);
              scopedWarehouseName = String((fallbackWarehouse as any)?.name || '').trim() || null;
              scopedWarehouseBranchId = String((fallbackWarehouse as any)?.branchId || '').trim() || null;
            }
          }
        }

        const scopedCompanyId = String((item as any).companyId || authContext.companyId || '').trim() || null;
        const scopedBranchId = String(
          (item as any).branchId
          || scopedWarehouseBranchId
          || authContext.branchId
          || '',
        ).trim() || null;

        const duplicateInPayload = serialNumbers.find((value: string, index: number) => serialNumbers.indexOf(value) !== index);
        if (duplicateInPayload) {
            return reply.status(409).send({ error: `رقم السيريال مكرر داخل القائمة: ${duplicateInPayload}` });
        }

        const existing = scopeRows(await db.select().from(schema.itemSerials).all(), req, 'item-serials');
        const conflicting = existing.find((row: any) => serialNumbers.includes(String(row.serialNumber || '').trim()));
        if (conflicting) {
            return reply.status(409).send({ error: `رقم السيريال مستخدم مسبقًا: ${conflicting.serialNumber}` });
        }

        const now = new Date().toISOString();
        await db.transaction(async (tx: any) => {
            for (const serialNumber of serialNumbers) {
                await tx.insert(schema.itemSerials).values({
                    id: `iserial-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    companyId: scopedCompanyId,
                    branchId: scopedBranchId,
                    itemId,
                    serialNumber,
                    warehouseId: scopedWarehouseId,
                    status: 'available',
                    purchaseInvoiceId,
                    salesInvoiceId: null,
                    createdAt: now,
                    updatedAt: now,
                }).run();
            }
            await tx.insert(schema.auditLogs).values({
                id: `audit-serial-${Date.now()}`,
                userId: String(currentUser.id || 'system'),
                companyId: scopedCompanyId,
                branchId: scopedBranchId,
                operationType: 'item_serial_import',
                affectedItems: JSON.stringify([itemId]),
                oldValues: null,
                newValues: JSON.stringify({ count: serialNumbers.length }),
                meta: JSON.stringify({ itemId, warehouseId: scopedWarehouseId, warehouseName: scopedWarehouseName, purchaseInvoiceId, serialNumbers }),
                timestamp: now,
            }).run();
        });

        return { success: true, count: serialNumbers.length };
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});

api.post('/promotions/evaluate', async (req, reply) => {
    try {
        const data = (req.body || {}) as any;
        const itemId = String(data.itemId || '').trim();
        const quantity = Number(data.quantity || 1);
        const unitPrice = Number(data.unitPrice || 0);
        const referenceDate = String(data.referenceDate || '').trim() || undefined;
        if (!itemId) return reply.status(400).send({ error: 'معرف المادة مطلوب.' });

        const promotion = await resolvePromotionForLine(itemId, quantity, referenceDate);
        if (!promotion) return { promotion: null };

        let finalPrice = unitPrice;
        if (promotion.discountType === 'percentage' && promotion.discountPercent > 0) {
            finalPrice = Math.max(0, unitPrice * (1 - promotion.discountPercent / 100));
        } else if (promotion.discountType === 'amount' && promotion.discountValue > 0) {
            finalPrice = Math.max(0, unitPrice - promotion.discountValue);
        } else if (promotion.discountType === 'special_price' && promotion.specialPrice > 0) {
            finalPrice = promotion.specialPrice;
        } else if (promotion.discountType === 'buy_quantity_discount' && promotion.buyQuantity > 0 && quantity >= promotion.buyQuantity) {
            finalPrice = Math.max(0, unitPrice * (1 - promotion.getDiscountPercent / 100));
        }

        return {
            promotion: {
                promotionId: promotion.id,
                promotionName: promotion.name,
                originalPrice: unitPrice,
                finalPrice,
                discountAmount: Math.max(0, unitPrice - finalPrice),
                label: promotion.name,
            },
        };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});

api.post('/item-groups/manage', async (req, reply) => {
    try {
        const currentUser = await getRequestUser(req);
        if (!currentUser) return reply.status(401).send({ error: 'غير مصرح.' });
        if (!hasAnyPermission(currentUser, ['group_manage'])) {
            return reply.status(403).send({ error: 'صلاحيات غير كافية لإدارة مجموعات المواد.' });
        }

        const data = (req.body || {}) as any;
        const action = String(data?.action || '').trim();
        const userId = String(currentUser.id || data?.userId || 'system');
        const timestamp = new Date().toISOString();

        if (!['create', 'update', 'delete', 'assign', 'unassign'].includes(action)) {
            return reply.status(400).send({ error: 'عملية مجموعات المواد غير مدعومة.' });
        }

        if ((action === 'create' || action === 'update') && !String(data?.name || '').trim()) {
            return reply.status(400).send({ error: 'اسم المجموعة مطلوب.' });
        }

        await db.transaction(async (tx: any) => {
            if (action === 'create') {
                const groupId = String(data?.groupId || data?.id || `igroup-${Date.now()}`);
                const groupName = String(data?.name || '').trim();
                const notes = String(data?.notes || '').trim() || null;

                await tx.insert(schema.itemGroups).values({
                    id: groupId,
                    name: groupName,
                    notes,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                }).run();

                await tx.insert(schema.auditLogs).values({
                    id: `audit-group-${Date.now()}`,
                    userId,
                    operationType: 'item_group_changes',
                    affectedItems: JSON.stringify([]),
                    oldValues: null,
                    newValues: JSON.stringify({ groupId, groupName, notes }),
                    meta: JSON.stringify({ action: 'create_group', groupId, groupName }),
                    timestamp,
                }).run();
                return;
            }

            const groupId = String(data?.groupId || data?.id || '').trim();
            const group = groupId
                ? await tx.select().from(schema.itemGroups).where(eq(schema.itemGroups.id, groupId)).get()
                : null;
            if (action !== 'unassign') {
                if (!groupId) throw new Error('معرف المجموعة مطلوب.');
                if (!group) throw new Error('المجموعة غير موجودة.');
            }

            if (action === 'update') {
                const groupName = String(data?.name || '').trim();
                const notes = String(data?.notes || '').trim() || null;
                await tx.update(schema.itemGroups)
                    .set({ name: groupName, notes, updatedAt: timestamp })
                    .where(eq(schema.itemGroups.id, groupId))
                    .run();
                const linkedItems = await tx.select().from(schema.items).where(eq(schema.items.groupId, groupId)).all();
                for (const item of linkedItems || []) {
                    await tx.update(schema.items)
                        .set({ groupName: groupName, lastUpdated: timestamp })
                        .where(eq(schema.items.id, (item as any).id))
                        .run();
                }
                await tx.insert(schema.auditLogs).values({
                    id: `audit-group-${Date.now()}`,
                    userId,
                    operationType: 'item_group_changes',
                    affectedItems: JSON.stringify((linkedItems || []).map((item: any) => item.id)),
                    oldValues: JSON.stringify({ name: group.name, notes: group.notes || null }),
                    newValues: JSON.stringify({ name: groupName, notes }),
                    meta: JSON.stringify({ action: 'update_group', groupId, groupName }),
                    timestamp,
                }).run();
                return;
            }

            if (action === 'delete') {
                const linkedAssignments = await tx.select().from(schema.itemGroupItems).where(eq(schema.itemGroupItems.groupId, groupId)).all();
                const linkedItemIds = linkedAssignments.map((row: any) => String(row.itemId));
                for (const itemId of linkedItemIds) {
                    await tx.update(schema.items)
                        .set({ groupId: null, groupName: null, lastUpdated: timestamp })
                        .where(eq(schema.items.id, itemId))
                        .run();
                }
                for (const row of linkedAssignments) {
                    await tx.delete(schema.itemGroupItems).where(eq(schema.itemGroupItems.id, (row as any).id)).run();
                }
                await tx.delete(schema.itemGroups).where(eq(schema.itemGroups.id, groupId)).run();
                await tx.insert(schema.auditLogs).values({
                    id: `audit-group-${Date.now()}`,
                    userId,
                    operationType: 'item_group_changes',
                    affectedItems: JSON.stringify(linkedItemIds),
                    oldValues: JSON.stringify({ groupId, groupName: group.name }),
                    newValues: null,
                    meta: JSON.stringify({ action: 'delete_group', groupId, groupName: group.name, affectedItemIds: linkedItemIds }),
                    timestamp,
                }).run();
                return;
            }

            const itemIds = Array.isArray(data?.itemIds)
                ? data.itemIds.map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
            if (itemIds.length === 0) throw new Error('يجب تحديد مادة واحدة على الأقل.');

            const targetGroupName = action === 'assign' ? String(group?.name || '') : null;
            const allAssignments = await tx.select().from(schema.itemGroupItems).all();
            for (const itemId of itemIds) {
                const currentLinks = allAssignments.filter((row: any) => String(row.itemId || '') === itemId);
                for (const row of currentLinks) {
                    await tx.delete(schema.itemGroupItems).where(eq(schema.itemGroupItems.id, (row as any).id)).run();
                }
                if (action === 'assign') {
                    await tx.insert(schema.itemGroupItems).values({
                        id: `igroup-item-${Date.now()}-${itemId}-${Math.random().toString(36).slice(2, 6)}`,
                        groupId,
                        itemId,
                        createdAt: timestamp,
                    }).run();
                }
                await tx.update(schema.items)
                    .set({
                        groupId: action === 'assign' ? groupId : null,
                        groupName: action === 'assign' ? targetGroupName : null,
                        lastUpdated: timestamp,
                    })
                    .where(eq(schema.items.id, itemId))
                    .run();
            }

            await tx.insert(schema.auditLogs).values({
                id: `audit-group-${Date.now()}`,
                userId,
                operationType: 'item_group_changes',
                affectedItems: JSON.stringify(itemIds),
                oldValues: null,
                newValues: JSON.stringify({ groupId: action === 'assign' ? groupId : null, groupName: action === 'assign' ? targetGroupName : null }),
                meta: JSON.stringify({
                    action: action === 'assign' ? 'assign_items' : 'unassign_items',
                    groupId: action === 'assign' ? groupId : null,
                    groupName: action === 'assign' ? targetGroupName : null,
                    affectedItemIds: itemIds,
                }),
                timestamp,
            }).run();
        });

        return { success: true };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});

api.post('/inventory/merge', async (req, reply) => {
    try {
        const currentUser = await getRequestUser(req);
        if (!currentUser) return reply.status(401).send({ error: 'غير مصرح.' });
        if (!hasAnyPermission(currentUser, ['item_merge'])) {
            return reply.status(403).send({ error: 'صلاحيات غير كافية لدمج المواد.' });
        }
        const authContext = getAuthContext(req);
        const data = req.body as any;
        const sourceItemId = String(data?.sourceItemId || '').trim();
        const targetItemId = String(data?.targetItemId || '').trim();
        const userId = String(data?.userId || 'system');

        if (!sourceItemId || !targetItemId) {
            return reply.status(400).send({ error: 'يجب اختيار المادة المصدر والمادة الهدف.' });
        }
        if (sourceItemId === targetItemId) {
            return reply.status(400).send({ error: 'لا يمكن دمج المادة بنفسها.' });
        }

        const sourceItem = await db.select().from(schema.items).where(eq(schema.items.id, sourceItemId)).get();
        const targetItem = await db.select().from(schema.items).where(eq(schema.items.id, targetItemId)).get();
        if (!sourceItem || !targetItem) {
            return reply.status(404).send({ error: 'المادة المصدر أو الهدف غير موجودة.' });
        }
        assertEntityBelongsToCompany(sourceItem, String(authContext.companyId || ''), 'المادة المصدر غير موجودة.');
        assertEntityBelongsToAllowedBranch(sourceItem, authContext, 'المادة المصدر خارج الفروع المسموح بها.');
        assertEntityBelongsToCompany(targetItem, String(authContext.companyId || ''), 'المادة الهدف غير موجودة.');
        assertEntityBelongsToAllowedBranch(targetItem, authContext, 'المادة الهدف خارج الفروع المسموح بها.');
        if (Boolean((sourceItem as any).merged) || Boolean((sourceItem as any).inactive)) {
            return reply.status(409).send({ error: 'المادة المصدر غير صالحة للدمج.' });
        }
        if (Boolean((targetItem as any).inactive)) {
            return reply.status(409).send({ error: 'المادة الهدف غير صالحة للدمج.' });
        }
        if (String(sourceItem.warehouseId || '') !== String(targetItem.warehouseId || '')) {
            return reply.status(409).send({ error: 'لا يمكن دمج مادتين من مستودعين مختلفين.' });
        }
        if (String(sourceItem.unitId || '') !== String(targetItem.unitId || '')) {
            return reply.status(409).send({ error: 'لا يمكن دمج مادتين بوحدتين مختلفتين.' });
        }

        const now = new Date().toISOString();
        let affectedInvoiceCount = 0;
        let affectedInvoiceLineCount = 0;
        let affectedTransferCount = 0;
        let affectedAgentInventoryCount = 0;
        let affectedDeliveryNoticeCount = 0;
        let affectedItemGroupLinks = 0;
        let affectedInventoryTransactionCount = 0;
        const transferredQuantity = Number(sourceItem.quantity || 0);

        await db.transaction(async (tx: any) => {
            const allInvoices = filterRowsByTenantScope(
              await tx.select().from(schema.invoices).all(),
              authContext,
              'invoices',
            );
            for (const invoice of allInvoices || []) {
                const lines = safeJsonParse((invoice as any).items, []);
                if (!Array.isArray(lines)) continue;
                let changed = false;
                const nextLines = lines.map((line: any) => {
                    if (String(line?.itemId || '') !== sourceItemId) return line;
                    changed = true;
                    affectedInvoiceLineCount += 1;
                    return {
                        ...line,
                        itemId: targetItemId,
                        itemName: targetItem.name,
                    };
                });
                if (changed) {
                    affectedInvoiceCount += 1;
                    await tx.update(schema.invoices)
                        .set({ items: JSON.stringify(nextLines) })
                        .where(eq(schema.invoices.id, (invoice as any).id))
                        .run();
                }
            }

            const invoiceItemRows = await tx.all(sql`SELECT id FROM invoice_items WHERE item_id = ${sourceItemId}`);
            if ((invoiceItemRows || []).length > 0) {
                await tx.run(sql`UPDATE invoice_items SET item_id = ${targetItemId}, item_name = ${targetItem.name} WHERE item_id = ${sourceItemId}`);
            }

            const inventoryTransactionRows = await tx.all(sql`SELECT id FROM inventory_transactions WHERE item_id = ${sourceItemId}`);
            affectedInventoryTransactionCount = Array.isArray(inventoryTransactionRows) ? inventoryTransactionRows.length : 0;
            if ((inventoryTransactionRows || []).length > 0) {
                await tx.run(sql`UPDATE inventory_transactions SET item_id = ${targetItemId}, item_name = ${targetItem.name} WHERE item_id = ${sourceItemId}`);
            }

            const transfers = filterRowsByTenantScope(
              await tx.select().from(schema.stockTransfers).all(),
              authContext,
              'stock-transfers',
            );
            for (const transfer of transfers || []) {
                const patch: any = {};
                let changed = false;
                if (String((transfer as any).itemId || '') === sourceItemId) {
                    patch.itemId = targetItemId;
                    patch.itemName = targetItem.name;
                    changed = true;
                }
                if (String((transfer as any).fromItemId || '') === sourceItemId) {
                    patch.fromItemId = targetItemId;
                    changed = true;
                }
                if (String((transfer as any).toItemId || '') === sourceItemId) {
                    patch.toItemId = targetItemId;
                    changed = true;
                }
                if (changed) {
                    affectedTransferCount += 1;
                    await tx.update(schema.stockTransfers).set(patch).where(eq(schema.stockTransfers.id, (transfer as any).id)).run();
                }
            }

            const agentRows = filterRowsByTenantScope(
              await tx.select().from(schema.agentInventory).all(),
              authContext,
              'agent-inventory',
            );
            const sourceAgentRows = agentRows.filter((row: any) => String(row.itemId || '') === sourceItemId);
            const targetAgentRows = agentRows.filter((row: any) => String(row.itemId || '') === targetItemId);
            for (const sourceRow of sourceAgentRows) {
                const sameAgentTarget = targetAgentRows.find((row: any) => String(row.agentId || '') === String((sourceRow as any).agentId || ''));
                if (sameAgentTarget) {
                  await tx.update(schema.agentInventory)
                    .set({
                      quantity: Number(sameAgentTarget.quantity || 0) + Number((sourceRow as any).quantity || 0),
                      updatedAt: now,
                    })
                    .where(eq(schema.agentInventory.id, sameAgentTarget.id))
                    .run();
                  await tx.delete(schema.agentInventory).where(eq(schema.agentInventory.id, (sourceRow as any).id)).run();
                } else {
                  await tx.update(schema.agentInventory)
                    .set({ itemId: targetItemId, itemName: targetItem.name, updatedAt: now })
                    .where(eq(schema.agentInventory.id, (sourceRow as any).id))
                    .run();
                }
                affectedAgentInventoryCount += 1;
            }

            const notices = filterRowsByTenantScope(
              await tx.select().from(schema.deliveryNotices).all(),
              authContext,
              'delivery-notices',
            );
            for (const notice of notices || []) {
                const lines = safeJsonParse((notice as any).items, []);
                if (!Array.isArray(lines)) continue;
                let changed = false;
                const nextLines = lines.map((line: any) => {
                    if (String(line?.itemId || '') !== sourceItemId) return line;
                    changed = true;
                    return { ...line, itemId: targetItemId, itemName: targetItem.name };
                });
                if (changed) {
                    affectedDeliveryNoticeCount += 1;
                    await tx.update(schema.deliveryNotices)
                        .set({ items: JSON.stringify(nextLines), updatedAt: now })
                        .where(eq(schema.deliveryNotices.id, (notice as any).id))
                        .run();
                }
            }

            const groupLinks = filterRowsByTenantScope(
              await tx.select().from(schema.itemGroupItems).all(),
              authContext,
              'item-group-items',
            );
            const sourceGroupLinks = groupLinks.filter((row: any) => String(row.itemId || '') === sourceItemId);
            const targetGroupLinks = groupLinks.filter((row: any) => String(row.itemId || '') === targetItemId);
            affectedItemGroupLinks = sourceGroupLinks.length;
            const targetGroupIds = new Set(targetGroupLinks.map((row: any) => String(row.groupId || '')));
            for (const sourceGroupLink of sourceGroupLinks) {
                if (targetGroupIds.has(String((sourceGroupLink as any).groupId || ''))) {
                    await tx.delete(schema.itemGroupItems).where(eq(schema.itemGroupItems.id, sourceGroupLink.id)).run();
                } else {
                    await tx.update(schema.itemGroupItems)
                        .set({ itemId: targetItemId })
                        .where(eq(schema.itemGroupItems.id, sourceGroupLink.id))
                        .run();
                }
            }

            const movementWarehouseId = String((sourceItem as any).warehouseId || (targetItem as any).warehouseId || '').trim();
            const movementWarehouseName = (sourceItem as any).warehouseName || (targetItem as any).warehouseName || null;
            if (transferredQuantity > 0) {
                if (!movementWarehouseId) {
                    throw new Error('ITEM_MERGE_WAREHOUSE_REQUIRED_FOR_STOCK_MOVEMENT');
                }
                adjustItemStockWithMovement(tx, {
                    itemId: sourceItemId,
                    warehouseId: movementWarehouseId,
                    warehouseName: movementWarehouseName,
                    unitId: (sourceItem as any).unitId || null,
                    unitName: (sourceItem as any).unitName || null,
                    qtyDelta: -transferredQuantity,
                    baseQtyDelta: -transferredQuantity,
                    meta: {
                        documentType: 'ITEM_MERGE',
                        documentId: `${sourceItemId}->${targetItemId}`,
                        movementType: 'MERGE_OUT',
                        userId: userId || null,
                        userName: null,
                        notes: 'Stock moved to merged target item.',
                    },
                });
                adjustItemStockWithMovement(tx, {
                    itemId: targetItemId,
                    warehouseId: movementWarehouseId,
                    warehouseName: movementWarehouseName,
                    unitId: (targetItem as any).unitId || null,
                    unitName: (targetItem as any).unitName || null,
                    qtyDelta: transferredQuantity,
                    baseQtyDelta: transferredQuantity,
                    meta: {
                        documentType: 'ITEM_MERGE',
                        documentId: `${sourceItemId}->${targetItemId}`,
                        movementType: 'MERGE_IN',
                        userId: userId || null,
                        userName: null,
                        notes: 'Stock received from merged source item.',
                    },
                });
            }

            await tx.update(schema.items)
                .set({
                    lastUpdated: now,
                    groupId: (targetItem as any).groupId || (sourceItem as any).groupId || null,
                    groupName: (targetItem as any).groupName || (sourceItem as any).groupName || null,
                })
                .where(eq(schema.items.id, targetItemId))
                .run();

            await tx.update(schema.items)
                .set({
                    merged: true,
                    inactive: true,
                    mergedIntoItemId: targetItemId,
                    lastUpdated: now,
                    groupId: (sourceItem as any).groupId || null,
                    groupName: (sourceItem as any).groupName || null,
                })
                .where(eq(schema.items.id, sourceItemId))
                .run();

            await tx.insert(schema.auditLogs).values({
                id: `audit-merge-${Date.now()}`,
                userId,
                companyId: String((sourceItem as any).companyId || authContext.companyId || '').trim() || null,
                branchId: String((sourceItem as any).branchId || authContext.branchId || '').trim() || null,
                operationType: 'item_merge',
                affectedItems: JSON.stringify([sourceItemId, targetItemId]),
                oldValues: JSON.stringify({
                    sourceQuantity: Number(sourceItem.quantity || 0),
                    targetQuantity: Number(targetItem.quantity || 0),
                }),
                newValues: JSON.stringify({
                    sourceMerged: true,
                    sourceInactive: true,
                    sourceMergedIntoItemId: targetItemId,
                    targetQuantity: Number(targetItem.quantity || 0) + transferredQuantity,
                }),
                meta: JSON.stringify({
                    sourceItemId,
                    sourceItemName: sourceItem.name,
                    targetItemId,
                    targetItemName: targetItem.name,
                    affectedInvoiceCount,
                    affectedInvoiceLineCount,
                    affectedTransferCount,
                    affectedAgentInventoryCount,
                    affectedDeliveryNoticeCount,
                    affectedItemGroupLinks,
                    affectedInventoryTransactionCount,
                    affectedRecordsCount:
                      affectedInvoiceLineCount +
                      affectedTransferCount +
                      affectedAgentInventoryCount +
                      affectedDeliveryNoticeCount +
                      affectedItemGroupLinks,
                }),
                timestamp: now,
            }).run();
        });

        return {
            success: true,
            sourceItemId,
            targetItemId,
            transferredQuantity,
            affectedInvoiceCount,
            affectedInvoiceLineCount,
            affectedTransferCount,
            affectedAgentInventoryCount,
            affectedDeliveryNoticeCount,
            affectedItemGroupLinks,
            affectedInventoryTransactionCount,
            affectedRecordsCount:
              affectedInvoiceLineCount +
              affectedTransferCount +
              affectedAgentInventoryCount +
              affectedDeliveryNoticeCount +
              affectedItemGroupLinks,
        };
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});


api.post('/parties/transfer', async (req, reply) => {
    try {
        const authContext = getAuthContext(req);
        const data = req.body as any;
        const id = `pt-${Date.now()}`;
        const payload = {
            id,
            transferNumber: Date.now().toString().slice(-6),
            companyId: String(authContext.companyId || '').trim() || null,
            branchId: String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null,
            fromPartyId: data.fromPartyId,
            fromPartyName: data.fromPartyName,
            toPartyId: data.toPartyId,
            toPartyName: data.toPartyName,
            amount: Number(data.amount || 0),
            date: data.date,
            note: data.note,
            currency: data.currency || 'USD',
        };
        if (!payload.fromPartyId || !payload.toPartyId || !payload.amount) {
            return reply.status(400).send({ error: 'Missing required transfer fields.' });
        }
        const fromParty = await db.select().from(schema.parties).where(eq(schema.parties.id, payload.fromPartyId)).get();
        const toParty = await db.select().from(schema.parties).where(eq(schema.parties.id, payload.toPartyId)).get();
        if (!fromParty || !toParty) {
            return reply.status(404).send({ error: 'الطرف المصدر أو الطرف الهدف غير موجود.' });
        }
        assertEntityBelongsToCompany(fromParty, String(authContext.companyId || ''), 'الطرف المصدر غير موجود ضمن المؤسسة الحالية.');
        assertEntityBelongsToCompany(toParty, String(authContext.companyId || ''), 'الطرف الهدف غير موجود ضمن المؤسسة الحالية.');

        await db.transaction(async (tx: any) => {
            await tx.insert(schema.partyTransfers).values(payload).run();

            if (fromParty) {
                const outDelta = computePartyDelta({
                    partyType: fromParty.type,
                    event: 'transfer_out',
                    totalOrAmount: payload.amount
                });
                await applyPartyTransaction(tx, {
                    id: `pt-${payload.id}-out`,
                    companyId: payload.companyId,
                    branchId: payload.branchId || null,
                    partyId: fromParty.id,
                    partyType: fromParty.type,
                    kind: 'transfer_out',
                    refId: payload.id,
                    amount: payload.amount,
                    delta: outDelta,
                    currency: payload.currency || 'USD',
                    createdAt: payload.date || new Date().toISOString()
                });
            }
            if (toParty) {
                const inDelta = computePartyDelta({
                    partyType: toParty.type,
                    event: 'transfer_in',
                    totalOrAmount: payload.amount
                });
                await applyPartyTransaction(tx, {
                    id: `pt-${payload.id}-in`,
                    companyId: payload.companyId,
                    branchId: payload.branchId || null,
                    partyId: toParty.id,
                    partyType: toParty.type,
                    kind: 'transfer_in',
                    refId: payload.id,
                    amount: payload.amount,
                    delta: inDelta,
                    currency: payload.currency || 'USD',
                    createdAt: payload.date || new Date().toISOString()
                });
            }
        });
        return { success: true };
    } catch (e: any) {
        if (isAppError(e)) {
            return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        return reply.status(500).send({ error: e.message });
    }
});

}

