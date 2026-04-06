import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import {
  createReconciliationSession,
  getSession,
  getSessionItems,
  listSessions,
  loadOpenItemsIntoSession,
  runAutoMatch,
  applyManualMatch,
  confirmSession,
  unmatchGroup,
  getSessionSummary,
  generateReconciliationReport,
} from '../services/reconciliation';
import { analyzeAging } from '../services/reconciliationCore';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { db as database } from '../db';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  pickEffectiveBranchId,
} from '../lib/tenantScope';

export async function reconciliationRoutes(app: FastifyInstance, _ctx: RouteContext) {
  const db = database as any;
  const getAuthContext = (req: any) => (req as any).authContext || {};

  const requireScope = (req: any, reply: any) => {
    const authContext = getAuthContext(req);
    const companyId = String(authContext.companyId || '').trim();
    if (!companyId) {
      reply.status(401).send({ success: false, error: 'NO_COMPANY_CONTEXT' });
      return null;
    }
    return {
      authContext,
      companyId,
      branchId: String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null,
      userId: String(authContext.userId || authContext.id || 'system'),
    };
  };

  const ensureSessionScope = async (sessionId: string, req: any) => {
    const session = await getSession(sessionId);
    const authContext = getAuthContext(req);
    const companyId = String(authContext.companyId || '').trim();
    assertEntityBelongsToCompany(session, companyId, 'SESSION_NOT_FOUND');
    assertEntityBelongsToAllowedBranch(session, authContext, 'SESSION_NOT_FOUND');
    return session;
  };

  const errorStatus = (msg: string, fallback = 500) => {
    if (msg.includes('SESSION_NOT_FOUND') || msg.includes('NOT_FOUND')) return 404;
    if (msg.includes('NOT_OPEN') || msg.includes('SESSION_NOT_OPEN') || msg.includes('PERIOD_LOCKED')) return 409;
    if (msg.includes('IMBALANCED')) return 422;
    if (msg.includes('NO_COMPANY_CONTEXT')) return 401;
    return fallback;
  };

  app.get('/reconciliation', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { partyId } = req.query as any;
      const sessions = await listSessions(scope.companyId, String(partyId || '').trim() || undefined);
      const scopedRows = sessions.filter((row: any) => {
        try {
          assertEntityBelongsToAllowedBranch(row, scope.authContext, 'SESSION_NOT_FOUND');
          return true;
        } catch {
          return false;
        }
      });
      return reply.send({ success: true, data: scopedRows });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.post('/reconciliation', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const body = req.body as any;
      if (!body?.type) {
        return reply.status(400).send({ success: false, error: 'type مطلوب (party_ar | party_ap | bank | interco)' });
      }

      const sessionId = await createReconciliationSession({
        type: body.type,
        partyId: body.partyId,
        partyName: body.partyName,
        fromDate: body.fromDate,
        toDate: body.toDate,
        toleranceAmount: Number(body.toleranceAmount ?? 0),
        companyId: scope.companyId,
        branchId: scope.branchId,
        createdBy: scope.userId,
        notes: body.notes,
      });
      return reply.status(201).send({ success: true, data: { sessionId } });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.get('/reconciliation/:id', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { id } = req.params as any;
      await ensureSessionScope(id, req);
      const summary = await getSessionSummary(id);
      return reply.send({ success: true, data: summary });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.get('/reconciliation/:id/items', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { id } = req.params as any;
      await ensureSessionScope(id, req);
      const items = await getSessionItems(id);
      return reply.send({ success: true, data: items });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.post('/reconciliation/:id/load-open-items', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { id } = req.params as any;
      const body = req.body as any;
      const session = await ensureSessionScope(id, req);

      const partyId = String(body?.partyId || session?.partyId || '').trim();
      const partyType = String(body?.partyType || '').trim().toLowerCase();
      if (!partyId) return reply.status(400).send({ success: false, error: 'partyId مطلوب' });
      if (!partyType) return reply.status(400).send({ success: false, error: 'partyType مطلوب (customer | supplier)' });

      const counts = await loadOpenItemsIntoSession(id, {
        partyId,
        partyType: partyType as 'customer' | 'supplier',
        companyId: scope.companyId,
        fromDate: body?.fromDate,
        toDate: body?.toDate,
      });
      return reply.send({ success: true, data: counts });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.post('/reconciliation/:id/auto-match', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { id } = req.params as any;
      await ensureSessionScope(id, req);
      const result = await runAutoMatch(id);
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.post('/reconciliation/:id/manual-match', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { id } = req.params as any;
      const body = req.body as any;
      await ensureSessionScope(id, req);

      if (!Array.isArray(body?.debitItemIds) || !Array.isArray(body?.creditItemIds)) {
        return reply.status(400).send({ success: false, error: 'debitItemIds و creditItemIds مطلوبان (مصفوفتان)' });
      }

      const group = await applyManualMatch({
        sessionId: id,
        debitItemIds: body.debitItemIds,
        creditItemIds: body.creditItemIds,
      });
      return reply.send({ success: true, data: group });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.delete('/reconciliation/:id/match/:matchGroupId', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { id, matchGroupId } = req.params as any;
      await ensureSessionScope(id, req);
      await unmatchGroup(id, matchGroupId);
      return reply.send({ success: true });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.post('/reconciliation/:id/confirm', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { id } = req.params as any;
      const body = req.body as any;
      await ensureSessionScope(id, req);

      const result = await confirmSession({
        sessionId: id,
        confirmedBy: String(body?.confirmedBy || scope.userId || 'system'),
        companyId: scope.companyId,
        branchId: scope.branchId,
      });
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.post('/reconciliation/:id/cancel', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { id } = req.params as any;
      const session = await ensureSessionScope(id, req);
      if (session.status === 'confirmed') {
        return reply.status(409).send({ success: false, error: 'لا يمكن إلغاء جلسة مؤكدة. استخدم إعادة الفتح.' });
      }
      await db.update(schema.reconciliationSessions)
        .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
        .where(eq(schema.reconciliationSessions.id, id))
        .run();
      return reply.send({ success: true });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.get('/reconciliation/report', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { partyId, fromDate, toDate } = req.query as any;
      const report = await generateReconciliationReport({
        companyId: scope.companyId,
        partyId,
        fromDate,
        toDate,
      });
      return reply.send({ success: true, data: report });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });

  app.get('/reconciliation/aging', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { partyId, asOfDate } = req.query as any;
      const sessions = await listSessions(scope.companyId, partyId);
      const scopedOpenSessions = (sessions || []).filter((row: any) => {
        try {
          assertEntityBelongsToAllowedBranch(row, scope.authContext, 'SESSION_NOT_FOUND');
          return row.status === 'open';
        } catch {
          return false;
        }
      });

      const allItems: any[] = [];
      for (const s of scopedOpenSessions) {
        const items = await getSessionItems(s.id);
        allItems.push(...items.filter((i: any) => i.matchStatus === 'unmatched' && i.side === 'debit'));
      }

      const aging = analyzeAging(allItems, String(asOfDate || new Date().toISOString().slice(0, 10)));
      return reply.send({ success: true, data: aging });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      return reply.status(errorStatus(msg)).send({ success: false, error: msg });
    }
  });
}
