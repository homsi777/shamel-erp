import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { isAppError } from '../lib/errors';
import {
  previewRevaluation,
  executeRevaluation,
  listRevaluationRuns,
  getRevaluationRunDetails,
  type RevaluationRates,
} from '../services/fxRevaluation';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  pickEffectiveBranchId,
} from '../lib/tenantScope';

export async function fxRevaluationRoutes(app: FastifyInstance, _ctx: RouteContext) {
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

  const scopedRuns = (runs: any[], authContext: any) =>
    (runs || []).filter((run: any) => {
      try {
        assertEntityBelongsToAllowedBranch(run, authContext, 'REVALUATION_RUN_NOT_FOUND');
        return true;
      } catch {
        return false;
      }
    });

  app.get('/fx-revaluation', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const runs = await listRevaluationRuns(scope.companyId);
      return reply.send({ success: true, data: scopedRuns(runs, scope.authContext) });
    } catch (err: any) {
      const msg = isAppError(err) ? err.message : String(err?.message || 'Unknown error');
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  app.post('/fx-revaluation/preview', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;

      const body = req.body as {
        valuationDate: string;
        rateSyp: number;
        rateTry: number;
      };

      if (!body.valuationDate) {
        return reply.status(400).send({ success: false, error: 'valuationDate مطلوب' });
      }
      if (!body.rateSyp || !body.rateTry) {
        return reply.status(400).send({ success: false, error: 'rateSyp و rateTry مطلوبان' });
      }

      const rates: RevaluationRates = { SYP: Number(body.rateSyp), TRY: Number(body.rateTry) };
      const result = await previewRevaluation({
        valuationDate: body.valuationDate,
        rates,
        companyId: scope.companyId,
        branchId: scope.branchId,
      });
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      const msg = isAppError(err) ? err.message : String(err?.message || 'Unknown error');
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  app.post('/fx-revaluation/execute', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;

      const body = req.body as {
        valuationDate: string;
        rateSyp: number;
        rateTry: number;
        executedBy?: string;
        notes?: string;
      };

      if (!body.valuationDate) {
        return reply.status(400).send({ success: false, error: 'valuationDate مطلوب' });
      }
      if (!body.rateSyp || !body.rateTry) {
        return reply.status(400).send({ success: false, error: 'rateSyp و rateTry مطلوبان' });
      }

      const rates: RevaluationRates = { SYP: Number(body.rateSyp), TRY: Number(body.rateTry) };
      const result = await executeRevaluation({
        valuationDate: body.valuationDate,
        rates,
        companyId: scope.companyId,
        branchId: scope.branchId,
        executedBy: String(body.executedBy || scope.userId || 'system'),
        notes: body.notes,
      });
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      const msg = isAppError(err) ? err.message : String(err?.message || 'Unknown error');
      const statusCode = String(msg).includes('PERIOD_LOCKED') ? 409 : 500;
      return reply.status(statusCode).send({ success: false, error: msg });
    }
  });

  app.get('/fx-revaluation/:runId', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { runId } = req.params as { runId: string };
      const details = await getRevaluationRunDetails(runId);
      assertEntityBelongsToCompany(details.run, scope.companyId, 'REVALUATION_RUN_NOT_FOUND');
      assertEntityBelongsToAllowedBranch(details.run, scope.authContext, 'REVALUATION_RUN_NOT_FOUND');
      return reply.send({ success: true, data: details });
    } catch (err: any) {
      const msg = String(err?.message || 'Unknown error');
      const statusCode = msg.includes('not found') || msg.includes('REVALUATION_RUN_NOT_FOUND') ? 404 : 500;
      return reply.status(statusCode).send({ success: false, error: msg });
    }
  });

  app.get('/fx-revaluation/report', async (req, reply) => {
    try {
      const scope = requireScope(req, reply);
      if (!scope) return;
      const { fromDate, toDate } = req.query as any;
      const runs = scopedRuns(await listRevaluationRuns(scope.companyId), scope.authContext);

      const filtered = runs.filter((r: any) => {
        if (fromDate && String(r.valuationDate || '') < String(fromDate)) return false;
        if (toDate && String(r.valuationDate || '') > String(toDate)) return false;
        return true;
      });

      let totalGain = 0;
      let totalLoss = 0;
      for (const run of filtered) {
        totalGain += Number(run.totalUnrealizedGain ?? 0);
        totalLoss += Number(run.totalUnrealizedLoss ?? 0);
      }

      return reply.send({
        success: true,
        data: {
          runs: filtered,
          summary: {
            totalUnrealizedGain: Math.round(totalGain * 100) / 100,
            totalUnrealizedLoss: Math.round(totalLoss * 100) / 100,
            netUnrealized: Math.round((totalGain - totalLoss) * 100) / 100,
            runCount: filtered.length,
          },
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message || 'Unknown error') });
    }
  });
}
