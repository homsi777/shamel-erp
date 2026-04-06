import { and, desc, eq, gte } from 'drizzle-orm';

const SENSITIVE_KEYS = ['password', 'passwordhash', 'token', 'secret', 'authorization'];
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export const SYSTEM_EVENT_TYPES = {
  COMPENSATION_SUCCESS: 'COMPENSATION_SUCCESS',
  COMPENSATION_PARTIAL: 'COMPENSATION_PARTIAL',
  COMPENSATION_FAILED: 'COMPENSATION_FAILED',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
  CRITICAL_OPERATION_FAILED: 'CRITICAL_OPERATION_FAILED',
  AUDIT_FAILURE: 'AUDIT_FAILURE',
  CONSISTENCY_DRIFT_DETECTED: 'CONSISTENCY_DRIFT_DETECTED',
  MISSING_JOURNAL_LINK: 'MISSING_JOURNAL_LINK',
  GUARD_RECOVERED: 'GUARD_RECOVERED',
  CLOSE_PROCESS_ALERT: 'CLOSE_PROCESS_ALERT',
  CROSS_SCOPE_ACCESS_ATTEMPT: 'CROSS_SCOPE_ACCESS_ATTEMPT',
  LOCAL_WRITE_VIOLATION: 'LOCAL_WRITE_VIOLATION',
  INVOICE_CANCEL: 'INVOICE_CANCEL',
  VOUCHER_UPDATE: 'VOUCHER_UPDATE',
  DELIVERY_CONFIRM: 'DELIVERY_CONFIRM',
  EXPENSE_POST: 'EXPENSE_POST',
  INVOICE_CREATED: 'INVOICE_CREATED',
  INVOICE_POSTED: 'INVOICE_POSTED',
  VOUCHER_CREATED: 'VOUCHER_CREATED',
  VOUCHER_POSTED: 'VOUCHER_POSTED',
  OPENING_BALANCE_POSTED: 'OPENING_BALANCE_POSTED',
  OPENING_STOCK_POSTED: 'OPENING_STOCK_POSTED',
  ITEM_CREATED: 'ITEM_CREATED',
  ITEM_UPDATED: 'ITEM_UPDATED',
  PRINT_JOB_COMPLETED: 'PRINT_JOB_COMPLETED',
  PRINT_JOB_FAILED: 'PRINT_JOB_FAILED',
  PRINT_TEMPLATE_SAVED: 'PRINT_TEMPLATE_SAVED',
  PRINTER_SAVED: 'PRINTER_SAVED',
  POS_SALE_COMPLETED: 'POS_SALE_COMPLETED',
  PERIOD_CLOSED: 'PERIOD_CLOSED',
  PERIOD_REOPENED: 'PERIOD_REOPENED',
  PERIOD_REOPEN_FAILED: 'PERIOD_REOPEN_FAILED',
  YEAR_END_CLOSED: 'YEAR_END_CLOSED',
  CARRY_FORWARD_EXECUTED: 'CARRY_FORWARD_EXECUTED',
  CARRY_FORWARD_DUPLICATE_BLOCKED: 'CARRY_FORWARD_DUPLICATE_BLOCKED',
  CROSS_COMPANY_OPERATION_BLOCKED: 'CROSS_COMPANY_OPERATION_BLOCKED',
  CONCURRENT_CLOSE_BLOCKED: 'CONCURRENT_CLOSE_BLOCKED',
  SECURITY_WEAK_SECRET: 'SECURITY_WEAK_SECRET',
  SECURITY_CONFIG_WARNING: 'SECURITY_CONFIG_WARNING',
  FX_POSTING_SKIPPED: 'FX_POSTING_SKIPPED',
  PURCHASE_MISSING_GOODS_SUBTOTAL: 'PURCHASE_MISSING_GOODS_SUBTOTAL',
  RESTAURANT_TABLE_CREATED: 'RESTAURANT_TABLE_CREATED',
  RESTAURANT_TABLE_UPDATED: 'RESTAURANT_TABLE_UPDATED',
  RESTAURANT_SESSION_OPENED: 'RESTAURANT_SESSION_OPENED',
  RESTAURANT_SESSION_UPDATED: 'RESTAURANT_SESSION_UPDATED',
  RESTAURANT_SESSION_CLOSED: 'RESTAURANT_SESSION_CLOSED',
  RESTAURANT_SESSION_OPEN_BLOCKED: 'RESTAURANT_SESSION_OPEN_BLOCKED',
  RESTAURANT_QR_REQUEST_SUBMITTED: 'RESTAURANT_QR_REQUEST_SUBMITTED',
  RESTAURANT_QR_REQUEST_SEEN: 'RESTAURANT_QR_REQUEST_SEEN',
  RESTAURANT_QR_REQUEST_ACCEPTED: 'RESTAURANT_QR_REQUEST_ACCEPTED',
  RESTAURANT_QR_REQUEST_REJECTED: 'RESTAURANT_QR_REQUEST_REJECTED',
  RESTAURANT_QR_PUBLIC_ACCESS_DENIED: 'RESTAURANT_QR_PUBLIC_ACCESS_DENIED',
  RESTAURANT_QR_TOKEN_RESOLVED: 'RESTAURANT_QR_TOKEN_RESOLVED',
  RESTAURANT_SESSION_UNREAD_COUNT_UPDATED: 'RESTAURANT_SESSION_UNREAD_COUNT_UPDATED',
  RESTAURANT_QR_DUPLICATE_SUBMIT_BLOCKED: 'RESTAURANT_QR_DUPLICATE_SUBMIT_BLOCKED',
  RESTAURANT_UNREAD_COUNT_HEALED: 'RESTAURANT_UNREAD_COUNT_HEALED',
  RESTAURANT_INVALID_REQUEST_TRANSITION_BLOCKED: 'RESTAURANT_INVALID_REQUEST_TRANSITION_BLOCKED',
  RESTAURANT_SESSION_CLOSE_BLOCKED_UNREAD: 'RESTAURANT_SESSION_CLOSE_BLOCKED_UNREAD',
  RESTAURANT_SESSION_FORCE_CLOSED_WITH_UNREAD_QR: 'RESTAURANT_SESSION_FORCE_CLOSED_WITH_UNREAD_QR',
  RESTAURANT_PUBLIC_SUBMIT_REJECTED_CLOSED_SESSION: 'RESTAURANT_PUBLIC_SUBMIT_REJECTED_CLOSED_SESSION',
  RESTAURANT_QR_TOKEN_REGENERATED: 'RESTAURANT_QR_TOKEN_REGENERATED',
  RESTAURANT_SOCKET_RESYNC_TRIGGERED: 'RESTAURANT_SOCKET_RESYNC_TRIGGERED',
  RESTAURANT_QR_REQUEST_ARCHIVED: 'RESTAURANT_QR_REQUEST_ARCHIVED',
  RESTAURANT_QR_ITEM_VISIBILITY_BLOCKED: 'RESTAURANT_QR_ITEM_VISIBILITY_BLOCKED',
  RESTAURANT_QR_ITEM_UNAVAILABLE_BLOCKED: 'RESTAURANT_QR_ITEM_UNAVAILABLE_BLOCKED',
  RESTAURANT_CASHIER_ITEMS_ADDED: 'RESTAURANT_CASHIER_ITEMS_ADDED',
  RESTAURANT_CASHIER_ITEMS_REMOVED: 'RESTAURANT_CASHIER_ITEMS_REMOVED',
  RESTAURANT_CASHIER_ITEM_QTY_CHANGED: 'RESTAURANT_CASHIER_ITEM_QTY_CHANGED',
  RESTAURANT_CASHIER_ORDER_SAVED: 'RESTAURANT_CASHIER_ORDER_SAVED',
  RESTAURANT_KITCHEN_SEND_STARTED: 'RESTAURANT_KITCHEN_SEND_STARTED',
  RESTAURANT_KITCHEN_SEND_COMPLETED: 'RESTAURANT_KITCHEN_SEND_COMPLETED',
  RESTAURANT_KITCHEN_SEND_FAILED: 'RESTAURANT_KITCHEN_SEND_FAILED',
  RESTAURANT_KITCHEN_TICKET_PRINT_STARTED: 'RESTAURANT_KITCHEN_TICKET_PRINT_STARTED',
  RESTAURANT_KITCHEN_TICKET_PRINT_SUCCEEDED: 'RESTAURANT_KITCHEN_TICKET_PRINT_SUCCEEDED',
  RESTAURANT_KITCHEN_TICKET_PRINT_FAILED: 'RESTAURANT_KITCHEN_TICKET_PRINT_FAILED',
  RESTAURANT_KITCHEN_PRINTER_TEST_STARTED: 'RESTAURANT_KITCHEN_PRINTER_TEST_STARTED',
  RESTAURANT_KITCHEN_PRINTER_TEST_SUCCEEDED: 'RESTAURANT_KITCHEN_PRINTER_TEST_SUCCEEDED',
  RESTAURANT_KITCHEN_PRINTER_TEST_FAILED: 'RESTAURANT_KITCHEN_PRINTER_TEST_FAILED',
  RESTAURANT_CHECKOUT_STARTED: 'RESTAURANT_CHECKOUT_STARTED',
  RESTAURANT_CHECKOUT_VALIDATION_FAILED: 'RESTAURANT_CHECKOUT_VALIDATION_FAILED',
  RESTAURANT_CHECKOUT_INVOICE_CREATE_STARTED: 'RESTAURANT_CHECKOUT_INVOICE_CREATE_STARTED',
  RESTAURANT_CHECKOUT_INVOICE_CREATED: 'RESTAURANT_CHECKOUT_INVOICE_CREATED',
  RESTAURANT_CHECKOUT_INVOICE_CREATE_FAILED: 'RESTAURANT_CHECKOUT_INVOICE_CREATE_FAILED',
  RESTAURANT_INVOICE_VERIFIED_IN_REGISTER: 'RESTAURANT_INVOICE_VERIFIED_IN_REGISTER',
  RESTAURANT_INVOICE_VERIFICATION_FAILED: 'RESTAURANT_INVOICE_VERIFICATION_FAILED',
  RESTAURANT_CHECKOUT_PRINT_STARTED: 'RESTAURANT_CHECKOUT_PRINT_STARTED',
  RESTAURANT_CHECKOUT_PRINT_SUCCEEDED: 'RESTAURANT_CHECKOUT_PRINT_SUCCEEDED',
  RESTAURANT_CHECKOUT_PRINT_FAILED: 'RESTAURANT_CHECKOUT_PRINT_FAILED',
  RESTAURANT_CHECKOUT_COMPLETED: 'RESTAURANT_CHECKOUT_COMPLETED',
  RESTAURANT_CHECKOUT_FAILED: 'RESTAURANT_CHECKOUT_FAILED',
  RESTAURANT_CASH_PAYMENT_RECORDED: 'RESTAURANT_CASH_PAYMENT_RECORDED',
  RESTAURANT_CASH_PAYMENT_RECORD_FAILED: 'RESTAURANT_CASH_PAYMENT_RECORD_FAILED',
  RESTAURANT_CREDIT_SALE_RECORDED: 'RESTAURANT_CREDIT_SALE_RECORDED',
  RESTAURANT_CREDIT_SALE_RECORD_FAILED: 'RESTAURANT_CREDIT_SALE_RECORD_FAILED',
  RESTAURANT_SHIFT_CLOSE_STARTED: 'RESTAURANT_SHIFT_CLOSE_STARTED',
  RESTAURANT_SHIFT_CLOSE_BLOCKED: 'RESTAURANT_SHIFT_CLOSE_BLOCKED',
  RESTAURANT_SHIFT_CLOSE_FORCED: 'RESTAURANT_SHIFT_CLOSE_FORCED',
  RESTAURANT_SHIFT_CLOSE_COMPLETED: 'RESTAURANT_SHIFT_CLOSE_COMPLETED',
  RESTAURANT_SHIFT_CLOSE_FAILED: 'RESTAURANT_SHIFT_CLOSE_FAILED',
  RESTAURANT_KITCHEN_PRINTER_SETTINGS_SAVED: 'RESTAURANT_KITCHEN_PRINTER_SETTINGS_SAVED',
  RESTAURANT_KITCHEN_PRINTER_SETTINGS_SAVE_FAILED: 'RESTAURANT_KITCHEN_PRINTER_SETTINGS_SAVE_FAILED',
} as const;

export type SystemEventType = typeof SYSTEM_EVENT_TYPES[keyof typeof SYSTEM_EVENT_TYPES];
export type SystemEventSeverity = 'info' | 'warning' | 'error' | 'critical';
export type SystemEventStatus = 'success' | 'failed' | 'compensated' | 'partial';

export type SystemEventPayload = {
  id?: string;
  eventType: string;
  companyId?: string | null;
  branchId?: string | null;
  severity: SystemEventSeverity;
  sourceModule: string;
  action: string;
  status: SystemEventStatus;
  errorCode?: string | null;
  requiresManualReview?: boolean;
  affectedDocumentType?: string | null;
  affectedDocumentId?: string | null;
  compensationStatus?: any;
  metadata?: any;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
  createdAt?: string;
};

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

const serializeJson = (value: any, fallback: any = {}) => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(scrubValue(value));
  } catch {
    return JSON.stringify(fallback);
  }
};

const parseJson = (value: any, fallback: any = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};

const buildSystemEventId = () => `sevt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeSeverity = (value: any): SystemEventSeverity => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'warning' || normalized === 'error' || normalized === 'critical') return normalized;
  return 'info';
};

const normalizeStatus = (value: any): SystemEventStatus => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'failed' || normalized === 'compensated' || normalized === 'partial') return normalized;
  return 'success';
};

export const parseSystemEventRow = (row: any) => ({
  id: String(row?.id || ''),
  eventType: String(row?.eventType ?? row?.event_type ?? ''),
  severity: normalizeSeverity(row?.severity),
  sourceModule: String(row?.sourceModule ?? row?.source_module ?? ''),
  action: String(row?.action || ''),
  status: normalizeStatus(row?.status),
  errorCode: row?.errorCode ?? row?.error_code ?? null,
  requiresManualReview: Boolean(row?.requiresManualReview ?? row?.requires_manual_review),
  affectedDocumentType: row?.affectedDocumentType ?? row?.affected_document_type ?? null,
  affectedDocumentId: row?.affectedDocumentId ?? row?.affected_document_id ?? null,
  compensationStatus: parseJson(row?.compensationStatus ?? row?.compensation_status, null),
  metadata: parseJson(row?.metadata, {}),
  resolvedAt: row?.resolvedAt ?? row?.resolved_at ?? null,
  resolvedBy: row?.resolvedBy ?? row?.resolved_by ?? null,
  resolutionNote: row?.resolutionNote ?? row?.resolution_note ?? null,
  createdAt: String(row?.createdAt ?? row?.created_at ?? ''),
});

export const createSystemEventLogger = (db: any, schema: any) => {
  const insertWith = async (runner: any, payload: SystemEventPayload) => {
    const row = {
      id: payload.id || buildSystemEventId(),
      companyId: payload.companyId ?? payload.metadata?.companyId ?? null,
      branchId: payload.branchId ?? payload.metadata?.branchId ?? null,
      eventType: String(payload.eventType || SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED),
      severity: normalizeSeverity(payload.severity),
      sourceModule: String(payload.sourceModule || 'system'),
      action: String(payload.action || 'observe'),
      status: normalizeStatus(payload.status),
      errorCode: payload.errorCode ? String(payload.errorCode) : null,
      requiresManualReview: Boolean(payload.requiresManualReview),
      affectedDocumentType: payload.affectedDocumentType ? String(payload.affectedDocumentType) : null,
      affectedDocumentId: payload.affectedDocumentId ? String(payload.affectedDocumentId) : null,
      compensationStatus: serializeJson(payload.compensationStatus),
      metadata: serializeJson(payload.metadata, { error: 'SYSTEM_EVENT_SERIALIZATION_FAILED' }) || '{}',
      resolvedAt: payload.resolvedAt || null,
      resolvedBy: payload.resolvedBy || null,
      resolutionNote: payload.resolutionNote ? String(payload.resolutionNote) : null,
      createdAt: payload.createdAt || new Date().toISOString(),
    };

    try {
      const windowStart = new Date(new Date(row.createdAt).getTime() - DEDUPE_WINDOW_MS).toISOString();

      // Dedupe is intentionally scoped to tenant + affected document (when available)
      // to avoid overwriting operational context like `affectedDocumentId` / `requiresManualReview`.
      const whereConditions: any[] = [
        eq(schema.systemEvents.eventType, row.eventType),
        eq(schema.systemEvents.sourceModule, row.sourceModule),
        eq(schema.systemEvents.action, row.action),
        eq(schema.systemEvents.status, row.status),
        gte(schema.systemEvents.createdAt, windowStart),
      ];
      if (row.companyId) whereConditions.push(eq(schema.systemEvents.companyId, row.companyId));
      if (row.branchId) whereConditions.push(eq(schema.systemEvents.branchId, row.branchId));
      if (row.affectedDocumentType) whereConditions.push(eq(schema.systemEvents.affectedDocumentType, row.affectedDocumentType));
      if (row.affectedDocumentId) whereConditions.push(eq(schema.systemEvents.affectedDocumentId, row.affectedDocumentId));

      const existing = await runner
        .select()
        .from(schema.systemEvents)
        .where(and(...whereConditions))
        .orderBy(desc(schema.systemEvents.createdAt))
        .limit(1)
        .get();

      if (existing && String(existing.errorCode || '') === String(row.errorCode || '')) {
        const existingMetadata = parseJson(existing.metadata, {});
        const occurrences = Number(existingMetadata?.occurrences || 1) + 1;
        // When deduping, keep the latest operational context by merging incoming metadata.
        // This prevents stale table/session/request ids from sticking to the row.
        const incomingMetadata = parseJson(row.metadata, {});
        const updatedMetadata = {
          ...existingMetadata,
          ...incomingMetadata,
          occurrences,
          lastOccurrenceAt: row.createdAt,
          lastOccurrenceError: row.errorCode || null,
        };
        await runner.update(schema.systemEvents)
          .set({ metadata: serializeJson(updatedMetadata) })
          .where(eq(schema.systemEvents.id, existing.id))
          .run();
        return existing.id;
      }
    } catch {
      // fall back to insert
    }

    await runner.insert(schema.systemEvents).values(row).run();
    return row.id;
  };

  return {
    log: async (payload: SystemEventPayload) => {
      try {
        return await insertWith(db, payload);
      } catch (error: any) {
        console.warn('[system-events] write failed:', error?.message || error);
        return null;
      }
    },
    logWithTx: async (tx: any, payload: SystemEventPayload) => {
      try {
        return await insertWith(tx, payload);
      } catch (error: any) {
        console.warn('[system-events] tx write failed:', error?.message || error);
        return null;
      }
    },
  };
};
