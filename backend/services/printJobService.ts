/**
 * Persist print job audit rows + optional invoice printed_at timestamps.
 */
import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';

export type PrintJobClientPayload = {
  companyId?: string | null;
  branchId?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  /** customer_receipt | kitchen_ticket */
  printType: 'customer_receipt' | 'kitchen_ticket';
  /** pos_receipt | kitchen_ticket */
  documentType?: string | null;
  templateId?: string | null;
  payloadSummary?: string | null;
  printerId?: string | null;
  printerAddress?: string | null;
  printerConnectionType?: string | null;
  copies?: number | null;
  status: 'pending' | 'success' | 'failed';
  errorMessage?: string | null;
  source?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
};

function newJobId() {
  return `pj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function truncateErr(msg: string | null | undefined, max = 1800) {
  if (!msg) return null;
  const s = String(msg);
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

let printJobsSchemaAutoFixed = false;
export const ensurePrintJobsAuditColumnsOnce = () => {
  if (printJobsSchemaAutoFixed) return;
  const raw = (db as any)?.$client;
  if (!raw?.prepare) return;
  const addColumn = (name: string, typeDef: string) => {
    try {
      raw.prepare(`ALTER TABLE print_jobs ADD COLUMN ${name} ${typeDef}`).run();
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (!msg.includes('duplicate column name') && !msg.includes('already exists')) {
        throw err;
      }
    }
  };
  addColumn('document_type', 'TEXT');
  addColumn('template_id', 'TEXT');
  addColumn('payload_summary', 'TEXT');
  addColumn('printer_address', 'TEXT');
  addColumn('printer_connection_type', 'TEXT');
  addColumn('invoice_number', 'TEXT');
  addColumn('printed_at', 'TEXT');
  addColumn('source', 'TEXT');
  addColumn('created_by_id', 'TEXT');
  addColumn('created_by_name', 'TEXT');
  printJobsSchemaAutoFixed = true;
};

/**
 * Inserts one print_jobs row (each attempt is a new row; never update in place for retries).
 * On success with invoiceId, sets customer_printed_at or kitchen_printed_at (independent).
 */
export async function createPrintJobRecord(payload: PrintJobClientPayload): Promise<{ id: string }> {
  const id = newJobId();
  const now = new Date().toISOString();
  const copies = Math.min(3, Math.max(1, Number(payload.copies ?? 1) || 1));
  const status = payload.status;
  const printedAt = status === 'success' ? now : null;

  const insertRow = () =>
    db.insert(schema.printJobs).values({
      id,
      companyId: payload.companyId ?? null,
      branchId: payload.branchId ?? null,
      invoiceId: payload.invoiceId ?? null,
      invoiceNumber: payload.invoiceNumber ?? null,
      printType: payload.printType,
      documentType: payload.documentType ?? null,
      templateId: payload.templateId ?? null,
      payloadSummary: payload.payloadSummary ?? null,
      printerId: payload.printerId ?? null,
      printerAddress: payload.printerAddress ?? null,
      printerConnectionType: payload.printerConnectionType ?? null,
      copies,
      status,
      errorMessage: truncateErr(payload.errorMessage),
      createdAt: now,
      printedAt,
      source: payload.source ?? null,
      createdById: payload.createdById ?? null,
      createdByName: payload.createdByName ?? null,
    }).run();

  try {
    await insertRow();
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('print_jobs') && message.includes('no column named')) {
      ensurePrintJobsAuditColumnsOnce();
      await insertRow();
    } else {
      throw error;
    }
  }

  if (payload.invoiceId && status === 'success') {
    if (payload.printType === 'customer_receipt') {
      await db
        .update(schema.invoices)
        .set({ customerPrintedAt: now })
        .where(eq(schema.invoices.id, payload.invoiceId))
        .run();
    } else if (payload.printType === 'kitchen_ticket') {
      await db
        .update(schema.invoices)
        .set({ kitchenPrintedAt: now })
        .where(eq(schema.invoices.id, payload.invoiceId))
        .run();
    }
  }

  return { id };
}

export async function listRecentPrintJobs(params: {
  companyId?: string | null;
  branchId?: string | null;
  limit?: number;
}): Promise<any[]> {
  const limit = Math.min(200, Math.max(1, Number(params.limit ?? 50) || 50));
  const companyId = params.companyId ? String(params.companyId).trim() : '';

  if (companyId) {
    return (await db
      .select()
      .from(schema.printJobs)
      .where(eq(schema.printJobs.companyId, companyId))
      .orderBy(desc(schema.printJobs.createdAt))
      .limit(limit)
      .all()) as any[];
  }

  return (await db
    .select()
    .from(schema.printJobs)
    .orderBy(desc(schema.printJobs.createdAt))
    .limit(limit)
    .all()) as any[];
}

