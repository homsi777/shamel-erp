/**
 * Provisioning Admin Routes — Shamel ERP
 *
 * Safe, read-only endpoints for provisioning verification and onboarding.
 * All write provisioning logic remains in activation.routes.ts / setup/complete.
 *
 * Endpoints:
 *   GET  /api/provisioning-admin/status               — Is system activated and bootstrapped?
 *   GET  /api/provisioning-admin/readiness/:companyId — Provisioning readiness check for a company
 *   GET  /api/provisioning-admin/onboarding/:companyId — Full onboarding checklist for a company
 *   GET  /api/provisioning-admin/diagnose/:companyId   — Stuck state diagnosis
 *   GET  /api/provisioning-admin/companies             — List all companies with bootstrap status
 */

import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import {
  checkProvisioningReadiness,
  buildOnboardingChecklist,
  diagnoseProvisioningState,
} from '../services/provisioningService';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, auditLogger, systemEventLogger } = ctx as any;
  const rawDb = (ctx as any).rawSqlite;

  const requireAdmin = (req: any, reply: any): boolean => {
    const auth = (req as any).authContext || {};
    const role = String(auth.role || '').toLowerCase();
    const perms: string[] = Array.isArray(auth.permissions)
      ? auth.permissions.map(String)
      : String(auth.permissions || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const allowed = role === 'admin' || perms.includes('*') || perms.includes('manage_settings') || perms.includes('manage_users');
    if (!allowed) {
      reply.status(403).send({ error: 'صلاحية المدير مطلوبة.', code: 'ADMIN_REQUIRED' });
      return false;
    }
    return true;
  };

  // ─── GET /provisioning-admin/status ─────────────────────────────────────
  api.get('/provisioning-admin/status', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      // Activation status
      const activationRow = await db.select().from(schema.activationCodes)
        .where((ctx as any).eq(schema.activationCodes.isUsed, true)).get();
      const activated = Boolean(activationRow);

      // Setup status — at least one user
      const usersAll = await db.select().from(schema.users).all();
      const bootstrapped = usersAll.length > 0;

      // Company count
      const companiesAll = await db.select().from(schema.companies).all();

      return reply.send({
        activated,
        activationType: activationRow?.activationType || null,
        bootstrapped,
        totalCompanies: companiesAll.length,
        totalUsers: usersAll.length,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Status check failed.' });
    }
  });

  // ─── GET /provisioning-admin/readiness/:companyId ────────────────────────
  api.get('/provisioning-admin/readiness/:companyId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const { companyId } = req.params as any;
      const auth = (req as any).authContext || {};

      // A non-admin user can only check their own company
      if (String(auth.role || '').toLowerCase() !== 'admin') {
        const userCompany = String(auth.companyId || '').trim();
        if (userCompany && userCompany !== companyId) {
          return reply.status(403).send({ error: 'يمكنك فقط فحص مؤسستك الحالية.', code: 'COMPANY_ACCESS_DENIED' });
        }
      }

      const result = checkProvisioningReadiness(rawDb, companyId);

      if (!result.ready) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
          companyId,
          severity: result.blockers.length > 2 ? 'error' : 'warning',
          sourceModule: 'provisioning-admin',
          action: 'readiness-check',
          status: 'failed',
          errorCode: 'PROVISIONING_INCOMPLETE',
          requiresManualReview: false,
          metadata: { blockers: result.blockers.map(b => b.code) },
        });
      }

      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Provisioning readiness check failed.' });
    }
  });

  // ─── GET /provisioning-admin/onboarding/:companyId ──────────────────────
  api.get('/provisioning-admin/onboarding/:companyId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const { companyId } = req.params as any;
      const auth = (req as any).authContext || {};

      if (String(auth.role || '').toLowerCase() !== 'admin') {
        const userCompany = String(auth.companyId || '').trim();
        if (userCompany && userCompany !== companyId) {
          return reply.status(403).send({ error: 'يمكنك فقط فحص مؤسستك الحالية.', code: 'COMPANY_ACCESS_DENIED' });
        }
      }

      const result = buildOnboardingChecklist(rawDb, companyId);

      await auditLogger?.log({
        userId: String((req as any).authContext?.userId || 'system'),
        operationType: 'provisioning.onboarding_check',
        affectedItems: [{ companyId }],
        newValues: { completedSteps: result.completedSteps, totalSteps: result.totalSteps, readyForOperations: result.readyForOperations },
      });

      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Onboarding checklist failed.' });
    }
  });

  // ─── GET /provisioning-admin/diagnose/:companyId ─────────────────────────
  api.get('/provisioning-admin/diagnose/:companyId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const { companyId } = req.params as any;
      const result = diagnoseProvisioningState(rawDb, companyId);

      if (result.stuck) {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
          companyId,
          severity: 'error',
          sourceModule: 'provisioning-admin',
          action: 'stuck-state-diagnosis',
          status: 'failed',
          errorCode: 'PROVISIONING_STUCK',
          requiresManualReview: true,
          metadata: { reason: result.reason },
        });
      }

      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Provisioning diagnosis failed.' });
    }
  });

  // ─── GET /provisioning-admin/companies ───────────────────────────────────
  api.get('/provisioning-admin/companies', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const companies = await db.select().from(schema.companies).all();

      const result = companies.map((c: any) => {
        const userRow = rawDb.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE company_id = ?`).get(c.id || c.companyId);
        const branchRow = rawDb.prepare(`SELECT COUNT(*) AS cnt FROM branches WHERE company_id = ?`).get(c.id || c.companyId);
        const coaRow = rawDb.prepare(`SELECT COUNT(*) AS cnt FROM accounts WHERE company_id = ?`).get(c.id || c.companyId);
        return {
          id: c.id,
          name: c.name,
          isActive: c.isActive ?? c.is_active,
          userCount: Number(userRow?.cnt || 0),
          branchCount: Number(branchRow?.cnt || 0),
          accountCount: Number(coaRow?.cnt || 0),
          bootstrapped: Number(userRow?.cnt || 0) > 0,
        };
      });

      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message || 'Company list failed.' });
    }
  });
}
