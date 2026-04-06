import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { isAppError } from '../lib/errors';
import { parseSystemEventRow } from '../lib/systemEvents';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  filterRowsByTenantScope,
} from '../lib/tenantScope';

const parseBooleanFilter = (value: any) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return null;
};

const normalizeDateBoundary = (value: any, endOfDay = false) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}T/.test(raw) === false) {
    parsed.setUTCHours(23, 59, 59, 999);
  }
  return parsed.toISOString();
};

const applyEventFilters = (rows: any[], filters: {
  severity?: string;
  eventType?: string;
  sourceModule?: string;
  actionContains?: string | null;
  requiresManualReview?: boolean | null;
  resolved?: boolean | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  olderThan?: string | null;
}) => {
  const {
    severity,
    eventType,
    sourceModule,
    actionContains,
    requiresManualReview,
    resolved,
    dateFrom,
    dateTo,
    olderThan,
  } = filters;
  return rows.filter((row: any) => {
    const createdAt = String(row.createdAt || '');
    if (severity && String(row.severity || '').toLowerCase() !== severity) return false;
    if (eventType && String(row.eventType || '').toUpperCase() !== eventType) return false;
    if (sourceModule && String(row.sourceModule || '').toLowerCase() !== sourceModule) return false;
    if (actionContains && !String(row.action || '').toLowerCase().includes(actionContains)) return false;
    if (requiresManualReview !== null && Boolean(row.requiresManualReview) !== requiresManualReview) return false;
    if (resolved !== null && Boolean(row.resolvedAt) !== resolved) return false;
    if (dateFrom && createdAt < dateFrom) return false;
    if (dateTo && createdAt > dateTo) return false;
    if (olderThan && createdAt >= olderThan) return false;
    return true;
  });
};

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, desc } = ctx as any;
  const getAuthContext = (req: any) => (req as any).authContext || {};

  api.get('/system-events', async (req, reply) => {
    try {
      const q = (req.query || {}) as any;
      const limit = Math.min(500, Math.max(1, Number(q.limit || 200)));
      const severity = String(q.severity || '').trim().toLowerCase();
      const eventType = String(q.event_type || q.eventType || '').trim().toUpperCase();
      const sourceModule = String(q.source_module || q.sourceModule || '').trim().toLowerCase();
      const actionContains = String(q.action_contains || q.actionContains || '').trim().toLowerCase() || null;
      const requiresManualReview = parseBooleanFilter(q.requires_manual_review ?? q.requiresManualReview);
      const resolved = parseBooleanFilter(q.resolved);
      const dateFrom = normalizeDateBoundary(q.date_from ?? q.dateFrom);
      const dateTo = normalizeDateBoundary(q.date_to ?? q.dateTo, true);

      let rows = filterRowsByTenantScope(
        await db.select().from(schema.systemEvents).orderBy(desc(schema.systemEvents.createdAt)).all(),
        getAuthContext(req),
        'system-events',
      );
      rows = applyEventFilters(rows, {
        severity,
        eventType,
        sourceModule,
        actionContains,
        requiresManualReview,
        resolved,
        dateFrom,
        dateTo,
      });

      const total = rows.length;
      const items = rows.slice(0, limit).map(parseSystemEventRow);
      const summary = {
        total,
        resolvedCount: rows.filter((row: any) => Boolean(row.resolvedAt)).length,
        activeCount: rows.filter((row: any) => !row.resolvedAt).length,
        criticalCount: rows.filter((row: any) => String(row.severity || '').toLowerCase() === 'critical').length,
        manualReviewCount: rows.filter((row: any) => Boolean(row.requiresManualReview) && !row.resolvedAt).length,
        failedCount: rows.filter((row: any) => ['failed', 'partial'].includes(String(row.status || '').toLowerCase())).length,
      };

      return { items, total, summary };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to load system events.' });
    }
  });

  api.get('/system-events/export', async (req, reply) => {
    try {
      const q = (req.query || {}) as any;
      const severity = String(q.severity || '').trim().toLowerCase();
      const eventType = String(q.event_type || q.eventType || '').trim().toUpperCase();
      const sourceModule = String(q.source_module || q.sourceModule || '').trim().toLowerCase();
      const actionContains = String(q.action_contains || q.actionContains || '').trim().toLowerCase() || null;
      const requiresManualReview = parseBooleanFilter(q.requires_manual_review ?? q.requiresManualReview);
      const resolved = parseBooleanFilter(q.resolved);
      const dateFrom = normalizeDateBoundary(q.date_from ?? q.dateFrom);
      const dateTo = normalizeDateBoundary(q.date_to ?? q.dateTo, true);

      let rows = filterRowsByTenantScope(
        await db.select().from(schema.systemEvents).orderBy(desc(schema.systemEvents.createdAt)).all(),
        getAuthContext(req),
        'system-events',
      );
      rows = applyEventFilters(rows, {
        severity,
        eventType,
        sourceModule,
        actionContains,
        requiresManualReview,
        resolved,
        dateFrom,
        dateTo,
      });

      const total = rows.length;
      const items = rows.map(parseSystemEventRow);
      const summary = {
        total,
        resolvedCount: rows.filter((row: any) => Boolean(row.resolvedAt)).length,
        activeCount: rows.filter((row: any) => !row.resolvedAt).length,
        criticalCount: rows.filter((row: any) => String(row.severity || '').toLowerCase() === 'critical').length,
        manualReviewCount: rows.filter((row: any) => Boolean(row.requiresManualReview) && !row.resolvedAt).length,
        failedCount: rows.filter((row: any) => ['failed', 'partial'].includes(String(row.status || '').toLowerCase())).length,
      };

      return { items, total, summary };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to export system events.' });
    }
  });

  api.get('/system-events/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const row = await db.select().from(schema.systemEvents).where(eq(schema.systemEvents.id, id)).get();
      if (!row) return reply.status(404).send({ error: 'System event not found.' });
      assertEntityBelongsToCompany(row, String(getAuthContext(req).companyId || ''), 'System event not found.');
      assertEntityBelongsToAllowedBranch(row, getAuthContext(req), 'System event not found.');
      return parseSystemEventRow(row);
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to load system event.' });
    }
  });

  api.post('/system-events/:id/resolve', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const body = (req.body || {}) as any;
      const existing = await db.select().from(schema.systemEvents).where(eq(schema.systemEvents.id, id)).get();
      if (!existing) return reply.status(404).send({ error: 'System event not found.' });
      assertEntityBelongsToCompany(existing, String(getAuthContext(req).companyId || ''), 'System event not found.');
      assertEntityBelongsToAllowedBranch(existing, getAuthContext(req), 'System event not found.');

      const resolvedAt = existing.resolvedAt || new Date().toISOString();
      const resolvedBy = existing.resolvedBy || String((req as any)?.authContext?.userId || 'system');
      const resolutionNoteRaw = typeof body?.note === 'string' ? body.note.trim() : '';
      const resolutionNote = resolutionNoteRaw ? resolutionNoteRaw.slice(0, 1000) : null;
      await db.update(schema.systemEvents)
        .set({
          resolvedAt,
          resolvedBy,
          ...(resolutionNote ? { resolutionNote } : {}),
        })
        .where(eq(schema.systemEvents.id, id))
        .run();

      const updated = await db.select().from(schema.systemEvents).where(eq(schema.systemEvents.id, id)).get();
      return { success: true, item: parseSystemEventRow(updated) };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to resolve system event.' });
    }
  });

  api.post('/system-events/resolve-bulk', async (req, reply) => {
    try {
      const body = (req.body || {}) as any;
      const severityList = Array.isArray(body.severities)
        ? body.severities.map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean)
        : [];
      const eventType = String(body.eventType || '').trim().toUpperCase();
      const sourceModule = String(body.sourceModule || '').trim().toLowerCase();
      const requiresManualReview = parseBooleanFilter(body.requiresManualReview);
      const resolved = parseBooleanFilter(body.resolved);
      const dateFrom = normalizeDateBoundary(body.dateFrom);
      const dateTo = normalizeDateBoundary(body.dateTo, true);
      const olderThan = normalizeDateBoundary(body.olderThan, true);
      const resolutionNoteRaw = typeof body?.note === 'string' ? body.note.trim() : '';
      const resolutionNote = resolutionNoteRaw ? resolutionNoteRaw.slice(0, 1000) : null;
      const authContext = getAuthContext(req);

      let rows = filterRowsByTenantScope(
        await db.select().from(schema.systemEvents).orderBy(desc(schema.systemEvents.createdAt)).all(),
        authContext,
        'system-events',
      );

      rows = applyEventFilters(rows, {
        severity: '',
        eventType,
        sourceModule,
        requiresManualReview,
        resolved,
        dateFrom,
        dateTo,
        olderThan,
      });

      if (severityList.length > 0) {
        rows = rows.filter((row: any) => severityList.includes(String(row.severity || '').toLowerCase()));
      }

      if (Array.isArray(body.eventIds) && body.eventIds.length > 0) {
        const allowed = new Set(body.eventIds.map((id: any) => String(id || '')));
        rows = rows.filter((row: any) => allowed.has(String(row.id || '')));
      }

      const ids = rows.map((row: any) => String(row.id || '')).filter(Boolean);
      if (ids.length === 0) {
        return { success: true, resolvedCount: 0 };
      }

      const resolvedAt = new Date().toISOString();
      const resolvedBy = String(authContext?.userId || 'system');
      for (const id of ids) {
        await db.update(schema.systemEvents)
          .set({
            resolvedAt,
            resolvedBy,
            ...(resolutionNote ? { resolutionNote } : {}),
          })
          .where(eq(schema.systemEvents.id, id))
          .run();
      }

      return { success: true, resolvedCount: ids.length };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to resolve system events.' });
    }
  });

  api.post('/system-events/delete-all', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const rows = filterRowsByTenantScope(
        await db.select().from(schema.systemEvents).all(),
        authContext,
        'system-events',
      );
      const ids = rows.map((row: any) => String(row.id || '')).filter(Boolean);
      for (const id of ids) {
        await db.delete(schema.systemEvents).where(eq(schema.systemEvents.id, id)).run();
      }
      return { success: true, deletedCount: ids.length };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to delete system events.' });
    }
  });

  api.post('/system-events/delete-visible', async (req, reply) => {
    try {
      const body = (req.body || {}) as any;
      const severity = String(body.severity || '').trim().toLowerCase();
      const eventType = String(body.eventType || '').trim().toUpperCase();
      const sourceModule = String(body.sourceModule || '').trim().toLowerCase();
      const requiresManualReview = parseBooleanFilter(body.requiresManualReview);
      const resolved = parseBooleanFilter(body.resolved);
      const dateFrom = normalizeDateBoundary(body.dateFrom);
      const dateTo = normalizeDateBoundary(body.dateTo, true);
      const authContext = getAuthContext(req);

      let rows = filterRowsByTenantScope(
        await db.select().from(schema.systemEvents).all(),
        authContext,
        'system-events',
      );

      rows = applyEventFilters(rows, {
        severity,
        eventType,
        sourceModule,
        requiresManualReview,
        resolved,
        dateFrom,
        dateTo,
      });

      if (Array.isArray(body.eventIds) && body.eventIds.length > 0) {
        const allowed = new Set(body.eventIds.map((id: any) => String(id || '')));
        rows = rows.filter((row: any) => allowed.has(String(row.id || '')));
      }

      const ids = rows.map((row: any) => String(row.id || '')).filter(Boolean);
      for (const id of ids) {
        await db.delete(schema.systemEvents).where(eq(schema.systemEvents.id, id)).run();
      }
      return { success: true, deletedCount: ids.length };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error?.message || 'Failed to delete system events.' });
    }
  });
}
