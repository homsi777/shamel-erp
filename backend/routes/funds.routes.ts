import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { assertCashBoxAccess } from '../lib/tenantScope';
import { isAppError } from '../lib/errors';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, createVoucherWithAccounting } = ctx as any;
  const getAuthContext = (req: any) => (req as any).authContext || {};

  api.post('/funds/transfer', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const scopedCompanyId = String(authContext.companyId || '').trim() || null;
      if (!scopedCompanyId) {
        return reply.status(401).send({ error: 'NO_COMPANY_CONTEXT' });
      }

      const data = req.body as any;
      const fromBoxId = data.fromBoxId || data.fromCashBoxId || data.sourceBoxId || data.sourceCashBoxId;
      const toBoxId = data.toBoxId || data.toCashBoxId || data.targetBoxId || data.targetCashBoxId;
      const amount = Number(data.amount || 0);
      if (!fromBoxId || !toBoxId || !Number.isFinite(amount) || amount <= 0 || fromBoxId === toBoxId) {
        return reply.status(400).send({ error: 'بيانات المناقلة غير صحيحة. تأكد من اختيار الصندوقين وإدخال مبلغ صالح.' });
      }

      const fromBox = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, fromBoxId)).get();
      const toBox = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, toBoxId)).get();
      if (!fromBox || !toBox) {
        return reply.status(404).send({ error: 'الصندوق غير موجود.' });
      }

      assertCashBoxAccess(fromBox, authContext);
      assertCashBoxAccess(toBox, authContext);

      if (Number(fromBox.balance || 0) < amount) {
        return reply.status(400).send({ error: 'رصيد الصندوق المرسل غير كافٍ.' });
      }

      const now = new Date().toISOString();
      const note = data.notes || `مناقلة من ${fromBox.name} إلى ${toBox.name}`;
      const transferId = Date.now();
      const fromBranchId = String((fromBox as any).branchId || authContext.branchId || '').trim() || null;
      const toBranchId = String((toBox as any).branchId || authContext.branchId || '').trim() || null;

      await createVoucherWithAccounting({
        id: `v-transfer-${transferId}-out`,
        companyId: scopedCompanyId,
        branchId: fromBranchId,
        type: 'payment',
        date: now,
        amount,
        currency: 'USD',
        cashBoxId: fromBox.id,
        cashBoxName: fromBox.name,
        category: 'مناقلة بين الصناديق',
        description: note,
        status: 'DRAFT',
      });

      await createVoucherWithAccounting({
        id: `v-transfer-${transferId}-in`,
        companyId: scopedCompanyId,
        branchId: toBranchId,
        type: 'receipt',
        date: now,
        amount,
        currency: 'USD',
        cashBoxId: toBox.id,
        cashBoxName: toBox.name,
        category: 'مناقلة بين الصناديق',
        description: note,
        status: 'DRAFT',
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
