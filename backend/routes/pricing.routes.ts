import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { resolvePrice } from '../pricingService';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, and } = ctx as any;

  // GET /pricing/resolve?itemId=...&customerId=...&unitId=...&qty=...
  api.get('/pricing/resolve', async (req, reply) => {
    const { itemId, customerId, unitId, qty } = req.query as any;
    if (!itemId) return reply.status(400).send({ error: 'itemId required' });
    const result = resolvePrice(db, itemId, customerId || null, unitId, qty ? Number(qty) : undefined);
    return result;
  });

  // --- Customer-Item Special Prices CRUD ---

  // GET /pricing/customer-prices?customerId=...
  api.get('/pricing/customer-prices', async (req, reply) => {
    const { customerId, itemId } = req.query as any;
    let rows;
    if (customerId && itemId) {
      rows = db.select().from(schema.customerItemPrices)
        .where(eq(schema.customerItemPrices.customerId, customerId))
        .all()
        .filter((r: any) => r.itemId === itemId);
    } else if (customerId) {
      rows = db.select().from(schema.customerItemPrices)
        .where(eq(schema.customerItemPrices.customerId, customerId))
        .all();
    } else {
      rows = db.select().from(schema.customerItemPrices).all();
    }
    return rows;
  });

  // POST /pricing/customer-prices
  api.post('/pricing/customer-prices', async (req, reply) => {
    const body = req.body as any;
    if (!body.customerId || !body.itemId || body.price == null) {
      return reply.status(400).send({ error: 'customerId, itemId, and price required' });
    }
    const id = `cip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    db.insert(schema.customerItemPrices).values({
      id,
      customerId: body.customerId,
      itemId: body.itemId,
      unitId: body.unitId || null,
      currencyId: body.currencyId || null,
      price: Number(body.price),
      minQty: body.minQty ? Number(body.minQty) : null,
      isActive: body.isActive !== false,
      notes: body.notes || null,
      createdAt: now,
      updatedAt: now,
    }).run();
    return { id, success: true };
  });

  // PUT /pricing/customer-prices/:id
  api.put('/pricing/customer-prices/:id', async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const updates: any = { updatedAt: new Date().toISOString() };
    if (body.price != null) updates.price = Number(body.price);
    if (body.unitId !== undefined) updates.unitId = body.unitId;
    if (body.currencyId !== undefined) updates.currencyId = body.currencyId;
    if (body.minQty !== undefined) updates.minQty = body.minQty ? Number(body.minQty) : null;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.notes !== undefined) updates.notes = body.notes;
    db.update(schema.customerItemPrices).set(updates)
      .where(eq(schema.customerItemPrices.id, id)).run();
    return { success: true };
  });

  // DELETE /pricing/customer-prices/:id
  api.delete('/pricing/customer-prices/:id', async (req, reply) => {
    const { id } = req.params as any;
    db.delete(schema.customerItemPrices).where(eq(schema.customerItemPrices.id, id)).run();
    return { success: true };
  });
}
