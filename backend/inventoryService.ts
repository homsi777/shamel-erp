import { sql, eq } from 'drizzle-orm';
import * as schema from './db/schema';

const envFlagEnabled = (...values: any[]) =>
  values.some((value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  });

export const isStrictMovementLedgerMode = () =>
  envFlagEnabled(
    process.env.ERP_STOCK_STRICT_LEDGER,
    process.env.ERP_STRICT_MODE,
  );

/**
 * Resolve unit factor from units table.
 * Returns { factor, unitName } where factor converts selected unit -> base quantity.
 */
export const resolveUnitFactor = async (
  db: any,
  unitId?: string | null
): Promise<{ factor: number; unitName: string | null }> => {
  if (!unitId) return { factor: 1, unitName: null };
  const unit = await db.select().from(schema.units).where(eq(schema.units.id, unitId)).get();
  if (!unit) return { factor: 1, unitName: null };
  const factorRaw = Number((unit as any).factor ?? 1);
  const factor = Number.isFinite(factorRaw) && factorRaw > 0 ? factorRaw : 1;
  return { factor, unitName: (unit as any).name || null };
};

/**
 * Compute canonical base quantity for a given qty/unit using units table.
 * Always returns a non-negative baseQty; sign should be applied by caller.
 */
export const computeBaseQty = async (
  db: any,
  params: { qty: number; unitId?: string | null }
): Promise<{ baseQty: number; factor: number }> => {
  const qty = Number(params.qty || 0);
  if (!qty) return { baseQty: 0, factor: 1 };
  const { factor } = await resolveUnitFactor(db, params.unitId);
  const baseQty = qty * factor;
  return { baseQty, factor };
};

export type StockMovementMeta = {
  documentType: string;
  documentId: string;
  documentNumber?: string | null;
  documentLineId?: string | null;
  movementType: string;
  userId?: string | null;
  userName?: string | null;
  notes?: string | null;
};

export type AdjustStockParams = {
  itemId: string;
  warehouseId: string;
  warehouseName?: string | null;
  unitId?: string | null;
  unitName?: string | null;
  qtyDelta: number; // in selected unit (signed)
  baseQtyDelta: number; // in base unit (signed)
  meta: StockMovementMeta;
};

export const assertNoDirectItemQuantityMutation = (payload: Record<string, any>, reason = 'DIRECT_ITEM_QUANTITY_MUTATION_BLOCKED') => {
  if (!payload || typeof payload !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(payload, 'quantity')) {
    throw new Error(reason);
  }
};

export const getItemMovementSum = async (db: any, itemId: string) => {
  const row = await db
    .select({
      movementCount: sql<number>`count(*)`,
      movementSum: sql<number>`coalesce(sum(${schema.inventoryMovements.baseQty}), 0)`,
    })
    .from(schema.inventoryMovements)
    .where(eq(schema.inventoryMovements.itemId, itemId))
    .get();

  return {
    movementCount: Number((row as any)?.movementCount || 0),
    movementSum: Number((row as any)?.movementSum || 0),
  };
};

export const getWarehouseItemMovementSum = async (
  db: any,
  params: { itemId: string; warehouseId: string; companyId?: string | null; branchId?: string | null },
) => {
  const itemId = String(params.itemId || '').trim();
  const warehouseId = String(params.warehouseId || '').trim();
  if (!itemId || !warehouseId) {
    return { movementCount: 0, movementSum: 0 };
  }

  const predicates = [
    eq(schema.inventoryMovements.itemId, itemId),
    eq(schema.inventoryMovements.warehouseId, warehouseId),
  ];
  if (params.companyId) predicates.push(eq(schema.inventoryMovements.companyId, String(params.companyId)));
  if (params.branchId) predicates.push(eq(schema.inventoryMovements.branchId, String(params.branchId)));

  const row = await db
    .select({
      movementCount: sql<number>`count(*)`,
      movementSum: sql<number>`coalesce(sum(${schema.inventoryMovements.baseQty}), 0)`,
    })
    .from(schema.inventoryMovements)
    .where(sql.join(predicates as any[], sql` and `))
    .get();

  return {
    movementCount: Number((row as any)?.movementCount || 0),
    movementSum: Number((row as any)?.movementSum || 0),
  };
};

export const loadWarehouseScopedItemStock = async (
  db: any,
  params: { itemId: string; warehouseId: string; companyId?: string | null; branchId?: string | null },
) => {
  const itemId = String(params.itemId || '').trim();
  const warehouseId = String(params.warehouseId || '').trim();
  if (!itemId || !warehouseId) return null;

  const predicates = [
    eq(schema.items.id, itemId),
    eq(schema.items.warehouseId, warehouseId),
  ];
  if (params.companyId) predicates.push(eq(schema.items.companyId, String(params.companyId)));
  if (params.branchId) predicates.push(eq(schema.items.branchId, String(params.branchId)));

  let item = await db.select().from(schema.items).where(sql.join(predicates as any[], sql` and `)).get();
  if (!item) {
    const fallbackPredicates = [eq(schema.items.id, itemId)];
    if (params.companyId) fallbackPredicates.push(eq(schema.items.companyId, String(params.companyId)));
    if (params.branchId) fallbackPredicates.push(eq(schema.items.branchId, String(params.branchId)));
    item = await db.select().from(schema.items).where(sql.join(fallbackPredicates as any[], sql` and `)).get();
  }
  if (!item && params.companyId) {
    item = await db.select().from(schema.items).where(
      sql.join([
        eq(schema.items.id, itemId),
        eq(schema.items.companyId, String(params.companyId)),
      ] as any[], sql` and `),
    ).get();
  }
  if (!item) {
    item = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
  }
  if (!item) return null;

  const movement = await getWarehouseItemMovementSum(db, params);
  const rowWarehouseId = String((item as any)?.warehouseId || '').trim();
  const fallbackQty = rowWarehouseId === warehouseId ? Number((item as any)?.quantity || 0) : 0;
  const availableQty = movement.movementCount > 0 ? movement.movementSum : fallbackQty;

  return {
    item,
    availableQty,
    movementCount: movement.movementCount,
    movementQty: movement.movementSum,
  };
};

export const recomputeItemQuantityFromMovements = async (
  db: any,
  params: {
    itemId: string;
    fallbackWarehouseId?: string | null;
    fallbackWarehouseName?: string | null;
    reason?: string | null;
  },
) => {
  const itemId = String(params.itemId || '').trim();
  if (!itemId) throw new Error('MISSING_ITEM_ID_FOR_RECOMPUTE');
  const item = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
  if (!item) throw new Error('ITEM_NOT_FOUND_FOR_RECOMPUTE');
  const { movementSum } = await getItemMovementSum(db, itemId);
  await db
    .update(schema.items)
    .set({
      quantity: movementSum,
      warehouseId: params.fallbackWarehouseId ?? (item as any).warehouseId ?? null,
      warehouseName: params.fallbackWarehouseName ?? (item as any).warehouseName ?? null,
      lastUpdated: new Date().toISOString(),
    })
    .where(eq(schema.items.id, itemId))
    .run();
  return { quantity: movementSum, reason: params.reason || 'RECOMPUTE_FROM_MOVEMENTS' };
};

/**
 * Canonical helper to change stock + log movement.
 * - Validates item and warehouse existence.
 * - Ensures non-negative stock (unless allowNegative=true in future).
 * - Updates items.quantity.
 * - Inserts inventory_movements audit row.
 *
 * IMPORTANT: This function executes queries DIRECTLY on the passed `db` (or `tx`).
 * It does NOT create its own inner transaction — the caller is responsible for
 * wrapping in a transaction when atomicity is required.  This avoids nested
 * SAVEPOINT issues with drizzle-orm/better-sqlite3 when called from inside an
 * outer db.transaction() callback.
 */
export const adjustItemStockWithMovement = async (
  db: any,
  params: AdjustStockParams
): Promise<{ newQuantity: number }> => {
  const {
    itemId,
    warehouseId,
    warehouseName,
    unitId,
    unitName,
    qtyDelta,
    baseQtyDelta,
    meta,
  } = params;

  if (!itemId) throw new Error('MISSING_ITEM_ID_FOR_STOCK_MOVEMENT');
  if (!warehouseId) throw new Error('MISSING_WAREHOUSE_ID_FOR_STOCK_MOVEMENT');

  const signedBase = Number(baseQtyDelta || 0);
  if (!Number.isFinite(signedBase) || signedBase === 0) {
    return { newQuantity: 0 };
  }

  // Validate warehouse exists
  const wh = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).get();
  if (!wh) {
    throw new Error('WAREHOUSE_NOT_FOUND_FOR_STOCK_MOVEMENT');
  }

  // Load existing item row bound to this warehouse (hybrid model).
  // Fall back to finding the item by ID only (ignoring warehouse) so that consignment
  // receiving for items that live in a different (or null) warehouse still works —
  // the UPDATE below will reassign warehouseId to the target warehouse.
  let existing = await db
    .select()
    .from(schema.items)
    .where(
      sql`${schema.items.id} = ${itemId} AND (${schema.items.warehouseId} = ${warehouseId} OR ${schema.items.warehouseId} IS NULL)`
    )
    .get();

  if (!existing) {
    existing = await db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
  }

  if (!existing) {
    throw new Error(`ITEM_NOT_FOUND_FOR_STOCK_MOVEMENT: ${itemId}`);
  }

  const strictLedger = isStrictMovementLedgerMode();
  let { movementCount, movementSum } = await getItemMovementSum(db, String((existing as any).id || itemId));
  const currentQty = Number((existing as any).quantity || 0);
  const shouldRepairPositiveDrift = movementCount > 0 && currentQty <= 0 && movementSum > 0.000001;

  if (shouldRepairPositiveDrift) {
    await db
      .update(schema.items)
      .set({
        quantity: movementSum,
        warehouseId,
        warehouseName: warehouseName ?? (existing as any).warehouseName ?? (wh as any).name ?? null,
        lastUpdated: new Date().toISOString(),
      })
      .where(eq(schema.items.id, (existing as any).id))
      .run();
  }

  // Bootstrap pre-existing items with an opening baseline movement to preserve
  // historical quantity when strict ledger mode is enabled.
  if (strictLedger && movementCount === 0 && currentQty !== 0) {
    await db.insert(schema.inventoryMovements).values({
      id: `imv-baseline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      companyId: (wh as any).companyId ?? (existing as any).companyId ?? null,
      branchId: (wh as any).branchId ?? (existing as any).branchId ?? null,
      itemId,
      warehouseId,
      warehouseName: warehouseName ?? (existing as any).warehouseName ?? (wh as any).name ?? null,
      documentType: 'SYSTEM_BASELINE',
      documentId: `baseline-${itemId}`,
      documentNumber: null,
      documentLineId: null,
      movementType: 'BASELINE',
      unitId: unitId ?? null,
      unitName: unitName ?? null,
      qty: currentQty,
      baseQty: currentQty,
      userId: meta.userId ?? null,
      userName: meta.userName ?? null,
      notes: 'Auto baseline movement generated to enforce movement-ledger stock invariants.',
      createdAt: new Date().toISOString(),
    }).run();
    movementCount = 1;
    movementSum = currentQty;
  }

  const baseBefore = strictLedger ? movementSum : (shouldRepairPositiveDrift ? movementSum : currentQty);
  const nextQty = baseBefore + signedBase;
  if (nextQty < 0) {
    throw new Error('NEGATIVE_STOCK_NOT_ALLOWED');
  }

  const nowIso = new Date().toISOString();

  await db
    .update(schema.items)
    .set({
      companyId: (wh as any).companyId ?? (existing as any).companyId ?? null,
      branchId: (wh as any).branchId ?? (existing as any).branchId ?? null,
      quantity: nextQty,
      warehouseId,
      warehouseName: warehouseName ?? (existing as any).warehouseName ?? (wh as any).name ?? null,
      lastUpdated: nowIso,
    })
    .where(eq(schema.items.id, (existing as any).id))
    .run();

  const movementId = `imv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await db.insert(schema.inventoryMovements).values({
    id: movementId,
    companyId: (wh as any).companyId ?? (existing as any).companyId ?? null,
    branchId: (wh as any).branchId ?? (existing as any).branchId ?? null,
    itemId,
    warehouseId,
    warehouseName: warehouseName ?? (existing as any).warehouseName ?? (wh as any).name ?? null,
    documentType: meta.documentType,
    documentId: meta.documentId,
    documentNumber: meta.documentNumber ?? null,
    documentLineId: meta.documentLineId ?? null,
    movementType: meta.movementType,
    unitId: unitId ?? null,
    unitName: unitName ?? null,
    qty: Number(qtyDelta || 0),
    baseQty: signedBase,
    userId: meta.userId ?? null,
    userName: meta.userName ?? null,
    notes: meta.notes ?? null,
    createdAt: nowIso,
  }).run();

  if (strictLedger) {
    const { movementSum: movementSumAfter } = await getItemMovementSum(db, String((existing as any).id || itemId));
    if (Math.abs(movementSumAfter - nextQty) > 0.000001) {
      throw new Error('STOCK_LEDGER_INVARIANT_BROKEN');
    }
  }

  return { newQuantity: nextQty };
};
