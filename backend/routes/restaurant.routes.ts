import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { z } from 'zod';
import { appError, isAppError } from '../lib/errors';
import { restaurantEmit } from '../lib/restaurantSocket';
import * as restaurantQrService from '../services/restaurantQrService';
import * as restaurantService from '../services/restaurantService';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';

const sessionStatusSchema = z.enum(['open', 'pending_review', 'ready_to_close', 'closed']);

const createTableBodySchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  zoneName: z.string().max(120).nullable().optional(),
  capacity: z.number().int().min(0).max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const updateTableBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  zoneName: z.string().max(120).nullable().optional(),
  capacity: z.number().int().min(0).max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const openSessionBodySchema = z.object({
  guestCount: z.number().int().min(0).max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const updateSessionBodySchema = z.object({
  guestCount: z.number().int().min(0).max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  preliminaryTotal: z.number().optional(),
  sessionStatus: sessionStatusSchema.optional(),
});

const publicMenuQuerySchema = z.object({
  customerSessionToken: z.string().max(200).optional(),
});

const publicRequestBodySchema = z.object({
  clientRequestId: z.string().min(8).max(128),
  customerSessionToken: z.string().max(200).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  items: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.number().positive().max(999),
    note: z.string().max(500).optional().nullable(),
  })).min(1).max(50),
});

const closeSessionBodySchema = z.object({
  forceCloseWithUnreadRequests: z.boolean().optional(),
});

const menuUpsertSchema = z.object({
  itemId: z.string().min(1),
  isVisibleInQr: z.boolean().optional(),
  displayNameOverride: z.string().max(240).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
  categoryName: z.string().max(160).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isAvailableNow: z.boolean().optional(),
});

const monitorEventBodySchema = z.object({
  eventType: z.string().min(3).max(120),
  action: z.string().min(3).max(200),
  severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
  status: z.enum(['success', 'failed', 'partial', 'compensated']).optional(),
  errorCode: z.string().max(120).nullable().optional(),
  requiresManualReview: z.boolean().optional(),
  affectedDocumentType: z.string().max(120).nullable().optional(),
  affectedDocumentId: z.string().max(120).nullable().optional(),
  metadata: z.record(z.any()).optional(),
});

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, systemEventLogger } = ctx as any;
  const rctx = { db, schema, systemEventLogger };

  /** فحص خفيف لإثبات أن الخادم يستجيب من الشبكة المحلية — دون بيانات حساسة */
  api.get('/restaurant/network-ready', async () => {
    const fallbackPort =
      Number(process.env.SERVER_PORT || process.env.SHAMEL_API_PORT || '3111') || 3111;
    let bindPort: number | null = null;
    try {
      const addr = api.server.address();
      if (addr && typeof addr === 'object' && addr !== null && 'port' in addr) {
        bindPort = Number((addr as { port: number }).port) || null;
      }
    } catch {
      bindPort = null;
    }
    return {
      ok: true,
      bindHost: '0.0.0.0',
      bindPort: bindPort ?? fallbackPort,
      t: Date.now(),
    };
  });

  api.get('/restaurant/public/menu/:publicToken', async (req, reply) => {
    try {
      const publicToken = String((req.params as { publicToken: string }).publicToken || '').trim();
      const q = publicMenuQuerySchema.safeParse(req.query || {});
      const cst = q.success && q.data.customerSessionToken ? String(q.data.customerSessionToken).trim() : null;
      const payload = await restaurantQrService.getPublicMenuPayload(rctx, publicToken, cst);
      return payload;
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.get('/restaurant/public/menu/:publicToken/session', async (req, reply) => {
    try {
      const publicToken = String((req.params as { publicToken: string }).publicToken || '').trim();
      const q = publicMenuQuerySchema.safeParse(req.query || {});
      const cst = q.success && q.data.customerSessionToken ? String(q.data.customerSessionToken).trim() : null;
      return await restaurantQrService.getPublicSessionState(rctx, publicToken, cst);
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.post('/restaurant/public/menu/:publicToken/request', async (req, reply) => {
    try {
      const publicToken = String((req.params as { publicToken: string }).publicToken || '').trim();
      const parsed = publicRequestBodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw appError(400, 'VALIDATION_ERROR', 'بيانات غير صالحة.', parsed.error.flatten());
      }
      return await restaurantQrService.submitPublicRequest(rctx, publicToken, {
        clientRequestId: parsed.data.clientRequestId,
        customerSessionToken: parsed.data.customerSessionToken,
        note: parsed.data.note,
        items: parsed.data.items,
      });
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.get('/restaurant/menu-items', async (req, reply) => {
    try {
      const rows = await restaurantQrService.listMenuSettings(rctx, req);
      return { menuItems: rows };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.post('/restaurant/menu-items', async (req, reply) => {
    try {
      const parsed = menuUpsertSchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw appError(400, 'VALIDATION_ERROR', 'بيانات غير صالحة.', parsed.error.flatten());
      }
      const row = await restaurantQrService.upsertMenuSetting(rctx, req, parsed.data);
      return { menuItem: row };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.post('/restaurant/tables/:id/regenerate-public-token', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const row = await restaurantQrService.regenerateTableQrToken(rctx, req, id);
      return { table: row };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  const requestTransition = (action: 'seen' | 'accept' | 'reject' | 'archive') =>
    async (req: any, reply: any) => {
      try {
        const { id } = req.params as { id: string };
        const result = await restaurantQrService.transitionRequestForCashier(rctx, req, id, action === 'seen' ? 'seen' : action === 'accept' ? 'accept' : action === 'reject' ? 'reject' : 'archive');
        return result;
      } catch (e: any) {
        if (isAppError(e)) {
          return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
        }
        throw e;
      }
    };

  api.post('/restaurant/requests/:id/mark-seen', requestTransition('seen'));
  api.post('/restaurant/requests/:id/accept', requestTransition('accept'));
  api.post('/restaurant/requests/:id/reject', requestTransition('reject'));
  api.post('/restaurant/requests/:id/archive', requestTransition('archive'));

  api.get('/restaurant/tables', async (req, reply) => {
    try {
      const rows = await restaurantService.listTablesForScope(rctx, req);
      return { tables: rows };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.post('/restaurant/tables', async (req, reply) => {
    try {
      const parsed = createTableBodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw appError(400, 'VALIDATION_ERROR', 'بيانات غير صالحة.', parsed.error.flatten());
      }
      const row = await restaurantService.createRestaurantTable(rctx, req, parsed.data);
      return { table: row };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      if (String(e?.code || e?.cause?.code) === 'SQLITE_CONSTRAINT_UNIQUE') {
        return reply.status(409).send({ error: 'رمز الطاولة مستخدم لهذا الفرع.', code: 'DUPLICATE_TABLE_CODE' });
      }
      throw e;
    }
  });

  api.put('/restaurant/tables/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const parsed = updateTableBodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw appError(400, 'VALIDATION_ERROR', 'بيانات غير صالحة.', parsed.error.flatten());
      }
      const row = await restaurantService.updateRestaurantTable(rctx, req, id, parsed.data);
      return { table: row };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.get('/restaurant/sessions/open', async (req, reply) => {
    try {
      const sessions = await restaurantService.listOpenSessions(rctx, req);
      return { sessions };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.post('/restaurant/sessions/open-all-empty', async (req, reply) => {
    try {
      const { opened } = await restaurantService.openSessionsForAllEmptyActiveTables(rctx, req);
      for (const { session, table } of opened) {
        restaurantEmit.sessionUpdated({
          companyId: String(session.companyId || table.companyId),
          branchId: String(session.branchId || table.branchId),
          publicToken: String(table.publicQrToken || '').trim() || null,
          sessionId: String(session.id || ''),
          unreadCount: Number(session.unreadRequestCount || 0),
          sessionStatus: String(session.sessionStatus || 'open'),
        });
      }
      return {
        openedCount: opened.length,
        sessions: opened.map((o) => o.session),
      };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.get('/restaurant/sessions/:sessionId/requests', async (req, reply) => {
    try {
      const { sessionId } = req.params as { sessionId: string };
      const rows = await restaurantQrService.listSessionRequestsForCashier(rctx, req, sessionId);
      return { requests: rows };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.get('/restaurant/sessions/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const session = await restaurantService.getSession(rctx, req, id);
      let openedByName: string | null = null;
      if (String(session.openedByUserId || '') === restaurantService.QR_GUEST_SESSION_OPENER_ID) {
        openedByName = 'زائر (فتح تلقائي من منيو QR)';
      } else {
        try {
          const u = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, String(session.openedByUserId || '')))
            .get();
          openedByName = u?.name || u?.username || null;
        } catch {
          openedByName = null;
        }
      }
      let closedByName: string | null = null;
      if (session.closedByUserId) {
        try {
          const u2 = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, String(session.closedByUserId || '')))
            .get();
          closedByName = u2?.name || u2?.username || null;
        } catch {
          closedByName = null;
        }
      }
      const table = await db
        .select()
        .from(schema.restaurantTables)
        .where(eq(schema.restaurantTables.id, String(session.tableId || '')))
        .get();
      return {
        session,
        openedByName,
        closedByName,
        table,
      };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.put('/restaurant/sessions/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const parsed = updateSessionBodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw appError(400, 'VALIDATION_ERROR', 'بيانات غير صالحة.', parsed.error.flatten());
      }
      const session = await restaurantService.updateSession(rctx, req, id, {
        ...parsed.data,
        sessionStatus: parsed.data.sessionStatus as any,
      });
      return { session };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.post('/restaurant/tables/:tableId/open-session', async (req, reply) => {
    try {
      const { tableId } = req.params as { tableId: string };
      const parsed = openSessionBodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw appError(400, 'VALIDATION_ERROR', 'بيانات غير صالحة.', parsed.error.flatten());
      }
      const session = await restaurantService.openSession(rctx, req, tableId, parsed.data);
      const table = await db
        .select()
        .from(schema.restaurantTables)
        .where(eq(schema.restaurantTables.id, tableId))
        .get();
      if (table) {
        restaurantEmit.sessionUpdated({
          companyId: String(session.companyId || table.companyId),
          branchId: String(session.branchId || table.branchId),
          publicToken: String(table.publicQrToken || '').trim() || null,
          sessionId: session.id,
          unreadCount: Number(session.unreadRequestCount || 0),
          sessionStatus: String(session.sessionStatus || ''),
        });
      }
      return { session };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.post('/restaurant/sessions/:id/close', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const pre = await restaurantService.getSession(rctx, req, id);
      const parsedClose = closeSessionBodySchema.safeParse((req as any).body || {});
      const forceClose = parsedClose.success ? Boolean(parsedClose.data.forceCloseWithUnreadRequests) : false;
      const table = await db
        .select()
        .from(schema.restaurantTables)
        .where(eq(schema.restaurantTables.id, String(pre.tableId || '')))
        .get();
      const session = await restaurantService.closeSession(rctx, req, id, {
        forceCloseWithUnreadRequests: forceClose,
      });
      if (table) {
        restaurantEmit.sessionClosed({
          companyId: String(session.companyId || table.companyId),
          branchId: String(session.branchId || table.branchId),
          publicToken: String(table.publicQrToken || '').trim() || null,
          sessionId: session.id,
        });
      }
      return { session };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      throw e;
    }
  });

  api.post('/restaurant/monitor-event', async (req, reply) => {
    try {
      if (!systemEventLogger) return { success: true, skipped: true };
      const parsed = monitorEventBodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw appError(400, 'VALIDATION_ERROR', 'بيانات حدث المراقبة غير صالحة.', parsed.error.flatten());
      }
      const authContext = (req as any).authContext || {};
      const companyId = String(authContext.companyId || '').trim() || null;
      const branchId = String(authContext.currentBranchId || authContext.defaultBranchId || '').trim() || null;
      const actorUserId = String(authContext.userId || '').trim() || null;
      const body = parsed.data;
      const eventId = await systemEventLogger.log({
        eventType: body.eventType,
        companyId,
        branchId,
        severity: body.severity || 'info',
        sourceModule: 'restaurant',
        action: body.action,
        status: body.status || 'success',
        errorCode: body.errorCode || null,
        requiresManualReview: Boolean(body.requiresManualReview),
        affectedDocumentType: body.affectedDocumentType || null,
        affectedDocumentId: body.affectedDocumentId || null,
        metadata: {
          ...(body.metadata || {}),
          actorUserId,
        },
      });
      return { success: true, eventId: eventId || null };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e?.message || 'Failed to emit restaurant monitoring event.' });
    }
  });

  // Lightweight operational marker for cashier socket reconnect/resync.
  // Used by monitoring center to correlate “socket state drift” incidents.
  api.post('/restaurant/socket/resync', async (req, reply) => {
    try {
      if (!systemEventLogger) return { success: true, skipped: true };
      const authContext = (req as any).authContext || {};
      const companyId = String(authContext.companyId || '').trim() || null;
      const branchId = String(authContext.currentBranchId || authContext.defaultBranchId || '').trim() || null;
      const actorUserId = String(authContext.userId || '').trim() || null;
      const body = (req.body || {}) as any;
      const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 200) : 'socket_reconnect';

      await systemEventLogger.log({
        eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SOCKET_RESYNC_TRIGGERED,
        companyId,
        branchId,
        severity: 'warning',
        sourceModule: 'restaurant',
        action: 'socket.resync',
        status: 'failed',
        requiresManualReview: false,
        metadata: { actorUserId, reason },
      });

      return { success: true };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e?.message || 'Failed to log socket resync.' });
    }
  });
}
