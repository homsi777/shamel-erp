import type { SystemEventPayload } from '../lib/systemEvents';
import { buildPartyLedger, type DateRange, type ReportScope } from './reportingEngine';
import {
  buildPartnerAccountingLedgerPreview,
  buildPartnerTransitionAudit,
  type PartnerAccountingRange,
  type PartnerAccountingScope,
} from './partnerAccountingView';

const ALL_TIME_RANGE = { from: '2000-01-01', to: '2100-12-31' } as const;

type PilotMonitorArgs = {
  db: any;
  schema: any;
  scope: PartnerAccountingScope;
  partyId?: string | null;
  documentType: string;
  documentId: string;
  action: string;
  userId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  metadata?: Record<string, unknown>;
  systemEventLogger?: { log: (payload: SystemEventPayload) => Promise<any> };
  auditLogger?: { log: (payload: Record<string, unknown>) => Promise<any> };
};

const normalizeText = (value: unknown) => String(value ?? '').trim();
const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const parseJson = (value: unknown, fallback: any = {}) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};
const buildPartnerPilotMessage = (review: { fallbackToOperational: boolean }, row: any) => {
  const reasons = [
    ...(Array.isArray(row?.settlementMismatchReasons) ? row.settlementMismatchReasons : []),
    ...(Array.isArray(row?.blockingReasons) ? row.blockingReasons : []),
  ].filter(Boolean);
  if (!review.fallbackToOperational) {
    return 'تم اعتماد partner pilot بدون fallback تشغيلي.';
  }
  if (reasons.length > 0) {
    return `تم التحويل إلى المسار التشغيلي بسبب: ${reasons.join('، ')}`;
  }
  return 'تم التحويل إلى المسار التشغيلي لأن شرط الثقة المحاسبية لم يتحقق بالكامل.';
};

export async function evaluatePartnerPilotStatus(
  scope: PartnerAccountingScope,
  partyId: string,
) {
  const normalizedPartyId = normalizeText(partyId);
  if (!normalizedPartyId) {
    return {
      selectedForPilot: false,
      fallbackToOperational: true,
      reason: 'missing_party_id',
      row: null,
      reviewRange: ALL_TIME_RANGE,
    };
  }
  const audit = await buildPartnerTransitionAudit(scope, ALL_TIME_RANGE, { partyId: normalizedPartyId, limit: 1 });
  const row = (audit.rows || []).find((entry: any) => String(entry?.partyId || '') === normalizedPartyId) || null;
  if (!row) {
    return {
      selectedForPilot: false,
      fallbackToOperational: true,
      reason: 'not_ready_for_shadow_trust',
      row: null,
      reviewRange: ALL_TIME_RANGE,
    };
  }
  const delta = Math.abs(Number(row?.balances?.delta || 0));
  const fallbackToOperational = delta > 0.01 || !Boolean(row?.readyForShadowTrust);
  return {
    selectedForPilot: Boolean(row?.readyForShadowTrust) && !fallbackToOperational,
    fallbackToOperational,
    reason: fallbackToOperational
      ? (delta > 0.01 ? 'delta_drift_detected' : 'shadow_gate_not_satisfied')
      : 'accounting_shadow_pilot',
    row,
    reviewRange: ALL_TIME_RANGE,
  };
}

export async function buildPartnerPilotLedger(
  db: any,
  scope: ReportScope & PartnerAccountingScope,
  partyId: string,
  range: DateRange,
) {
  const operational = buildPartyLedger(db, scope, partyId, range);
  const accounting = await buildPartnerAccountingLedgerPreview(scope, partyId, range);
  const pilot = await evaluatePartnerPilotStatus(scope, partyId);
  const selectedSource = pilot.selectedForPilot && accounting
    ? 'accounting_shadow_pilot'
    : 'party_transactions_fallback';
  return {
    preview: true,
    pilotMode: true,
    partyId,
    selectedSource,
    fallbackActive: selectedSource !== 'accounting_shadow_pilot',
    fallbackReason: pilot.reason,
    pilotStatus: pilot.row ? {
      coverageLevel: pilot.row.coverage.level,
      delta: pilot.row.balances.delta,
      settlementMismatchReasons: pilot.row.settlementMismatchReasons,
      blockingReasons: pilot.row.blockingReasons,
      readyForShadowTrust: pilot.row.readyForShadowTrust,
    } : null,
    selectedBalance: selectedSource === 'accounting_shadow_pilot'
      ? Number(accounting?.comparison?.accountingBalanceTextLinked || 0)
      : Number(operational?.closingBalance || 0),
    operational,
    accounting,
  };
}

export async function monitorPartnerPilotOperation(args: PilotMonitorArgs) {
  const partyId = normalizeText(args.partyId);
  if (!partyId) return null;
  const review = await evaluatePartnerPilotStatus(args.scope, partyId);
  const row = review.row;
  if (!row) return null;

  const metadata = {
    partyId,
    partyName: row.partyName,
    coverageLevel: row.coverage.level,
    delta: row.balances.delta,
    settlementMismatchReasons: row.settlementMismatchReasons,
    blockingReasons: row.blockingReasons,
    readyForShadowTrust: row.readyForShadowTrust,
    selectedForPilot: review.selectedForPilot,
    fallbackToOperational: review.fallbackToOperational,
    reviewRange: review.reviewRange,
    message: buildPartnerPilotMessage(review, row),
    ...args.metadata,
  };

  if (args.systemEventLogger?.log) {
    await args.systemEventLogger.log({
      eventType: review.fallbackToOperational ? 'PARTNER_PILOT_FALLBACK' : 'PARTNER_PILOT_OPERATION',
      companyId: args.companyId || args.scope.companyId || null,
      branchId: args.branchId || args.scope.branchId || null,
      severity: review.fallbackToOperational ? 'warning' : 'info',
      sourceModule: 'partner-pilot',
      action: args.action,
      status: review.fallbackToOperational ? 'partial' : 'success',
      errorCode: review.fallbackToOperational ? 'PARTNER_PILOT_DELTA_DRIFT' : null,
      requiresManualReview: review.fallbackToOperational,
      affectedDocumentType: args.documentType,
      affectedDocumentId: args.documentId,
      metadata,
    });
  }

  if (args.auditLogger?.log) {
    await args.auditLogger.log({
      userId: String(args.userId || 'system'),
      operationType: `partner_pilot.${args.action}`,
      affectedItems: [{ partyId, documentType: args.documentType, documentId: args.documentId }],
      meta: metadata,
      mandatory: false,
    });
  }

  return {
    selectedForPilot: review.selectedForPilot,
    fallbackToOperational: review.fallbackToOperational,
    reason: review.reason,
    coverageLevel: row.coverage.level,
    delta: Number(row.balances.delta || 0),
    settlementMismatchReasons: row.settlementMismatchReasons,
    blockingReasons: row.blockingReasons,
    readyForShadowTrust: Boolean(row.readyForShadowTrust),
  };
}

export async function buildPartnerPilotMetrics(
  db: any,
  schema: any,
  scope: PartnerAccountingScope,
  range: PartnerAccountingRange,
) {
  const events = await db.select().from(schema.systemEvents).all();
  const scopedEvents = (events || []).filter((row: any) => {
    if (normalizeText(row?.companyId) !== scope.companyId) return false;
    if (scope.branchId && normalizeText(row?.branchId) && normalizeText(row?.branchId) !== normalizeText(scope.branchId)) return false;
    if (normalizeText(row?.sourceModule) !== 'partner-pilot') return false;
    const createdAt = normalizeText(row?.createdAt).slice(0, 10);
    return createdAt >= range.from && createdAt <= range.to;
  });

  const parsedEvents = scopedEvents.map((row: any) => {
    const metadata = parseJson(row?.metadata, {});
    const partyId = normalizeText(metadata?.partyId);
    const fallbackToOperational = Boolean(metadata?.fallbackToOperational) || normalizeText(row?.eventType) === 'PARTNER_PILOT_FALLBACK';
    const selectedForPilot = Boolean(metadata?.selectedForPilot);
    const delta = Math.abs(toNumber(metadata?.delta));
    const driftIncident = fallbackToOperational && (normalizeText(row?.errorCode) === 'PARTNER_PILOT_DELTA_DRIFT' || delta > 0.01);
    return {
      id: String(row?.id || ''),
      createdAt: String(row?.createdAt || ''),
      eventType: String(row?.eventType || ''),
      action: String(row?.action || ''),
      status: String(row?.status || ''),
      partyId,
      partyName: String(metadata?.partyName || ''),
      selectedForPilot,
      fallbackToOperational,
      driftIncident,
      delta,
      coverageLevel: String(metadata?.coverageLevel || ''),
      readyForShadowTrust: Boolean(metadata?.readyForShadowTrust),
      settlementMismatchReasons: Array.isArray(metadata?.settlementMismatchReasons) ? metadata.settlementMismatchReasons : [],
      blockingReasons: Array.isArray(metadata?.blockingReasons) ? metadata.blockingReasons : [],
    };
  }).filter((row) => row.partyId);

  const eventBuckets = new Map<string, any[]>();
  for (const event of parsedEvents) {
    const bucket = eventBuckets.get(event.partyId) || [];
    bucket.push(event);
    eventBuckets.set(event.partyId, bucket);
  }

  const transitionAudit = await buildPartnerTransitionAudit(scope, range, { limit: 1000 });
  const auditByParty = new Map<string, any>((transitionAudit.rows || []).map((row: any) => [String(row.partyId || ''), row]));

  const reviewedPartyIds = Array.from(new Set([
    ...Array.from(eventBuckets.keys()),
    ...(transitionAudit.rows || []).map((row: any) => String(row.partyId || '')),
  ].filter(Boolean)));

  const partners = reviewedPartyIds.map((partyId) => {
    const usageEvents = eventBuckets.get(partyId) || [];
    const auditRow = auditByParty.get(partyId) || null;
    const successCount = usageEvents.filter((event) => event.selectedForPilot && !event.fallbackToOperational).length;
    const fallbackCount = usageEvents.filter((event) => event.fallbackToOperational).length;
    const driftIncidents = usageEvents.filter((event) => event.driftIncident).length;
    const totalEvents = usageEvents.length;
    const currentlyEligible = Boolean(auditRow?.readyForShadowTrust)
      && String(auditRow?.coverage?.level || '') === 'full'
      && Math.abs(toNumber(auditRow?.balances?.delta)) <= 0.01
      && Number(auditRow?.settlementMismatchCount || 0) === 0;
    const stableOverTime = totalEvents > 0 && fallbackCount === 0 && driftIncidents === 0 && currentlyEligible;
    return {
      partyId,
      partyName: String(auditRow?.partyName || usageEvents[0]?.partyName || ''),
      totalEvents,
      successCount,
      fallbackCount,
      driftIncidents,
      currentCoverageLevel: String(auditRow?.coverage?.level || 'none'),
      currentDelta: toNumber(auditRow?.balances?.delta),
      currentSettlementMismatchCount: Number(auditRow?.settlementMismatchCount || 0),
      currentlyEligible,
      stableOverTime,
      reviewStatus: stableOverTime ? 'stable' : currentlyEligible ? 'eligible_but_unproven' : 'unstable',
      blockingReasons: Array.from(new Set([
        ...(Array.isArray(auditRow?.blockingReasons) ? auditRow.blockingReasons : []),
        ...usageEvents.flatMap((event) => Array.isArray(event.blockingReasons) ? event.blockingReasons : []),
      ])),
    };
  });

  const totalPilotOperations = parsedEvents.length;
  const successCount = parsedEvents.filter((event) => event.selectedForPilot && !event.fallbackToOperational).length;
  const fallbackCount = parsedEvents.filter((event) => event.fallbackToOperational).length;
  const driftIncidents = parsedEvents.filter((event) => event.driftIncident).length;
  const stablePartners = partners.filter((partner) => partner.stableOverTime);
  const unstablePartners = partners.filter((partner) => partner.reviewStatus === 'unstable');
  const eligibleButUnprovenPartners = partners.filter((partner) => partner.reviewStatus === 'eligible_but_unproven');
  const stableRatio = partners.length > 0 ? Number((stablePartners.length / partners.length).toFixed(4)) : 0;
  const recommendation = partners.length === 0
    ? 'hold'
    : stableRatio >= 0.9 && fallbackCount === 0 && driftIncidents === 0
      ? 'expand'
      : stableRatio >= 0.6 && driftIncidents <= Math.max(1, Math.floor(totalPilotOperations * 0.05))
        ? 'hold'
        : 'fix';

  return {
    preview: true,
    pilotMode: true,
    source: 'partner_pilot_metrics',
    range,
    partners,
    summary: {
      totalPilotPartners: partners.filter((partner) => partner.totalEvents > 0).length,
      candidatePartnersReviewed: partners.length,
      eligiblePartnersNow: partners.filter((partner) => partner.currentlyEligible).length,
      stablePartnersOverTime: stablePartners.length,
      unstablePartners: unstablePartners.length,
      eligibleButUnprovenPartners: eligibleButUnprovenPartners.length,
      totalPilotOperations,
      pilotSuccessCount: successCount,
      fallbackCount,
      driftIncidents,
      pilotSuccessRate: totalPilotOperations > 0 ? Number((successCount / totalPilotOperations).toFixed(4)) : 0,
      fallbackRate: totalPilotOperations > 0 ? Number((fallbackCount / totalPilotOperations).toFixed(4)) : 0,
      driftFrequency: totalPilotOperations > 0 ? Number((driftIncidents / totalPilotOperations).toFixed(4)) : 0,
      stableVsUnstableRatio: partners.length > 0 ? Number((stablePartners.length / Math.max(unstablePartners.length, 1)).toFixed(4)) : 0,
      stableRatio,
      readinessForWiderRollout: recommendation === 'expand' ? 'ready' : recommendation === 'hold' ? 'guarded' : 'not_ready',
      recommendation,
    },
  };
}
