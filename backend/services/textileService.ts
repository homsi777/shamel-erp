import { and, eq, sql } from 'drizzle-orm';
import { appError } from '../lib/errors';

export const TEXTILE_BASE_UOMS = ['meter', 'yard'] as const;
export type TextileBaseUom = typeof TEXTILE_BASE_UOMS[number];

const normalizeBaseUom = (value: any): TextileBaseUom | null => {
  const normalized = String(value || '').trim().toLowerCase();
  return (TEXTILE_BASE_UOMS as readonly string[]).includes(normalized) ? (normalized as TextileBaseUom) : null;
};

const normalizeColorName = (value: any) =>
  String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const safeNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const isTextileItem = (item: any) => Boolean(item?.isTextile || item?.is_textile);

export const resolveItemTextileBaseUom = (item: any): TextileBaseUom | null =>
  normalizeBaseUom(item?.textileBaseUom ?? item?.textile_base_uom);

export const ensureTextileColor = async (
  db: any,
  schema: any,
  companyId: string,
  color: { id?: string | null; name?: string | null; code?: string | null },
) => {
  const requestedId = String(color?.id || '').trim();
  if (requestedId) {
    const existing = await db.select().from(schema.textileColors).where(eq(schema.textileColors.id, requestedId)).get();
    if (!existing) {
      throw appError(404, 'TEXTILE_COLOR_NOT_FOUND', 'لون القماش المحدد غير موجود.');
    }
    if (String(existing.companyId || '').trim() && String(existing.companyId || '').trim() !== companyId) {
      throw appError(404, 'TEXTILE_COLOR_NOT_FOUND', 'لون القماش المحدد غير موجود ضمن المؤسسة الحالية.');
    }
    return existing;
  }

  const name = String(color?.name || '').trim();
  const normalizedName = normalizeColorName(name);
  if (!normalizedName) {
    throw appError(400, 'TEXTILE_COLOR_REQUIRED', 'لون القماش مطلوب.');
  }

  const existing = await db.select().from(schema.textileColors).where(and(
    eq(schema.textileColors.companyId, companyId),
    eq(schema.textileColors.normalizedName, normalizedName),
  )).get();
  if (existing) return existing;

  const id = `tcolor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    companyId,
    code: String(color?.code || '').trim() || null,
    name,
    normalizedName,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.insert(schema.textileColors).values(row).run();
  return row;
};

export const sumTextileDecomposition = (payload: any, baseUom?: string | null) => {
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entries)
      ? payload.entries
      : [];
  const normalized = entries.map((entry: any, index: number) => ({
    sequence: Number(entry?.sequence || index + 1),
    length: safeNumber(entry?.length ?? entry?.lengthValue),
    unit: normalizeBaseUom(entry?.unit || baseUom),
    rollLabel: String(entry?.rollLabel || entry?.label || '').trim() || null,
  }));
  const totalLength = normalized.reduce((sum: number, entry: any) => sum + safeNumber(entry.length), 0);
  return {
    entries: normalized,
    totalLength,
    count: normalized.length,
  };
};

export const normalizeTextileInvoiceLine = async (
  db: any,
  schema: any,
  companyId: string,
  invoiceType: string,
  line: any,
  itemRecord?: any,
) => {
  const textile = itemRecord ? isTextileItem(itemRecord) : Boolean(line?.isTextile);
  if (!textile) {
    return { ...line, isTextile: false };
  }

  const itemBaseUom = resolveItemTextileBaseUom(itemRecord);
  const baseUom = normalizeBaseUom(line?.textileBaseUom || line?.baseUom || itemBaseUom);
  if (!baseUom) {
    throw appError(400, 'TEXTILE_BASE_UOM_REQUIRED', 'وحدة القماش يجب أن تكون متر أو ياردة.');
  }
  if (itemBaseUom && itemBaseUom !== baseUom) {
    throw appError(409, 'TEXTILE_BASE_UOM_MISMATCH', 'وحدة القماش في السطر لا تطابق تعريف الصنف.');
  }

  const colorRow = await ensureTextileColor(db, schema, companyId, {
    id: line?.textileColorId,
    name: line?.textileColorName || line?.colorName || line?.color,
    code: line?.textileColorCode,
  });

  const rollCount = safeNumber(line?.textileRollCount ?? line?.rollCount ?? line?.requestedRollCount);
  const totalLength = safeNumber(line?.textileTotalLength ?? line?.totalLength ?? line?.baseQuantity ?? line?.quantity);
  const unitPricePerLength = safeNumber(
    line?.textileUnitPricePerLength ?? line?.unitPricePerLength ?? line?.unitPriceBase ?? line?.unitPrice,
  );
  const decomposition = sumTextileDecomposition(line?.textileDecompositionPayload, baseUom);

  if (invoiceType === 'purchase') {
    if (rollCount <= 0) throw appError(400, 'TEXTILE_ROLL_COUNT_REQUIRED', 'عدد الرولات مطلوب في شراء الأقمشة.');
    if (totalLength <= 0) throw appError(400, 'TEXTILE_TOTAL_LENGTH_REQUIRED', 'إجمالي الطول مطلوب في شراء الأقمشة.');
    if (unitPricePerLength <= 0) throw appError(400, 'TEXTILE_PRICE_PER_LENGTH_REQUIRED', 'سعر الطول مطلوب في شراء الأقمشة.');
  } else if (invoiceType === 'sale' || invoiceType === 'return' || invoiceType === 'exchange') {
    if (rollCount <= 0) throw appError(400, 'TEXTILE_ROLL_COUNT_REQUIRED', 'عدد الرولات مطلوب في بيع الأقمشة.');
    if (decomposition.count !== Math.round(rollCount)) {
      throw appError(400, 'TEXTILE_DECOMPOSITION_INCOMPLETE', 'تفكيك الرولات غير مكتمل أو لا يطابق عدد الرولات المطلوبة.');
    }
    if (decomposition.totalLength <= 0) {
      throw appError(400, 'TEXTILE_TOTAL_LENGTH_REQUIRED', 'إجمالي الطول الناتج من التفكيك مطلوب.');
    }
  }

  const effectiveLength = decomposition.totalLength > 0 ? decomposition.totalLength : totalLength;
  const effectiveUnitPrice = unitPricePerLength > 0
    ? unitPricePerLength
    : safeNumber(line?.lineTotalBase || line?.total) > 0 && effectiveLength > 0
      ? safeNumber(line?.lineTotalBase || line?.total) / effectiveLength
      : 0;

  return {
    ...line,
    isTextile: true,
    quantity: effectiveLength,
    baseQuantity: effectiveLength,
    textileColorId: String(colorRow.id),
    textileColorName: String(colorRow.name || ''),
    textileRollCount: rollCount,
    textileTotalLength: effectiveLength,
    textileBaseUom: baseUom,
    textileUnitPricePerLength: effectiveUnitPrice,
    textileDecompositionPayload: decomposition.entries.map((entry: any) => ({
      sequence: entry.sequence,
      lengthValue: entry.length,
      unit: entry.unit || baseUom,
      rollLabel: entry.rollLabel,
    })),
  };
};

export const adjustTextileStock = (
  db: any,
  schema: any,
  params: {
    companyId?: string | null;
    branchId?: string | null;
    warehouseId: string;
    warehouseName?: string | null;
    itemId: string;
    colorId: string;
    baseUom: TextileBaseUom;
    rollDelta: number;
    lengthDelta: number;
    documentType: string;
    documentId: string;
    documentNumber?: string | null;
    documentLineId?: string | null;
    movementType: string;
    userId?: string | null;
    userName?: string | null;
    notes?: string | null;
  },
) => {
  const rollDelta = safeNumber(params.rollDelta);
  const lengthDelta = safeNumber(params.lengthDelta);
  if (!rollDelta && !lengthDelta) return null;

  const existing = db.select().from(schema.textileStockBalances).where(and(
    eq(schema.textileStockBalances.companyId, params.companyId || null),
    eq(schema.textileStockBalances.branchId, params.branchId || null),
    eq(schema.textileStockBalances.warehouseId, params.warehouseId),
    eq(schema.textileStockBalances.itemId, params.itemId),
    eq(schema.textileStockBalances.colorId, params.colorId),
    eq(schema.textileStockBalances.baseUom, params.baseUom),
  )).get();

  const nextRolls = safeNumber(existing?.rollCount) + rollDelta;
  const nextLength = safeNumber(existing?.totalLength) + lengthDelta;
  if (nextRolls < -0.000001 || nextLength < -0.000001) {
    throw appError(409, 'TEXTILE_STOCK_INSUFFICIENT', 'المخزون القماشي غير كافٍ لهذه العملية.', {
      item_id: params.itemId,
      color_id: params.colorId,
      warehouse_id: params.warehouseId,
      current_roll_count: safeNumber(existing?.rollCount),
      current_total_length: safeNumber(existing?.totalLength),
      requested_roll_delta: rollDelta,
      requested_length_delta: lengthDelta,
    });
  }

  const now = new Date().toISOString();
  if (existing) {
    db.update(schema.textileStockBalances).set({
      warehouseName: params.warehouseName || existing.warehouseName || null,
      rollCount: nextRolls,
      totalLength: nextLength,
      updatedAt: now,
    }).where(eq(schema.textileStockBalances.id, existing.id)).run();
  } else {
    db.insert(schema.textileStockBalances).values({
      id: `tsb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      companyId: params.companyId || null,
      branchId: params.branchId || null,
      warehouseId: params.warehouseId,
      warehouseName: params.warehouseName || null,
      itemId: params.itemId,
      colorId: params.colorId,
      baseUom: params.baseUom,
      rollCount: nextRolls,
      totalLength: nextLength,
      updatedAt: now,
    }).run();
  }

  db.insert(schema.textileStockMovements).values({
    id: `tsm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    companyId: params.companyId || null,
    branchId: params.branchId || null,
    warehouseId: params.warehouseId,
    warehouseName: params.warehouseName || null,
    itemId: params.itemId,
    colorId: params.colorId,
    baseUom: params.baseUom,
    rollDelta,
    lengthDelta,
    documentType: params.documentType,
    documentId: params.documentId,
    documentNumber: params.documentNumber || null,
    documentLineId: params.documentLineId || null,
    movementType: params.movementType,
    userId: params.userId || null,
    userName: params.userName || null,
    notes: params.notes || null,
    createdAt: now,
  }).run();

  return { rollCount: nextRolls, totalLength: nextLength };
};

export const getTextileInventoryBalances = async (
  db: any,
  schema: any,
  filters: {
    companyId: string;
    branchId?: string | null;
    warehouseId?: string | null;
    itemId?: string | null;
    colorId?: string | null;
    textileOnly?: boolean;
  },
) => {
  const clauses = [eq(schema.textileStockBalances.companyId, filters.companyId)];
  if (filters.branchId) clauses.push(eq(schema.textileStockBalances.branchId, filters.branchId));
  if (filters.warehouseId) clauses.push(eq(schema.textileStockBalances.warehouseId, filters.warehouseId));
  if (filters.itemId) clauses.push(eq(schema.textileStockBalances.itemId, filters.itemId));
  if (filters.colorId) clauses.push(eq(schema.textileStockBalances.colorId, filters.colorId));

  const rows = await db.select({
    id: schema.textileStockBalances.id,
    companyId: schema.textileStockBalances.companyId,
    branchId: schema.textileStockBalances.branchId,
    warehouseId: schema.textileStockBalances.warehouseId,
    warehouseName: schema.textileStockBalances.warehouseName,
    itemId: schema.textileStockBalances.itemId,
    colorId: schema.textileStockBalances.colorId,
    baseUom: schema.textileStockBalances.baseUom,
    rollCount: schema.textileStockBalances.rollCount,
    totalLength: schema.textileStockBalances.totalLength,
    updatedAt: schema.textileStockBalances.updatedAt,
    itemName: schema.items.name,
    itemCode: schema.items.code,
    colorName: schema.textileColors.name,
  }).from(schema.textileStockBalances)
    .leftJoin(schema.items, eq(schema.items.id, schema.textileStockBalances.itemId))
    .leftJoin(schema.textileColors, eq(schema.textileColors.id, schema.textileStockBalances.colorId))
    .where(and(...clauses))
    .all();

  if (!filters.textileOnly) return rows;
  return rows.filter((row: any) => true);
};

export const buildTextileDispatchPrintPayload = (notice: any, lines: any[], decompositionsByLine: Map<string, any[]>) => ({
  id: String(notice.id),
  dispatchNumber: String(notice.dispatchNumber || notice.id),
  status: String(notice.status || ''),
  date: String(notice.createdAt || notice.requestedAt || ''),
  customerName: String(notice.customerName || ''),
  warehouseName: String(notice.warehouseName || ''),
  requestedByName: String(notice.requestedByName || ''),
  preparedByName: String(notice.preparedByName || ''),
  approvedByName: String(notice.approvedByName || ''),
  notes: String(notice.notes || ''),
  lines: (lines || []).map((line: any) => ({
    id: String(line.id),
    itemId: String(line.itemId),
    itemName: String(line.itemName || ''),
    colorId: String(line.colorId || ''),
    colorName: String(line.colorName || ''),
    requestedRollCount: safeNumber(line.requestedRollCount),
    fulfilledRollCount: safeNumber(line.fulfilledRollCount),
    fulfilledTotalLength: safeNumber(line.fulfilledTotalLength),
    baseUom: String(line.baseUom || ''),
    textileUnitPricePerLength: safeNumber(line.textileUnitPricePerLength),
    decomposition: (decompositionsByLine.get(String(line.id)) || []).map((entry: any) => ({
      sequence: Number(entry.sequence || 0),
      lengthValue: safeNumber(entry.lengthValue),
      unit: String(entry.unit || ''),
      rollLabel: entry.rollLabel || null,
    })),
  })),
});

export const findDispatchWithDetails = async (db: any, schema: any, noticeId: string) => {
  const notice = await db.select().from(schema.warehouseDispatchNotices).where(eq(schema.warehouseDispatchNotices.id, noticeId)).get();
  if (!notice) return null;
  const lines = await db.select().from(schema.warehouseDispatchNoticeLines).where(eq(schema.warehouseDispatchNoticeLines.noticeId, noticeId)).all();
  const decompositions = await db.select().from(schema.warehouseDispatchNoticeLineDecompositions).where(eq(schema.warehouseDispatchNoticeLineDecompositions.noticeId, noticeId)).all();
  const decompositionsByLine = new Map<string, any[]>();
  for (const entry of decompositions || []) {
    const key = String(entry.lineId || '');
    decompositionsByLine.set(key, [...(decompositionsByLine.get(key) || []), entry]);
  }
  return { notice, lines, decompositions, decompositionsByLine };
};

export const assertDispatchStatus = (currentStatus: string, allowed: string[], message: string) => {
  const normalized = String(currentStatus || '').trim().toLowerCase();
  if (!allowed.map((entry) => String(entry).toLowerCase()).includes(normalized)) {
    throw appError(409, 'TEXTILE_DISPATCH_INVALID_STATUS', message, {
      status: currentStatus,
      allowed_statuses: allowed,
    });
  }
};

export const dispatchNoticeStatusValues = [
  'draft',
  'sent_to_warehouse',
  'in_preparation',
  'prepared',
  'awaiting_approval',
  'approved',
  'rejected',
  'converted_to_invoice',
  'cancelled',
] as const;

export const buildDispatchLineInvoicePayload = (line: any, decompositions: any[]) => {
  const normalizedDecomposition = (decompositions || [])
    .slice()
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .map((entry: any) => ({
      sequence: Number(entry.sequence || 0),
      lengthValue: safeNumber(entry.lengthValue),
      unit: String(entry.unit || line.baseUom || ''),
      rollLabel: entry.rollLabel || null,
    }));
  const totalLength = normalizedDecomposition.reduce((sum, entry) => sum + safeNumber(entry.lengthValue), 0);
  return {
    itemId: String(line.itemId || ''),
    itemName: String(line.itemName || ''),
    quantity: totalLength,
    baseQuantity: totalLength,
    unitName: String(line.baseUom || ''),
    unitPrice: safeNumber(line.textileUnitPricePerLength),
    total: safeNumber(line.textileUnitPricePerLength) * totalLength,
    isTextile: true,
    textileColorId: String(line.colorId || ''),
    textileColorName: String(line.colorName || ''),
    textileRollCount: safeNumber(line.fulfilledRollCount || line.requestedRollCount),
    textileTotalLength: totalLength,
    textileBaseUom: String(line.baseUom || ''),
    textileUnitPricePerLength: safeNumber(line.textileUnitPricePerLength),
    textileDecompositionPayload: normalizedDecomposition,
    sourceDispatchLineId: String(line.id || ''),
  };
};
