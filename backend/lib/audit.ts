import { SYSTEM_EVENT_TYPES } from './systemEvents';

const SENSITIVE_KEYS = ['password', 'passwordhash', 'token', 'secret', 'authorization'];

const scrubValue = (value: any): any => {
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry));
  if (!value || typeof value !== 'object') return value;
  const clone: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key || '').replace(/[_-]/g, '').toLowerCase();
    if (SENSITIVE_KEYS.some((part) => normalizedKey.includes(part))) {
      clone[key] = '[REDACTED]';
      continue;
    }
    clone[key] = scrubValue(entry);
  }
  return clone;
};

const serialize = (value: any) => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(scrubValue(value));
  } catch {
    return JSON.stringify({ error: 'AUDIT_SERIALIZATION_FAILED' });
  }
};

export type AuditPayload = {
  userId?: string | null;
  operationType: string;
  affectedItems: any;
  oldValues?: any;
  newValues?: any;
  meta?: any;
  timestamp?: string;
  mandatory?: boolean;
};

const toSnakeCase = (value: string) => String(value || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[\s-]+/g, '_')
  .toLowerCase();

const inferAffectedDocument = (affectedItems: any) => {
  const first = Array.isArray(affectedItems) ? affectedItems[0] : null;
  if (!first || typeof first !== 'object') return { affectedDocumentType: null, affectedDocumentId: null };
  for (const [key, value] of Object.entries(first)) {
    if (!key.toLowerCase().endsWith('id') || value === null || value === undefined || value === '') continue;
    return {
      affectedDocumentType: toSnakeCase(key.replace(/Id$/i, '')),
      affectedDocumentId: String(value),
    };
  }
  return { affectedDocumentType: null, affectedDocumentId: null };
};

export const createAuditLogger = (db: any, schema: any, systemEventLogger?: { log: (payload: any) => Promise<any> }) => {
  const shouldForceFailure = (operationType: string) => {
    const raw = String(process.env.AUDIT_FAIL_OPERATIONS || '').trim();
    if (!raw) return false;
    const operations = raw
      .split(',')
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    return operations.includes(operationType) || operations.includes('*');
  };

  const insertWith = async (runner: any, payload: AuditPayload) => {
    const targetUserId = String(payload.userId || 'system').trim() || 'system';
    try {
      if (shouldForceFailure(String(payload.operationType || 'unknown'))) {
        throw new Error(`AUDIT_FORCED_FAILURE:${String(payload.operationType || 'unknown')}`);
      }
      await runner.insert(schema.auditLogs).values({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: targetUserId,
        operationType: String(payload.operationType || 'unknown'),
        affectedItems: serialize(payload.affectedItems) || '[]',
        oldValues: serialize(payload.oldValues),
        newValues: serialize(payload.newValues),
        meta: serialize(payload.meta),
        timestamp: payload.timestamp || new Date().toISOString(),
      }).run();
    } catch (error: any) {
      const inferred = inferAffectedDocument(payload.affectedItems);
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.AUDIT_FAILURE,
        severity: payload.mandatory ? 'critical' : 'warning',
        sourceModule: String(payload.operationType || 'audit').split('.')[0] || 'audit',
        action: 'audit',
        status: 'failed',
        errorCode: String(error?.code || 'AUDIT_WRITE_FAILED'),
        requiresManualReview: Boolean(payload.mandatory),
        affectedDocumentType: inferred.affectedDocumentType,
        affectedDocumentId: inferred.affectedDocumentId,
        metadata: {
          operationType: payload.operationType,
          mandatory: Boolean(payload.mandatory),
          message: String(error?.message || error || 'Unknown audit error'),
          affectedItems: scrubValue(payload.affectedItems),
          meta: scrubValue(payload.meta),
        },
      });
      if (payload.mandatory) {
        throw error;
      }
      console.warn('[audit] write failed:', error?.message || error);
    }
  };

  return {
    log: async (payload: AuditPayload) => insertWith(db, payload),
    logWithTx: async (tx: any, payload: AuditPayload) => insertWith(tx, payload),
  };
};
