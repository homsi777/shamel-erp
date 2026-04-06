import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { appError, isAppError } from '../lib/errors';
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
    eq,
    desc,
    safeJsonParse,
    roundMoney,
    resolveSystemAccountId,
    SYSTEM_ACCOUNTS,
    ACCOUNTING_LABELS,
    buildDescription,
    createJournalEntry,
    postJournalEntry,
    adjustItemStockWithMovement,
  } = ctx as any;

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const withScopedRecipe = async (recipeId: string, req: any, notFoundMessage = 'Recipe not found.') => {
    const recipe = await db.select().from(schema.recipes).where(eq(schema.recipes.id, recipeId)).get();
    if (!recipe) return null;
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(recipe, String(authContext.companyId || ''), notFoundMessage);
    return recipe;
  };

  const withScopedManufacturingOrder = async (orderId: string, req: any, notFoundMessage = 'Manufacturing order not found.') => {
    const order = await db.select().from(schema.manufacturingOrders).where(eq(schema.manufacturingOrders.id, orderId)).get();
    if (!order) return null;
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(order, String(authContext.companyId || ''), notFoundMessage);
    assertEntityBelongsToAllowedBranch(order, authContext, notFoundMessage);
    return order;
  };

  const assertItemTenantAccess = (item: any, req: any, notFoundMessage = 'Item not found.') => {
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(item, String(authContext.companyId || ''), notFoundMessage);
    assertEntityBelongsToAllowedBranch(item, authContext, notFoundMessage);
  };

  api.get('/manufacturing/recipes', async (req) => {
    const rows = await db.select().from(schema.recipes).orderBy(desc(schema.recipes.createdAt)).all();
    return filterRowsByTenantScope(rows, getAuthContext(req), 'recipes');
  });

  api.post('/manufacturing/recipes', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const data = req.body as any;
      const id = data.id || `rec-${Date.now()}`;
      const outputItemId = String(data.outputItemId || '').trim();
      if (!String(data.name || '').trim() || !outputItemId) {
        return reply.status(400).send({ error: 'بيانات الوصفة غير مكتملة.' });
      }

      const outputItem = await db.select().from(schema.items).where(eq(schema.items.id, outputItemId)).get();
      if (outputItem) assertItemTenantAccess(outputItem, req, 'الصنف النهائي غير موجود.');

      const rawLines = Array.isArray(data.lines) ? data.lines : safeJsonParse(data.lines, []);
      for (const line of rawLines || []) {
        const inputItemId = String(line.inputItemId || line.itemId || '').trim();
        if (!inputItemId) continue;
        const inputItem = await db.select().from(schema.items).where(eq(schema.items.id, inputItemId)).get();
        if (!inputItem) {
          return reply.status(400).send({ error: `الصنف الخام غير موجود ضمن الوصفة: ${inputItemId}` });
        }
        assertEntityBelongsToCompany(inputItem, String(authContext.companyId || ''), 'الصنف الخام غير موجود ضمن المؤسسة الحالية.');
      }

      await db.insert(schema.recipes).values({
        id,
        companyId: String(authContext.companyId || '').trim() || null,
        name: data.name,
        code: data.code || null,
        outputItemId,
        outputItemName: data.outputItemName,
        outputQty: Number(data.outputQty || 1),
        unitName: data.unitName || null,
        lines: JSON.stringify(rawLines || []),
        notes: data.notes || null,
        createdAt: data.createdAt,
      }).run();
      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  api.delete('/manufacturing/recipes/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const existing = await withScopedRecipe(String(id || ''), req);
      if (!existing) return reply.status(404).send({ error: 'Recipe not found.' });
      await db.delete(schema.recipes).where(eq(schema.recipes.id, id)).run();
      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  api.get('/manufacturing/orders', async (req) => {
    try {
      const rows = filterRowsByTenantScope(
        await db.select().from(schema.manufacturingOrders).all(),
        getAuthContext(req),
        'manufacturing-orders',
      );
      return rows.map((r: any) => ({ ...r, items: safeJsonParse(r.items, []) }));
    } catch {
      return [];
    }
  });

  api.post('/manufacturing/process', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const data = req.body as any;
      if (!data.outputItemId || !data.warehouseId || !data.outputQty) {
        return reply.status(400).send({ error: 'Missing required manufacturing fields.' });
      }

      const warehouse = await resolveWarehouseForContext(db, schema, eq, String(data.warehouseId || ''));
      assertWarehouseAccess(warehouse, authContext);

      const companyId = String(warehouse?.companyId || authContext.companyId || '').trim() || null;
      const branchId = String(warehouse?.branchId || pickEffectiveBranchId(data.branchId, authContext) || '').trim() || null;
      const warehouseId = String(data.warehouseId || '').trim();
      const warehouseName = data.warehouseName || warehouse?.name || null;

      const items = Array.isArray(data.items) ? data.items : safeJsonParse(data.items, []);
      const materialCost = items.reduce((sum: number, i: any) => sum + (Number(i.lineTotalCost) || 0), 0);
      let expenseAmt = 0;
      if (data.expenseType === 'PERCENT') expenseAmt = materialCost * (Number(data.expenseValue || 0) / 100);
      else expenseAmt = Number(data.expenseValue || 0);
      const totalCost = Number(data.totalCost) || (materialCost + expenseAmt);
      const outputQty = Number(data.outputQty || 0);
      const unitCost = Number(data.unitCost) || (outputQty > 0 ? totalCost / outputQty : 0);

      const id = data.id || `mfg-${Date.now()}`;

      await db.transaction(async (tx: any) => {
        await tx.insert(schema.manufacturingOrders).values({
          id,
          companyId,
          branchId,
          code: data.code || Date.now().toString().slice(-6),
          date: data.date,
          warehouseId,
          warehouseName,
          outputItemId: data.outputItemId,
          outputItemName: data.outputItemName,
          outputQty,
          unitCost,
          totalCost,
          status: data.status || 'POSTED',
          expenseType: data.expenseType || 'FIXED',
          expenseValue: Number(data.expenseValue || 0),
          items: JSON.stringify(items),
          notes: data.notes,
          createdAt: data.createdAt,
        }).run();

        for (const it of items || []) {
          const inputItemId = String(it.inputItemId || '').trim();
          if (!inputItemId) continue;
          const invItem = await tx.select().from(schema.items).where(eq(schema.items.id, inputItemId)).get();
          if (!invItem) throw appError(400, 'MANUFACTURING_INPUT_ITEM_NOT_FOUND', `الصنف الخام غير موجود: ${inputItemId}`);
          assertEntityBelongsToCompany(invItem, String(companyId || ''), 'الصنف الخام غير موجود ضمن المؤسسة الحالية.');
          assertEntityBelongsToAllowedBranch(invItem, authContext, 'الصنف الخام خارج الفروع المسموح بها.');
          await adjustItemStockWithMovement(tx, {
            itemId: inputItemId,
            warehouseId,
            warehouseName,
            unitId: it.unitId || null,
            unitName: it.unitName || null,
            qtyDelta: -Number(it.inputQty || 0),
            baseQtyDelta: -Number(it.inputQty || 0),
            meta: {
              documentType: 'MANUFACTURING_ORDER',
              documentId: id,
              documentNumber: data.code || id,
              movementType: 'MANUFACTURING_CONSUMPTION',
              userId: authContext.userId || null,
              userName: authContext.username || null,
              notes: data.notes || null,
            },
          });
        }

        let outputItem = await tx.select().from(schema.items).where(eq(schema.items.id, String(data.outputItemId))).get();
        if (outputItem) {
          assertEntityBelongsToCompany(outputItem, String(companyId || ''), 'الصنف النهائي غير موجود ضمن المؤسسة الحالية.');
        } else {
          await tx.insert(schema.items).values({
            id: data.outputItemId,
            companyId,
            branchId,
            name: data.outputItemName || 'منتج نهائي',
            code: data.outputCode || Date.now().toString().slice(-6),
            unitName: items[0]?.unitName || 'وحدة',
            quantity: 0,
            costPrice: unitCost,
            costPriceBase: unitCost,
            salePrice: unitCost,
            salePriceBase: unitCost,
            wholesalePrice: unitCost,
            wholesalePriceBase: unitCost,
            priceCurrency: 'USD',
            warehouseId,
            warehouseName,
            itemType: 'STOCK',
            lastUpdated: new Date().toISOString(),
          }).run();
          outputItem = await tx.select().from(schema.items).where(eq(schema.items.id, String(data.outputItemId))).get();
        }

        await adjustItemStockWithMovement(tx, {
          itemId: String(data.outputItemId),
          warehouseId,
          warehouseName,
          unitId: data.unitId || items[0]?.unitId || null,
          unitName: data.unitName || items[0]?.unitName || null,
          qtyDelta: outputQty,
          baseQtyDelta: outputQty,
          meta: {
            documentType: 'MANUFACTURING_ORDER',
            documentId: id,
            documentNumber: data.code || id,
            movementType: 'MANUFACTURING_OUTPUT',
            userId: authContext.userId || null,
            userName: authContext.username || null,
            notes: data.notes || null,
          },
        });

        await tx.update(schema.items)
          .set({ costPrice: unitCost, costPriceBase: unitCost, lastUpdated: new Date().toISOString() })
          .where(eq(schema.items.id, String(data.outputItemId)))
          .run();
      });

      if (String(data.status || 'POSTED').toUpperCase() === 'POSTED') {
        try {
          const inventoryAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.INVENTORY, companyId);
          const salaryAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.SALARIES, companyId);
          const lines: any[] = [
            { accountId: inventoryAccountId, debit: roundMoney(totalCost), credit: 0, description: buildDescription(ACCOUNTING_LABELS.PRODUCTION_OUTPUT, ':', data.outputItemName || data.outputItemId) },
            { accountId: inventoryAccountId, debit: 0, credit: roundMoney(materialCost), description: ACCOUNTING_LABELS.RAW_MATERIALS },
          ];
          if (expenseAmt > 0) {
            lines.push({ accountId: salaryAccountId, debit: 0, credit: roundMoney(expenseAmt), description: ACCOUNTING_LABELS.DIRECT_LABOR });
          }
          const entry = await createJournalEntry({
            description: buildDescription(ACCOUNTING_LABELS.MANUFACTURING_ORDER, ACCOUNTING_LABELS.NUMBER, data.code || id),
            referenceType: 'manufacturing',
            referenceId: null,
            entryDate: data.date || new Date().toISOString(),
            currencyCode: 'SYP',
            companyId,
            branchId,
            lines,
          });
          await postJournalEntry(entry.id);
        } catch (error: any) {
          console.error('Manufacturing journal error:', error?.message || error);
        }
      }

      return { success: true };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });
}
