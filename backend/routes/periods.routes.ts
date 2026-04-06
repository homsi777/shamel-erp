/**
 * Fiscal Period Routes — Shamel ERP
 *
 * Endpoints:
 *   GET    /periods                    List all fiscal periods
 *   POST   /periods                    Create a new fiscal period
 *   GET    /periods/:id                Get single period with P&L summary
 *   GET    /periods/:id/validate       Pre-closing validation (dry run)
 *   POST   /periods/:id/close         Execute period closing
 *   POST   /periods/:id/reopen        Reopen a closed period (requires reason)
 *   POST   /periods/:id/carry-forward  Carry forward BS balances to next period
 *   GET    /periods/lock-check         Check if a given date is in a closed period
 */

import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { isAppError, appError } from '../lib/errors';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import {
  validatePeriodForClosing,
  executePeriodClose,
  executeCarryForward,
  reopenPeriod,
  getPeriodSummary,
  isPeriodLocked,
} from '../services/periodClosing';
import { filterRowsByTenantScope } from '../lib/tenantScope';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const {
    db,
    schema,
    eq,
    createJournalEntry,
    postJournalEntry,
    sql,
    and,
    auditLogger,
    systemEventLogger,
  } = ctx as any;

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const buildCtx = () => ({ db, schema, sql, eq, and, createJournalEntry, postJournalEntry });

  // ─── List periods ──────────────────────────────────────────────────────────
  api.get('/periods', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const allPeriods = await db.select().from(schema.fiscalPeriods).all();
      const scoped = filterRowsByTenantScope(allPeriods, authContext, 'fiscal-periods');
      return scoped.sort((a: any, b: any) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Failed to list periods.' });
    }
  });

  // ─── Create period ─────────────────────────────────────────────────────────
  api.post('/periods', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;
      const branchId = String(authContext.branchId || '').trim() || null;
      const body = req.body as any;

      const name = String(body.name || '').trim();
      const startDate = String(body.startDate || '').slice(0, 10);
      const endDate = String(body.endDate || '').slice(0, 10);

      if (!name || !startDate || !endDate) {
        return reply.status(400).send({ error: 'اسم الفترة وتاريخ البداية والنهاية مطلوبة.' });
      }
      if (startDate >= endDate) {
        return reply.status(400).send({ error: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية.' });
      }

      // Check for overlapping open/closed periods
      const existing = await db.select().from(schema.fiscalPeriods).all();
      const overlap = existing.find((p: any) => {
        if (companyId && String(p.companyId || '') !== companyId) return false;
        const pStart = String(p.startDate || '').slice(0, 10);
        const pEnd = String(p.endDate || '').slice(0, 10);
        return startDate <= pEnd && endDate >= pStart;
      });
      if (overlap) {
        return reply.status(409).send({
          error: `تتداخل الفترة مع فترة موجودة: "${overlap.name}" (${overlap.startDate} → ${overlap.endDate}).`,
          code: 'PERIOD_OVERLAP',
        });
      }

      const id = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await db.insert(schema.fiscalPeriods).values({
        id,
        companyId,
        branchId,
        name,
        startDate,
        endDate,
        status: 'open',
        notes: body.notes || null,
        createdBy: String(authContext.userId || 'system'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();

      await auditLogger?.log({
        userId: String(authContext.userId || 'system'),
        operationType: 'period.create',
        affectedItems: [{ periodId: id, name }],
        newValues: { id, name, startDate, endDate },
      });

      return reply.status(201).send({ success: true, id, name, startDate, endDate });
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      return reply.status(500).send({ error: error?.message || 'Failed to create period.' });
    }
  });

  // ─── Get single period with summary ───────────────────────────────────────
  api.get('/periods/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;

      const summary = await getPeriodSummary(buildCtx(), id, companyId);
      return reply.send(summary);
    } catch (error: any) {
      if (error?.message === 'PERIOD_NOT_FOUND') return reply.status(404).send({ error: 'الفترة المالية غير موجودة.' });
      return reply.status(500).send({ error: error?.message || 'Failed to get period.' });
    }
  });

  // ─── Pre-closing validation (dry run) ─────────────────────────────────────
  api.get('/periods/:id/validate', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;

      const result = await validatePeriodForClosing(buildCtx(), id, companyId);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Validation failed.' });
    }
  });

  // ─── Execute period closing ────────────────────────────────────────────────
  api.post('/periods/:id/close', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;
      const branchId = String(authContext.branchId || '').trim() || null;
      const userId = String(authContext.userId || 'system');

      // Must validate first
      const validation = await validatePeriodForClosing(buildCtx(), id, companyId);
      if (!validation.valid) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CLOSE_PROCESS_ALERT,
          companyId,
          branchId,
          severity: 'warning',
          sourceModule: 'periods',
          action: 'close',
          status: 'failed',
          errorCode: 'PERIOD_VALIDATION_FAILED',
          requiresManualReview: false,
          affectedDocumentType: 'fiscal_period',
          affectedDocumentId: id,
          metadata: {
            userId,
            errors: validation.errors,
            warnings: validation.warnings,
            stats: validation.stats,
          },
        });
        return reply.status(422).send({
          error: 'فشل التحقق من الفترة قبل الإقفال. راجع قائمة الأخطاء.',
          code: 'PERIOD_VALIDATION_FAILED',
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }

      let result;
      try {
        result = await executePeriodClose(buildCtx(), id, companyId, branchId, userId);
      } catch (closeErr: any) {
        const closeMsg = String(closeErr?.message || '');
        if (closeMsg === 'CROSS_COMPANY_CLOSE_DENIED') {
          return reply.status(403).send({ error: 'تعدي نطاق المؤسسة — الإقفال مرفوض.', code: 'CROSS_COMPANY_CLOSE_DENIED' });
        }
        if (closeMsg === 'PERIOD_CLOSING_IN_PROGRESS') {
          return reply.status(409).send({ error: 'عملية الإقفال جارية حالياً — انتظر حتى تكتمل.', code: 'PERIOD_CLOSING_IN_PROGRESS' });
        }
        throw closeErr;
      }

      await auditLogger?.log({
        userId,
        operationType: 'period.close',
        affectedItems: [{ periodId: id }],
        newValues: result,
      });

      await systemEventLogger?.log({
        eventType: 'PERIOD_CLOSED',
        severity: 'info',
        sourceModule: 'periods',
        action: 'close',
        status: 'success',
        affectedDocumentType: 'fiscal_period',
        affectedDocumentId: id,
        metadata: JSON.stringify(result),
      });

      return reply.send(result);
    } catch (error: any) {
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;
      const branchId = String(authContext.branchId || '').trim() || null;
      const userId = String(authContext.userId || 'system');
      if (isAppError(error)) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CLOSE_PROCESS_ALERT,
          companyId,
          branchId,
          severity: 'error',
          sourceModule: 'periods',
          action: 'close',
          status: 'failed',
          errorCode: String(error.code || 'PERIOD_CLOSE_FAILED'),
          requiresManualReview: false,
          affectedDocumentType: 'fiscal_period',
          affectedDocumentId: String((req.params as any)?.id || ''),
          metadata: {
            userId,
            message: String(error.message || ''),
            details: error.details || null,
          },
        });
        return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      }
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.CLOSE_PROCESS_ALERT,
        companyId,
        branchId,
        severity: 'critical',
        sourceModule: 'periods',
        action: 'close',
        status: 'failed',
        errorCode: 'PERIOD_CLOSE_FAILED',
        requiresManualReview: true,
        affectedDocumentType: 'fiscal_period',
        affectedDocumentId: String((req.params as any)?.id || ''),
        metadata: {
          userId,
          message: String(error?.message || error || 'Unknown close failure'),
        },
      });
      return reply.status(500).send({ error: error?.message || 'Period closing failed.' });
    }
  });

  // ─── Reopen period (requires reason) ──────────────────────────────────────
  api.post('/periods/:id/reopen', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;
      const userId = String(authContext.userId || 'system');
      const body = req.body as any;
      const reason = String(body?.reason || '').trim();

      if (reason.length < 10) {
        return reply.status(400).send({ error: 'سبب إعادة الفتح مطلوب (10 أحرف كحد أدنى).' });
      }

      // Only admin users or users with close_periods permission may reopen
      const userRole = String(authContext.role || '').toLowerCase();
      const userPerms: string[] = Array.isArray(authContext.permissions)
        ? authContext.permissions.map(String)
        : String(authContext.permissions || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      const canReopen = userRole === 'admin' || userPerms.includes('close_periods') || userPerms.includes('manage_accounts');
      if (!canReopen) {
        return reply.status(403).send({ error: 'لا تملك صلاحية إعادة فتح الفترة المالية.', code: 'REOPEN_ACCESS_DENIED' });
      }

      const result = await reopenPeriod(buildCtx(), id, companyId, userId, reason, true);

      await auditLogger?.log({
        userId,
        operationType: 'period.reopen',
        affectedItems: [{ periodId: id }],
        newValues: { reason },
      });

      await systemEventLogger?.log({
        eventType: 'PERIOD_REOPENED',
        severity: 'warning',
        sourceModule: 'periods',
        action: 'reopen',
        status: 'success',
        affectedDocumentType: 'fiscal_period',
        affectedDocumentId: id,
        metadata: JSON.stringify({ reason, reopenedBy: userId }),
      });

      return reply.send(result);
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg === 'PERIOD_NOT_FOUND') return reply.status(404).send({ error: 'الفترة غير موجودة.' });
      if (msg === 'PERIOD_NOT_CLOSED') return reply.status(409).send({ error: 'الفترة ليست مغلقة.' });
      if (msg === 'REOPEN_REASON_REQUIRED' || msg === 'REOPEN_REASON_TOO_SHORT') return reply.status(400).send({ error: 'سبب إعادة الفتح مطلوب (10 أحرف كحد أدنى).' });
      if (msg === 'REOPEN_PRIVILEGE_REQUIRED') return reply.status(403).send({ error: 'إعادة الفتح تتطلب صلاحية مدير.', code: 'REOPEN_PRIVILEGE_REQUIRED' });
      if (msg === 'ACCESS_DENIED') return reply.status(403).send({ error: 'لا يمكن الوصول لهذه الفترة.' });

      await systemEventLogger?.log({
        eventType: 'PERIOD_REOPEN_FAILED',
        severity: 'error',
        sourceModule: 'periods',
        action: 'reopen',
        status: 'failed',
        errorCode: 'PERIOD_REOPEN_FAILED',
        requiresManualReview: true,
        affectedDocumentType: 'fiscal_period',
        affectedDocumentId: String((req.params as any)?.id || ''),
        metadata: { message: msg },
      });
      return reply.status(500).send({ error: msg || 'Reopen failed.' });
    }
  });

  // ─── Carry forward ─────────────────────────────────────────────────────────
  api.post('/periods/:id/carry-forward', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;
      const branchId = String(authContext.branchId || '').trim() || null;
      const userId = String(authContext.userId || 'system');
      const body = req.body as any;
      const nextPeriodId = String(body?.nextPeriodId || '').trim();

      if (!nextPeriodId) {
        return reply.status(400).send({ error: 'nextPeriodId مطلوب.' });
      }

      const result = await executeCarryForward(buildCtx(), id, nextPeriodId, companyId, branchId, userId);

      await auditLogger?.log({
        userId,
        operationType: 'period.carry_forward',
        affectedItems: [{ fromPeriodId: id, toPeriodId: nextPeriodId }],
        newValues: result,
      });

      return reply.send(result);
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg.startsWith('CARRY_FORWARD_ALREADY_EXISTS:')) {
        const jeId = msg.split(':')[1];
        return reply.status(409).send({
          error: `قيد ترحيل الأرصدة موجود بالفعل (قيد #${jeId}) — لا يمكن تكرار العملية.`,
          code: 'CARRY_FORWARD_ALREADY_EXISTS',
          existingJournalEntryId: jeId,
        });
      }
      if (msg === 'CROSS_COMPANY_CARRY_FORWARD_DENIED' || msg === 'CROSS_COMPANY_NEXT_PERIOD_DENIED') {
        return reply.status(403).send({ error: 'تعدي نطاق المؤسسة غير مسموح.', code: msg });
      }
      if (msg === 'PERIOD_NOT_CLOSED_YET') return reply.status(422).send({ error: 'يجب إقفال الفترة أولاً.', code: 'PERIOD_NOT_CLOSED_YET' });
      if (msg === 'NEXT_PERIOD_MUST_BE_OPEN') return reply.status(422).send({ error: 'الفترة التالية يجب أن تكون مفتوحة.', code: 'NEXT_PERIOD_MUST_BE_OPEN' });
      return reply.status(500).send({ error: msg || 'Carry forward failed.' });
    }
  });

  // ─── Lock-check: is a given date inside a closed period? ──────────────────
  api.get('/periods/lock-check', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;
      const { date } = req.query as any;

      if (!date) return reply.status(400).send({ error: 'date query param required.' });

      const result = await isPeriodLocked(buildCtx(), String(date), companyId);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Lock check failed.' });
    }
  });

  // ─── Period closing report (income statement for period) ──────────────────
  api.get('/periods/:id/income-statement', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim() || null;

      const summary = await getPeriodSummary(buildCtx(), id, companyId);

      const revenueAccounts = summary.accountBreakdown.filter(a => a.type === 'revenue');
      const expenseAccounts = summary.accountBreakdown.filter(a => a.type === 'expenses');

      return reply.send({
        period: {
          id: summary.period.id,
          name: summary.period.name,
          startDate: summary.period.startDate,
          endDate: summary.period.endDate,
          status: summary.period.status,
        },
        revenue: {
          accounts: revenueAccounts,
          total: summary.totalRevenue,
        },
        expenses: {
          accounts: expenseAccounts,
          total: summary.totalExpenses,
        },
        netPnl: summary.netPnl,
        netPnlLabel: summary.netPnl >= 0 ? 'صافي ربح' : 'صافي خسارة',
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Income statement failed.' });
    }
  });
}
