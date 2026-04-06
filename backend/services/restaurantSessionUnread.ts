import { eq } from 'drizzle-orm';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import { restaurantEmit } from '../lib/restaurantSocket';

export type UnreadSyncCtx = {
  db: any;
  schema: any;
  systemEventLogger?: { log: (p: any) => Promise<any> };
};

async function logEvt(ctx: UnreadSyncCtx, payload: Record<string, unknown>) {
  if (!ctx.systemEventLogger) return;
  try {
    await ctx.systemEventLogger.log(payload);
  } catch {
    /* non-blocking */
  }
}

/**
 * Recompute count of requests in `new` status for session; persist on session row.
 * Optionally emit socket + drift event when stored value did not match DB reality.
 */
export async function recomputeSessionUnreadCount(
  ctx: UnreadSyncCtx,
  sessionId: string,
  table: {
    companyId: string;
    branchId: string;
    publicQrToken?: string | null;
    // Optional fields (present in actual DB row) for richer monitoring metadata.
    id?: string;
    code?: string;
  },
  options?: {
    /** When true, emit RESTAURANT_UNREAD_COUNT_HEALED if stored !== computed (audit / integrity). Default false to avoid noise after normal writes. */
    emitHealEventIfDrift?: boolean;
    /** Emit restaurant:session-updated when computed value differs from previously stored. Default true. */
    emitSessionUpdatedIfChanged?: boolean;
    touchLastActivity?: boolean;
  },
): Promise<{ computed: number; storedBefore: number; changed: boolean }> {
  const rows = await ctx.db
    .select()
    .from(ctx.schema.restaurantTableRequests)
    .where(eq(ctx.schema.restaurantTableRequests.sessionId, sessionId))
    .all();
  const computed = (rows || []).filter((r: any) => String(r.requestStatus || '') === 'new').length;
  const sessionRow = await ctx.db
    .select()
    .from(ctx.schema.restaurantTableSessions)
    .where(eq(ctx.schema.restaurantTableSessions.id, sessionId))
    .get();
  if (!sessionRow) return { computed: 0, storedBefore: 0, changed: false };
  const storedBefore = Number(sessionRow.unreadRequestCount ?? 0);
  const changed = storedBefore !== computed;

  if (!changed) {
    return { computed, storedBefore, changed: false };
  }

  if (options?.emitHealEventIfDrift) {
    await logEvt(ctx, {
      eventType: SYSTEM_EVENT_TYPES.RESTAURANT_UNREAD_COUNT_HEALED,
      companyId: table.companyId,
      branchId: table.branchId,
      severity: 'error',
      sourceModule: 'restaurant',
      action: 'unread.healed',
      status: 'success',
      requiresManualReview: true,
      metadata: {
        sessionId,
        tableId: table.id ?? null,
        tableCode: table.code ?? null,
        unreadBefore: storedBefore,
        unreadAfter: computed,
        reason: 'unread_drift_healed',
      },
    });
  }

  const ts = new Date().toISOString();
  await ctx.db
    .update(ctx.schema.restaurantTableSessions)
    .set({
      unreadRequestCount: computed,
      ...(options?.touchLastActivity === false ? {} : { lastActivityAt: ts }),
      updatedAt: ts,
    })
    .where(eq(ctx.schema.restaurantTableSessions.id, sessionId))
    .run();

  const emitIfChanged = options?.emitSessionUpdatedIfChanged !== false;
  if (emitIfChanged) {
    restaurantEmit.sessionUpdated({
      companyId: String(table.companyId),
      branchId: String(table.branchId),
      publicToken: String(table.publicQrToken || '').trim() || null,
      sessionId,
      unreadCount: computed,
    });
  }

  await logEvt(ctx, {
    eventType: SYSTEM_EVENT_TYPES.RESTAURANT_SESSION_UNREAD_COUNT_UPDATED,
    companyId: table.companyId,
    branchId: table.branchId,
    severity: 'warning',
    sourceModule: 'restaurant',
    action: 'unread.recomputed',
    status: 'success',
    metadata: {
      sessionId,
      tableId: table.id ?? null,
      tableCode: table.code ?? null,
      unreadBefore: storedBefore,
      unreadAfter: computed,
    },
  });

  return { computed, storedBefore, changed: true };
}
