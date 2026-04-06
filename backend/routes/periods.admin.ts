/**
 * Period Admin Routes — Shamel ERP
 *
 * Operational and administrative endpoints for period management, close readiness,
 * year-end safety, and system diagnostics.
 *
 * All endpoints require `periods.admin` permission (manage_accounts or admin role).
 * All endpoints are fully scoped to the caller's company context.
 *
 * Endpoints:
 *   GET  /api/periods-admin/:id/readiness           — Close readiness summary with hard blockers + warnings
 *   GET  /api/periods-admin/:id/year-end-readiness  — Year-end specific readiness checks
 *   GET  /api/periods-admin/:id/diagnostics         — Deep period financial diagnostics
 *   GET  /api/periods-admin/diagnostics/inventory-drift   — Inventory quantity drift report
 *   GET  /api/periods-admin/diagnostics/party-drift       — Party balance drift report
 *   GET  /api/periods-admin/diagnostics/missing-journals  — Missing journal link report
 *   GET  /api/periods-admin/diagnostics/failed-compensations — Failed compensation report
 */

import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { isAppError } from '../lib/errors';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import {
  buildCloseReadinessSummary,
  buildYearEndReadiness,
  buildPeriodDiagnosticsReport,
  buildInventoryDriftReport,
  buildPartyBalanceDriftReport,
  buildMissingJournalLinkReport,
  buildFailedCompensationReport,
} from '../services/periodReadiness';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { auditLogger, systemEventLogger } = ctx as any;

  const getScope = (req: any) => {
    const auth = (req as any).authContext || {};
    const companyId = String(auth.companyId || '').trim();
    if (!companyId) {
      const err = new Error('SCOPE_REQUIRED') as any;
      err.statusCode = 403;
      err.code = 'SCOPE_REQUIRED';
      throw err;
    }
    const branchId = String(auth.branchId || '').trim() || null;
    return { companyId, branchId, userId: String(auth.userId || 'system') };
  };

  const requireAdminOrAccountsAccess = (req: any, reply: any): boolean => {
    const auth = (req as any).authContext || {};
    const role = String(auth.role || '').toLowerCase();
    const perms: string[] = Array.isArray(auth.permissions)
      ? auth.permissions.map(String)
      : String(auth.permissions || '').split(',').map((s: string) => s.trim()).filter(Boolean);

    const allowed =
      role === 'admin' ||
      perms.includes('*') ||
      perms.includes('manage_accounts') ||
      perms.includes('close_periods');

    if (!allowed) {
      reply.status(403).send({
        error: 'صلاحية إدارة الحسابات أو إقفال الفترات مطلوبة.',
        code: 'PERIODS_ADMIN_ACCESS_DENIED',
      });
      return false;
    }
    return true;
  };

  // ─── GET /periods-admin/:id/readiness ─────────────────────────────────────
  api.get('/periods-admin/:id/readiness', async (req, reply) => {
    if (!requireAdminOrAccountsAccess(req, reply)) return;
    try {
      const { id } = req.params as any;
      const scope = getScope(req);

      const result = buildCloseReadinessSummary(
        (ctx as any).rawSqlite || (ctx as any).db,
        { companyId: scope.companyId, branchId: scope.branchId },
        id,
      );

      // Log system event if critical blockers found
      if (result.hardBlockers.length > 0) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CLOSE_PROCESS_ALERT,
          companyId: scope.companyId,
          branchId: scope.branchId,
          severity: 'warning',
          sourceModule: 'periods-admin',
          action: 'readiness-check',
          status: 'failed',
          errorCode: 'CLOSE_BLOCKERS_DETECTED',
          requiresManualReview: false,
          affectedDocumentType: 'fiscal_period',
          affectedDocumentId: id,
          metadata: {
            userId: scope.userId,
            blockers: result.hardBlockers.map((b: any) => b.code),
            warnings: result.warnings.map((w: any) => w.code),
          },
        });
      }

      return reply.send(result);
    } catch (error: any) {
      if (isAppError(error)) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      if (error?.message === 'PERIOD_NOT_FOUND') return reply.status(404).send({ error: 'الفترة غير موجودة.' });
      if (error?.message === 'SCOPE_REQUIRED') return reply.status(403).send({ error: 'سياق المؤسسة مطلوب.', code: 'SCOPE_REQUIRED' });
      return reply.status(500).send({ error: error?.message || 'Close readiness check failed.' });
    }
  });

  // ─── GET /periods-admin/:id/year-end-readiness ────────────────────────────
  api.get('/periods-admin/:id/year-end-readiness', async (req, reply) => {
    if (!requireAdminOrAccountsAccess(req, reply)) return;
    try {
      const { id } = req.params as any;
      const scope = getScope(req);

      const result = buildYearEndReadiness(
        (ctx as any).rawSqlite || (ctx as any).db,
        { companyId: scope.companyId, branchId: scope.branchId },
        id,
      );

      if (result.hardBlockers.length > 0) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CLOSE_PROCESS_ALERT,
          companyId: scope.companyId,
          branchId: scope.branchId,
          severity: 'warning',
          sourceModule: 'periods-admin',
          action: 'year-end-readiness',
          status: 'failed',
          errorCode: 'YEAR_END_BLOCKERS_DETECTED',
          requiresManualReview: false,
          affectedDocumentType: 'fiscal_period',
          affectedDocumentId: id,
          metadata: { userId: scope.userId, blockers: result.hardBlockers.map((b: any) => b.code) },
        });
      }

      return reply.send(result);
    } catch (error: any) {
      if (error?.message === 'PERIOD_NOT_FOUND') return reply.status(404).send({ error: 'الفترة غير موجودة.' });
      if (error?.message === 'SCOPE_REQUIRED') return reply.status(403).send({ error: 'سياق المؤسسة مطلوب.', code: 'SCOPE_REQUIRED' });
      return reply.status(500).send({ error: error?.message || 'Year-end readiness check failed.' });
    }
  });

  // ─── GET /periods-admin/:id/diagnostics ───────────────────────────────────
  api.get('/periods-admin/:id/diagnostics', async (req, reply) => {
    if (!requireAdminOrAccountsAccess(req, reply)) return;
    try {
      const { id } = req.params as any;
      const scope = getScope(req);

      const result = buildPeriodDiagnosticsReport(
        (ctx as any).rawSqlite || (ctx as any).db,
        { companyId: scope.companyId, branchId: scope.branchId },
        id,
      );

      return reply.send(result);
    } catch (error: any) {
      if (error?.message === 'PERIOD_NOT_FOUND') return reply.status(404).send({ error: 'الفترة غير موجودة.' });
      if (error?.message === 'SCOPE_REQUIRED') return reply.status(403).send({ error: 'سياق المؤسسة مطلوب.', code: 'SCOPE_REQUIRED' });
      return reply.status(500).send({ error: error?.message || 'Period diagnostics failed.' });
    }
  });

  // ─── GET /periods-admin/diagnostics/inventory-drift ──────────────────────
  api.get('/periods-admin/diagnostics/inventory-drift', async (req, reply) => {
    if (!requireAdminOrAccountsAccess(req, reply)) return;
    try {
      const scope = getScope(req);

      const result = buildInventoryDriftReport(
        (ctx as any).rawSqlite || (ctx as any).db,
        { companyId: scope.companyId, branchId: scope.branchId },
      );

      // Log drift to system events if significant
      if (result.driftedItems > 0) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CONSISTENCY_DRIFT_DETECTED,
          companyId: scope.companyId,
          branchId: scope.branchId,
          severity: result.driftedItems > 10 ? 'error' : 'warning',
          sourceModule: 'periods-admin',
          action: 'inventory-drift-check',
          status: 'failed',
          errorCode: 'INVENTORY_DRIFT_DETECTED',
          requiresManualReview: result.driftedItems > 10,
          affectedDocumentType: 'inventory',
          affectedDocumentId: null,
          metadata: {
            userId: scope.userId,
            driftedItems: result.driftedItems,
            totalDrift: result.totalDrift,
          },
        });
        console.warn(`[PeriodAdmin] Inventory drift detected: ${result.driftedItems} items, total drift: ${result.totalDrift}`);
      }

      return reply.send(result);
    } catch (error: any) {
      if (error?.message === 'SCOPE_REQUIRED') return reply.status(403).send({ error: 'سياق المؤسسة مطلوب.', code: 'SCOPE_REQUIRED' });
      return reply.status(500).send({ error: error?.message || 'Inventory drift check failed.' });
    }
  });

  // ─── GET /periods-admin/diagnostics/party-drift ───────────────────────────
  api.get('/periods-admin/diagnostics/party-drift', async (req, reply) => {
    if (!requireAdminOrAccountsAccess(req, reply)) return;
    try {
      const scope = getScope(req);

      const result = buildPartyBalanceDriftReport(
        (ctx as any).rawSqlite || (ctx as any).db,
        { companyId: scope.companyId, branchId: scope.branchId },
      );

      if (result.driftedParties > 0) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CONSISTENCY_DRIFT_DETECTED,
          companyId: scope.companyId,
          branchId: scope.branchId,
          severity: result.driftedParties > 5 ? 'error' : 'warning',
          sourceModule: 'periods-admin',
          action: 'party-drift-check',
          status: 'failed',
          errorCode: 'PARTY_BALANCE_DRIFT_DETECTED',
          requiresManualReview: result.driftedParties > 5,
          affectedDocumentType: 'parties',
          affectedDocumentId: null,
          metadata: {
            userId: scope.userId,
            driftedParties: result.driftedParties,
            totalDrift: result.totalDrift,
          },
        });
        console.warn(`[PeriodAdmin] Party balance drift detected: ${result.driftedParties} parties, total drift: ${result.totalDrift}`);
      }

      return reply.send(result);
    } catch (error: any) {
      if (error?.message === 'SCOPE_REQUIRED') return reply.status(403).send({ error: 'سياق المؤسسة مطلوب.', code: 'SCOPE_REQUIRED' });
      return reply.status(500).send({ error: error?.message || 'Party drift check failed.' });
    }
  });

  // ─── GET /periods-admin/diagnostics/missing-journals ─────────────────────
  api.get('/periods-admin/diagnostics/missing-journals', async (req, reply) => {
    if (!requireAdminOrAccountsAccess(req, reply)) return;
    try {
      const scope = getScope(req);
      const q = req.query as any;
      const fromDate = String(q?.from || '').slice(0, 10) || undefined;
      const toDate   = String(q?.to   || '').slice(0, 10) || undefined;

      const result = buildMissingJournalLinkReport(
        (ctx as any).rawSqlite || (ctx as any).db,
        { companyId: scope.companyId, branchId: scope.branchId },
        fromDate,
        toDate,
      );

      if (result.totalIssues > 0) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.MISSING_JOURNAL_LINK,
          companyId: scope.companyId,
          branchId: scope.branchId,
          severity: result.totalIssues > 5 ? 'error' : 'warning',
          sourceModule: 'periods-admin',
          action: 'missing-journal-check',
          status: 'failed',
          errorCode: 'MISSING_JOURNAL_LINKS_DETECTED',
          requiresManualReview: result.totalIssues > 0,
          affectedDocumentType: 'journal',
          affectedDocumentId: null,
          metadata: {
            userId: scope.userId,
            totalIssues: result.totalIssues,
          },
        });
        console.warn(`[PeriodAdmin] Missing journal links detected: ${result.totalIssues} issues`);
      }

      return reply.send(result);
    } catch (error: any) {
      if (error?.message === 'SCOPE_REQUIRED') return reply.status(403).send({ error: 'سياق المؤسسة مطلوب.', code: 'SCOPE_REQUIRED' });
      return reply.status(500).send({ error: error?.message || 'Missing journal check failed.' });
    }
  });

  // ─── GET /periods-admin/diagnostics/failed-compensations ─────────────────
  api.get('/periods-admin/diagnostics/failed-compensations', async (req, reply) => {
    if (!requireAdminOrAccountsAccess(req, reply)) return;
    try {
      const scope = getScope(req);
      const q = req.query as any;
      const fromDate = String(q?.from || '').slice(0, 10) || undefined;
      const toDate   = String(q?.to   || '').slice(0, 10) || undefined;

      const result = buildFailedCompensationReport(
        (ctx as any).rawSqlite || (ctx as any).db,
        { companyId: scope.companyId, branchId: scope.branchId },
        fromDate,
        toDate,
      );

      if (result.totalIssues > 0) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.COMPENSATION_FAILED,
          companyId: scope.companyId,
          branchId: scope.branchId,
          severity: 'error',
          sourceModule: 'periods-admin',
          action: 'failed-compensation-check',
          status: 'failed',
          errorCode: 'FAILED_COMPENSATIONS_DETECTED',
          requiresManualReview: true,
          affectedDocumentType: 'compensation',
          affectedDocumentId: null,
          metadata: {
            userId: scope.userId,
            totalIssues: result.totalIssues,
          },
        });
        console.warn(`[PeriodAdmin] Failed compensations detected: ${result.totalIssues} issues`);
      }

      return reply.send(result);
    } catch (error: any) {
      if (error?.message === 'SCOPE_REQUIRED') return reply.status(403).send({ error: 'سياق المؤسسة مطلوب.', code: 'SCOPE_REQUIRED' });
      return reply.status(500).send({ error: error?.message || 'Failed compensation check failed.' });
    }
  });

  // ─── GET /periods-admin/diagnostics/all ───────────────────────────────────
  // Convenience: run all diagnostic checks in one call
  api.get('/periods-admin/diagnostics/all', async (req, reply) => {
    if (!requireAdminOrAccountsAccess(req, reply)) return;
    try {
      const scope = getScope(req);
      const q = req.query as any;
      const fromDate = String(q?.from || '').slice(0, 10) || undefined;
      const toDate   = String(q?.to   || '').slice(0, 10) || undefined;
      const rawDb = (ctx as any).rawSqlite || (ctx as any).db;
      const diagScope = { companyId: scope.companyId, branchId: scope.branchId };

      const [inventoryDrift, partyDrift, missingJournals, failedCompensations] = await Promise.all([
        Promise.resolve().then(() => buildInventoryDriftReport(rawDb, diagScope)),
        Promise.resolve().then(() => buildPartyBalanceDriftReport(rawDb, diagScope)),
        Promise.resolve().then(() => buildMissingJournalLinkReport(rawDb, diagScope, fromDate, toDate)),
        Promise.resolve().then(() => buildFailedCompensationReport(rawDb, diagScope, fromDate, toDate)),
      ]);

      const totalIssues =
        inventoryDrift.driftedItems +
        partyDrift.driftedParties +
        missingJournals.totalIssues +
        failedCompensations.totalIssues;

      if (totalIssues > 0) {
        await auditLogger?.log({
          userId: scope.userId,
          operationType: 'diagnostics.all',
          affectedItems: [],
          newValues: {
            inventoryDriftedItems: inventoryDrift.driftedItems,
            partyDriftedParties: partyDrift.driftedParties,
            missingJournalIssues: missingJournals.totalIssues,
            failedCompensationIssues: failedCompensations.totalIssues,
          },
        });
      }

      return reply.send({
        checkedAt: new Date().toISOString(),
        companyId: scope.companyId,
        branchId: scope.branchId,
        totalIssues,
        inventoryDrift,
        partyDrift,
        missingJournals,
        failedCompensations,
      });
    } catch (error: any) {
      if (error?.message === 'SCOPE_REQUIRED') return reply.status(403).send({ error: 'سياق المؤسسة مطلوب.', code: 'SCOPE_REQUIRED' });
      return reply.status(500).send({ error: error?.message || 'Full diagnostics failed.' });
    }
  });
}
