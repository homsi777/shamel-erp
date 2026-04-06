/**
 * POS queue / ticket number allocation (SQLite, transaction-safe).
 */

import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';

export type QueueScopeMode = 'global' | 'branch';
export type QueueResetMode = 'continuous' | 'daily';

export interface RestaurantQueueSettings {
  queueEnabled?: boolean;
  queueResetMode?: QueueResetMode;
  queueScope?: QueueScopeMode;
  queuePrefix?: string;
}

function newId() {
  return `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build stable scope key for counter row.
 */
export function buildQueueScopeKey(params: {
  companyId: string;
  branchId: string | null;
  scope: QueueScopeMode;
  resetMode: QueueResetMode;
  businessDate: string;
}): string {
  const c = String(params.companyId || '').trim() || 'default';
  const b = String(params.branchId || '').trim() || 'none';
  const d = String(params.businessDate || '').trim() || new Date().toISOString().split('T')[0];
  if (params.resetMode === 'daily') {
    return params.scope === 'branch'
      ? `qd:${c}:${b}:${d}`
      : `qd:${c}:global:${d}`;
  }
  return params.scope === 'branch'
    ? `qc:${c}:${b}`
    : `qc:${c}:global`;
}

export function parseRestaurantQueueFromPrintSettings(print: any): RestaurantQueueSettings {
  const r = print?.restaurant || {};
  return {
    queueEnabled: Boolean(r.queueEnabled),
    queueResetMode: r.queueResetMode === 'continuous' ? 'continuous' : 'daily',
    queueScope: r.queueScope === 'global' ? 'global' : 'branch',
    queuePrefix: String(r.queuePrefix || '').trim(),
  };
}

/**
 * Increment and return next queue value (1-based). Must run inside the same DB transaction as invoice insert.
 */
export function allocateNextQueueInTransaction(
  tx: any,
  params: {
    companyId: string | null;
    branchId: string | null;
    settings: RestaurantQueueSettings;
    businessDate: string;
  },
): { queueNumber: string; queueScope: string; queueDate: string } {
  const companyId = String(params.companyId || '').trim() || 'default';
  const branchId = params.branchId ? String(params.branchId).trim() : null;
  const scopeKey = buildQueueScopeKey({
    companyId,
    branchId,
    scope: params.settings.queueScope || 'branch',
    resetMode: params.settings.queueResetMode || 'daily',
    businessDate: params.businessDate,
  });

  const existing = tx.select().from(schema.queueCounters).where(eq(schema.queueCounters.scopeKey, scopeKey)).get();
  let nextVal = 1;
  if (existing) {
    nextVal = Number((existing as any).lastValue || 0) + 1;
    tx.update(schema.queueCounters)
      .set({ lastValue: nextVal, updatedAt: new Date().toISOString() })
      .where(eq(schema.queueCounters.scopeKey, scopeKey))
      .run();
  } else {
    tx.insert(schema.queueCounters).values({
      id: newId(),
      companyId,
      branchId,
      scopeKey,
      lastValue: nextVal,
      updatedAt: new Date().toISOString(),
    }).run();
  }

  const prefix = params.settings.queuePrefix || '';
  const queueNumber = `${prefix}${nextVal}`;
  return {
    queueNumber,
    queueScope: scopeKey,
    queueDate: params.businessDate,
  };
}
