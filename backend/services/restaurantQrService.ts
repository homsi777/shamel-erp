import { createHash, randomUUID } from 'crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { appError } from '../lib/errors';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  enforcePayloadTenantScope,
  pickEffectiveBranchId,
  resolveEntityBranchId,
  resolveEntityCompanyId,
} from '../lib/tenantScope';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import { restaurantEmit } from '../lib/restaurantSocket';
import {
  ensureQrGuestSessionForTable,
  getLatestSessionForTable,
  getLiveSessionForTable,
} from './restaurantService';
import { recomputeSessionUnreadCount } from './restaurantSessionUnread';
import { nextStatusForCashierAction } from '../lib/restaurantRequestFsm';

export type Ctx = {
  db: any;
  schema: any;
  systemEventLogger?: { log: (p: any) => Promise<any> };
};

const nowIso = () => new Date().toISOString();
const roundMoney = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

async function logEvt(ctx: Ctx, payload: Record<string, unknown>) {
  if (!ctx.systemEventLogger) return;
  try {
    // Enforce the monitored module name strictly.
    payload.sourceModule = 'restaurant';
    if (payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)) {
      const meta = payload.metadata as Record<string, unknown>;
      if (meta.actorUserId === undefined && meta.by !== undefined) {
        meta.actorUserId = meta.by;
      }
    }
    await ctx.systemEventLogger.log(payload);
  } catch {
    // non-blocking
  }
}

const tokenSuffix = (token: string | null | undefined, length = 4) => {
  const t = String(token || '').trim();
  if (!t) return null;
  return t.length <= length ? t : t.slice(-length);
};

const shortTokenHash = (value: string | null | undefined) => {
  const v = String(value || '').trim();
  if (!v) return null;
  return createHash('sha256').update(v).digest('hex').slice(0, 10);
};

export async function ensureTablePublicQrToken(ctx: Ctx, table: any): Promise<any> {
  const cur = String(table?.publicQrToken || '').trim();
  if (cur.length >= 16) return table;
  let token = randomUUID();
  const ts = nowIso();
  for (let i = 0; i < 5; i += 1) {
    try {
      await ctx.db
        .update(ctx.schema.restaurantTables)
        .set({ publicQrToken: token, updatedAt: ts })
        .where(eq(ctx.schema.restaurantTables.id, table.id))
        .run();
      return { ...table, publicQrToken: token };
    } catch {
      token = randomUUID();
    }
  }
  throw appError(500, 'QR_TOKEN_FAIL', 'تعذر إنشاء رمز QR للطاولة.');
}

export async function resolveTableByPublicToken(ctx: Ctx, rawToken: string) {
  const token = String(rawToken || '').trim();
  if (token.length < 16) return null;
  let row = await ctx.db.select().from(ctx.schema.restaurantTables).where(eq(ctx.schema.restaurantTables.publicQrToken, token)).get();
  if (!row) {
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_PUBLIC_ACCESS_DENIED,
      severity: 'warning',
      sourceModule: 'restaurant',
      action: 'qr.token.access_denied',
      status: 'failed',
      metadata: { reason: 'unknown_token', publicQrSuffix: tokenSuffix(rawToken), actorUserId: null },
    });
    return null;
  }
  if (!row.isActive || Number(row.isActive) === 0) {
    return {
      denied: true as const,
      reason: 'inactive' as const,
      tableId: row.id,
      tableCode: row.code,
      tableName: row.name,
      companyId: row.companyId,
      branchId: row.branchId,
    };
  }
  row = await ensureTablePublicQrToken(ctx, row);
  return { table: row };
}

function scopedItemsForBranch(items: any[], companyId: string, branchId: string) {
  return (items || []).filter((it) => {
    const c = resolveEntityCompanyId(it);
    const b = resolveEntityBranchId(it);
    return c === companyId && (!b || b === branchId);
  });
}

export async function loadQrMenuForTable(ctx: Ctx, companyId: string, branchId: string) {
  const menuRows = await ctx.db
    .select()
    .from(ctx.schema.restaurantMenuItems)
    .where(
      and(
        eq(ctx.schema.restaurantMenuItems.companyId, companyId),
        eq(ctx.schema.restaurantMenuItems.branchId, branchId),
        eq(ctx.schema.restaurantMenuItems.isVisibleInQr, true),
        eq(ctx.schema.restaurantMenuItems.isAvailableNow, true),
      ),
    )
    .orderBy(asc(ctx.schema.restaurantMenuItems.sortOrder), asc(ctx.schema.restaurantMenuItems.itemId))
    .all();

  const allItems = await ctx.db.select().from(ctx.schema.items).all();
  const itemPool = scopedItemsForBranch(allItems, companyId, branchId);
  const byId = new Map(itemPool.map((it: any) => [String(it.id), it]));

  const categories = new Map<string, typeof menuRows>();
  for (const m of menuRows || []) {
    const it = byId.get(String(m.itemId));
    if (!it) continue;
    if (it.inactive === true || Number(it.inactive) === 1) continue;
    const price = Number(it.posPrice) > 0 ? Number(it.posPrice) : Number(it.salePrice || 0);
    const cat = String(m.categoryName || 'عام');
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push({ ...m, _item: it, _price: price });
  }

  const menuCategories = Array.from(categories.entries()).map(([name, rows]) => ({
    name,
    items: (rows as any[]).map((m) => ({
      itemId: String(m.itemId),
      name: m.displayNameOverride || m._item.name,
      description: m.description || null,
      imageUrl: m.imageUrl || m._item.imageUrl || null,
      unitName: m._item.unitName || null,
      basePrice: roundMoney(m._price),
      sortOrder: m.sortOrder ?? 0,
    })),
  }));

  return menuCategories;
}

function customerSafeRequests(reqs: any[], linesByRequest: Map<string, any[]>, customerToken: string | null) {
  const mine = (reqs || []).filter((r: any) => !customerToken || String(r.customerSessionToken || '') === customerToken);
  return mine.map((r: any) => {
    const lines = linesByRequest.get(String(r.id)) || [];
    return {
      id: r.id,
      status: r.requestStatus,
      submittedAt: r.submittedAt,
      note: r.notes,
      lines: lines.map((l: any) => ({
        name: l.itemNameSnapshot,
        quantity: l.quantity,
        note: l.customerNote,
      })),
    };
  });
}

export async function getPublicMenuPayload(ctx: Ctx, publicToken: string, customerSessionToken: string | null) {
  const resolved = await resolveTableByPublicToken(ctx, publicToken);
  if (!resolved) {
    // If token length is invalid, resolveTableByPublicToken won't log.
    if (String(publicToken || '').trim().length < 16) {
      await logEvt(ctx, {
        eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_PUBLIC_ACCESS_DENIED,
        severity: 'warning',
        sourceModule: 'restaurant',
        action: 'qr.token.access_denied',
        status: 'failed',
    metadata: { reason: 'invalid_token_format', publicQrSuffix: tokenSuffix(publicToken), actorUserId: null },
      });
    }
    throw appError(404, 'NOT_FOUND', 'رابط غير صالح.');
  }
  if ('denied' in resolved) {
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_PUBLIC_ACCESS_DENIED,
      severity: 'warning',
      sourceModule: 'restaurant',
      action: 'qr.token.access_denied',
      status: 'failed',
      companyId: String(resolved.companyId || ''),
      branchId: String(resolved.branchId || ''),
      metadata: {
        reason: resolved.reason,
        tableId: resolved.tableId,
        tableCode: resolved.tableCode,
        tableName: resolved.tableName,
        publicQrSuffix: tokenSuffix(publicToken),
        actorUserId: null,
      },
      requiresManualReview: false,
    });
    throw appError(403, 'TABLE_INACTIVE', 'الطاولة غير متاحة.');
  }
  const { table } = resolved;
  const companyId = String(table.companyId);
  const branchId = String(table.branchId);

  await logEvt(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_TOKEN_RESOLVED,
    companyId,
    branchId,
    severity: 'info',
    sourceModule: 'restaurant',
    action: 'qr.token.resolve',
    status: 'success',
    metadata: {
      tableId: table.id,
      tableCode: table.code,
      tableName: table.name,
      publicQrSuffix: tokenSuffix(publicToken),
      actorUserId: null,
    },
  });

  let session = await getLiveSessionForTable(ctx, table.id);
  let qrGuestSessionCreated = false;
  if (!session && table.isActive) {
    const ensured = ensureQrGuestSessionForTable(ctx, table);
    if (ensured) {
      session = ensured.session;
      qrGuestSessionCreated = ensured.created;
      if (qrGuestSessionCreated) {
        await logEvt(ctx, {
          eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_OPENED,
          companyId,
          branchId,
          severity: 'info',
          action: 'session.open.qr_guest_auto',
          status: 'success',
          metadata: {
            sessionId: session.id,
            tableId: table.id,
            tableCode: String(table.code || ''),
            tableName: String(table.name || ''),
            source: 'qr_guest',
          },
        });
        const tok = String(table.publicQrToken || '').trim();
        if (tok) {
          restaurantEmit.sessionUpdated({
            companyId,
            branchId,
            publicToken: tok,
            sessionId: String(session.id || ''),
            unreadCount: Number(session.unreadRequestCount || 0),
            sessionStatus: String(session.sessionStatus || 'open'),
          });
        }
      }
    }
  }
  const sessionOpen = Boolean(session && String(session.sessionStatus || '') !== 'closed');
  const menuCategories = await loadQrMenuForTable(ctx, companyId, branchId);

  let priorRequests: any[] = [];
  if (sessionOpen && session && customerSessionToken) {
    const reqs = await ctx.db
      .select()
      .from(ctx.schema.restaurantTableRequests)
      .where(eq(ctx.schema.restaurantTableRequests.sessionId, session.id))
      .orderBy(desc(ctx.schema.restaurantTableRequests.submittedAt))
      .all();
    const ids = (reqs || []).map((r: any) => r.id);
    let lineRows: any[] = [];
    if (ids.length) {
      lineRows = await ctx.db
        .select()
        .from(ctx.schema.restaurantTableRequestItems)
        .where(inArray(ctx.schema.restaurantTableRequestItems.requestId, ids))
        .all();
    }
    const map = new Map<string, any[]>();
    for (const l of lineRows || []) {
      const k = String(l.requestId);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    priorRequests = customerSafeRequests(reqs || [], map, customerSessionToken);
  }

  return {
    table: {
      code: table.code,
      name: table.name,
      zoneName: table.zoneName || null,
    },
    publicToken: String(table.publicQrToken || '').trim(),
    sessionOpen,
    session: sessionOpen && session
      ? {
          status: session.sessionStatus,
          openedAt: session.openedAt,
        }
      : null,
    menuCategories,
    priorRequests,
    notice:
      'الإجمالي قد يُعدَّل عند مراجعة الكاشير. الطلبات ليست فواتير نهائية.',
    qrGuestAutoSession: qrGuestSessionCreated,
  };
}

export async function getPublicSessionState(ctx: Ctx, publicToken: string, customerSessionToken: string | null) {
  const payload = await getPublicMenuPayload(ctx, publicToken, customerSessionToken);
  return {
    sessionOpen: payload.sessionOpen,
    session: payload.session,
    menuCategories: payload.menuCategories,
    priorRequests: payload.priorRequests,
    table: payload.table,
    notice: payload.notice,
    qrGuestAutoSession: Boolean((payload as { qrGuestAutoSession?: boolean }).qrGuestAutoSession),
  };
}

async function buildIdempotentPublicSubmitResponse(ctx: Ctx, existing: any, table: any, sessionId: string) {
  const sessFresh = await ctx.db.select().from(ctx.schema.restaurantTableSessions).where(eq(ctx.schema.restaurantTableSessions.id, sessionId)).get();
  const { computed } = await recomputeSessionUnreadCount(ctx, sessionId, table, {
    emitHealEventIfDrift: false,
    emitSessionUpdatedIfChanged: false,
    touchLastActivity: false,
  });
  return {
    customerSessionToken: String(existing.customerSessionToken || ''),
    requestId: existing.id,
    requestStatus: String(existing.requestStatus || 'new'),
    sessionStatus: String(sessFresh?.sessionStatus || ''),
    unreadCount: computed,
    submittedAt: existing.submittedAt,
    idempotentReplay: true as const,
  };
}

export async function submitPublicRequest(
  ctx: Ctx,
  publicToken: string,
  body: {
    clientRequestId: string;
    customerSessionToken?: string | null;
    note?: string | null;
    items: Array<{ itemId: string; quantity: number; note?: string | null }>;
  },
) {
  const publicQrSuffix = tokenSuffix(publicToken);
  const customerSessionMarkerInput = shortTokenHash(body.customerSessionToken ?? null);
  const resolved = await resolveTableByPublicToken(ctx, publicToken);
  if (!resolved) {
    // resolveTableByPublicToken logs unknown_token when token format is valid.
    if (String(publicToken || '').trim().length < 16) {
      await logEvt(ctx, {
        eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_PUBLIC_ACCESS_DENIED,
        severity: 'warning',
        sourceModule: 'restaurant',
        action: 'qr.token.access_denied',
        status: 'failed',
        metadata: { reason: 'invalid_token_format', publicQrSuffix, customerSessionMarker: customerSessionMarkerInput, actorUserId: null },
      });
    }
    throw appError(404, 'NOT_FOUND', 'لا يمكن تقديم الطلب.');
  }
  if ('denied' in resolved) {
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_PUBLIC_ACCESS_DENIED,
      severity: 'warning',
      sourceModule: 'restaurant',
      action: 'qr.token.access_denied',
      status: 'failed',
      companyId: String(resolved.companyId || ''),
      branchId: String(resolved.branchId || ''),
      metadata: {
        reason: resolved.reason,
        tableId: resolved.tableId,
        tableCode: resolved.tableCode,
        tableName: resolved.tableName,
        publicQrSuffix,
        customerSessionMarker: customerSessionMarkerInput,
        actorUserId: null,
      },
      requiresManualReview: false,
    });
    throw appError(404, 'NOT_FOUND', 'لا يمكن تقديم الطلب.');
  }
  const { table } = resolved;
  if (!table.isActive) throw appError(403, 'TABLE_INACTIVE', 'الطاولة غير مفعّلة.');

  const live = await getLiveSessionForTable(ctx, table.id);
  if (!live) {
    const latest = await getLatestSessionForTable(ctx, table.id);
    if (latest && String(latest.sessionStatus || '') === 'closed') {
      await logEvt(ctx, {
        eventType: SYSTEM_EVENT_TYPES.RESTAURANT_PUBLIC_SUBMIT_REJECTED_CLOSED_SESSION,
        companyId: String(table.companyId),
        branchId: String(table.branchId),
        severity: 'error',
        sourceModule: 'restaurant',
        action: 'qr.request.submit',
        status: 'failed',
        requiresManualReview: !!(latest.closedAt && (Date.now() - new Date(String(latest.closedAt)).getTime() < 2 * 60 * 1000)),
        metadata: {
          tableId: table.id,
          tableCode: table.code,
          tableName: table.name,
          lastSessionId: latest.id,
          closedAt: latest.closedAt ?? null,
          clientRequestId: String(body.clientRequestId || '').trim(),
        publicQrSuffix,
        customerSessionMarker: customerSessionMarkerInput,
          actorUserId: null,
          reason: 'closed_session',
        },
      });
      throw appError(409, 'RESTAURANT_SESSION_CLOSED', 'انتهت جلسة هذه الطاولة — لا يمكن إرسال طلبات جديدة.', {});
    }
    throw appError(409, 'RESTAURANT_NO_OPEN_SESSION', 'لا توجد جلسة مفتوحة على هذه الطاولة.', {});
  }
  const session = live;
  const companyId = String(table.companyId);
  const branchId = String(table.branchId);

  const clientRequestId = String(body.clientRequestId || '').trim();

  // Token resolve is useful for incident correlation even when the user never loads menu.
  await logEvt(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_TOKEN_RESOLVED,
    companyId,
    branchId,
    severity: 'info',
    sourceModule: 'restaurant',
    action: 'qr.token.resolve',
    status: 'success',
    requiresManualReview: false,
    metadata: {
      tableId: table.id,
      tableCode: table.code,
      tableName: table.name,
      publicQrSuffix,
      actorUserId: null,
    },
  });

  const dup = await ctx.db
    .select()
    .from(ctx.schema.restaurantTableRequests)
    .where(
      and(
        eq(ctx.schema.restaurantTableRequests.sessionId, session.id),
        eq(ctx.schema.restaurantTableRequests.clientRequestId, clientRequestId),
      ),
    )
    .get();
  if (dup) {
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_DUPLICATE_SUBMIT_BLOCKED,
      companyId,
      branchId,
      severity: 'warning',
      sourceModule: 'restaurant',
      action: 'qr.request.duplicate_blocked',
      status: 'success',
      requiresManualReview: false,
      metadata: {
        requestId: dup.id,
        sessionId: session.id,
        clientRequestId,
        reason: 'idempotent_replay',
        publicQrSuffix,
        customerSessionMarker: customerSessionMarkerInput,
        actorUserId: null,
      },
    });
    return buildIdempotentPublicSubmitResponse(ctx, dup, table, session.id);
  }

  const menuRows = await ctx.db
    .select()
    .from(ctx.schema.restaurantMenuItems)
    .where(
      and(
        eq(ctx.schema.restaurantMenuItems.companyId, companyId),
        eq(ctx.schema.restaurantMenuItems.branchId, branchId),
        eq(ctx.schema.restaurantMenuItems.isVisibleInQr, true),
        eq(ctx.schema.restaurantMenuItems.isAvailableNow, true),
      ),
    )
    .all();
  const menuByItem = new Map<string, any>((menuRows || []).map((m: any) => [String(m.itemId), m]));

  const allItems = await ctx.db.select().from(ctx.schema.items).all();
  const itemPool = scopedItemsForBranch(allItems, companyId, branchId);
  const itemByIdnew = new Map(itemPool.map((it: any) => [String(it.id), it]));

  const customerSessionToken = String(body.customerSessionToken || '').trim() || `cst-${randomUUID()}`;
  const customerSessionMarker = shortTokenHash(customerSessionToken);

  const ts = nowIso();
  const requestId = `rtr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const lineValues: any[] = [];
  let sort = 0;
  for (const line of body.items || []) {
    const itemId = String(line.itemId || '').trim();
    const qty = Number(line.quantity);
    if (!itemId || !Number.isFinite(qty) || qty <= 0 || qty > 999) {
      throw appError(400, 'VALIDATION_ERROR', 'كمية غير صالحة.');
    }
    const menuEnt = menuByItem.get(itemId);
    if (!menuEnt) {
      await logEvt(ctx, {
        eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_ITEM_VISIBILITY_BLOCKED,
        severity: 'warning',
        sourceModule: 'restaurant',
        action: 'qr.item.visibility_blocked',
        status: 'failed',
        companyId,
        branchId,
        requiresManualReview: false,
        metadata: {
          requestId,
          sessionId: session.id,
          tableId: table.id,
          tableCode: table.code,
          clientRequestId,
            publicQrSuffix,
            customerSessionMarker,
          itemId,
          reason: 'item_not_visible_in_qr_menu',
          actorUserId: null,
        },
      });
      throw appError(400, 'RESTAURANT_ITEM_NOT_VISIBLE_IN_QR', 'المادة غير ظاهرة أو غير متاحة في منيو QR.', { itemId });
    }
    const inv = itemByIdnew.get(itemId);
    if (!inv || inv.inactive === true || Number(inv.inactive) === 1) {
      await logEvt(ctx, {
        eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_ITEM_UNAVAILABLE_BLOCKED,
        severity: 'warning',
        sourceModule: 'restaurant',
        action: 'qr.item.unavailable_blocked',
        status: 'failed',
        companyId,
        branchId,
        requiresManualReview: false,
        metadata: {
          requestId,
          sessionId: session.id,
          tableId: table.id,
          tableCode: table.code,
          clientRequestId,
            publicQrSuffix,
            customerSessionMarker,
          itemId,
          reason: 'item_unavailable',
          actorUserId: null,
        },
      });
      throw appError(400, 'RESTAURANT_ITEM_UNAVAILABLE', 'المادة غير متاحة حاليًا.', { itemId });
    }
    const unit = Number(inv.posPrice) > 0 ? Number(inv.posPrice) : Number(inv.salePrice || 0);
    const sub = roundMoney(unit * qty);
    lineValues.push({
      id: `rtri-${requestId}-${sort}`,
      requestId,
      companyId,
      branchId,
      itemId,
      itemNameSnapshot: String(inv.name || ''),
      itemCodeSnapshot: inv.code || null,
      unitNameSnapshot: inv.unitName || null,
      quantity: qty,
      baseUnitPrice: roundMoney(unit),
      lineSubtotal: sub,
      customerNote: line.note ? String(line.note).slice(0, 500) : null,
      sortOrder: sort,
      createdAt: ts,
      updatedAt: ts,
    });
    sort += 1;
  }

  try {
    await ctx.db.insert(ctx.schema.restaurantTableRequests).values({
      id: requestId,
      companyId,
      branchId,
      tableId: table.id,
      sessionId: session.id,
      publicQrTokenSnapshot: String(table.publicQrToken || ''),
      requestStatus: 'new',
      requestSource: 'qr',
      customerSessionToken,
      clientRequestId,
      submittedAt: ts,
      seenAt: null,
      acceptedAt: null,
      rejectedAt: null,
      archivedAt: null,
      notes: body.note ? String(body.note).slice(0, 2000) : null,
      createdAt: ts,
      updatedAt: ts,
    }).run();
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      const retry = await ctx.db
        .select()
        .from(ctx.schema.restaurantTableRequests)
        .where(
          and(
            eq(ctx.schema.restaurantTableRequests.sessionId, session.id),
            eq(ctx.schema.restaurantTableRequests.clientRequestId, clientRequestId),
          ),
        )
        .get();
      if (retry) {
        await logEvt(ctx, {
          eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_DUPLICATE_SUBMIT_BLOCKED,
          companyId,
          branchId,
          severity: 'warning',
          sourceModule: 'restaurant',
          action: 'qr.request.duplicate_blocked',
          status: 'success',
          requiresManualReview: true,
          metadata: {
            requestId: retry.id,
            sessionId: session.id,
            clientRequestId,
            reason: 'unique_violation_race',
            publicQrSuffix,
            customerSessionMarker: customerSessionMarkerInput,
            actorUserId: null,
          },
        });
        return buildIdempotentPublicSubmitResponse(ctx, retry, table, session.id);
      }
    }
    throw e;
  }

  for (const lv of lineValues) {
    await ctx.db.insert(ctx.schema.restaurantTableRequestItems).values(lv).run();
  }

  if (String(session.sessionStatus || '') === 'open') {
    await ctx.db
      .update(ctx.schema.restaurantTableSessions)
      .set({ sessionStatus: 'pending_review', lastActivityAt: ts, updatedAt: ts })
      .where(eq(ctx.schema.restaurantTableSessions.id, session.id))
      .run();
  }

  const { computed: unread } = await recomputeSessionUnreadCount(ctx, session.id, table, {
    emitHealEventIfDrift: false,
    emitSessionUpdatedIfChanged: true,
    touchLastActivity: true,
  });

  await logEvt(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_REQUEST_SUBMITTED,
    companyId,
    branchId,
    severity: 'info',
    sourceModule: 'restaurant',
    action: 'qr.request.submit',
    status: 'success',
    requiresManualReview: false,
    metadata: {
      requestId,
      sessionId: session.id,
      tableId: table.id,
      tableCode: table.code,
      clientRequestId,
      publicQrSuffix,
      customerSessionMarker,
      requestBatchSize: (body.items || []).length,
      unreadAfter: unread,
      actorUserId: null,
    },
  });

  restaurantEmit.requestNew({
    companyId,
    branchId,
    publicToken: String(table.publicQrToken || ''),
    sessionId: session.id,
    tableId: table.id,
    requestId,
    unreadCount: unread,
    tableCode: table.code,
  });

  const sessAfter = await ctx.db.select().from(ctx.schema.restaurantTableSessions).where(eq(ctx.schema.restaurantTableSessions.id, session.id)).get();
  return {
    customerSessionToken,
    requestId,
    requestStatus: 'new',
    sessionStatus: String(sessAfter?.sessionStatus || 'pending_review'),
    unreadCount: unread,
    submittedAt: ts,
    idempotentReplay: false as const,
  };
}

async function loadRequestLines(ctx: Ctx, requestIds: string[]) {
  if (!requestIds.length) return [] as any[];
  return ctx.db
    .select()
    .from(ctx.schema.restaurantTableRequestItems)
    .where(inArray(ctx.schema.restaurantTableRequestItems.requestId, requestIds))
    .orderBy(asc(ctx.schema.restaurantTableRequestItems.sortOrder))
    .all();
}

export async function listSessionRequestsForCashier(ctx: Ctx, req: any, sessionId: string) {
  const auth = (req as any).authContext || {};
  const session = await ctx.db.select().from(ctx.schema.restaurantTableSessions).where(eq(ctx.schema.restaurantTableSessions.id, sessionId)).get();
  if (!session) throw appError(404, 'NOT_FOUND', 'الجلسة غير موجودة.');
  assertEntityBelongsToCompany(session, String(auth.companyId || '').trim());
  assertEntityBelongsToAllowedBranch(session, auth);

  const reqs = await ctx.db
    .select()
    .from(ctx.schema.restaurantTableRequests)
    .where(eq(ctx.schema.restaurantTableRequests.sessionId, sessionId))
    .orderBy(desc(ctx.schema.restaurantTableRequests.submittedAt))
    .all();
  const ids = (reqs || []).map((r: any) => r.id);
  const lines = await loadRequestLines(ctx, ids);
  const byReq = new Map<string, any[]>();
  for (const l of lines || []) {
    const k = String(l.requestId);
    if (!byReq.has(k)) byReq.set(k, []);
    byReq.get(k)!.push(l);
  }
  return (reqs || []).map((r: any) => ({ ...r, items: byReq.get(String(r.id)) || [] }));
}

async function getRequestScoped(ctx: Ctx, req: any, requestId: string) {
  const auth = (req as any).authContext || {};
  const row = await ctx.db.select().from(ctx.schema.restaurantTableRequests).where(eq(ctx.schema.restaurantTableRequests.id, requestId)).get();
  if (!row) throw appError(404, 'NOT_FOUND', 'الطلب غير موجود.');
  assertEntityBelongsToCompany(row, String(auth.companyId || '').trim());
  assertEntityBelongsToAllowedBranch(row, auth);
  return row;
}

export async function transitionRequestForCashier(
  ctx: Ctx,
  req: any,
  requestId: string,
  action: 'seen' | 'accept' | 'reject' | 'archive',
) {
  const auth = (req as any).authContext || {};
  const userId = String(auth.userId || '').trim();
  const row = await getRequestScoped(ctx, req, requestId);
  const session = await ctx.db.select().from(ctx.schema.restaurantTableSessions).where(eq(ctx.schema.restaurantTableSessions.id, row.sessionId)).get();
  const table = await ctx.db.select().from(ctx.schema.restaurantTables).where(eq(ctx.schema.restaurantTables.id, row.tableId)).get();
  if (!session || !table) throw appError(404, 'NOT_FOUND', 'سياق غير مكتمل.');

  if (String(session.sessionStatus || '') === 'closed') {
    throw appError(409, 'RESTAURANT_SESSION_CLOSED', 'الجلسة مغلقة.');
  }

  const st = String(row.requestStatus || '');
  const ts = nowIso();
  const nextAllowed = nextStatusForCashierAction(st, action);
  if (!nextAllowed) {
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_INVALID_REQUEST_TRANSITION_BLOCKED,
      companyId: row.companyId,
      branchId: row.branchId,
      severity: 'error',
      sourceModule: 'restaurant',
      action: 'invalid_transition',
      status: 'failed',
      requiresManualReview: true,
      metadata: {
        requestId,
        sessionId: session.id,
        tableId: table.id,
        oldStatus: st,
        attemptedRequestAction: action,
        actorUserId: userId || null,
        reason: 'fsm_transition_blocked',
      },
    });
    throw appError(400, 'RESTAURANT_INVALID_REQUEST_TRANSITION', 'انتقال حالة غير مسموح لهذا الطلب.', {
      from: st,
      action,
    });
  }
  const next = nextAllowed;

  if (action === 'seen') {
    await ctx.db
      .update(ctx.schema.restaurantTableRequests)
      .set({ requestStatus: next, seenAt: ts, updatedAt: ts })
      .where(eq(ctx.schema.restaurantTableRequests.id, requestId))
      .run();
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_REQUEST_SEEN,
      companyId: row.companyId,
      branchId: row.branchId,
      severity: 'info',
      sourceModule: 'restaurant',
      action: 'qr.request.seen',
      status: 'success',
      metadata: {
        requestId,
        sessionId: session.id,
        tableId: table.id,
        oldStatus: st,
        newStatus: next,
        actorUserId: userId || null,
      },
    });
    restaurantEmit.requestSeen({
      companyId: String(row.companyId),
      branchId: String(row.branchId),
      publicToken: String(table.publicQrToken || '').trim() || null,
      sessionId: session.id,
      requestId,
      status: next,
    });
  } else if (action === 'accept') {
    await ctx.db
      .update(ctx.schema.restaurantTableRequests)
      .set({ requestStatus: next, acceptedAt: ts, seenAt: row.seenAt || ts, updatedAt: ts })
      .where(eq(ctx.schema.restaurantTableRequests.id, requestId))
      .run();
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_REQUEST_ACCEPTED,
      companyId: row.companyId,
      branchId: row.branchId,
      severity: 'info',
      sourceModule: 'restaurant',
      action: 'qr.request.accept',
      status: 'success',
      metadata: {
        requestId,
        sessionId: session.id,
        tableId: table.id,
        oldStatus: st,
        newStatus: next,
        actorUserId: userId || null,
      },
    });
    restaurantEmit.requestAccepted({
      companyId: String(row.companyId),
      branchId: String(row.branchId),
      publicToken: String(table.publicQrToken || '').trim() || null,
      sessionId: session.id,
      requestId,
    });
  } else if (action === 'reject') {
    await ctx.db
      .update(ctx.schema.restaurantTableRequests)
      .set({ requestStatus: next, rejectedAt: ts, seenAt: row.seenAt || ts, updatedAt: ts })
      .where(eq(ctx.schema.restaurantTableRequests.id, requestId))
      .run();
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_REQUEST_REJECTED,
      companyId: row.companyId,
      branchId: row.branchId,
      severity: 'info',
      sourceModule: 'restaurant',
      action: 'qr.request.reject',
      status: 'success',
      metadata: {
        requestId,
        sessionId: session.id,
        tableId: table.id,
        oldStatus: st,
        newStatus: next,
        actorUserId: userId || null,
      },
    });
    restaurantEmit.requestRejected({
      companyId: String(row.companyId),
      branchId: String(row.branchId),
      publicToken: String(table.publicQrToken || '').trim() || null,
      sessionId: session.id,
      requestId,
    });
  } else if (action === 'archive') {
    await ctx.db
      .update(ctx.schema.restaurantTableRequests)
      .set({ requestStatus: next, archivedAt: ts, updatedAt: ts })
      .where(eq(ctx.schema.restaurantTableRequests.id, requestId))
      .run();
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_REQUEST_ARCHIVED,
      companyId: row.companyId,
      branchId: row.branchId,
      severity: 'info',
      sourceModule: 'restaurant',
      action: 'qr.request.archive',
      status: 'success',
      requiresManualReview: false,
      metadata: {
        requestId,
        sessionId: session.id,
        tableId: table.id,
        oldStatus: st,
        newStatus: next,
        actorUserId: userId || null,
      },
    });
  }

  const { computed: unread } = await recomputeSessionUnreadCount(ctx, session.id, table, {
    emitHealEventIfDrift: false,
    emitSessionUpdatedIfChanged: true,
    touchLastActivity: true,
  });
  return {
    request: await ctx.db.select().from(ctx.schema.restaurantTableRequests).where(eq(ctx.schema.restaurantTableRequests.id, requestId)).get(),
    unreadCount: unread,
  };
}

export async function listMenuSettings(ctx: Ctx, req: any) {
  const auth = (req as any).authContext || {};
  const companyId = String(auth.companyId || '').trim();
  const branchId = String(pickEffectiveBranchId(undefined, auth) || auth.branchId || '').trim();
  if (!companyId || !branchId) throw appError(400, 'BRANCH_REQUIRED', 'الفرع مطلوب.');

  const menuRows = await ctx.db
    .select()
    .from(ctx.schema.restaurantMenuItems)
    .where(and(eq(ctx.schema.restaurantMenuItems.companyId, companyId), eq(ctx.schema.restaurantMenuItems.branchId, branchId)))
    .orderBy(asc(ctx.schema.restaurantMenuItems.sortOrder))
    .all();
  const allItems = await ctx.db.select().from(ctx.schema.items).all();
  const pool = scopedItemsForBranch(allItems, companyId, branchId);
  const byItem = new Map(pool.map((it: any) => [String(it.id), it]));

  return (menuRows || []).map((m: any) => ({
    ...m,
    item: byItem.get(String(m.itemId)) || null,
  }));
}

export async function upsertMenuSetting(ctx: Ctx, req: any, body: {
  itemId: string;
  isVisibleInQr?: boolean;
  displayNameOverride?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  categoryName?: string | null;
  sortOrder?: number;
  isAvailableNow?: boolean;
}) {
  const auth = (req as any).authContext || {};
  const itemId = String(body.itemId || '').trim();
  if (!itemId) throw appError(400, 'VALIDATION_ERROR', 'itemId مطلوب.');
  const scoped = enforcePayloadTenantScope({ itemId }, auth, 'restaurant-menu-items');
  const companyId = String(scoped.companyId || '').trim();
  const branchId = String(scoped.branchId || '').trim();
  const inv = await ctx.db.select().from(ctx.schema.items).where(eq(ctx.schema.items.id, itemId)).get();
  if (!inv) throw appError(404, 'NOT_FOUND', 'المادة غير موجودة.');
  assertEntityBelongsToCompany(inv, companyId);
  const invBranch = resolveEntityBranchId(inv);
  if (invBranch && invBranch !== branchId) throw appError(403, 'BRANCH_MISMATCH', 'المادة لا تنتمي لهذا الفرع.');

  const existing = await ctx.db
    .select()
    .from(ctx.schema.restaurantMenuItems)
    .where(
      and(
        eq(ctx.schema.restaurantMenuItems.companyId, companyId),
        eq(ctx.schema.restaurantMenuItems.branchId, branchId),
        eq(ctx.schema.restaurantMenuItems.itemId, itemId),
      ),
    )
    .get();

  const ts = nowIso();
  if (existing) {
    await ctx.db
      .update(ctx.schema.restaurantMenuItems)
      .set({
        ...(body.isVisibleInQr !== undefined ? { isVisibleInQr: Boolean(body.isVisibleInQr) } : {}),
        ...(body.displayNameOverride !== undefined ? { displayNameOverride: body.displayNameOverride } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.categoryName !== undefined ? { categoryName: body.categoryName } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
        ...(body.isAvailableNow !== undefined ? { isAvailableNow: Boolean(body.isAvailableNow) } : {}),
        updatedAt: ts,
      })
      .where(eq(ctx.schema.restaurantMenuItems.id, existing.id))
      .run();
    return ctx.db.select().from(ctx.schema.restaurantMenuItems).where(eq(ctx.schema.restaurantMenuItems.id, existing.id)).get();
  }

  const id = `rmi-${randomUUID()}`;
  await ctx.db.insert(ctx.schema.restaurantMenuItems).values({
    id,
    companyId,
    branchId,
    itemId,
    isVisibleInQr: body.isVisibleInQr !== false,
    displayNameOverride: body.displayNameOverride ?? null,
    description: body.description ?? null,
    imageUrl: body.imageUrl ?? null,
    categoryName: body.categoryName ?? null,
    sortOrder: Number(body.sortOrder ?? 0) || 0,
    isAvailableNow: body.isAvailableNow !== false,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return ctx.db.select().from(ctx.schema.restaurantMenuItems).where(eq(ctx.schema.restaurantMenuItems.id, id)).get();
}

export async function regenerateTableQrToken(ctx: Ctx, req: any, tableId: string) {
  const auth = (req as any).authContext || {};
  const userId = String(auth.userId || '').trim() || null;
  const table = await ctx.db.select().from(ctx.schema.restaurantTables).where(eq(ctx.schema.restaurantTables.id, tableId)).get();
  if (!table) throw appError(404, 'NOT_FOUND', 'الطاولة غير موجودة.');
  assertEntityBelongsToCompany(table, String(auth.companyId || '').trim());
  assertEntityBelongsToAllowedBranch(table, auth);
  const token = randomUUID();
  const ts = nowIso();
  await ctx.db
    .update(ctx.schema.restaurantTables)
    .set({ publicQrToken: token, updatedAt: ts })
    .where(eq(ctx.schema.restaurantTables.id, tableId))
    .run();
  await logEvt(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_QR_TOKEN_REGENERATED,
    companyId: String(table.companyId || ''),
    branchId: String(table.branchId || ''),
    severity: 'warning',
    sourceModule: 'restaurant',
    action: 'qr.token.regenerate',
    status: 'success',
    requiresManualReview: false,
    metadata: {
      tableId: table.id,
      tableCode: table.code,
      tableName: table.name,
      publicQrSuffix: tokenSuffix(token),
      actorUserId: userId,
      reason: 'user_regenerated_public_token',
    },
  });
  return ctx.db.select().from(ctx.schema.restaurantTables).where(eq(ctx.schema.restaurantTables.id, tableId)).get();
}
