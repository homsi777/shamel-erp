import { appError, isAppError } from './errors';
import { SYSTEM_EVENT_TYPES } from './systemEvents';

export type CompensationStepResult = {
  status: 'succeeded' | 'failed';
  error_code?: string | null;
  message?: string | null;
};

export type CriticalCompensationResult = {
  status: 'completed' | 'partial_failure' | 'failed';
  requiresManualReview: boolean;
  steps: Record<string, CompensationStepResult>;
  auditStatus: 'written' | 'failed' | 'skipped';
  auditErrorCode?: string | null;
  auditErrorMessage?: string | null;
};

type CompensationStep = {
  key: string;
  forceKey?: string;
  failureCode: string;
  run: () => Promise<unknown> | unknown;
};

type RunCriticalCompensationOptions = {
  operationType: string;
  userId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  affectedDocumentType: string;
  affectedDocumentId: string;
  primaryError: any;
  auditLogger?: { log: (payload: any) => Promise<void> };
  systemEventLogger?: { log: (payload: any) => Promise<any> };
  steps: CompensationStep[];
};

const toErrorInfo = (error: any, fallbackCode: string) => {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  const rawMessage = String(error?.message || error || 'Unknown error');
  const forcedFailureMatch = /^COMPENSATION_FORCED_FAILURE:([A-Za-z0-9._-]+)$/.exec(rawMessage);
  if (forcedFailureMatch) {
    return {
      code: fallbackCode,
      message: `Forced compensation failure at ${forcedFailureMatch[1]}.`,
    };
  }

  return {
    code: String(error?.code || fallbackCode || 'COMPENSATION_STEP_FAILED'),
    message: rawMessage,
  };
};

const shouldForceCompensationFailure = (stepKey: string, forceKey?: string) => {
  const raw = String(process.env.COMPENSATION_FAIL_STEPS || '').trim();
  if (!raw) return false;
  const values = raw
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return values.includes('*') || values.includes(stepKey) || (forceKey ? values.includes(forceKey) : false);
};

const buildPrimaryErrorMeta = (error: any) => {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
    };
  }
  return {
    code: String(error?.code || 'UNKNOWN_PRIMARY_ERROR'),
    message: String(error?.message || error || 'Unknown primary error'),
  };
};

export const runCriticalCompensation = async (options: RunCriticalCompensationOptions): Promise<CriticalCompensationResult> => {
  const steps: Record<string, CompensationStepResult> = {};
  const primaryErrorMeta = buildPrimaryErrorMeta(options.primaryError);

  for (const step of options.steps) {
    try {
      if (shouldForceCompensationFailure(step.key, step.forceKey)) {
        throw new Error(`COMPENSATION_FORCED_FAILURE:${step.forceKey || step.key}`);
      }
      await step.run();
      steps[step.key] = { status: 'succeeded' };
    } catch (error: any) {
      const normalized = toErrorInfo(error, step.failureCode);
      console.error(`[compensation] ${options.operationType}.${step.key} failed:`, normalized.message);
      steps[step.key] = {
        status: 'failed',
        error_code: normalized.code,
        message: normalized.message,
      };
    }
  }

  const stepResults = Object.values(steps);
  const failedCount = stepResults.filter((entry) => entry.status === 'failed').length;
  const succeededCount = stepResults.length - failedCount;
  let result: CriticalCompensationResult = {
    status: failedCount === 0 ? 'completed' : succeededCount === 0 ? 'failed' : 'partial_failure',
    requiresManualReview: failedCount > 0,
    steps,
    auditStatus: options.auditLogger ? 'written' : 'skipped',
  };

  if (!options.auditLogger) {
    return result;
  }

  try {
    await options.auditLogger.log({
      userId: options.userId || 'system',
      operationType: `${options.operationType}.compensation.${result.requiresManualReview ? 'failed' : 'completed'}`,
      affectedItems: [{
        documentType: options.affectedDocumentType,
        documentId: options.affectedDocumentId,
      }],
      meta: {
        severity: result.requiresManualReview ? 'critical' : 'warning',
        primaryError: primaryErrorMeta,
        compensationStatus: result.status,
        requiresManualReview: result.requiresManualReview,
        steps: result.steps,
      },
      mandatory: result.requiresManualReview,
    });
  } catch (auditError: any) {
    const normalized = toErrorInfo(auditError, 'COMPENSATION_AUDIT_FAILED');
    console.error(`[compensation] ${options.operationType}.audit failed:`, normalized.message);
    result = {
      ...result,
      status: result.status === 'completed' ? 'partial_failure' : result.status,
      requiresManualReview: true,
      auditStatus: 'failed',
      auditErrorCode: normalized.code,
      auditErrorMessage: normalized.message,
    };
  }

  const eventType =
    result.status === 'completed'
      ? SYSTEM_EVENT_TYPES.COMPENSATION_SUCCESS
      : result.status === 'partial_failure'
        ? SYSTEM_EVENT_TYPES.COMPENSATION_PARTIAL
        : SYSTEM_EVENT_TYPES.COMPENSATION_FAILED;

  await options.systemEventLogger?.log({
    eventType,
    companyId: options.companyId || null,
    branchId: options.branchId || null,
    severity: result.requiresManualReview ? 'critical' : result.status === 'completed' ? 'warning' : 'error',
    sourceModule: String(options.operationType || 'system').split('.')[0] || 'system',
    action: 'compensation',
    status: result.status === 'completed' ? 'compensated' : result.status === 'partial_failure' ? 'partial' : 'failed',
    errorCode: primaryErrorMeta.code,
    requiresManualReview: result.requiresManualReview,
    affectedDocumentType: options.affectedDocumentType,
    affectedDocumentId: options.affectedDocumentId,
    compensationStatus: {
      status: result.status,
      steps: result.steps,
      auditStatus: result.auditStatus,
      auditErrorCode: result.auditErrorCode || null,
    },
    metadata: {
      operationType: options.operationType,
      primaryError: primaryErrorMeta,
      auditStatus: result.auditStatus,
      auditErrorMessage: result.auditErrorMessage || null,
    },
  });

  if (result.requiresManualReview) {
    await options.systemEventLogger?.log({
      eventType: SYSTEM_EVENT_TYPES.MANUAL_REVIEW_REQUIRED,
      companyId: options.companyId || null,
      branchId: options.branchId || null,
      severity: 'critical',
      sourceModule: String(options.operationType || 'system').split('.')[0] || 'system',
      action: 'manual_review',
      status: result.status === 'failed' ? 'failed' : 'partial',
      errorCode: primaryErrorMeta.code,
      requiresManualReview: true,
      affectedDocumentType: options.affectedDocumentType,
      affectedDocumentId: options.affectedDocumentId,
      compensationStatus: {
        status: result.status,
        steps: result.steps,
      },
      metadata: {
        operationType: options.operationType,
        primaryError: primaryErrorMeta,
        auditStatus: result.auditStatus,
      },
    });
  }

  return result;
};

type BuildCompensationErrorOptions = {
  statusCode: number;
  code: string;
  message: string;
  primaryError: any;
  compensation: CriticalCompensationResult;
  affectedDocumentType: string;
  affectedDocumentId: string;
};

export const buildCompensationAppError = (options: BuildCompensationErrorOptions) => {
  const primaryErrorMeta = buildPrimaryErrorMeta(options.primaryError);
  const flattenedStatuses = Object.fromEntries(
    Object.entries(options.compensation.steps).map(([key, value]) => [`${key}_status`, value.status])
  );
  return appError(
    options.statusCode,
    options.code,
    options.message,
    {
      main_error_code: primaryErrorMeta.code,
      compensation_status: options.compensation.status,
      requires_manual_review: options.compensation.requiresManualReview,
      affected_document_type: options.affectedDocumentType,
      affected_document_id: options.affectedDocumentId,
      audit_status: options.compensation.auditStatus,
      compensation_audit_error_code: options.compensation.auditErrorCode || null,
      primary_error: primaryErrorMeta,
      compensation: options.compensation.steps,
      ...flattenedStatuses,
    }
  );
};
