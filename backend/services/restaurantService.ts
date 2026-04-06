import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { appError } from '../lib/errors';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  enforcePayloadTenantScope,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
} from '../lib/tenantScope';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import { randomUUID } from 'crypto';
import { recomputeSessionUnreadCount } from './restaurantSessionUnread';

export const SESSION_STATUSES = ['open', 'pending_review', 'ready_to_close', 'closed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

type Ctx = {
  db: any;
  schema: any;
  systemEventLogger?: { log: (p: any) => Promise<any> };
};

const nowIso = () => new Date().toISOString();

/** مستخدم وهمي في قاعدة البيانات — فتح جلسة آلياً عند أول زيارة لمنيو QR */
export const QR_GUEST_SESSION_OPENER_ID = 'qr-guest-auto';

const logRestaurantEvent = async (ctx: Ctx, payload: {
  eventType: string;
  companyId: string | null;
  branchId: string | null;
  userId: string | null;
  status: 'success' | 'failed';
  action: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  requiresManualReview?: boolean;
  metadata?: Record<string, unknown>;
}) => {
  if (!ctx.systemEventLogger) return;
  try {
    await ctx.systemEventLogger.log({
      eventType: payload.eventType,
      companyId: payload.companyId,
      branchId: payload.branchId,
      severity: payload.severity || 'info',
      sourceModule: 'restaurant',
      action: payload.action,
      status: payload.status,
      requiresManualReview: Boolean(payload.requiresManualReview),
      metadata: {
        ...payload.metadata,
        actorUserId: payload.userId,
      },
    });
  } catch {
    // non-blocking
  }
};

export const assertSessionTransition = (from: SessionStatus, to: SessionStatus): void => {
  if (from === to) return;
  if (to === 'closed') {
    throw appError(400, 'INVALID_SESSION_TRANSITION', 'إغلاق الجلسة يتم عبر /close فقط.', { from, to });
  }
  const ok =
    (from === 'open' && to === 'pending_review')
    || (from === 'pending_review' && to === 'ready_to_close');
  if (!ok) {
    throw appError(400, 'INVALID_SESSION_TRANSITION', 'انتقال حالة غير مسموح.', { from, to });
  }
};

export const getLiveSessionForTable = async (ctx: Ctx, tableId: string) => {
  const row = await ctx.db
    .select()
    .from(ctx.schema.restaurantTableSessions)
    .where(
      and(
        eq(ctx.schema.restaurantTableSessions.tableId, tableId),
        ne(ctx.schema.restaurantTableSessions.sessionStatus, 'closed'),
      ),
    )
    .limit(1)
    .get();
  return row || null;
};

/** Most recent session row for table (may be closed). */
export const getLatestSessionForTable = async (ctx: Ctx, tableId: string) => {
  return ctx.db
    .select()
    .from(ctx.schema.restaurantTableSessions)
    .where(eq(ctx.schema.restaurantTableSessions.tableId, tableId))
    .orderBy(desc(ctx.schema.restaurantTableSessions.openedAt))
    .limit(1)
    .get();
};

export const listTablesForScope = async (ctx: Ctx, req: any) => {
  const auth = (req as any).authContext || {};
  const companyId = String(auth.companyId || '').trim();
  const branchId = String(pickEffectiveBranchId(undefined, auth) || auth.branchId || '').trim();
  if (!companyId) throw appError(401, 'NO_COMPANY_CONTEXT', 'سياق المؤسسة مطلوب.');
  if (!branchId) throw appError(400, 'BRANCH_REQUIRED', 'يجب اختيار فرع.');

  const rows = await ctx.db
    .select()
    .from(ctx.schema.restaurantTables)
    .where(
      and(
        eq(ctx.schema.restaurantTables.companyId, companyId),
        eq(ctx.schema.restaurantTables.branchId, branchId),
        eq(ctx.schema.restaurantTables.isActive, true),
      ),
    )
    .orderBy(asc(ctx.schema.restaurantTables.sortOrder), asc(ctx.schema.restaurantTables.code))
    .all();

  const sessions = await ctx.db.select().from(ctx.schema.restaurantTableSessions).all();
  const scopedSessions = filterRowsByTenantScope(sessions, auth, 'restaurant-table-sessions')
    .filter((s: any) => String(s.sessionStatus || '') !== 'closed');
  const byTable = new Map<string, any>();
  for (const s of scopedSessions) {
    byTable.set(String(s.tableId), s);
  }

  const ts = nowIso();
  for (const t of rows || []) {
    if (!String(t.publicQrToken || '').trim()) {
      const tok = randomUUID();
      try {
        await ctx.db
          .update(ctx.schema.restaurantTables)
          .set({ publicQrToken: tok, updatedAt: ts })
          .where(eq(ctx.schema.restaurantTables.id, t.id))
          .run();
        t.publicQrToken = tok;
      } catch {
        // ignore rare unique collision
      }
    }
  }

  return (rows || []).map((t: any) => ({
    ...t,
    currentSession: byTable.get(String(t.id)) || null,
  }));
};

export const createRestaurantTable = async (
  ctx: Ctx,
  req: any,
  body: { code: string; name: string; zoneName?: string | null; capacity?: number | null; sortOrder?: number; notes?: string | null },
) => {
  const auth = (req as any).authContext || {};
  const payload = enforcePayloadTenantScope(
    { ...body, id: `rtbl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    auth,
    'restaurant-tables',
  );
  const id = String(payload.id || '').trim();
  const companyId = String(payload.companyId || '').trim();
  const branchId = String(payload.branchId || '').trim();
  const code = String(payload.code || '').trim();
  const name = String(payload.name || '').trim();
  if (!code || !name) throw appError(400, 'VALIDATION_ERROR', 'رمز الطاولة والاسم مطلوبان.');

  const ts = nowIso();
  await ctx.db.insert(ctx.schema.restaurantTables).values({
    id,
    companyId,
    branchId,
    code,
    name,
    zoneName: payload.zoneName ?? null,
    capacity: payload.capacity ?? null,
    sortOrder: Number(payload.sortOrder ?? 0) || 0,
    isActive: true,
    notes: payload.notes ?? null,
    publicQrToken: randomUUID(),
    createdAt: ts,
    updatedAt: ts,
  }).run();

  await logRestaurantEvent(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_TABLE_CREATED,
    companyId,
    branchId,
    userId: String(auth.userId || '').trim() || null,
    status: 'success',
    action: 'table.create',
    metadata: { tableId: id, tableCode: code, tableName: name },
  });

  return ctx.db.select().from(ctx.schema.restaurantTables).where(eq(ctx.schema.restaurantTables.id, id)).get();
};

export const updateRestaurantTable = async (
  ctx: Ctx,
  req: any,
  tableId: string,
  patch: {
    name?: string;
    zoneName?: string | null;
    capacity?: number | null;
    sortOrder?: number;
    isActive?: boolean;
    notes?: string | null;
  },
) => {
  const auth = (req as any).authContext || {};
  const row = await ctx.db.select().from(ctx.schema.restaurantTables).where(eq(ctx.schema.restaurantTables.id, tableId)).get();
  if (!row) throw appError(404, 'NOT_FOUND', 'الطاولة غير موجودة.');
  assertEntityBelongsToCompany(row, String(auth.companyId || '').trim());
  assertEntityBelongsToAllowedBranch(row, auth);

  const ts = nowIso();
  await ctx.db
    .update(ctx.schema.restaurantTables)
    .set({
      ...(patch.name !== undefined ? { name: String(patch.name || '').trim() } : {}),
      ...(patch.zoneName !== undefined ? { zoneName: patch.zoneName } : {}),
      ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: Number(patch.sortOrder) || 0 } : {}),
      ...(patch.isActive !== undefined ? { isActive: Boolean(patch.isActive) } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      updatedAt: ts,
    })
    .where(eq(ctx.schema.restaurantTables.id, tableId))
    .run();

  await logRestaurantEvent(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_TABLE_UPDATED,
    companyId: String(auth.companyId || '').trim() || null,
    branchId: String(row.branchId || '').trim() || null,
    userId: String(auth.userId || '').trim() || null,
    status: 'success',
    action: 'table.update',
    metadata: { tableId, tableCode: String(row.code || ''), tableName: String(row.name || ''), changes: patch },
  });

  return ctx.db.select().from(ctx.schema.restaurantTables).where(eq(ctx.schema.restaurantTables.id, tableId)).get();
};

export const listOpenSessions = async (ctx: Ctx, req: any) => {
  const auth = (req as any).authContext || {};
  const all = await ctx.db.select().from(ctx.schema.restaurantTableSessions).orderBy(desc(ctx.schema.restaurantTableSessions.lastActivityAt)).all();
  const rows = filterRowsByTenantScope(all || [], auth, 'restaurant-table-sessions')
    .filter((r: any) => String(r.sessionStatus || '') !== 'closed');
  return rows;
};

export const getSession = async (ctx: Ctx, req: any, sessionId: string) => {
  const auth = (req as any).authContext || {};
  const row = await ctx.db.select().from(ctx.schema.restaurantTableSessions).where(eq(ctx.schema.restaurantTableSessions.id, sessionId)).get();
  if (!row) throw appError(404, 'NOT_FOUND', 'الجلسة غير موجودة.');
  assertEntityBelongsToCompany(row, String(auth.companyId || '').trim());
  assertEntityBelongsToAllowedBranch(row, auth);
  return row;
};

export const openSession = async (
  ctx: Ctx,
  req: any,
  tableId: string,
  body: { guestCount?: number | null; notes?: string | null },
) => {
  const auth = (req as any).authContext || {};
  const companyId = String(auth.companyId || '').trim();
  const branchId = String(pickEffectiveBranchId(undefined, auth) || auth.branchId || '').trim();
  const userId = String(auth.userId || '').trim();
  if (!companyId) throw appError(401, 'NO_COMPANY_CONTEXT', 'سياق المؤسسة مطلوب.');
  if (!branchId) throw appError(400, 'BRANCH_REQUIRED', 'يجب اختيار فرع.');
  if (!userId) throw appError(401, 'UNAUTHENTICATED', 'المستخدم مطلوب.');

  const table = await ctx.db.select().from(ctx.schema.restaurantTables).where(eq(ctx.schema.restaurantTables.id, tableId)).get();
  if (!table) throw appError(404, 'NOT_FOUND', 'الطاولة غير موجودة.');
  assertEntityBelongsToCompany(table, companyId);
  assertEntityBelongsToAllowedBranch(table, auth);
  if (!table.isActive) throw appError(400, 'TABLE_INACTIVE', 'الطاولة غير مفعّلة.');

  const existing = await getLiveSessionForTable(ctx, tableId);
  if (existing) {
    await logRestaurantEvent(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_OPEN_BLOCKED,
      companyId,
      branchId,
      userId,
      status: 'failed',
      severity: 'warning',
      action: 'session.open_blocked',
      metadata: { tableId, tableCode: String(table.code || ''), sessionId: existing.id, reason: 'session_already_open' },
    });
    throw appError(409, 'SESSION_ALREADY_OPEN', 'توجد جلسة غير مغلقة على هذه الطاولة.', {
      sessionId: existing.id,
    });
  }

  const ts = nowIso();
  const id = `rses-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await ctx.db.insert(ctx.schema.restaurantTableSessions).values({
    id,
    companyId,
    branchId,
    tableId,
    openedByUserId: userId,
    closedByUserId: null,
    sessionStatus: 'open',
    guestCount: body.guestCount ?? null,
    openedAt: ts,
    lastActivityAt: ts,
    closedAt: null,
    preliminaryTotal: 0,
    notes: body.notes ?? null,
    source: 'cashier',
    unreadRequestCount: 0,
    finalInvoiceId: null,
    createdAt: ts,
    updatedAt: ts,
  }).run();

  await logRestaurantEvent(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_OPENED,
    companyId,
    branchId,
    userId,
    status: 'success',
    action: 'session.open',
    metadata: { sessionId: id, tableId, tableCode: String(table.code || ''), tableName: String(table.name || ''), guestCount: body.guestCount ?? null },
  });

  return ctx.db.select().from(ctx.schema.restaurantTableSessions).where(eq(ctx.schema.restaurantTableSessions.id, id)).get();
};

/**
 * عند فتح الضيف لمنيو الطاولة ولا توجد جلسة حيّة: تُنشأ جلسة مفتوحة تلقائياً (مصدر qr_guest).
 * يُنفَّذ داخل معاملة لتقليل ازدواج الجلسات عند طلبات متزامنة.
 */
export function ensureQrGuestSessionForTable(
  ctx: Ctx,
  table: { id: string; companyId: string; branchId: string; isActive: boolean; code?: string; name?: string },
): Promise<{ session: any; created: boolean } | null> {
  if (!table.isActive) return null;

  return ctx.db.transaction(async (tx: any) => {
    const schema = ctx.schema;
    const existing = await tx
      .select()
      .from(schema.restaurantTableSessions)
      .where(
        and(
          eq(schema.restaurantTableSessions.tableId, table.id),
          ne(schema.restaurantTableSessions.sessionStatus, 'closed'),
        ),
      )
      .limit(1)
      .get();
    if (existing) return { session: existing, created: false };

    const ts = nowIso();
    const id = `rses-${randomUUID()}`;
    await tx.insert(schema.restaurantTableSessions)
      .values({
        id,
        companyId: table.companyId,
        branchId: table.branchId,
        tableId: table.id,
        openedByUserId: QR_GUEST_SESSION_OPENER_ID,
        closedByUserId: null,
        sessionStatus: 'open',
        guestCount: null,
        openedAt: ts,
        lastActivityAt: ts,
        closedAt: null,
        preliminaryTotal: 0,
        notes: null,
        source: 'qr_guest',
        unreadRequestCount: 0,
        finalInvoiceId: null,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    const sess = await tx.select().from(schema.restaurantTableSessions).where(eq(schema.restaurantTableSessions.id, id)).get();
    return { session: sess, created: true };
  });
}

/** لفتح جلسات يدوية (كاتب: الكاشير) لكل طاولة نشطة لا تملك جلسة حيّة بعد. */
export const openSessionsForAllEmptyActiveTables = async (ctx: Ctx, req: any) => {
  const auth = (req as any).authContext || {};
  const companyId = String(auth.companyId || '').trim();
  const branchId = String(pickEffectiveBranchId(undefined, auth) || auth.branchId || '').trim();
  const userId = String(auth.userId || '').trim();
  if (!companyId) throw appError(401, 'NO_COMPANY_CONTEXT', 'سياق المؤسسة مطلوب.');
  if (!branchId) throw appError(400, 'BRANCH_REQUIRED', 'يجب اختيار فرع.');
  if (!userId) throw appError(401, 'UNAUTHENTICATED', 'المستخدم مطلوب.');

  const all = await ctx.db.select().from(ctx.schema.restaurantTables).all();
  const tables = filterRowsByTenantScope(all || [], auth, 'restaurant-tables').filter((t: any) => Boolean(t.isActive));

  const opened: { session: any; table: any }[] = [];
  for (const t of tables) {
    const live = await getLiveSessionForTable(ctx, t.id);
    if (live) continue;
    const session = await openSession(ctx, req, t.id, {});
    opened.push({ session, table: t });
  }
  return { opened };
};

export const updateSession = async (
  ctx: Ctx,
  req: any,
  sessionId: string,
  patch: {
    guestCount?: number | null;
    notes?: string | null;
    preliminaryTotal?: number;
    sessionStatus?: SessionStatus;
  },
) => {
  const auth = (req as any).authContext || {};
  const row = await getSession(ctx, req, sessionId);
  const status = String(row.sessionStatus || '') as SessionStatus;
  if (status === 'closed') {
    throw appError(400, 'SESSION_CLOSED', 'لا يمكن تعديل جلسة مغلقة.');
  }

  let nextStatus = status;
  if (patch.sessionStatus !== undefined) {
    const requested = patch.sessionStatus;
    if (requested === 'closed') {
      throw appError(400, 'INVALID_SESSION_TRANSITION', 'استخدم مسار إغلاق الجلسة المخصص.');
    }
    assertSessionTransition(status, requested);
    nextStatus = requested;
  }

  const ts = nowIso();
  await ctx.db
    .update(ctx.schema.restaurantTableSessions)
    .set({
      ...(patch.guestCount !== undefined ? { guestCount: patch.guestCount } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.preliminaryTotal !== undefined ? { preliminaryTotal: Number(patch.preliminaryTotal) || 0 } : {}),
      ...(patch.sessionStatus !== undefined ? { sessionStatus: nextStatus } : {}),
      lastActivityAt: ts,
      updatedAt: ts,
    })
    .where(eq(ctx.schema.restaurantTableSessions.id, sessionId))
    .run();

  await logRestaurantEvent(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_UPDATED,
    companyId: String(auth.companyId || '').trim() || null,
    branchId: String(row.branchId || '').trim() || null,
    userId: String(auth.userId || '').trim() || null,
    status: 'success',
    action: 'session.update',
    metadata: { sessionId, tableId: row.tableId, changes: patch },
  });

  return ctx.db.select().from(ctx.schema.restaurantTableSessions).where(eq(ctx.schema.restaurantTableSessions.id, sessionId)).get();
};

export const closeSession = async (
  ctx: Ctx,
  req: any,
  sessionId: string,
  options?: { forceCloseWithUnreadRequests?: boolean },
) => {
  const auth = (req as any).authContext || {};
  const userId = String(auth.userId || '').trim();
  const row = await getSession(ctx, req, sessionId);
  await logRestaurantEvent(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_UPDATED,
    companyId: String(auth.companyId || '').trim() || null,
    branchId: String(row.branchId || '').trim() || null,
    userId: userId || null,
    status: 'success',
    action: 'session.close_started',
    metadata: { sessionId, tableId: row.tableId, forceCloseWithUnreadRequests: Boolean(options?.forceCloseWithUnreadRequests) },
  });
  if (String(row.sessionStatus || '') === 'closed') {
    throw appError(400, 'SESSION_ALREADY_CLOSED', 'الجلسة مغلقة مسبقًا.');
  }

  const outstandingNew = await ctx.db
    .select()
    .from(ctx.schema.restaurantTableRequests)
    .where(
      and(
        eq(ctx.schema.restaurantTableRequests.sessionId, sessionId),
        eq(ctx.schema.restaurantTableRequests.requestStatus, 'new'),
      ),
    )
    .all();
  const newCount = (outstandingNew || []).length;
  const table = await ctx.db
    .select()
    .from(ctx.schema.restaurantTables)
    .where(eq(ctx.schema.restaurantTables.id, String(row.tableId || '')))
    .get();
  if (newCount > 0 && !options?.forceCloseWithUnreadRequests) {
    await logRestaurantEvent(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_CLOSE_BLOCKED_UNREAD,
      companyId: String(auth.companyId || '').trim() || null,
      branchId: String(row.branchId || '').trim() || null,
      userId: userId || null,
      status: 'failed',
      severity: 'error',
      action: 'session.close_blocked',
      metadata: {
        sessionId,
        tableId: row.tableId,
        tableCode: String(table?.code || ''),
        unreadBefore: newCount,
        reason: 'unread_new_requests_present',
      },
    });
    throw appError(
      409,
      'RESTAURANT_SESSION_HAS_UNREAD_REQUESTS',
      `لا يمكن إغلاق الجلسة: يوجد ${newCount} طلب QR بحالة «جديد». راجع الطلبات أو استخدم الإغلاق الإجباري.`,
      { unreadNewCount: newCount },
    );
  }
  if (newCount > 0 && options?.forceCloseWithUnreadRequests) {
    await logRestaurantEvent(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_FORCE_CLOSED_WITH_UNREAD_QR,
      companyId: String(auth.companyId || '').trim() || null,
      branchId: String(row.branchId || '').trim() || null,
      userId: userId || null,
      status: 'success',
      severity: 'warning',
      requiresManualReview: true,
      action: 'session.force_close',
      metadata: {
        sessionId,
        tableId: row.tableId,
        tableCode: String(table?.code || ''),
        unreadBefore: newCount,
        forceClose: true,
        reason: 'forced_close_with_unread_qr',
      },
    });
  }

  const ts = nowIso();
  await ctx.db
    .update(ctx.schema.restaurantTableSessions)
    .set({
      sessionStatus: 'closed',
      closedByUserId: userId || null,
      closedAt: ts,
      lastActivityAt: ts,
      updatedAt: ts,
    })
    .where(eq(ctx.schema.restaurantTableSessions.id, sessionId))
    .run();

  await logRestaurantEvent(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_CLOSED,
    companyId: String(auth.companyId || '').trim() || null,
    branchId: String(row.branchId || '').trim() || null,
    userId: userId || null,
    status: 'success',
    action: 'session.close',
    metadata: {
      sessionId,
      tableId: row.tableId,
      tableCode: String(table?.code || ''),
      forcedClose: Boolean(newCount > 0 && options?.forceCloseWithUnreadRequests),
      unreadNewCount: newCount,
    },
  });

  if (table) {
    await recomputeSessionUnreadCount(ctx, sessionId, table, {
      emitHealEventIfDrift: true,
      emitSessionUpdatedIfChanged: false,
      touchLastActivity: false,
    });
  }

  return ctx.db.select().from(ctx.schema.restaurantTableSessions).where(eq(ctx.schema.restaurantTableSessions.id, sessionId)).get();
};
