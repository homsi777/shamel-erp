/**
 * Print Routes - Shamel ERP
 *
 * All template/printer/settings access is derived from the authenticated session.
 * Client-supplied companyId/branchId is ignored for tenant-owned operations.
 */

import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listPrinters,
  getPrinter,
  createPrinter,
  updatePrinter,
  deletePrinter,
  getDefaultPrinter,
  renderPrintDocument,
  ensureDefaultTemplates,
  sendEscPosTcp,
  probeTcpPrinterConnection,
  type PrintRenderRequest,
} from '../services/printServiceBackend';
import { createPrintJobRecord, listRecentPrintJobs } from '../services/printJobService';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';

export async function printRoutes(app: FastifyInstance, _ctx: RouteContext) {
  const { systemEventLogger } = _ctx as any;
  const getAuthScope = (req: any) => {
    const authContext = (req as any).authContext || {};
    return {
      companyId: String(authContext.companyId || '').trim(),
      branchId: String(authContext.branchId || '').trim() || null,
    };
  };

  app.get('/print/templates', async (req, reply) => {
    try {
      const { companyId } = getAuthScope(req);
      const data = await listTemplates(companyId);
      return reply.send({ success: true, data });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.post('/print/templates', async (req, reply) => {
    try {
      const body = req.body as any;
      const { companyId, branchId } = getAuthScope(req);
      if (!body?.templateType || !body?.format || !body?.name) {
        return reply.status(400).send({ success: false, error: 'templateType, format, and name are required' });
      }
      const id = await createTemplate({ ...body }, { companyId, branchId });
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.PRINT_TEMPLATE_SAVED,
        severity: 'info',
        sourceModule: 'print',
        action: 'template.create',
        status: 'success',
        affectedDocumentType: 'print_template',
        affectedDocumentId: id,
        metadata: {
          templateType: body.templateType,
          format: body.format,
          name: body.name,
        },
      });
      return reply.status(201).send({ success: true, data: { id } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.get('/print/templates/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const { companyId } = getAuthScope(req);
      const tpl = await getTemplate(id, companyId);
      if (!tpl) return reply.status(404).send({ success: false, error: 'Template not found' });
      return reply.send({ success: true, data: tpl });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.put('/print/templates/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const { companyId } = getAuthScope(req);
      const existing = await getTemplate(id, companyId);
      if (!existing) return reply.status(404).send({ success: false, error: 'Template not found' });
      await updateTemplate(id, req.body as any);
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.PRINT_TEMPLATE_SAVED,
        severity: 'info',
        sourceModule: 'print',
        action: 'template.update',
        status: 'success',
        affectedDocumentType: 'print_template',
        affectedDocumentId: id,
      });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.delete('/print/templates/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const { companyId } = getAuthScope(req);
      const existing = await getTemplate(id, companyId);
      if (!existing) return reply.status(404).send({ success: false, error: 'Template not found' });
      await deleteTemplate(id);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.post('/print/templates/seed-defaults', async (req, reply) => {
    try {
      const { companyId } = getAuthScope(req);
      if (!companyId) return reply.status(400).send({ success: false, error: 'Company context required' });
      await ensureDefaultTemplates(companyId);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.get('/print/printers', async (req, reply) => {
    try {
      const { companyId } = getAuthScope(req);
      const data = await listPrinters(companyId);
      return reply.send({ success: true, data });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.post('/print/printers', async (req, reply) => {
    try {
      const body = req.body as any;
      const { companyId, branchId } = getAuthScope(req);
      if (!body?.name || !body?.type || !body?.connectionType) {
        return reply.status(400).send({ success: false, error: 'name, type, and connectionType are required' });
      }
      const id = await createPrinter({ ...body }, { companyId, branchId });
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.PRINTER_SAVED,
        severity: 'info',
        sourceModule: 'print',
        action: 'printer.create',
        status: 'success',
        affectedDocumentType: 'printer',
        affectedDocumentId: id,
        metadata: {
          name: body.name,
          type: body.type,
          connectionType: body.connectionType,
        },
      });
      return reply.status(201).send({ success: true, data: { id } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.get('/print/printers/default', async (req, reply) => {
    try {
      const { companyId, branchId } = getAuthScope(req);
      const { documentType } = req.query as any;
      if (!companyId) return reply.status(400).send({ success: false, error: 'Company context required' });
      const printer = await getDefaultPrinter(companyId, documentType, branchId || undefined);
      return reply.send({ success: true, data: printer });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.post('/print/jobs', async (req, reply) => {
    try {
      const body = req.body as any;
      const { companyId, branchId } = getAuthScope(req);
      if (!body?.printType || !body?.status) {
        return reply.status(400).send({ success: false, error: 'printType and status are required' });
      }
      const pt = String(body.printType);
      if (!['customer_receipt', 'kitchen_ticket'].includes(pt)) {
        return reply.status(400).send({ success: false, error: 'Invalid printType' });
      }
      const st = String(body.status);
      if (!['pending', 'success', 'failed'].includes(st)) {
        return reply.status(400).send({ success: false, error: 'Invalid status' });
      }
      const actor = body.actor || {};
      const { id } = await createPrintJobRecord({
        companyId: companyId || null,
        branchId: branchId || null,
        invoiceId: body.invoiceId ?? null,
        invoiceNumber: body.invoiceNumber ?? null,
        printType: pt as 'customer_receipt' | 'kitchen_ticket',
        documentType: body.documentType ?? null,
        templateId: body.templateId ?? null,
        payloadSummary: body.payloadSummary ?? null,
        printerId: body.printerId ?? null,
        printerAddress: body.printerAddress ?? null,
        printerConnectionType: body.printerConnectionType ?? null,
        copies: body.copies ?? 1,
        status: st as 'pending' | 'success' | 'failed',
        errorMessage: body.errorMessage ?? null,
        source: body.source ?? null,
        createdById: body.createdById ?? actor.id ?? null,
        createdByName: body.createdByName ?? actor.name ?? null,
      });
      if (st === 'success') {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.PRINT_JOB_COMPLETED,
          severity: 'info',
          sourceModule: 'print',
          action: 'print.job',
          status: 'success',
          affectedDocumentType: body.documentType ?? null,
          affectedDocumentId: body.invoiceId ?? null,
          metadata: {
            printType: pt,
            printerId: body.printerId ?? null,
          },
        });
      } else if (st === 'failed') {
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.PRINT_JOB_FAILED,
          severity: 'error',
          sourceModule: 'print',
          action: 'print.job',
          status: 'failed',
          errorCode: 'PRINT_JOB_FAILED',
          affectedDocumentType: body.documentType ?? null,
          affectedDocumentId: body.invoiceId ?? null,
          metadata: {
            printType: pt,
            printerId: body.printerId ?? null,
            errorMessage: body.errorMessage ?? null,
          },
        });
      }
      return reply.send({ success: true, data: { id } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.get('/print/jobs', async (req, reply) => {
    try {
      const { companyId } = getAuthScope(req);
      const { limit } = req.query as any;
      const rows = await listRecentPrintJobs({
        companyId: companyId ? String(companyId) : undefined,
        limit: limit ? Number(limit) : 50,
      });
      return reply.send({ success: true, data: rows });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.post('/print/tcp/probe', async (req, reply) => {
    try {
      const body = req.body as { host?: string; port?: number };
      const result = await probeTcpPrinterConnection(String(body?.host || '').trim(), body?.port);
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.post('/print/escpos/send-tcp', async (req, reply) => {
    try {
      const body = req.body as { host?: string; port?: number; dataBase64?: string; copies?: number };
      if (!body?.host || typeof body.host !== 'string' || !body?.dataBase64) {
        return reply.status(400).send({ success: false, error: 'host and dataBase64 are required' });
      }
      await sendEscPosTcp({
        host: body.host.trim(),
        port: body.port,
        dataBase64: body.dataBase64,
        copies: body.copies,
      });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.get('/print/printers/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const { companyId } = getAuthScope(req);
      const printer = await getPrinter(id, companyId);
      if (!printer) return reply.status(404).send({ success: false, error: 'Printer not found' });
      return reply.send({ success: true, data: printer });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.put('/print/printers/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const { companyId } = getAuthScope(req);
      const existing = await getPrinter(id, companyId);
      if (!existing) return reply.status(404).send({ success: false, error: 'Printer not found' });
      await updatePrinter(id, req.body as any);
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.PRINTER_SAVED,
        severity: 'info',
        sourceModule: 'print',
        action: 'printer.update',
        status: 'success',
        affectedDocumentType: 'printer',
        affectedDocumentId: id,
      });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.delete('/print/printers/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const { companyId } = getAuthScope(req);
      const existing = await getPrinter(id, companyId);
      if (!existing) return reply.status(404).send({ success: false, error: 'Printer not found' });
      await deletePrinter(id);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.post('/print/render', async (req, reply) => {
    try {
      const body = req.body as PrintRenderRequest;
      const { companyId, branchId } = getAuthScope(req);
      if (!body?.documentType || !body?.format || !body?.output) {
        return reply.status(400).send({ success: false, error: 'documentType, format, and output are required' });
      }
      const result = await renderPrintDocument({
        ...body,
        companyId,
        branchId: branchId || undefined,
      });

      if (body.output === 'html' && result.html) {
        reply.header('Content-Type', 'text/html; charset=utf-8');
        return reply.send(result.html);
      }

      return reply.send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });

  app.post('/print/preview', async (req, reply) => {
    try {
      const { companyId, branchId } = getAuthScope(req);
      const body = {
        ...(req.body as PrintRenderRequest),
        companyId,
        branchId: branchId || undefined,
        output: 'html' as const,
      };
      if (!body?.documentType || !body?.format) {
        return reply.status(400).send({ success: false, error: 'documentType and format are required' });
      }
      const result = await renderPrintDocument(body);
      if (result.html) {
        reply.header('Content-Type', 'text/html; charset=utf-8');
        return reply.send(result.html);
      }
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: String(err?.message) });
    }
  });
}
