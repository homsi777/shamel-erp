import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, appendAudit, buildPartyStatement, getBackupDir, buildBackupPayload, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, fs, path, getResolvedDbPath, closeDb, bcrypt, server, getLocalIp } = ctx as any;

api.get('/units', async () => {
    return await db.select().from(schema.units).orderBy(schema.units.name).all();
});

api.post('/units', async (req, reply) => {
    try {
        const data = req.body as any;
        
        // Validation
        if (!data.name) return reply.status(400).send({ error: 'Unit name is required.' });
        
        const isBase = (typeof data.isBase === 'boolean') ? (data.isBase ? 1 : 0) : 1;
        const factor = Number(data.factor || data.multiplier || 1);
        
        if (isBase && factor !== 1) {
            return reply.status(400).send({ error: 'Base unit must have factor = 1.' });
        }
        
        if (!isBase && !data.baseUnitId) {
            return reply.status(400).send({ error: 'Non-base units must reference a base unit.' });
        }
        
        if (factor <= 0) {
            return reply.status(400).send({ error: 'Factor must be greater than 0.' });
        }

        // Check for circular references
        if (!isBase && data.baseUnitId) {
            const baseUnit = await db.select().from(schema.units).where(eq(schema.units.id, data.baseUnitId)).get();
            if (baseUnit && !baseUnit.isBase) {
                return reply.status(400).send({ error: 'Cannot create unit chain. Reference a base unit directly.' });
            }
        }

        const id = data.id || `unit-${Date.now()}`;
        await db.insert(schema.units).values({
            id,
            name: data.name,
            isBase,
            baseUnitId: isBase ? null : data.baseUnitId,
            factor,
            multiplier: factor
        }).run();

        return { success: true, id };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});


api.put('/units/:id', async (req, reply) => {
    try {
        const { id } = req.params as any;
        const data = req.body as any;
        const unit = await db.select().from(schema.units).where(eq(schema.units.id, id)).get();
        if (!unit) return reply.status(404).send({ error: 'Unit not found.' });
        const isBase = data.isBase !== undefined ? (data.isBase ? 1 : 0) : unit.isBase;
        const factor = data.factor !== undefined ? Number(data.factor) : Number(unit.factor || unit.multiplier || 1);
        await db.update(schema.units).set({
            name: data.name ?? unit.name,
            isBase,
            baseUnitId: isBase ? null : (data.baseUnitId ?? unit.baseUnitId),
            factor,
            multiplier: factor
        }).where(eq(schema.units.id, id)).run();
        return { success: true };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});


api.delete('/units/:id', async (req, reply) => {
    try {
        const { id } = req.params as any;
        const unit = await db.select().from(schema.units).where(eq(schema.units.id, id)).get();
        if (!unit) return reply.status(404).send({ error: 'Unit not found.' });

        // Check if any items reference this unit
        const itemsUsingUnit = await db.select().from(schema.items)
            .where(sql`${schema.items.unitId} = ${id}`)
            .all();
        
        if (itemsUsingUnit.length > 0) {
            return reply.status(400).send({ error: 'Cannot delete unit that is in use by items.' });
        }

        // Check if any derived units reference this unit as base
        const derivedUnits = await db.select().from(schema.units)
            .where(eq(schema.units.baseUnitId, id))
            .all();
        
        if (derivedUnits.length > 0) {
            return reply.status(400).send({ error: 'Cannot delete unit that is referenced by other units.' });
        }

        await db.delete(schema.units).where(eq(schema.units.id, id)).run();
        return { success: true };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});

// --- UNIT CONVERSION HELPER ---

api.post('/units/convert', async (req, reply) => {
    try {
        const data = req.body as any;
        const { fromUnitId, toUnitId, quantity } = data;
        
        if (!fromUnitId || !toUnitId || !quantity) {
            return reply.status(400).send({ error: 'Missing required conversion fields.' });
        }

        const fromUnit = await db.select().from(schema.units).where(eq(schema.units.id, fromUnitId)).get();
        const toUnit = await db.select().from(schema.units).where(eq(schema.units.id, toUnitId)).get();
        
        if (!fromUnit || !toUnit) {
            return reply.status(404).send({ error: 'Unit not found.' });
        }

        // Get base unit factor for both
        const fromFactor = Number(fromUnit.factor || fromUnit.multiplier || 1);
        const toFactor = Number(toUnit.factor || toUnit.multiplier || 1);

        // Convert to base unit then to target unit
        const baseQty = Number(quantity) * fromFactor;
        const result = baseQty / toFactor;

        return {
            success: true,
            inputQuantity: Number(quantity),
            outputQuantity: result,
            fromUnitId,
            toUnitId,
            fromFactor,
            toFactor
        };
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});

// --- INVOICE MOVEMENTS LIST ---
}
