import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { createInvoiceLifecycleService } from '../services/invoiceLifecycle';
import { appError, isAppError } from '../lib/errors';
import { getScopedSettingRow, upsertValidatedSetting } from '../lib/settings';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  assertWarehouseAccess,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
  resolveWarehouseForContext,
} from '../lib/tenantScope';

/**
 * Consignment routes:
 * - Documents (customer/supplier)
 * - Settlements
 * - Settings
 *
 * NOTE: This file focuses on core backend logic for posting, quantities, and accounting.
 * UI/printing and some secondary validations will be layered on top later.
 */
export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const {
    db,
    schema,
    sql,
    eq,
    roundMoney,
    computeBaseQty,
    adjustItemStockWithMovement,
    postConsignmentDispatchJournal,
    postSupplierConsignmentSettlementJournal,
    reverseConsignmentJournal,
    getNextDocNumber,
    server: fastifyServer,
  } = ctx as any;
  const invoiceLifecycle = createInvoiceLifecycleService(ctx as any);
  const getAuthContext = (req: any) => (req as any).authContext || {};

  const DIRECTIONS = ['OUT_CUSTOMER', 'IN_SUPPLIER'] as const;
  type Direction = (typeof DIRECTIONS)[number];

  const isValidDirection = (value: any): value is Direction => DIRECTIONS.includes(String(value) as Direction);

  const parseJson = (value: any) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const parseSerialNumbers = (line: any): string[] => {
    const raw = line?.serialNumbers ?? line?.serial_numbers;
    if (Array.isArray(raw)) return raw.map((v: any) => String(v || '').trim()).filter(Boolean);
    if (typeof raw === 'string') {
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map((v: any) => String(v || '').trim()).filter(Boolean) : [];
      } catch {
        return raw.split(/\r?\n|,/).map((v: string) => v.trim()).filter(Boolean);
      }
    }
    return [];
  };

  const loadConsignmentSettings = async (companyId: string) => {
    const row = await getScopedSettingRow(db, schema, 'consignmentSettings', { companyId });
    return parseJson(row?.value) || {};
  };

  const saveConsignmentSettings = async (companyId: string, value: any) => {
    const { storedValue, existing, rowKey } = await upsertValidatedSetting(
      db,
      schema,
      eq,
      'consignmentSettings',
      value || {},
      { companyId },
    );
    if (existing) {
      await db.update(schema.systemSettings)
        .set({ companyId, branchId: null, value: storedValue })
        .where(eq(schema.systemSettings.key, rowKey))
        .run();
    } else {
      await db.insert(schema.systemSettings).values({
        key: rowKey,
        companyId,
        branchId: null,
        value: storedValue,
      }).run();
    }
  };

  const assertPartyAccess = (party: any, req: any, notFoundMessage = 'الطرف غير موجود.') => {
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(party, String(authContext.companyId || ''), notFoundMessage);
  };

  const assertItemAccess = (item: any, req: any, notFoundMessage = 'المادة غير موجودة.') => {
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(item, String(authContext.companyId || ''), notFoundMessage);
    assertEntityBelongsToAllowedBranch(item, authContext, notFoundMessage);
  };

  const ensureWarehouseAccessForRequest = async (warehouseId: string, req: any, notFoundMessage: string) => {
    const warehouse = await resolveWarehouseForContext(db, schema, eq, warehouseId);
    if (!warehouse) {
      throw appError(404, 'WAREHOUSE_NOT_FOUND', notFoundMessage);
    }
    assertWarehouseAccess(warehouse, getAuthContext(req));
    return warehouse;
  };

  const ensureWarehousePairSameBranch = (sourceWarehouse: any, consignmentWarehouse: any) => {
    const sourceBranchId = String(sourceWarehouse?.branchId || '').trim() || null;
    const consignmentBranchId = String(consignmentWarehouse?.branchId || '').trim() || null;
    if (sourceBranchId && consignmentBranchId && sourceBranchId !== consignmentBranchId) {
      throw appError(
        409,
        'CONSIGNMENT_BRANCH_WAREHOUSE_MISMATCH',
        'لا يمكن تنفيذ سند الأمانة بين مستودعين تابعين لفرعين مختلفين في هذا المسار.',
        {
          source_branch_id: sourceBranchId,
          consignment_branch_id: consignmentBranchId,
        },
      );
    }
  };

  const withScopedConsignmentDocument = async (id: string, req: any, notFoundMessage = 'سند الأمانة غير موجود.') => {
    const header = await db.select().from(schema.consignmentDocuments).where(eq(schema.consignmentDocuments.id, id)).get();
    if (!header) return null;
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(header, String(authContext.companyId || ''), notFoundMessage);
    assertEntityBelongsToAllowedBranch(header, authContext, notFoundMessage);
    return header;
  };

  const withScopedSettlement = async (id: string, req: any, notFoundMessage = 'تسوية الأمانة غير موجودة.') => {
    const settlement = await db.select().from(schema.consignmentSettlements).where(eq(schema.consignmentSettlements.id, id)).get();
    if (!settlement) return null;
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(settlement, String(authContext.companyId || ''), notFoundMessage);
    assertEntityBelongsToAllowedBranch(settlement, authContext, notFoundMessage);
    return settlement;
  };

  // --------- CONSIGNMENT SETTINGS ----------
  api.get('/settings/consignment', async (req) => {
    const settings = await loadConsignmentSettings(String(getAuthContext(req).companyId || '').trim());
    return settings || {};
  });

  api.put('/settings/consignment', async (req, reply) => {
    try {
      const body = (req.body || {}) as any;
      const companyId = String(getAuthContext(req).companyId || '').trim();
      if (!companyId) {
        throw appError(401, 'NO_COMPANY_CONTEXT', 'يجب تمرير سياق مؤسسة صالح مع هذا الطلب.');
      }
      await saveConsignmentSettings(companyId, body || {});
      return { success: true };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e?.message || 'فشل حفظ إعدادات الأمانة.' });
    }
  });

  // --------- CONSIGNMENT DOCUMENTS ----------

  api.get('/consignments', async (req) => {
    const q = (req.query || {}) as any;
    const direction = String(q.direction || '').trim();
    const status = String(q.status || '').trim();
    const partyId = String(q.partyId || '').trim();
    const fromDate = String(q.fromDate || q.from || '').trim();
    const toDate = String(q.toDate || q.to || '').trim();
    const warehouseId = String(q.warehouseId || '').trim();

    let rows = filterRowsByTenantScope(
      await db.select().from(schema.consignmentDocuments).all(),
      getAuthContext(req),
      'consignment-documents',
    );
    rows = (rows || []).filter((row: any) => {
      if (direction && String(row.direction || '') !== direction) return false;
      if (status && String(row.status || '') !== status) return false;
      if (partyId && String(row.partyId || '') !== partyId) return false;
      if (warehouseId && String(row.consignmentWarehouseId || '') !== warehouseId) return false;
      const d = String(row.issueDate || '').slice(0, 10);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
    return rows;
  });

  api.get('/consignments/:id', async (req, reply) => {
    const { id } = req.params as any;
    const header = await withScopedConsignmentDocument(String(id || ''), req);
    if (!header) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });
    const lines = filterRowsByTenantScope(await db
      .select()
      .from(schema.consignmentDocumentLines)
      .where(eq(schema.consignmentDocumentLines.documentId, id))
      .all(), getAuthContext(req), 'consignment-document-lines');
    return { header, lines };
  });

  api.get('/consignments/:id/lines', async (req, reply) => {
    const { id } = req.params as any;
    const lines = filterRowsByTenantScope(await db
      .select()
      .from(schema.consignmentDocumentLines)
      .where(eq(schema.consignmentDocumentLines.documentId, id))
      .all(), getAuthContext(req), 'consignment-document-lines');
    if (!lines || lines.length === 0) {
      const header = await withScopedConsignmentDocument(String(id || ''), req);
      if (!header) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });
    }
    return lines;
  });

  api.get('/consignments/:id/open-lines', async (req, reply) => {
    const { id } = req.params as any;
    const header = await withScopedConsignmentDocument(String(id || ''), req);
    if (!header) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });
    const lines = filterRowsByTenantScope(await db
      .select()
      .from(schema.consignmentDocumentLines)
      .where(eq(schema.consignmentDocumentLines.documentId, id))
      .all(), getAuthContext(req), 'consignment-document-lines');
    const openLines = (lines || []).filter((l: any) => Number(l.remainingQty || 0) > 0);
    return openLines;
  });

  api.get('/consignments/next-number', async (req) => {
    const authContext = getAuthContext(req);
    return {
      number: String(await getNextDocNumber('consignment_document', {
        companyId: String(authContext.companyId || '').trim() || null,
        branchId: String(authContext.branchId || '').trim() || null,
      })),
    };
  });

  api.post('/consignments', async (req, reply) => {
    try {
      const data = (req.body || {}) as any;
      const authContext = getAuthContext(req);
      const id = data.id || `cs-${Date.now()}`;
      const directionRaw = String(data.direction || '').trim();
      if (!isValidDirection(directionRaw)) {
        return reply.status(400).send({ error: 'اتجاه الأمانة غير صالح.' });
      }
      const direction: Direction = directionRaw;

      if (!data.partyId || !data.consignmentWarehouseId || !data.issueDate) {
        return reply.status(400).send({ error: 'بيانات رأس سند الأمانة غير مكتملة.' });
      }

      const party = await db.select().from(schema.parties).where(eq(schema.parties.id, data.partyId)).get();
      if (!party) return reply.status(400).send({ error: 'الطرف غير موجود.' });
      assertPartyAccess(party, req);

      const partyType = String(party.type || '').toUpperCase();
      if (direction === 'OUT_CUSTOMER' && partyType !== 'CUSTOMER' && partyType !== 'BOTH') {
        return reply.status(400).send({ error: 'سند أمانة العملاء يجب أن يكون لطرف من نوع عميل.' });
      }
      if (direction === 'IN_SUPPLIER' && partyType !== 'SUPPLIER' && partyType !== 'BOTH') {
        return reply.status(400).send({ error: 'سند أمانة الموردين يجب أن يكون لطرف من نوع مورد.' });
      }

      const consWh = await ensureWarehouseAccessForRequest(
        String(data.consignmentWarehouseId || ''),
        req,
        'مستودع الأمانة غير موجود.',
      );
      const sourceWh = data.sourceWarehouseId
        ? await ensureWarehouseAccessForRequest(
          String(data.sourceWarehouseId || ''),
          req,
          'المستودع المصدر غير موجود.',
        )
        : null;
      if (sourceWh) {
        ensureWarehousePairSameBranch(sourceWh, consWh);
      }

      const companyId = String((consWh as any)?.companyId || authContext.companyId || '').trim() || null;
      const branchId = String((consWh as any)?.branchId || pickEffectiveBranchId(data.branchId, authContext) || '').trim() || null;

      const rawLines = Array.isArray(data.lines) ? data.lines : parseJson(data.lines) || [];
      if (!Array.isArray(rawLines) || rawLines.length === 0) {
        return reply.status(400).send({ error: 'لا يمكن حفظ سند أمانة بدون مواد.' });
      }

      const linesToInsert: any[] = [];
      let totalBaseQty = 0;
      let totalAmountRef = 0;

      for (const [index, line] of rawLines.entries()) {
        const itemId = String(line.itemId || '').trim();
        const qtyRaw = Number(line.qty ?? line.quantity ?? 0);
        if (!itemId || !qtyRaw || qtyRaw <= 0) {
          return reply
            .status(400)
            .send({ error: `سطر ${index + 1}: المادة أو الكمية غير صالحة.` });
        }
        const item = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
        if (!item) return reply.status(400).send({ error: `المادة غير موجودة في السطر ${index + 1}.` });

        const unitId = line.unitId || (item as any).unitId || null;
        const unitName = line.unitName || (item as any).unitName || null;

        const { baseQty, factor } = await computeBaseQty(db, { qty: qtyRaw, unitId });
        if (!baseQty || baseQty <= 0) {
          return reply.status(400).send({ error: `سطر ${index + 1}: الكمية الأساسية غير صالحة.` });
        }

        const unitCost = Number(line.unitCost ?? (item as any).costPriceBase ?? (item as any).costPrice ?? 0);
        const referencePrice = line.referencePrice != null ? Number(line.referencePrice) : null;

        totalBaseQty += baseQty;
        totalAmountRef += referencePrice ? referencePrice * baseQty : 0;

        const serials = parseSerialNumbers(line);
        const serialNumbersJson = serials.length > 0 ? JSON.stringify(serials) : null;

        linesToInsert.push({
          id: line.id || `csl-${Date.now()}-${index}`,
          companyId,
          branchId,
          documentId: id,
          itemId,
          unitId,
          unitName,
          unitFactor: factor,
          qty: qtyRaw,
          baseQty,
          serialNumbers: serialNumbersJson,
          unitCost,
          referencePrice,
          customSalePrice: line.customSalePrice != null ? Number(line.customSalePrice) : null,
          commissionType: line.commissionType || null,
          commissionValue: line.commissionValue != null ? Number(line.commissionValue) : 0,
          notes: line.notes || null,
          settledSoldQty: 0,
          settledReturnedQty: 0,
          remainingQty: baseQty,
        });
      }

      const headerPayload = {
        id,
        companyId,
        branchId,
        documentNumber: String(data.documentNumber || ''),
        direction,
        status: 'DRAFT',
        partyType,
        partyId: data.partyId,
        sourceWarehouseId: data.sourceWarehouseId || null,
        consignmentWarehouseId: data.consignmentWarehouseId,
        issueDate: data.issueDate,
        notes: data.notes || null,
        currencyId: data.currencyId || null,
        exchangeRate: Number(data.exchangeRate || 1),
        pricingPolicy: data.pricingPolicy || 'MANUAL',
        commissionType: data.commissionType || 'NONE',
        commissionValue: Number(data.commissionValue || 0),
        totalQty: totalBaseQty,
        totalAmountReference: totalAmountRef || null,
        createdBy: data.createdBy || data.userId || null,
      };

      await db.transaction(async (tx: any) => {
        await tx.insert(schema.consignmentDocuments).values(headerPayload).run();
        for (const line of linesToInsert) {
          await tx.insert(schema.consignmentDocumentLines).values(line).run();
        }
      });

      return { success: true, id };
    } catch (e: any) {
      return reply.status(500).send({ error: e?.message || 'فشل حفظ سند الأمانة.' });
    }
  });

  api.put('/consignments/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const existing = await db
        .select()
        .from(schema.consignmentDocuments)
        .where(eq(schema.consignmentDocuments.id, id))
        .get();
      if (!existing) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });
      if (String(existing.status || '') !== 'DRAFT') {
        return reply.status(400).send({ error: 'لا يمكن تعديل سند أمانة مرحل أو مسوى.' });
      }

      const data = (req.body || {}) as any;
      const rawLines = Array.isArray(data.lines) ? data.lines : parseJson(data.lines) || [];
      if (!Array.isArray(rawLines) || rawLines.length === 0) {
        return reply.status(400).send({ error: 'لا يمكن حفظ سند أمانة بدون مواد.' });
      }

      const direction: Direction = existing.direction as Direction;
      const companyId = String((existing as any).companyId || getAuthContext(req).companyId || '').trim() || null;
      const branchId = String((existing as any).branchId || getAuthContext(req).branchId || '').trim() || null;

      const party = await db.select().from(schema.parties).where(eq(schema.parties.id, data.partyId || existing.partyId)).get();
      if (!party) return reply.status(400).send({ error: 'الطرف غير موجود.' });
      const partyType = String(party.type || '').toUpperCase();

      const consWhId = data.consignmentWarehouseId || existing.consignmentWarehouseId;
      const consWh = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, consWhId)).get();
      if (!consWh) return reply.status(400).send({ error: 'مستودع الأمانة غير موجود.' });

      const linesToInsert: any[] = [];
      let totalBaseQty = 0;
      let totalAmountRef = 0;

      for (const [index, line] of rawLines.entries()) {
        const itemId = String(line.itemId || '').trim();
        const qtyRaw = Number(line.qty ?? line.quantity ?? 0);
        if (!itemId || !qtyRaw || qtyRaw <= 0) {
          return reply
            .status(400)
            .send({ error: `سطر ${index + 1}: المادة أو الكمية غير صالحة.` });
        }
        const item = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
        if (!item) return reply.status(400).send({ error: `المادة غير موجودة في السطر ${index + 1}.` });

        const unitId = line.unitId || (item as any).unitId || null;
        const unitName = line.unitName || (item as any).unitName || null;

        const { baseQty, factor } = await computeBaseQty(db, { qty: qtyRaw, unitId });
        if (!baseQty || baseQty <= 0) {
          return reply.status(400).send({ error: `سطر ${index + 1}: الكمية الأساسية غير صالحة.` });
        }

        const unitCost = Number(line.unitCost ?? (item as any).costPriceBase ?? (item as any).costPrice ?? 0);
        const referencePrice = line.referencePrice != null ? Number(line.referencePrice) : null;

        totalBaseQty += baseQty;
        totalAmountRef += referencePrice ? referencePrice * baseQty : 0;

        const serials = parseSerialNumbers(line);
        const serialNumbersJson = serials.length > 0 ? JSON.stringify(serials) : null;

        linesToInsert.push({
          id: line.id || `csl-${Date.now()}-${index}`,
          companyId,
          branchId,
          documentId: id,
          itemId,
          unitId,
          unitName,
          unitFactor: factor,
          qty: qtyRaw,
          baseQty,
          serialNumbers: serialNumbersJson,
          unitCost,
          referencePrice,
          customSalePrice: line.customSalePrice != null ? Number(line.customSalePrice) : null,
          commissionType: line.commissionType || null,
          commissionValue: line.commissionValue != null ? Number(line.commissionValue) : 0,
          notes: line.notes || null,
          settledSoldQty: 0,
          settledReturnedQty: 0,
          remainingQty: baseQty,
        });
      }

      const headerPatch: any = {
        partyType,
        partyId: data.partyId || existing.partyId,
        sourceWarehouseId: data.sourceWarehouseId ?? existing.sourceWarehouseId,
        consignmentWarehouseId: consWhId,
        issueDate: data.issueDate || existing.issueDate,
        notes: data.notes ?? existing.notes,
        currencyId: data.currencyId ?? existing.currencyId,
        exchangeRate: data.exchangeRate != null ? Number(data.exchangeRate) : existing.exchangeRate,
        pricingPolicy: data.pricingPolicy ?? existing.pricingPolicy,
        commissionType: data.commissionType ?? existing.commissionType,
        commissionValue: data.commissionValue != null ? Number(data.commissionValue) : existing.commissionValue,
        totalQty: totalBaseQty,
        totalAmountReference: totalAmountRef || null,
      };

      await db.transaction(async (tx: any) => {
        await tx.update(schema.consignmentDocuments).set(headerPatch).where(eq(schema.consignmentDocuments.id, id)).run();
        await tx.delete(schema.consignmentDocumentLines).where(eq(schema.consignmentDocumentLines.documentId, id)).run();
        for (const line of linesToInsert) {
          await tx.insert(schema.consignmentDocumentLines).values(line).run();
        }
      });

      return { success: true };
    } catch (e: any) {
      return reply.status(500).send({ error: e?.message || 'فشل تعديل سند الأمانة.' });
    }
  });

  api.post('/consignments/:id/post', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const body = (req.body || {}) as any;
      const userId = body.userId || body.createdBy || null;
      const userName = body.userName || null;
      const authContext = getAuthContext(req);

      const header = await withScopedConsignmentDocument(String(id || ''), req);
      if (!header) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });
      if (String(header.status || '') !== 'DRAFT') {
        return reply.status(400).send({ error: 'لا يمكن ترحيل سند أمانة غير مسودة.' });
      }
      const companyId = String((header as any).companyId || authContext.companyId || '').trim() || null;
      const branchId = String((header as any).branchId || authContext.branchId || '').trim() || null;

      const direction: Direction = header.direction as Direction;

      const lines = await db
        .select()
        .from(schema.consignmentDocumentLines)
        .where(eq(schema.consignmentDocumentLines.documentId, id))
        .all();
      if (!lines || lines.length === 0) return reply.status(400).send({ error: 'لا توجد مواد في سند الأمانة.' });

      const settings = await loadConsignmentSettings(String(companyId || '').trim());
      const supplierPolicy: 'REAL_LEDGER' | 'MEMO_ONLY' =
        settings.supplierPolicy === 'MEMO_ONLY' ? 'MEMO_ONLY' : 'REAL_LEDGER';

      const consWh = await db
        .select()
        .from(schema.warehouses)
        .where(eq(schema.warehouses.id, header.consignmentWarehouseId))
        .get();
      if (!consWh) return reply.status(400).send({ error: 'مستودع الأمانة غير موجود.' });

      const sourceWhId = header.sourceWarehouseId || null;

      let totalCostBase = 0;

      // Use a synchronous transaction callback — drizzle-orm/better-sqlite3 is synchronous.
      // An async callback causes drizzle to COMMIT before any awaits resolve, so all inventory
      // updates would be silently lost.
      await db.transaction(async (tx: any) => {
        for (const line of lines || []) {
          const baseQty = Number((line as any).baseQty || 0);
          const unitCost = Number((line as any).unitCost || 0);
          const lineCostBase = roundMoney(baseQty * unitCost);
          totalCostBase += lineCostBase;

          const itemRow = await tx.select().from(schema.items).where(eq(schema.items.id, line.itemId)).get();
          const serialTracking = String((itemRow as any)?.serialTracking || 'none');
          const lineSerials = parseSerialNumbers(line as any);
          const expectSerials = serialTracking === 'required' && Number.isInteger(baseQty) && baseQty > 0;
          if (expectSerials && lineSerials.length !== baseQty) {
            throw new Error(`الصنف يتطلب أرقام سيريال بعدد الكمية (${baseQty}).`);
          }
          const duplicateSerials = lineSerials.filter((v, i) => lineSerials.indexOf(v) !== i);
          if (duplicateSerials.length > 0) {
            throw new Error(`رقم السيريال مكرر في السطر: ${duplicateSerials[0]}`);
          }

          if (direction === 'OUT_CUSTOMER') {
            if (!sourceWhId) {
              throw new Error('مطلوب مستودع مصدر لإرسال أمانة إلى عميل.');
            }

            if (lineSerials.length > 0) {
              for (const sn of lineSerials) {
                const serialRow = await tx
                  .select()
                  .from(schema.itemSerials)
                  .where(
                    sql`${schema.itemSerials.itemId} = ${line.itemId} AND ${schema.itemSerials.serialNumber} = ${sn}`
                  )
                  .get();
                if (!serialRow) throw new Error(`رقم السيريال غير موجود على الصنف: ${sn}`);
                if (String((serialRow as any).status || '') !== 'available') {
                  throw new Error(`رقم السيريال غير متاح للتحويل: ${sn}`);
                }
                const whId = String((serialRow as any).warehouseId || '');
                if (whId && whId !== sourceWhId) {
                  throw new Error(`رقم السيريال ليس في المستودع المصدر: ${sn}`);
                }
                await tx
                  .update(schema.itemSerials)
                  .set({
                    warehouseId: header.consignmentWarehouseId,
                    consignmentDocumentId: id,
                    locationType: 'consignment_document',
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(schema.itemSerials.id, (serialRow as any).id))
                  .run();
              }
            }

            // تحقق من الكمية المتاحة في المستودع المصدر
            const sourceItem = await tx
              .select()
              .from(schema.items)
              .where(
                sql`${schema.items.id} = ${line.itemId} AND (${schema.items.warehouseId} = ${sourceWhId} OR ${schema.items.warehouseId} IS NULL)`
              )
              .get();
            if (!sourceItem) {
              throw new Error('المادة غير متوفرة في المستودع المصدر.');
            }
            const available = Number((sourceItem as any).quantity || 0);
            if (available < baseQty) {
              throw new Error('الكمية غير كافية في المستودع المصدر.');
            }

            await adjustItemStockWithMovement(tx, {
              itemId: String(line.itemId),
              warehouseId: sourceWhId,
              warehouseName: (sourceItem as any).warehouseName || null,
              unitId: (line as any).unitId,
              unitName: (line as any).unitName,
              qtyDelta: -Number((line as any).qty || 0),
              baseQtyDelta: -baseQty,
              meta: {
                documentType: 'CONSIGNMENT_DOCUMENT',
                documentId: id,
                documentNumber: header.documentNumber,
                documentLineId: (line as any).id,
                movementType: 'DISPATCH_TO_CUSTOMER_CONSIGNMENT',
                userId,
                userName,
                notes: header.notes || null,
              },
            });

            await adjustItemStockWithMovement(tx, {
              itemId: String(line.itemId),
              warehouseId: header.consignmentWarehouseId,
              warehouseName: (consWh as any).name || null,
              unitId: (line as any).unitId,
              unitName: (line as any).unitName,
              qtyDelta: Number((line as any).qty || 0),
              baseQtyDelta: baseQty,
              meta: {
                documentType: 'CONSIGNMENT_DOCUMENT',
                documentId: id,
                documentNumber: header.documentNumber,
                documentLineId: (line as any).id,
                movementType: 'DISPATCH_TO_CUSTOMER_CONSIGNMENT',
                userId,
                userName,
                notes: header.notes || null,
              },
            });

            // تحديث بيانات السعر والوحدة في سجل المادة بمستودع الأمانة (عميل)
            {
              const lineUnitCost = Number((line as any).unitCost || 0);
              const lineSalePrice = Number((line as any).customSalePrice || (line as any).referencePrice || 0);
              const lineUnitId = (line as any).unitId || null;
              const lineUnitName = (line as any).unitName || null;
              const priceUpdate: Record<string, any> = {
                warehouseId: header.consignmentWarehouseId,
                warehouseName: (consWh as any).name || null,
                lastUpdated: new Date().toISOString(),
              };
              if (lineUnitId) { priceUpdate.unitId = lineUnitId; priceUpdate.unitName = lineUnitName; }
              if (lineUnitCost > 0) { priceUpdate.costPrice = lineUnitCost; priceUpdate.costPriceBase = lineUnitCost; }
              if (lineSalePrice > 0) { priceUpdate.salePrice = lineSalePrice; priceUpdate.salePriceBase = lineSalePrice; }
              await tx.update(schema.items).set(priceUpdate).where(eq(schema.items.id, String(line.itemId))).run();
            }
          } else if (direction === 'IN_SUPPLIER') {
            if (lineSerials.length > 0) {
              for (const sn of lineSerials) {
                const existingSerial = await tx
                  .select()
                  .from(schema.itemSerials)
                  .where(eq(schema.itemSerials.serialNumber, sn))
                  .get();
                if (existingSerial) {
                  if (String((existingSerial as any).itemId || '') !== String(line.itemId)) {
                    throw new Error(`رقم السيريال مسجّل لصنف آخر: ${sn}`);
                  }
                  await tx
                    .update(schema.itemSerials)
                    .set({
                      warehouseId: header.consignmentWarehouseId,
                      consignmentDocumentId: id,
                      locationType: 'consignment_document',
                      status: 'available',
                      updatedAt: new Date().toISOString(),
                    })
                    .where(eq(schema.itemSerials.id, (existingSerial as any).id))
                    .run();
                } else {
                  await tx.insert(schema.itemSerials).values({
                    id: `iserial-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                    itemId: String(line.itemId),
                    serialNumber: sn,
                    warehouseId: header.consignmentWarehouseId,
                    status: 'available',
                    consignmentDocumentId: id,
                    locationType: 'consignment_document',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }).run();
                }
              }
            }
            // استلام من مورد إلى مستودع أمانة المورد
            await adjustItemStockWithMovement(tx, {
              itemId: String(line.itemId),
              warehouseId: header.consignmentWarehouseId,
              warehouseName: (consWh as any).name || null,
              unitId: (line as any).unitId,
              unitName: (line as any).unitName,
              qtyDelta: Number((line as any).qty || 0),
              baseQtyDelta: baseQty,
              meta: {
                documentType: 'CONSIGNMENT_DOCUMENT',
                documentId: id,
                documentNumber: header.documentNumber,
                documentLineId: (line as any).id,
                movementType: 'RECEIVE_FROM_SUPPLIER_CONSIGNMENT',
                userId,
                userName,
                notes: header.notes || null,
              },
            });

            // تحديث بيانات السعر والوحدة في سجل المادة بمستودع الأمانة
            {
              const lineUnitCost = Number((line as any).unitCost || 0);
              const lineSalePrice = Number((line as any).customSalePrice || (line as any).referencePrice || 0);
              const lineUnitId = (line as any).unitId || null;
              const lineUnitName = (line as any).unitName || null;
              const priceUpdate: Record<string, any> = {
                warehouseId: header.consignmentWarehouseId,
                warehouseName: (consWh as any).name || null,
                lastUpdated: new Date().toISOString(),
              };
              if (lineUnitId) { priceUpdate.unitId = lineUnitId; priceUpdate.unitName = lineUnitName; }
              if (lineUnitCost > 0) { priceUpdate.costPrice = lineUnitCost; priceUpdate.costPriceBase = lineUnitCost; }
              if (lineSalePrice > 0) { priceUpdate.salePrice = lineSalePrice; priceUpdate.salePriceBase = lineSalePrice; }
              await tx.update(schema.items).set(priceUpdate).where(eq(schema.items.id, String(line.itemId))).run();
            }
          }
        }

        await tx
          .update(schema.consignmentDocuments)
          .set({ status: 'POSTED', postedAt: new Date().toISOString(), postedBy: userId })
          .where(eq(schema.consignmentDocuments.id, id))
          .run();
      });

      // قيود محاسبية بعد نجاح حركة المخزون
      const currencyCode = header.currencyId || 'SYP';
      const exchangeRate = Number(header.exchangeRate || 1);

      let journalEntryId: number | null = null;
      if (direction === 'OUT_CUSTOMER') {
        journalEntryId = await postConsignmentDispatchJournal({
          db,
          documentId: id,
          documentNumber: header.documentNumber,
          direction,
          totalCostBase,
          currencyCode,
          exchangeRate,
          companyId,
          branchId,
        });
      } else if (direction === 'IN_SUPPLIER' && supplierPolicy === 'REAL_LEDGER') {
        journalEntryId = await postConsignmentDispatchJournal({
          db,
          documentId: id,
          documentNumber: header.documentNumber,
          direction,
          totalCostBase,
          currencyCode,
          exchangeRate,
          companyId,
          branchId,
        });
      }
      if (journalEntryId != null) {
        await db
          .update(schema.consignmentDocuments)
          .set({ journalEntryId })
          .where(eq(schema.consignmentDocuments.id, id))
          .run();
      }

      return { success: true };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e?.message || 'فشل ترحيل سند الأمانة.' });
    }
  });

  api.post('/consignments/:id/cancel', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const body = (req.body || {}) as any;
      const userId = body.userId || body.cancelledBy || body.createdBy || null;
      const userName = body.userName || null;
      const reason = String(body.reason || 'إلغاء سند أمانة').trim();

      const header = await db
        .select()
        .from(schema.consignmentDocuments)
        .where(eq(schema.consignmentDocuments.id, id))
        .get();
      if (!header) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });

      const status = String(header.status || '');
      if (status === 'CANCELLED') return { success: true, duplicate: true };
      if (status !== 'POSTED') {
        return reply.status(400).send({ error: 'لا يمكن إلغاء سند أمانة غير مرحّل.' });
      }

      const postedSettlement = await db
        .select()
        .from(schema.consignmentSettlements)
        .where(sql`${schema.consignmentSettlements.documentId} = ${id} AND ${schema.consignmentSettlements.status} = 'POSTED'`)
        .get();
      if (postedSettlement) {
        return reply.status(409).send({ error: 'لا يمكن إلغاء السند لوجود تسويات مرحّلة عليه.' });
      }

      const direction: Direction = header.direction as Direction;
      const consWh = await db
        .select()
        .from(schema.warehouses)
        .where(eq(schema.warehouses.id, header.consignmentWarehouseId))
        .get();
      if (!consWh) return reply.status(400).send({ error: 'مستودع الأمانة غير موجود.' });

      const lines = await db
        .select()
        .from(schema.consignmentDocumentLines)
        .where(eq(schema.consignmentDocumentLines.documentId, id))
        .all();
      if (!lines || lines.length === 0) return reply.status(400).send({ error: 'لا توجد مواد في سند الأمانة.' });

      const sourceWhId = header.sourceWarehouseId || null;

      await db.transaction(async (tx: any) => {
        for (const line of lines || []) {
          const baseQty = Number((line as any).baseQty || 0);
          const lineSerials = parseSerialNumbers(line as any);

          if (lineSerials.length > 0) {
            for (const sn of lineSerials) {
              const serialRow = await tx
                .select()
                .from(schema.itemSerials)
                .where(
                  sql`${schema.itemSerials.itemId} = ${line.itemId} AND ${schema.itemSerials.serialNumber} = ${sn} AND ${schema.itemSerials.consignmentDocumentId} = ${id}`
                )
                .get();
              if (!serialRow) continue;
              if (direction === 'OUT_CUSTOMER') {
                await tx
                  .update(schema.itemSerials)
                  .set({
                    warehouseId: sourceWhId,
                    consignmentDocumentId: null,
                    consignmentSettlementId: null,
                    locationType: null,
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(schema.itemSerials.id, (serialRow as any).id))
                  .run();
              } else {
                await tx
                  .update(schema.itemSerials)
                  .set({
                    consignmentDocumentId: null,
                    consignmentSettlementId: null,
                    locationType: null,
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(schema.itemSerials.id, (serialRow as any).id))
                  .run();
              }
            }
          }

          if (direction === 'OUT_CUSTOMER') {
            if (!sourceWhId) throw new Error('مطلوب مستودع مصدر لسند أمانة العملاء.');

            await adjustItemStockWithMovement(tx, {
              itemId: String(line.itemId),
              warehouseId: header.consignmentWarehouseId,
              warehouseName: (consWh as any).name || null,
              unitId: (line as any).unitId,
              unitName: (line as any).unitName,
              qtyDelta: -Number((line as any).qty || 0),
              baseQtyDelta: -baseQty,
              meta: {
                documentType: 'CONSIGNMENT_DOCUMENT',
                documentId: id,
                documentNumber: header.documentNumber,
                documentLineId: (line as any).id,
                movementType: 'CANCEL_CONSIGNMENT_DOCUMENT',
                userId,
                userName,
                notes: reason || header.notes || null,
              },
            });

            const sourceItem = tx
              .select()
              .from(schema.items)
              .where(
                sql`${schema.items.id} = ${line.itemId} AND (${schema.items.warehouseId} = ${sourceWhId} OR ${schema.items.warehouseId} IS NULL)`
              )
              .get();

            await adjustItemStockWithMovement(tx, {
              itemId: String(line.itemId),
              warehouseId: sourceWhId,
              warehouseName: (sourceItem as any)?.warehouseName || null,
              unitId: (line as any).unitId,
              unitName: (line as any).unitName,
              qtyDelta: Number((line as any).qty || 0),
              baseQtyDelta: baseQty,
              meta: {
                documentType: 'CONSIGNMENT_DOCUMENT',
                documentId: id,
                documentNumber: header.documentNumber,
                documentLineId: (line as any).id,
                movementType: 'CANCEL_CONSIGNMENT_DOCUMENT',
                userId,
                userName,
                notes: reason || header.notes || null,
              },
            });
          } else if (direction === 'IN_SUPPLIER') {
            adjustItemStockWithMovement(tx, {
              itemId: String(line.itemId),
              warehouseId: header.consignmentWarehouseId,
              warehouseName: (consWh as any).name || null,
              unitId: (line as any).unitId,
              unitName: (line as any).unitName,
              qtyDelta: -Number((line as any).qty || 0),
              baseQtyDelta: -baseQty,
              meta: {
                documentType: 'CONSIGNMENT_DOCUMENT',
                documentId: id,
                documentNumber: header.documentNumber,
                documentLineId: (line as any).id,
                movementType: 'CANCEL_CONSIGNMENT_DOCUMENT',
                userId,
                userName,
                notes: reason || header.notes || null,
              },
            });
          }
        }

        await tx
          .update(schema.consignmentDocuments)
          .set({
            status: 'CANCELLED',
            cancelledAt: new Date().toISOString(),
            cancelledBy: userId,
          })
          .where(eq(schema.consignmentDocuments.id, id))
          .run();
      });

      const entryId = (header as any).journalEntryId;
      if (entryId != null && Number(entryId) > 0) {
        await ctx.reverseConsignmentJournal(Number(entryId), reason || 'إلغاء سند أمانة');
      }

      return { success: true };
    } catch (e: any) {
      return reply.status(500).send({ error: e?.message || 'فشل إلغاء سند الأمانة.' });
    }
  });

  // --------- CONSIGNMENT SETTLEMENTS ----------

  const computeDocumentRemainingInTx = async (tx: any, documentId: string) => {
    const docLines = await tx
      .select()
      .from(schema.consignmentDocumentLines)
      .where(eq(schema.consignmentDocumentLines.documentId, documentId))
      .all();

    const postedSettlements = await tx
      .select()
      .from(schema.consignmentSettlements)
      .where(sql`${schema.consignmentSettlements.documentId} = ${documentId} AND ${schema.consignmentSettlements.status} = 'POSTED'`)
      .all();

    const postedIds = (postedSettlements || []).map((s: any) => s.id);
    const postedLines: any[] = [];
    for (const sid of postedIds) {
      const batch = await tx
        .select()
        .from(schema.consignmentSettlementLines)
        .where(eq(schema.consignmentSettlementLines.settlementId, String(sid)))
        .all();
      postedLines.push(...(batch || []));
    }

    const sums: Record<string, { sold: number; returned: number }> = {};
    for (const l of postedLines || []) {
      const key = String((l as any).documentLineId);
      if (!sums[key]) sums[key] = { sold: 0, returned: 0 };
      const baseQty = Number((l as any).baseQty || 0);
      const action = String((l as any).actionType || '');
      if (action === 'SOLD') sums[key].sold += baseQty;
      else if (action === 'RETURNED') sums[key].returned += baseQty;
    }

    return (docLines || []).map((dl: any) => {
      const key = String(dl.id);
      const baseQty = Number(dl.baseQty || 0);
      const sold = Number(sums[key]?.sold || 0);
      const returned = Number(sums[key]?.returned || 0);
      const remaining = roundMoney(baseQty - sold - returned);
      return { ...dl, settledSoldQty: sold, settledReturnedQty: returned, remainingQty: remaining };
    });
  };

  const computeDocumentRemaining = async (documentId: string) => {
    const docLines = await db
      .select()
      .from(schema.consignmentDocumentLines)
      .where(eq(schema.consignmentDocumentLines.documentId, documentId))
      .all();

    const postedSettlements = await db
      .select()
      .from(schema.consignmentSettlements)
      .where(sql`${schema.consignmentSettlements.documentId} = ${documentId} AND ${schema.consignmentSettlements.status} = 'POSTED'`)
      .all();

    const postedIds = (postedSettlements || []).map((s: any) => s.id);
    const postedLines: any[] = [];
    for (const sid of postedIds) {
      const batch = await db
        .select()
        .from(schema.consignmentSettlementLines)
        .where(eq(schema.consignmentSettlementLines.settlementId, String(sid)))
        .all();
      postedLines.push(...(batch || []));
    }

    const sums: Record<string, { sold: number; returned: number }> = {};
    for (const l of postedLines || []) {
      const key = String((l as any).documentLineId);
      if (!sums[key]) sums[key] = { sold: 0, returned: 0 };
      const baseQty = Number((l as any).baseQty || 0);
      const action = String((l as any).actionType || '');
      if (action === 'SOLD') sums[key].sold += baseQty;
      else if (action === 'RETURNED') sums[key].returned += baseQty;
    }

    const next = (docLines || []).map((dl: any) => {
      const key = String(dl.id);
      const baseQty = Number(dl.baseQty || 0);
      const sold = Number(sums[key]?.sold || 0);
      const returned = Number(sums[key]?.returned || 0);
      const remaining = roundMoney(baseQty - sold - returned);
      return { ...dl, settledSoldQty: sold, settledReturnedQty: returned, remainingQty: remaining };
    });

    return next;
  };

  api.get('/consignment-settlements', async (req) => {
    const q = (req.query || {}) as any;
    const status = String(q.status || '').trim();
    const documentId = String(q.documentId || '').trim();
    let rows = await db.select().from(schema.consignmentSettlements).all();
    rows = (rows || []).filter((r: any) => {
      if (status && String(r.status || '') !== status) return false;
      if (documentId && String(r.documentId || '') !== documentId) return false;
      return true;
    });
    return rows;
  });

  api.get('/consignment-settlements/:id', async (req, reply) => {
    const { id } = req.params as any;
    const header = await db.select().from(schema.consignmentSettlements).where(eq(schema.consignmentSettlements.id, id)).get();
    if (!header) return reply.status(404).send({ error: 'تسوية الأمانة غير موجودة.' });
    const lines = await db
      .select()
      .from(schema.consignmentSettlementLines)
      .where(eq(schema.consignmentSettlementLines.settlementId, id))
      .all();
    return { header, lines };
  });

  api.get('/consignment-settlements/next-number', async (req) => {
    const scoped = getAuthContext(req);
    return {
      number: String(await getNextDocNumber('consignment_settlement', {
        companyId: String(scoped.companyId || '').trim() || null,
        branchId: String(scoped.branchId || '').trim() || null,
      })),
    };
  });

  api.post('/consignment-settlements', async (req, reply) => {
    try {
      const data = (req.body || {}) as any;
      const id = data.id || `cset-${Date.now()}`;
      const settlementNumber = String(data.settlementNumber || data.settlement_number || '').trim();
      const documentId = String(data.documentId || data.document_id || '').trim();
      const settlementDate = String(data.settlementDate || data.settlement_date || '').trim();
      const createdBy = String(data.createdBy || data.userId || '').trim();

      if (!settlementNumber || !documentId || !settlementDate || !createdBy) {
        return reply.status(400).send({ error: 'بيانات تسوية الأمانة غير مكتملة.' });
      }

      const doc = await withScopedConsignmentDocument(documentId, req);
      if (!doc) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });
      if (String(doc.status || '') === 'CANCELLED') return reply.status(409).send({ error: 'لا يمكن إنشاء تسوية لسند ملغي.' });
      if (String(doc.status || '') === 'DRAFT') return reply.status(409).send({ error: 'يجب ترحيل سند الأمانة قبل التسوية.' });
      const docCompanyId = String((doc as any).companyId || getAuthContext(req).companyId || '').trim() || null;
      const docBranchId = String((doc as any).branchId || getAuthContext(req).branchId || '').trim() || null;

      const rawLines = Array.isArray(data.lines) ? data.lines : parseJson(data.lines) || [];
      if (!Array.isArray(rawLines) || rawLines.length === 0) {
        return reply.status(400).send({ error: 'لا توجد أسطر في التسوية.' });
      }

      const linesToInsert: any[] = [];
      for (const l of rawLines) {
        const documentLineId = String(l.documentLineId || l.document_line_id || '').trim();
        const actionType = String(l.actionType || l.action_type || '').trim().toUpperCase();
        const qty = Number(l.qty ?? 0);
        if (!documentLineId || !['SOLD', 'RETURNED'].includes(actionType) || qty <= 0) {
          return reply.status(400).send({ error: 'أسطر التسوية غير صحيحة.' });
        }
        const { baseQty, factor } = await computeBaseQty(db, { qty, unitId: l.unitId || null });
        const serials = parseSerialNumbers(l);
        const serialNumbersJson = serials.length > 0 ? JSON.stringify(serials) : null;
        linesToInsert.push({
          id: l.id || `csetl-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          companyId: docCompanyId,
          branchId: docBranchId,
          settlementId: id,
          documentLineId,
          actionType,
          unitId: l.unitId || null,
          unitName: l.unitName || null,
          unitFactor: factor || null,
          qty,
          baseQty,
          serialNumbers: serialNumbersJson,
          unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
          unitCost: l.unitCost != null ? Number(l.unitCost) : null,
          commissionType: l.commissionType || null,
          commissionValue: l.commissionValue != null ? Number(l.commissionValue) : 0,
          notes: l.notes || null,
        });
      }

      await db.transaction(async (tx: any) => {
        await tx.insert(schema.consignmentSettlements)
          .values({
            id,
            companyId: docCompanyId,
            branchId: docBranchId,
            settlementNumber,
            documentId,
            settlementDate,
            status: 'DRAFT',
            notes: data.notes || null,
            createdBy,
          })
          .run();
        for (const l of linesToInsert) await tx.insert(schema.consignmentSettlementLines).values(l).run();
      });

      return { success: true, id };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e?.message || 'فشل إنشاء تسوية الأمانة.' });
    }
  });

  api.put('/consignment-settlements/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const data = (req.body || {}) as any;

      const existing = await db.select().from(schema.consignmentSettlements).where(eq(schema.consignmentSettlements.id, id)).get();
      if (!existing) return reply.status(404).send({ error: 'تسوية الأمانة غير موجودة.' });
      if (String(existing.status || '') !== 'DRAFT') return reply.status(400).send({ error: 'لا يمكن تعديل تسوية مرحّلة.' });

      const rawLines = Array.isArray(data.lines) ? data.lines : parseJson(data.lines) || [];
      if (!Array.isArray(rawLines) || rawLines.length === 0) {
        return reply.status(400).send({ error: 'لا توجد أسطر في التسوية.' });
      }

      const linesToInsert: any[] = [];
      for (const l of rawLines) {
        const documentLineId = String(l.documentLineId || l.document_line_id || '').trim();
        const actionType = String(l.actionType || l.action_type || '').trim().toUpperCase();
        const qty = Number(l.qty ?? 0);
        if (!documentLineId || !['SOLD', 'RETURNED'].includes(actionType) || qty <= 0) {
          return reply.status(400).send({ error: 'أسطر التسوية غير صحيحة.' });
        }
        const { baseQty, factor } = await computeBaseQty(db, { qty, unitId: l.unitId || null });
        const serials = parseSerialNumbers(l);
        const serialNumbersJson = serials.length > 0 ? JSON.stringify(serials) : null;
        linesToInsert.push({
          id: l.id || `csetl-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          settlementId: id,
          documentLineId,
          actionType,
          unitId: l.unitId || null,
          unitName: l.unitName || null,
          unitFactor: factor || null,
          qty,
          baseQty,
          serialNumbers: serialNumbersJson,
          unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
          unitCost: l.unitCost != null ? Number(l.unitCost) : null,
          commissionType: l.commissionType || null,
          commissionValue: l.commissionValue != null ? Number(l.commissionValue) : 0,
          notes: l.notes || null,
        });
      }

      await db.transaction(async (tx: any) => {
        await tx.update(schema.consignmentSettlements)
          .set({
            settlementDate: data.settlementDate ?? existing.settlementDate,
            notes: data.notes ?? existing.notes,
          })
          .where(eq(schema.consignmentSettlements.id, id))
          .run();
        await tx.delete(schema.consignmentSettlementLines).where(eq(schema.consignmentSettlementLines.settlementId, id)).run();
        for (const l of linesToInsert) await tx.insert(schema.consignmentSettlementLines).values(l).run();
      });

      return { success: true };
    } catch (e: any) {
      return reply.status(500).send({ error: e?.message || 'فشل تعديل تسوية الأمانة.' });
    }
  });

  api.post('/consignment-settlements/:id/post', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const body = (req.body || {}) as any;
      const userId = body.userId || body.postedBy || body.createdBy || null;
      const userName = body.userName || null;

      const settlement = await db.select().from(schema.consignmentSettlements).where(eq(schema.consignmentSettlements.id, id)).get();
      if (!settlement) return reply.status(404).send({ error: 'تسوية الأمانة غير موجودة.' });
      if (String(settlement.status || '') !== 'DRAFT') return reply.status(400).send({ error: 'لا يمكن ترحيل تسوية غير مسودة.' });

      const docId = String((settlement as any).documentId);
      const doc = await db.select().from(schema.consignmentDocuments).where(eq(schema.consignmentDocuments.id, docId)).get();
      if (!doc) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });
      if (String(doc.status || '') === 'CANCELLED') return reply.status(409).send({ error: 'لا يمكن تسوية سند ملغي.' });
      const docCompanyId = String((doc as any).companyId || getAuthContext(req).companyId || '').trim() || null;
      const docBranchId = String((doc as any).branchId || getAuthContext(req).branchId || '').trim() || null;

      const direction: Direction = doc.direction as Direction;

      const consWh = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, doc.consignmentWarehouseId)).get();
      if (!consWh) return reply.status(400).send({ error: 'مستودع الأمانة غير موجود.' });

      const sourceWhId = doc.sourceWarehouseId || null;
      const lines = await db
        .select()
        .from(schema.consignmentSettlementLines)
        .where(eq(schema.consignmentSettlementLines.settlementId, id))
        .all();
      if (!lines || lines.length === 0) return reply.status(400).send({ error: 'لا توجد أسطر في التسوية.' });

      const remainingLines = await computeDocumentRemaining(docId);
      const remainingById = new Map<string, any>((remainingLines || []).map((l: any) => [String(l.id), l]));

      // validate against remaining (based on posted settlements only)
      for (const l of lines || []) {
        const docLineId = String((l as any).documentLineId);
        const baseQty = Number((l as any).baseQty || 0);
        const rem = remainingById.get(docLineId);
        if (!rem) return reply.status(400).send({ error: 'سطر التسوية يشير إلى سطر سند غير موجود.' });
        const remaining = Number((rem as any).remainingQty || 0);
        if (baseQty > remaining + 1e-9) {
          return reply.status(409).send({ error: 'كمية التسوية تتجاوز المتبقي في سند الأمانة.' });
        }
      }

      const settings = await loadConsignmentSettings(String(docCompanyId || '').trim());
      const supplierPolicy: 'REAL_LEDGER' | 'MEMO_ONLY' =
        settings.supplierPolicy === 'MEMO_ONLY' ? 'MEMO_ONLY' : 'REAL_LEDGER';

      let supplierSoldCostBase = 0;

      await db.transaction(async (tx: any) => {
        for (const l of lines || []) {
          const docLineId = String((l as any).documentLineId);
          const action = String((l as any).actionType || '');
          const baseQty = Number((l as any).baseQty || 0);
          const qty = Number((l as any).qty || 0);

          const docLine = remainingById.get(docLineId);
          const unitCost = Number((docLine as any)?.unitCost || 0);
          if (direction === 'IN_SUPPLIER' && action === 'SOLD') {
            supplierSoldCostBase += roundMoney(baseQty * unitCost);
          }

          const setLineSerials = parseSerialNumbers(l as any);

          if (action === 'SOLD') {
            if (setLineSerials.length > 0) {
              for (const sn of setLineSerials) {
                const serialRow = await tx
                  .select()
                  .from(schema.itemSerials)
                  .where(
                    sql`${schema.itemSerials.itemId} = ${(docLine as any).itemId} AND ${schema.itemSerials.serialNumber} = ${sn} AND ${schema.itemSerials.consignmentDocumentId} = ${docId}`
                  )
                  .get();
                if (!serialRow) throw new Error(`رقم السيريال غير موجود في أمانة السند: ${sn}`);
                if (String((serialRow as any).status || '') !== 'available') {
                  throw new Error(`رقم السيريال غير متاح للبيع: ${sn}`);
                }
                await tx
                  .update(schema.itemSerials)
                  .set({
                    status: 'sold',
                    consignmentSettlementId: id,
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(schema.itemSerials.id, (serialRow as any).id))
                  .run();
              }
            }
            await adjustItemStockWithMovement(tx, {
              itemId: String((docLine as any).itemId),
              warehouseId: doc.consignmentWarehouseId,
              warehouseName: (consWh as any).name || null,
              unitId: (l as any).unitId,
              unitName: (l as any).unitName,
              qtyDelta: -qty,
              baseQtyDelta: -baseQty,
              meta: {
                documentType: 'CONSIGNMENT_SETTLEMENT',
                documentId: id,
                documentNumber: settlement.settlementNumber,
                documentLineId: (l as any).id,
                movementType: 'CONSIGNMENT_SOLD',
                userId,
                userName,
                notes: settlement.notes || null,
              },
            });
          } else if (action === 'RETURNED') {
            if (setLineSerials.length > 0) {
              for (const sn of setLineSerials) {
                const serialRow = await tx
                  .select()
                  .from(schema.itemSerials)
                  .where(
                    sql`${schema.itemSerials.itemId} = ${(docLine as any).itemId} AND ${schema.itemSerials.serialNumber} = ${sn} AND ${schema.itemSerials.consignmentDocumentId} = ${docId}`
                  )
                  .get();
                if (!serialRow) throw new Error(`رقم السيريال غير موجود في أمانة السند: ${sn}`);
                const targetWh = direction === 'OUT_CUSTOMER' ? sourceWhId : (serialRow as any).warehouseId;
                await tx
                  .update(schema.itemSerials)
                  .set({
                    warehouseId: targetWh || null,
                    consignmentSettlementId: id,
                    status: 'available',
                    locationType: null,
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(schema.itemSerials.id, (serialRow as any).id))
                  .run();
              }
            }
            await adjustItemStockWithMovement(tx, {
              itemId: String((docLine as any).itemId),
              warehouseId: doc.consignmentWarehouseId,
              warehouseName: (consWh as any).name || null,
              unitId: (l as any).unitId,
              unitName: (l as any).unitName,
              qtyDelta: -qty,
              baseQtyDelta: -baseQty,
              meta: {
                documentType: 'CONSIGNMENT_SETTLEMENT',
                documentId: id,
                documentNumber: settlement.settlementNumber,
                documentLineId: (l as any).id,
                movementType: 'CONSIGNMENT_RETURNED',
                userId,
                userName,
                notes: settlement.notes || null,
              },
            });

            if (direction === 'OUT_CUSTOMER') {
              if (!sourceWhId) throw new Error('مطلوب مستودع مصدر لتسوية إرجاع أمانة عميل.');
              const sourceItem = await tx
                .select()
                .from(schema.items)
                .where(
                  sql`${schema.items.id} = ${(docLine as any).itemId} AND (${schema.items.warehouseId} = ${sourceWhId} OR ${schema.items.warehouseId} IS NULL)`
                )
                .get();

              await adjustItemStockWithMovement(tx, {
                itemId: String((docLine as any).itemId),
                warehouseId: sourceWhId,
                warehouseName: (sourceItem as any)?.warehouseName || null,
                unitId: (l as any).unitId,
                unitName: (l as any).unitName,
                qtyDelta: qty,
                baseQtyDelta: baseQty,
                meta: {
                  documentType: 'CONSIGNMENT_SETTLEMENT',
                  documentId: id,
                  documentNumber: settlement.settlementNumber,
                  documentLineId: (l as any).id,
                  movementType: 'CONSIGNMENT_RETURNED',
                  userId,
                  userName,
                  notes: settlement.notes || null,
                },
              });
            }
          }
        }

        await tx
          .update(schema.consignmentSettlements)
          .set({ status: 'POSTED', postedAt: new Date().toISOString(), postedBy: userId })
          .where(eq(schema.consignmentSettlements.id, id))
          .run();

        // recompute & persist remaining on document lines (synchronous — runs queries on tx)
        const recomputed = await computeDocumentRemainingInTx(tx, docId);
        const allRemainingZero = (recomputed || []).every((l: any) => Number(l.remainingQty || 0) <= 1e-9);

        for (const dl of recomputed || []) {
          await tx
            .update(schema.consignmentDocumentLines)
            .set({
              settledSoldQty: Number(dl.settledSoldQty || 0),
              settledReturnedQty: Number(dl.settledReturnedQty || 0),
              remainingQty: Number(dl.remainingQty || 0),
            })
            .where(eq(schema.consignmentDocumentLines.id, dl.id))
            .run();
        }

        await tx
          .update(schema.consignmentDocuments)
          .set({ status: allRemainingZero ? 'FULLY_SETTLED' : 'PARTIALLY_SETTLED' })
          .where(eq(schema.consignmentDocuments.id, docId))
          .run();
      });

      // accounting (supplier only)
      if (direction === 'IN_SUPPLIER' && supplierPolicy === 'REAL_LEDGER' && supplierSoldCostBase > 0) {
        const currencyCode = doc.currencyId || 'SYP';
        const exchangeRate = Number(doc.exchangeRate || 1);
        await postSupplierConsignmentSettlementJournal({
          db,
          documentId: docId,
          documentNumber: doc.documentNumber,
          totalCostBase: supplierSoldCostBase,
          currencyCode,
          exchangeRate,
          policy: supplierPolicy,
          companyId: docCompanyId,
          branchId: docBranchId,
        });
      }

      // Customer consignment: auto-create sales invoice for SOLD quantities (applyStock=0 — stock already moved by settlement)
      let linkedInvoiceId: string | null = null;
      let autoInvoiceFailure: { code: string; error: string } | null = null;
      if (direction === 'OUT_CUSTOMER' && getNextDocNumber) {
        const soldLines = (lines || []).filter((l: any) => String(l.actionType || '') === 'SOLD');
        if (soldLines.length > 0) {
          const party = await db.select().from(schema.parties).where(eq(schema.parties.id, doc.partyId)).get();
          const invoiceItems: any[] = [];
          let totalAmountBase = 0;
          for (const l of soldLines) {
            const docLine = remainingById.get(String(l.documentLineId));
            if (!docLine) continue;
            const itemRow = await db.select().from(schema.items).where(eq(schema.items.id, docLine.itemId)).get();
            const itemName = (itemRow as any)?.name || (docLine as any).itemId || '';
            const baseQty = Number(l.baseQty || 0);
            const unitPrice = Number(l.unitPrice ?? (docLine as any).customSalePrice ?? (docLine as any).referencePrice ?? (itemRow as any)?.salePrice ?? (itemRow as any)?.salePriceBase ?? 0);
            const lineTotal = roundMoney(baseQty * unitPrice);
            totalAmountBase += lineTotal;
            invoiceItems.push({
              itemId: docLine.itemId,
              itemName,
              quantity: baseQty,
              baseQuantity: baseQty,
              unitPrice,
              serialNumbers: parseSerialNumbers(l),
            });
          }
          if (invoiceItems.length > 0 && totalAmountBase >= 0) {
            const invoiceNumber = await getNextDocNumber('sale');
            const currencyCode = doc.currencyId || 'SYP';
            const exchangeRate = Number(doc.exchangeRate || 1);
            const generatedInvoiceId = `inv-cons-${id}-${Date.now()}`;
            const invoicePayload = {
              id: generatedInvoiceId,
              invoiceNumber,
              type: 'sale',
              clientId: doc.partyId,
              clientName: (party as any)?.name || '',
              date: (settlement as any).settlementDate,
              items: invoiceItems,
              totalAmountBase,
              totalAmount: totalAmountBase,
              exchangeRate,
              currency: currencyCode,
              applyStock: 0,
              paymentType: 'credit',
              paidAmount: 0,
              remainingAmount: totalAmountBase,
              notes: `من تسوية أمانة ${(settlement as any).settlementNumber}`,
              createdById: userId,
              createdByName: userName,
            };
            try {
              const created = await invoiceLifecycle.createInvoice(invoicePayload, getAuthContext(req));
              const linkedId = created?.id || generatedInvoiceId;
              await db
                .update(schema.consignmentSettlements)
                .set({ linkedInvoiceId: linkedId })
                .where(eq(schema.consignmentSettlements.id, id))
                .run();
              linkedInvoiceId = linkedId;
            } catch (invErr: any) {
              autoInvoiceFailure = {
                code: String(invErr?.code || 'CONSIGNMENT_AUTO_INVOICE_FAILED'),
                error: String(invErr?.message || invErr || 'Auto invoice creation failed.'),
              };
            }
          }
        }
      }

      if (autoInvoiceFailure) {
        return reply.status(207).send({
          success: false,
          partialSuccess: true,
          settlementPosted: true,
          linkedInvoiceId: linkedInvoiceId ?? undefined,
          code: autoInvoiceFailure.code,
          error: autoInvoiceFailure.error,
        });
      }

      return { success: true, linkedInvoiceId: linkedInvoiceId ?? undefined };
    } catch (e: any) {
      return reply.status(500).send({ error: e?.message || 'فشل ترحيل تسوية الأمانة.' });
    }
  });

  api.post('/consignment-settlements/:id/cancel', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const body = (req.body || {}) as any;
      const userId = body.userId || body.cancelledBy || body.createdBy || null;
      const userName = body.userName || null;
      const reason = String(body.reason || 'إلغاء تسوية أمانة').trim();

      const settlement = await db.select().from(schema.consignmentSettlements).where(eq(schema.consignmentSettlements.id, id)).get();
      if (!settlement) return reply.status(404).send({ error: 'تسوية الأمانة غير موجودة.' });

      const status = String(settlement.status || '');
      if (status === 'CANCELLED') return { success: true, duplicate: true };
      if (status !== 'POSTED') return reply.status(400).send({ error: 'لا يمكن إلغاء تسوية غير مرحّلة.' });

      const docId = String((settlement as any).documentId);
      const doc = await db.select().from(schema.consignmentDocuments).where(eq(schema.consignmentDocuments.id, docId)).get();
      if (!doc) return reply.status(404).send({ error: 'سند الأمانة غير موجود.' });
      if (String(doc.status || '') === 'CANCELLED') return reply.status(409).send({ error: 'السند ملغي.' });

      const direction: Direction = doc.direction as Direction;
      const consWh = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, doc.consignmentWarehouseId)).get();
      if (!consWh) return reply.status(400).send({ error: 'مستودع الأمانة غير موجود.' });

      const sourceWhId = doc.sourceWarehouseId || null;
      const lines = await db
        .select()
        .from(schema.consignmentSettlementLines)
        .where(eq(schema.consignmentSettlementLines.settlementId, id))
        .all();
      if (!lines || lines.length === 0) return reply.status(400).send({ error: 'لا توجد أسطر في التسوية.' });

      const docLines = await db
        .select()
        .from(schema.consignmentDocumentLines)
        .where(eq(schema.consignmentDocumentLines.documentId, docId))
        .all();
      const docLineById = new Map<string, any>((docLines || []).map((l: any) => [String(l.id), l]));

      await db.transaction(async (tx: any) => {
        for (const l of lines || []) {
          const docLine = docLineById.get(String((l as any).documentLineId));
          if (!docLine) continue;

          const action = String((l as any).actionType || '');
          const baseQty = Number((l as any).baseQty || 0);
          const qty = Number((l as any).qty || 0);
          const setLineSerials = parseSerialNumbers(l as any);

          if (setLineSerials.length > 0) {
            if (action === 'SOLD') {
              for (const sn of setLineSerials) {
                const serialRow = await tx
                  .select()
                  .from(schema.itemSerials)
                  .where(
                    sql`${schema.itemSerials.itemId} = ${docLine.itemId} AND ${schema.itemSerials.serialNumber} = ${sn} AND ${schema.itemSerials.consignmentSettlementId} = ${id}`
                  )
                  .get();
                if (serialRow) {
                  await tx
                    .update(schema.itemSerials)
                    .set({
                      status: 'available',
                      consignmentSettlementId: null,
                      updatedAt: new Date().toISOString(),
                    })
                    .where(eq(schema.itemSerials.id, (serialRow as any).id))
                    .run();
                }
              }
            } else if (action === 'RETURNED') {
              const serialsInSettlement = await tx
                .select()
                .from(schema.itemSerials)
                .where(
                  sql`${schema.itemSerials.consignmentSettlementId} = ${id} AND ${schema.itemSerials.itemId} = ${docLine.itemId}`
                )
                .all();
              for (const row of serialsInSettlement || []) {
                if (setLineSerials.includes(String((row as any).serialNumber || ''))) {
                  await tx
                    .update(schema.itemSerials)
                    .set({
                      warehouseId: doc.consignmentWarehouseId,
                      consignmentSettlementId: null,
                      updatedAt: new Date().toISOString(),
                    })
                    .where(eq(schema.itemSerials.id, (row as any).id))
                    .run();
                }
              }
            }
          }

          if (action === 'SOLD') {
            await adjustItemStockWithMovement(tx, {
              itemId: String(docLine.itemId),
              warehouseId: doc.consignmentWarehouseId,
              warehouseName: (consWh as any).name || null,
              unitId: (l as any).unitId,
              unitName: (l as any).unitName,
              qtyDelta: qty,
              baseQtyDelta: baseQty,
              meta: {
                documentType: 'CONSIGNMENT_SETTLEMENT',
                documentId: id,
                documentNumber: settlement.settlementNumber,
                documentLineId: (l as any).id,
                movementType: 'CANCEL_CONSIGNMENT_SETTLEMENT',
                userId,
                userName,
                notes: reason || settlement.notes || null,
              },
            });
          } else if (action === 'RETURNED') {
            await adjustItemStockWithMovement(tx, {
              itemId: String(docLine.itemId),
              warehouseId: doc.consignmentWarehouseId,
              warehouseName: (consWh as any).name || null,
              unitId: (l as any).unitId,
              unitName: (l as any).unitName,
              qtyDelta: qty,
              baseQtyDelta: baseQty,
              meta: {
                documentType: 'CONSIGNMENT_SETTLEMENT',
                documentId: id,
                documentNumber: settlement.settlementNumber,
                documentLineId: (l as any).id,
                movementType: 'CANCEL_CONSIGNMENT_SETTLEMENT',
                userId,
                userName,
                notes: reason || settlement.notes || null,
              },
            });

            if (direction === 'OUT_CUSTOMER') {
              if (!sourceWhId) throw new Error('مطلوب مستودع مصدر لإلغاء تسوية إرجاع أمانة عميل.');
              const sourceItem = await tx
                .select()
                .from(schema.items)
                .where(
                  sql`${schema.items.id} = ${docLine.itemId} AND (${schema.items.warehouseId} = ${sourceWhId} OR ${schema.items.warehouseId} IS NULL)`
                )
                .get();

              await adjustItemStockWithMovement(tx, {
                itemId: String(docLine.itemId),
                warehouseId: sourceWhId,
                warehouseName: (sourceItem as any)?.warehouseName || null,
                unitId: (l as any).unitId,
                unitName: (l as any).unitName,
                qtyDelta: -qty,
                baseQtyDelta: -baseQty,
                meta: {
                  documentType: 'CONSIGNMENT_SETTLEMENT',
                  documentId: id,
                  documentNumber: settlement.settlementNumber,
                  documentLineId: (l as any).id,
                  movementType: 'CANCEL_CONSIGNMENT_SETTLEMENT',
                  userId,
                  userName,
                  notes: reason || settlement.notes || null,
                },
              });
            }
          }
        }

        await tx
          .update(schema.consignmentSettlements)
          .set({ status: 'CANCELLED', cancelledAt: new Date().toISOString(), cancelledBy: userId })
          .where(eq(schema.consignmentSettlements.id, id))
          .run();

        const recomputed = await computeDocumentRemainingInTx(tx, docId);
        const allRemainingZero = (recomputed || []).every((l: any) => Number(l.remainingQty || 0) <= 1e-9);
        for (const dl of recomputed || []) {
          await tx
            .update(schema.consignmentDocumentLines)
            .set({
              settledSoldQty: Number(dl.settledSoldQty || 0),
              settledReturnedQty: Number(dl.settledReturnedQty || 0),
              remainingQty: Number(dl.remainingQty || 0),
            })
            .where(eq(schema.consignmentDocumentLines.id, dl.id))
            .run();
        }
        await tx
          .update(schema.consignmentDocuments)
          .set({ status: allRemainingZero ? 'FULLY_SETTLED' : 'PARTIALLY_SETTLED' })
          .where(eq(schema.consignmentDocuments.id, docId))
          .run();
      });

      return { success: true };
    } catch (e: any) {
      return reply.status(500).send({ error: e?.message || 'فشل إلغاء تسوية الأمانة.' });
    }
  });
}
