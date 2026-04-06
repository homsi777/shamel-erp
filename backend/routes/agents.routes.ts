import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import { appError } from '../lib/errors';
import { loadWarehouseScopedItemStock } from '../inventoryService';
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
    and,
    desc,
    safeJsonParse,
    stringifyOrEmpty,
    adjustItemStockWithMovement,
    systemEventLogger,
    bcrypt,
    auditLogger,
  } = ctx as any;
  const getAuthContext = (req: any) => (req as any).authContext || {};

  const nowIso = () => new Date().toISOString();
  const buildId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const toNumber = (value: any) => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  };
  const ensureAgentScope = (agent: any, authContext: any, companyId: string, message = 'Agent not found.') => {
    if (!agent) throw appError(404, 'AGENT_NOT_FOUND', message);
    assertEntityBelongsToCompany(agent, companyId, message);
    assertEntityBelongsToAllowedBranch(agent, authContext, message);
  };
  const normalizeScopedAgentInventoryRow = async (
    tx: any,
    scope: { companyId: string; branchId: string; agentId: string; itemId: string },
  ) => {
    const scopedRow = await tx.select().from(schema.agentInventory).where(
      and(
        eq(schema.agentInventory.companyId, scope.companyId),
        eq(schema.agentInventory.branchId, scope.branchId),
        eq(schema.agentInventory.agentId, scope.agentId),
        eq(schema.agentInventory.itemId, scope.itemId),
      ),
    ).get();
    if (scopedRow) return scopedRow;

    const legacyRow = await tx.select().from(schema.agentInventory).where(
      and(
        eq(schema.agentInventory.agentId, scope.agentId),
        eq(schema.agentInventory.itemId, scope.itemId),
      ),
    ).get();
    if (!legacyRow) return null;

    const legacyCompanyId = String((legacyRow as any).companyId || '').trim();
    const legacyBranchId = String((legacyRow as any).branchId || '').trim();
    if (legacyCompanyId === scope.companyId && legacyBranchId === scope.branchId) return legacyRow;

    await tx.update(schema.agentInventory)
      .set({
        companyId: scope.companyId,
        branchId: scope.branchId,
        updatedAt: nowIso(),
      })
      .where(eq(schema.agentInventory.id, legacyRow.id))
      .run();

    return tx.select().from(schema.agentInventory).where(eq(schema.agentInventory.id, legacyRow.id)).get();
  };
  const isAgentSelf = (req: any, agent: any) => {
    const authContext = getAuthContext(req);
    const authUserId = String(authContext.userId || req.user?.id || '').trim();
    if (!authUserId) return false;
    return authUserId === String(agent?.userId || '').trim() || authUserId === String(agent?.id || '').trim();
  };
  const resolveSelfAgentId = async (req: any) => {
    const authContext = getAuthContext(req);
    if (String(authContext.role || '').toLowerCase() !== 'agent') return null;
    const authUserId = String(authContext.userId || req.user?.id || '').trim();
    if (!authUserId) return null;
    const linkedAgent = await db.select().from(schema.agents).where(eq(schema.agents.userId, authUserId)).get();
    if (linkedAgent?.id) return String(linkedAgent.id);
    const directAgent = await db.select().from(schema.agents).where(eq(schema.agents.id, authUserId)).get();
    return directAgent?.id ? String(directAgent.id) : null;
  };

  api.get('/agent-inventory', async (req) => {
    try {
      const query = req.query as any;
      let rows = await db.select().from(schema.agentInventory).all();
      rows = filterRowsByTenantScope(rows, getAuthContext(req), 'agent-inventory');
      const selfAgentId = await resolveSelfAgentId(req);
      if (selfAgentId) rows = rows.filter((r: any) => String(r.agentId || '') === selfAgentId);
      if (query.agentId) rows = rows.filter((r: any) => String(r.agentId) === String(query.agentId));
      if (query.itemId) rows = rows.filter((r: any) => String(r.itemId) === String(query.itemId));
      const scopedItems = filterRowsByTenantScope(
        await db.select().from(schema.items).all(),
        getAuthContext(req),
        'items',
      );
      const itemMap = new Map((scopedItems || []).map((item: any) => [String(item.id || ''), item]));
      return rows.map((row: any) => {
        const item = itemMap.get(String(row.itemId || '')) || {};
        return {
          ...row,
          name: row.itemName || item.name || null,
          code: item.code || null,
          imageUrl: item.imageUrl || null,
          unitId: item.unitId || null,
          warehouseId: item.warehouseId || null,
          warehouseName: item.warehouseName || null,
          costPrice: Number(item.costPrice || 0),
          costPriceBase: Number(item.costPriceBase ?? item.costPrice ?? 0),
          salePrice: Number(item.salePrice || 0),
          salePriceBase: Number(item.salePriceBase ?? item.salePrice ?? 0),
          posPrice: Number(item.posPrice ?? item.salePrice ?? 0),
          posPriceBase: Number(item.posPriceBase ?? item.posPrice ?? item.salePrice ?? 0),
          wholesalePrice: Number(item.wholesalePrice || 0),
          wholesalePriceBase: Number(item.wholesalePriceBase ?? item.wholesalePrice ?? 0),
          distributionPrice: Number(item.distributionPrice || 0),
          distributionPriceBase: Number(item.distributionPriceBase ?? item.distributionPrice ?? 0),
          delegatePrice: Number(item.delegatePrice || 0),
          delegatePriceBase: Number(item.delegatePriceBase ?? item.delegatePrice ?? 0),
          priceCurrency: String(item.priceCurrency || 'USD'),
          itemType: item.itemType || 'STOCK',
        };
      });
    } catch (e) {
      return [];
    }
  });

  api.get('/agent-inventory/summary', async (req) => {
    try {
      const authContext = getAuthContext(req);
      let rows = await db.select().from(schema.agentInventory).all();
      rows = filterRowsByTenantScope(rows, authContext, 'agent-inventory');
      const selfAgentId = await resolveSelfAgentId(req);
      if (selfAgentId) rows = rows.filter((r: any) => String(r.agentId || '') === selfAgentId);
      const totals = new Map<string, { agentId: string; totalQty: number; itemCount: number }>();
      for (const row of rows || []) {
        const agentId = String(row.agentId || '');
        if (!agentId) continue;
        const current = totals.get(agentId) || { agentId, totalQty: 0, itemCount: 0 };
        current.totalQty += Number(row.quantity || 0);
        current.itemCount += 1;
        totals.set(agentId, current);
      }
      return Array.from(totals.values());
    } catch {
      return [];
    }
  });

  api.get('/agent-transfers', async (req) => {
    try {
      const query = req.query as any;
      let rows = await db.select().from(schema.agentTransfers).orderBy(desc(schema.agentTransfers.createdAt)).all();
      rows = filterRowsByTenantScope(rows, getAuthContext(req), 'agent-transfers');
      const selfAgentId = await resolveSelfAgentId(req);
      if (selfAgentId) rows = rows.filter((r: any) => String(r.agentId || '') === selfAgentId);
      rows = rows.map((r: any) => ({ ...r, items: safeJsonParse(r.items, []) }));
      if (query.agentId) rows = rows.filter((r: any) => String(r.agentId) === String(query.agentId));
      if (query.transferType) rows = rows.filter((r: any) => String(r.transferType || '') === String(query.transferType));
      return rows;
    } catch (e) {
      return [];
    }
  });

  api.get('/agent-transfers/:id/lines', async (req) => {
    try {
      const id = String((req.params as any)?.id || '');
      if (!id) return [];
      let rows = await db.select().from(schema.agentTransferLines).where(eq(schema.agentTransferLines.transferId, id)).all();
      rows = filterRowsByTenantScope(rows, getAuthContext(req), 'agent-transfers');
      const selfAgentId = await resolveSelfAgentId(req);
      if (selfAgentId) rows = rows.filter((r: any) => String(r.agentId || '') === selfAgentId);
      return rows;
    } catch {
      return [];
    }
  });

  api.post('/agents/provision', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim();
      const body = (req.body || {}) as any;
      const name = String(body.name || '').trim();
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const branchId = String(body.branchId || '').trim();

      if (!companyId) {
        return reply.status(401).send({ error: 'سياق الشركة الحالي غير متوفر.' });
      }
      if (!name || !username || !password || !branchId) {
        return reply.status(400).send({ error: 'الاسم واسم المستخدم وكلمة المرور والفرع حقول مطلوبة.' });
      }

      const branch = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId)).get();
      if (!branch) {
        return reply.status(404).send({ error: 'الفرع المحدد غير موجود.' });
      }
      assertEntityBelongsToCompany(branch, companyId, 'الفرع المحدد غير موجود.');
      assertEntityBelongsToAllowedBranch(branch, authContext, 'لا يمكنك إنشاء مندوب لهذا الفرع.');

      const existingUser = await db.select().from(schema.users).where(eq(schema.users.username, username)).get();
      if (existingUser) {
        const linkedAgent = await db.select().from(schema.agents).where(eq(schema.agents.userId, String(existingUser.id || ''))).get();
        return reply.status(409).send({
          error: linkedAgent
            ? 'اسم المستخدم مستخدم مسبقًا. اختر اسمًا مختلفًا للمندوب.'
            : 'اسم المستخدم محجوز بحساب غير مكتمل من محاولة سابقة. غيّر اسم المستخدم أو نظّف الحساب المعلّق.',
          code: linkedAgent ? 'AGENT_USERNAME_EXISTS' : 'AGENT_ORPHAN_USER_EXISTS',
        });
      }

      const id = String(body.id || buildId('agent-user'));
      const createdAt = nowIso();
      const permissions = Array.isArray(body.permissions)
        ? body.permissions.join(',')
        : String(body.permissions || '');
      const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

      await db.transaction(async (tx: any) => {
        await tx.insert(schema.users).values({
          id,
          username,
          passwordHash,
          name,
          role: 'agent',
          permissions,
          companyId,
          defaultBranchId: branchId,
          branchScope: 'restricted',
          posWarehouseId: null,
          posWarehouseName: null,
          isActive: body.isActive ?? true,
        }).run();

        await tx.insert(schema.userCompanyAccess).values({
          id: `uca-${id}-${companyId}`,
          userId: id,
          companyId,
          isDefault: true,
          isActive: true,
        }).run();

        await tx.insert(schema.userBranchAccess).values({
          id: `uba-${id}-${branchId}`,
          userId: id,
          branchId,
          isDefault: true,
          isActive: true,
        }).run();

        await tx.insert(schema.agents).values({
          id,
          companyId,
          branchId,
          userId: id,
          name,
          phone: String(body.phone || '').trim() || null,
          vehicle: String(body.vehicle || '').trim() || null,
          vehicleImage: body.vehicleImage || null,
          certificateImage: body.certificateImage || null,
          notes: String(body.notes || '').trim() || null,
          isActive: body.isActive ?? true,
          commissionRate: Number(body.commissionRate || 0),
          commissionCurrency: String(body.commissionCurrency || 'USD').trim() || 'USD',
          createdAt,
          updatedAt: createdAt,
        }).run();
      });

      await auditLogger?.log({
        userId: String(authContext.userId || 'system'),
        operationType: 'agents.create',
        affectedItems: [{ agentId: id, userId: id }],
        newValues: {
          id,
          companyId,
          branchId,
          userId: id,
          name,
          username,
        },
      });

      return { success: true, id };
    } catch (e: any) {
      const statusCode = e?.statusCode || 500;
      return reply.status(statusCode).send({ error: e?.message || 'تعذر إنشاء المندوب.' });
    }
  });

  api.post('/agents/:id/location', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const data = req.body as any;
      if (data.lat === undefined || data.lng === undefined) {
        return reply.status(400).send({ error: 'Missing coordinates.' });
      }

      const authContext = getAuthContext(req);
      const userPayload = req.user as any;
      const scopeContext = authContext?.companyId
        ? authContext
        : {
          companyId: userPayload?.companyId,
          allowedBranchIds: Array.isArray(userPayload?.allowedBranchIds) ? userPayload.allowedBranchIds : [],
          branchScope: userPayload?.branchScope,
          defaultBranchId: userPayload?.defaultBranchId,
          currentBranchId: userPayload?.currentBranchId,
          userId: userPayload?.id,
          role: userPayload?.role,
        };
      const companyId = String(scopeContext.companyId || '').trim();
      const agent = await db.select().from(schema.agents).where(eq(schema.agents.id, String(id || ''))).get();
      ensureAgentScope(agent, scopeContext, companyId, 'Agent not found.');

      const requestedBranchId = String(req.headers['x-branch-id'] || '').trim();
      if (requestedBranchId && String(agent?.branchId || '').trim() !== requestedBranchId) {
        return reply.status(403).send({ error: 'Branch scope mismatch.' });
      }

      const isSelf = isAgentSelf(req, agent);
      if (!isSelf && String(authContext.role || userPayload?.role || '').toLowerCase() === 'agent') {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
          severity: 'warning',
          sourceModule: 'agents',
          action: 'location.update',
          status: 'failed',
          errorCode: 'AGENT_LOCATION_FORBIDDEN',
          affectedDocumentType: 'agent',
          affectedDocumentId: String(agent?.id || ''),
          metadata: {
            reason: 'agent_self_violation',
            userId: String(authContext.userId || userPayload?.id || ''),
          },
        });
        return reply.status(403).send({ error: 'Location update forbidden.' });
      }

      await db.update(schema.agents).set({
        lastLat: Number(data.lat),
        lastLng: Number(data.lng),
        lastSeenAt: nowIso(),
        updatedAt: nowIso(),
      }).where(eq(schema.agents.id, id)).run();
      return { success: true };
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  api.post('/agent-inventory/transfer', async (req, reply) => {
    try {
      const data = req.body as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim();
      if (!data.agentId || !data.warehouseId || !Array.isArray(data.items)) {
        return reply.status(400).send({ error: 'Missing required transfer fields.' });
      }

      const agent = await db.select().from(schema.agents).where(eq(schema.agents.id, data.agentId)).get();
      const warehouse = await resolveWarehouseForContext(db, schema, eq, String(data.warehouseId || ''));
      ensureAgentScope(agent, authContext, companyId, 'Agent not found.');
      if (agent?.isActive === false || Number(agent?.isActive) === 0) {
        return reply.status(409).send({ error: 'INACTIVE_AGENT' });
      }
      assertWarehouseAccess(warehouse, authContext);
      assertEntityBelongsToCompany(warehouse, companyId, 'Warehouse not found.');

      const shortages: any[] = [];
      for (const line of data.items) {
        const stock = await loadWarehouseScopedItemStock(db, {
          itemId: String(line.itemId || ''),
          warehouseId: String(data.warehouseId || ''),
          companyId,
          branchId: String((warehouse as any)?.branchId || '').trim() || null,
        });
        const invItem = stock?.item || null;
        if (invItem) {
          assertEntityBelongsToCompany(invItem, companyId, 'Item not found.');
          assertEntityBelongsToAllowedBranch(invItem, authContext, 'Item not found.');
        }
        const available = Number(stock?.availableQty || 0);
        if (!invItem || available < Number(line.quantity || 0)) {
          shortages.push({ itemId: line.itemId, itemName: invItem?.name, available, requested: Number(line.quantity || 0) });
        }
      }
      if (shortages.length > 0) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
          severity: 'warning',
          sourceModule: 'agents',
          action: 'transfer',
          status: 'failed',
          errorCode: 'AGENT_TRANSFER_INSUFFICIENT_STOCK',
          affectedDocumentType: 'agent_transfer',
          metadata: { agentId: data.agentId, shortages },
        });
        return reply.status(409).send({ error: 'INSUFFICIENT_STOCK', shortages });
      }

      const transferId = data.id || buildId('at');
      const createdAt = nowIso();
      const scopedCompanyId = String((agent as any).companyId || companyId || '').trim();
      const scopedBranchId = String((agent as any).branchId || pickEffectiveBranchId(undefined, authContext) || '').trim();

      await db.transaction(async (tx: any) => {
        for (const line of data.items) {
          const stock = await loadWarehouseScopedItemStock(tx, {
            itemId: String(line.itemId || ''),
            warehouseId: String(data.warehouseId || ''),
            companyId,
            branchId: String((warehouse as any)?.branchId || '').trim() || null,
          });
          const invItem = stock?.item || null;
          if (!invItem) continue;
          const qty = toNumber(line.quantity);
          if (!(qty > 0)) continue;
          await adjustItemStockWithMovement(tx, {
            itemId: String(invItem.id),
            warehouseId: String(data.warehouseId),
            warehouseName: (warehouse as any)?.name || (invItem as any).warehouseName || null,
            unitId: (line as any).unitId || (invItem as any).unitId || null,
            unitName: (line as any).unitName || (invItem as any).unitName || null,
            qtyDelta: -qty,
            baseQtyDelta: -qty,
            meta: {
              documentType: 'AGENT_TRANSFER',
              documentId: transferId,
              documentNumber: null,
              movementType: 'AGENT_TRANSFER_OUT',
              userId: String(authContext.userId || '') || null,
              userName: String(authContext.username || '') || null,
              notes: data.notes || null,
            },
          });

          const existingAgentItem = await normalizeScopedAgentInventoryRow(tx, {
            companyId: scopedCompanyId,
            branchId: scopedBranchId,
            agentId: String(data.agentId || ''),
            itemId: String(line.itemId || ''),
          });
          const nextQty = (Number(existingAgentItem?.quantity) || 0) + qty;
          if (existingAgentItem) {
            await tx.update(schema.agentInventory)
              .set({ quantity: nextQty, itemName: invItem.name, unitName: invItem.unitName, updatedAt: nowIso() })
              .where(eq(schema.agentInventory.id, existingAgentItem.id))
              .run();
          } else {
            await tx.insert(schema.agentInventory).values({
              id: buildId('ai'),
              companyId: scopedCompanyId,
              branchId: scopedBranchId,
              agentId: data.agentId,
              itemId: invItem.id,
              itemName: invItem.name,
              unitName: invItem.unitName,
              quantity: nextQty,
              createdAt,
              updatedAt: createdAt,
            }).run();
          }

          await tx.insert(schema.agentTransferLines).values({
            id: buildId('atl'),
            companyId: scopedCompanyId,
            branchId: scopedBranchId,
            transferId,
            agentId: data.agentId,
            warehouseId: data.warehouseId,
            warehouseName: warehouse?.name || null,
            itemId: invItem.id,
            itemName: invItem.name,
            unitName: invItem.unitName,
            quantity: qty,
            createdAt,
          }).run();

          await tx.insert(schema.agentInventoryMovements).values({
            id: buildId('aim'),
            companyId: scopedCompanyId,
            branchId: scopedBranchId,
            agentId: data.agentId,
            itemId: invItem.id,
            itemName: invItem.name,
            unitName: invItem.unitName,
            qty,
            baseQty: qty,
            movementType: 'AGENT_TRANSFER_IN',
            documentType: 'AGENT_TRANSFER',
            documentId: transferId,
            documentNumber: null,
            documentLineId: null,
            warehouseId: data.warehouseId,
            warehouseName: warehouse?.name || null,
            userId: String(authContext.userId || '') || null,
            userName: String(authContext.username || '') || null,
            notes: data.notes || null,
            createdAt,
          }).run();
        }

        await tx.insert(schema.agentTransfers).values({
          id: transferId,
          companyId: scopedCompanyId,
          branchId: scopedBranchId,
          agentId: data.agentId,
          agentName: agent?.name,
          transferType: 'transfer',
          status: 'posted',
          warehouseId: data.warehouseId,
          warehouseName: warehouse?.name,
          createdById: String(authContext.userId || '') || null,
          createdByName: String(authContext.username || '') || null,
          items: stringifyOrEmpty(data.items || []),
          notes: data.notes || '',
          createdAt,
          updatedAt: createdAt,
        }).run();
      });

      return { success: true, id: transferId };
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  api.post('/agent-inventory/return', async (req, reply) => {
    try {
      const data = req.body as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim();
      if (!data.agentId || !data.warehouseId || !Array.isArray(data.items)) {
        return reply.status(400).send({ error: 'Missing required return fields.' });
      }

      const agent = await db.select().from(schema.agents).where(eq(schema.agents.id, data.agentId)).get();
      const warehouse = await resolveWarehouseForContext(db, schema, eq, String(data.warehouseId || ''));
      ensureAgentScope(agent, authContext, companyId, 'Agent not found.');
      if (agent?.isActive === false || Number(agent?.isActive) === 0) {
        return reply.status(409).send({ error: 'INACTIVE_AGENT' });
      }
      assertWarehouseAccess(warehouse, authContext);
      assertEntityBelongsToCompany(warehouse, companyId, 'Warehouse not found.');

      const shortages: any[] = [];
      for (const line of data.items) {
        const invItem = await db.select().from(schema.agentInventory)
          .where(sql`${schema.agentInventory.agentId} = ${data.agentId} AND ${schema.agentInventory.itemId} = ${line.itemId}`)
          .get();
        const available = Number(invItem?.quantity || 0);
        if (!invItem || available < Number(line.quantity || 0)) {
          shortages.push({ itemId: line.itemId, itemName: invItem?.itemName, available, requested: Number(line.quantity || 0) });
        }
      }
      if (shortages.length > 0) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
          severity: 'warning',
          sourceModule: 'agents',
          action: 'return',
          status: 'failed',
          errorCode: 'AGENT_RETURN_INSUFFICIENT_STOCK',
          affectedDocumentType: 'agent_return',
          metadata: { agentId: data.agentId, shortages },
        });
        return reply.status(409).send({ error: 'INSUFFICIENT_AGENT_STOCK', shortages });
      }

      const transferId = data.id || buildId('ar');
      const createdAt = nowIso();
      const scopedCompanyId = String((agent as any).companyId || companyId || '').trim();
      const scopedBranchId = String((agent as any).branchId || pickEffectiveBranchId(undefined, authContext) || '').trim();

      await db.transaction(async (tx: any) => {
        for (const line of data.items) {
          const qty = toNumber(line.quantity);
          if (!(qty > 0)) continue;
          const agentLine = await normalizeScopedAgentInventoryRow(tx, {
            companyId: scopedCompanyId,
            branchId: scopedBranchId,
            agentId: String(data.agentId || ''),
            itemId: String(line.itemId || ''),
          });
          if (!agentLine) continue;
          const nextQty = Math.max(0, Number(agentLine?.quantity || 0) - qty);
          await tx.update(schema.agentInventory)
            .set({ quantity: nextQty, updatedAt: nowIso() })
            .where(eq(schema.agentInventory.id, agentLine.id))
            .run();

          const stock = await loadWarehouseScopedItemStock(tx, {
            itemId: String(line.itemId || ''),
            warehouseId: String(data.warehouseId || ''),
            companyId,
            branchId: String((warehouse as any)?.branchId || '').trim() || null,
          });
          const invItem = stock?.item || null;
          if (invItem) {
            await adjustItemStockWithMovement(tx, {
              itemId: String(invItem.id),
              warehouseId: String(data.warehouseId),
              warehouseName: (warehouse as any)?.name || (invItem as any).warehouseName || null,
              unitId: (line as any).unitId || (invItem as any).unitId || null,
              unitName: (line as any).unitName || (invItem as any).unitName || null,
              qtyDelta: qty,
              baseQtyDelta: qty,
              meta: {
                documentType: 'AGENT_RETURN',
                documentId: transferId,
                documentNumber: null,
                movementType: 'AGENT_RETURN_IN',
                userId: String(authContext.userId || '') || null,
                userName: String(authContext.username || '') || null,
                notes: data.notes || null,
              },
            });
          }

          await tx.insert(schema.agentTransferLines).values({
            id: buildId('atl'),
            companyId: scopedCompanyId,
            branchId: scopedBranchId,
            transferId,
            agentId: data.agentId,
            warehouseId: data.warehouseId,
            warehouseName: warehouse?.name || null,
            itemId: String(line.itemId || ''),
            itemName: agentLine?.itemName || null,
            unitName: agentLine?.unitName || null,
            quantity: qty,
            createdAt,
          }).run();

          await tx.insert(schema.agentInventoryMovements).values({
            id: buildId('aim'),
            companyId: scopedCompanyId,
            branchId: scopedBranchId,
            agentId: data.agentId,
            itemId: String(line.itemId || ''),
            itemName: agentLine?.itemName || null,
            unitName: agentLine?.unitName || null,
            qty: -qty,
            baseQty: -qty,
            movementType: 'AGENT_RETURN_OUT',
            documentType: 'AGENT_RETURN',
            documentId: transferId,
            documentNumber: null,
            documentLineId: null,
            warehouseId: data.warehouseId,
            warehouseName: warehouse?.name || null,
            userId: String(authContext.userId || '') || null,
            userName: String(authContext.username || '') || null,
            notes: data.notes || null,
            createdAt,
          }).run();
        }

        await tx.insert(schema.agentTransfers).values({
          id: transferId,
          companyId: scopedCompanyId,
          branchId: scopedBranchId,
          agentId: data.agentId,
          agentName: agent?.name,
          transferType: 'return',
          status: 'posted',
          warehouseId: data.warehouseId,
          warehouseName: warehouse?.name,
          createdById: String(authContext.userId || '') || null,
          createdByName: String(authContext.username || '') || null,
          items: stringifyOrEmpty(data.items || []),
          notes: data.notes || '',
          createdAt,
          updatedAt: createdAt,
        }).run();
      });

      return { success: true, id: transferId };
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  api.post('/agent-inventory/reconcile', async (req, reply) => {
    try {
      const data = req.body as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim();
      if (!data.agentId || !Array.isArray(data.items)) {
        return reply.status(400).send({ error: 'Missing required reconciliation fields.' });
      }

      const agent = await db.select().from(schema.agents).where(eq(schema.agents.id, data.agentId)).get();
      ensureAgentScope(agent, authContext, companyId, 'Agent not found.');
      if (agent?.isActive === false || Number(agent?.isActive) === 0) {
        return reply.status(409).send({ error: 'INACTIVE_AGENT' });
      }

      const createdAt = nowIso();
      const transferId = data.id || buildId('arc');
      const mode = String(data.mode || 'adjust').toLowerCase();
      const scopedCompanyId = String((agent as any).companyId || companyId || '').trim();
      const scopedBranchId = String((agent as any).branchId || pickEffectiveBranchId(undefined, authContext) || '').trim();

      await db.transaction(async (tx: any) => {
        for (const line of data.items) {
          const qty = toNumber(line.quantity);
          if (!Number.isFinite(qty) || qty === 0) continue;
          const agentLine = await normalizeScopedAgentInventoryRow(tx, {
            companyId: scopedCompanyId,
            branchId: scopedBranchId,
            agentId: String(data.agentId || ''),
            itemId: String(line.itemId || ''),
          });
          const currentQty = Number(agentLine?.quantity || 0);
          const nextQty = mode === 'set' ? qty : currentQty + qty;
          if (nextQty < 0) {
            await systemEventLogger?.log({
              eventType: SYSTEM_EVENT_TYPES.MANUAL_REVIEW_REQUIRED,
              severity: 'warning',
              sourceModule: 'agents',
              action: 'reconcile',
              status: 'failed',
              errorCode: 'AGENT_RECONCILE_NEGATIVE',
              requiresManualReview: true,
              affectedDocumentType: 'agent_reconcile',
              affectedDocumentId: transferId,
              metadata: { agentId: data.agentId, itemId: line.itemId, currentQty, requested: qty, mode },
            });
            throw appError(409, 'AGENT_RECONCILE_NEGATIVE', 'Agent inventory would go negative.');
          }

          if (agentLine) {
            await tx.update(schema.agentInventory)
              .set({ quantity: nextQty, updatedAt: nowIso() })
              .where(eq(schema.agentInventory.id, agentLine.id))
              .run();
          } else {
            await tx.insert(schema.agentInventory).values({
              id: buildId('ai'),
              companyId: scopedCompanyId,
              branchId: scopedBranchId,
              agentId: data.agentId,
              itemId: String(line.itemId || ''),
              itemName: String(line.itemName || ''),
              unitName: String(line.unitName || ''),
              quantity: nextQty,
              createdAt,
              updatedAt: createdAt,
            }).run();
          }

          const delta = mode === 'set' ? (nextQty - currentQty) : qty;
          await tx.insert(schema.agentInventoryMovements).values({
            id: buildId('aim'),
            companyId: scopedCompanyId,
            branchId: scopedBranchId,
            agentId: data.agentId,
            itemId: String(line.itemId || ''),
            itemName: agentLine?.itemName || String(line.itemName || ''),
            unitName: agentLine?.unitName || String(line.unitName || ''),
            qty: delta,
            baseQty: delta,
            movementType: 'AGENT_RECONCILE',
            documentType: 'AGENT_RECONCILE',
            documentId: transferId,
            documentNumber: null,
            documentLineId: null,
            warehouseId: data.warehouseId || null,
            warehouseName: data.warehouseName || null,
            userId: String(authContext.userId || '') || null,
            userName: String(authContext.username || '') || null,
            notes: data.notes || null,
            createdAt,
          }).run();
        }

        await tx.insert(schema.agentTransfers).values({
          id: transferId,
          companyId: scopedCompanyId,
          branchId: scopedBranchId,
          agentId: data.agentId,
          agentName: agent?.name,
          transferType: 'reconcile',
          status: 'posted',
          warehouseId: data.warehouseId || null,
          warehouseName: data.warehouseName || null,
          createdById: String(authContext.userId || '') || null,
          createdByName: String(authContext.username || '') || null,
          items: stringifyOrEmpty(data.items || []),
          notes: data.notes || '',
          createdAt,
          updatedAt: createdAt,
        }).run();
      });

      return { success: true, id: transferId };
    } catch (e: any) {
      const status = e?.statusCode || 500;
      return reply.status(status).send({ error: e?.message || 'Agent reconciliation failed.' });
    }
  });
}
