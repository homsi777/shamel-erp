/**
 * Print Service Backend — Shamel ERP
 *
 * Orchestrates:
 *   1. Template resolution (DB lookup → default built-in fallback)
 *   2. Rendering (HTML or ESC/POS based on format)
 *   3. Printer resolution (DB lookup → settings fallback)
 *   4. CRUD for print_templates and printers tables
 */

import * as net from 'net';
import { db as database } from '../db';
import * as schema from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { renderSaleInvoiceHtml, renderVoucherHtml, renderReportHtml, renderCustomTemplate, renderThermalHtml, renderKitchenThermalHtml, type InvoiceRenderParams } from './htmlRenderer';
import { buildEscPosCommands, buildReceiptLines, buildKitchenReceiptLines, escPosToBase64, type EscPosOptions } from './escpos';
import { buildInvoiceContext, buildVoucherContext, type TemplateConfig } from './templateEngine';
import { normalizeTenantId } from '../lib/tenantScope';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentType = 'pos_receipt' | 'kitchen_ticket' | 'sale_invoice' | 'purchase_invoice' | 'voucher' | 'report';
export type PrintFormat  = '58mm' | '80mm' | 'A4' | 'A5';
export type RenderOutput = 'html' | 'escpos_base64' | 'escpos_bytes';

export interface PrintRenderRequest {
  documentType: DocumentType;
  format:       PrintFormat;
  output:       RenderOutput;
  templateId?:  string;
  companyId?:   string;
  branchId?:    string;
  data:         Record<string, unknown>;
  config?:      TemplateConfig;
  codepage?:    'UTF8' | 'CP1256' | 'PC864';
}

export interface PrintRenderResult {
  html?:         string;
  escposBase64?: string;
  escposBytes?:  number[];
  format:        PrintFormat;
  templateId?:   string;
  templateName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template CRUD
// ─────────────────────────────────────────────────────────────────────────────

function newId(prefix = 'tpl') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type ScopedTenant = { companyId: string; branchId?: string | null };

export async function listTemplates(companyId?: string): Promise<any[]> {
  const db = database as any;
  const rows = await db.select().from(schema.printTemplates)
    .where(companyId ? eq(schema.printTemplates.companyId, companyId) : undefined)
    .all();
  return rows;
}

export async function getTemplate(id: string, companyId?: string | null): Promise<any | null> {
  const db = database as any;
  const [row] = await db.select().from(schema.printTemplates).where(eq(schema.printTemplates.id, id)).all();
  if (!row) return null;
  if (companyId && String(row.companyId || '').trim() !== String(companyId || '').trim()) return null;
  return row ?? null;
}

export async function getDefaultTemplate(companyId: string, templateType: string, format: string): Promise<any | null> {
  const db = database as any;
  const rows = await db.select().from(schema.printTemplates)
    .where(and(
      eq(schema.printTemplates.companyId,    companyId),
      eq(schema.printTemplates.templateType, templateType),
      eq(schema.printTemplates.format,       format),
    ))
    .all();
  // Prefer is_default=true, otherwise first match
  return rows.find((r: any) => r.isDefault) ?? rows[0] ?? null;
}

export async function createTemplate(data: {
  templateType: string; format: string; name: string;
  templateJson?: string; templateHtml?: string;
  isDefault?: boolean;
  showLogo?: boolean; showCompanyName?: boolean; showAddress?: boolean;
  showPhone?: boolean; showTaxNumber?: boolean; showQrCode?: boolean;
  showDiscount?: boolean; showTaxBreakdown?: boolean;
  showFooter?: boolean; showSignatureLine?: boolean;
  headerTitle?: string; headerSubtitle?: string; footerText?: string;
  fontSize?: string; createdBy?: string;
}, scope: ScopedTenant): Promise<string> {
  const db = database as any;
  const id = newId('tpl');
  const scopedCompanyId = normalizeTenantId(scope?.companyId);
  const scopedBranchId = normalizeTenantId(scope?.branchId) || null;
  if (!scopedCompanyId) {
    throw new Error('Company context required');
  }

  // If isDefault=true, unset existing defaults for same type+format
  if (data.isDefault) {
    await db.update(schema.printTemplates)
      .set({ isDefault: false })
      .where(and(
        eq(schema.printTemplates.companyId,    scopedCompanyId),
        eq(schema.printTemplates.templateType, data.templateType),
        eq(schema.printTemplates.format,       data.format),
      ))
      .run();
  }

  await db.insert(schema.printTemplates).values({
    id,
    companyId:        scopedCompanyId,
    branchId:         scopedBranchId,
    templateType:     data.templateType,
    format:           data.format,
    name:             data.name,
    templateJson:     data.templateJson  ?? null,
    templateHtml:     data.templateHtml  ?? null,
    isDefault:        data.isDefault     ?? false,
    showLogo:         data.showLogo      ?? true,
    showCompanyName:  data.showCompanyName ?? true,
    showAddress:      data.showAddress   ?? true,
    showPhone:        data.showPhone     ?? true,
    showTaxNumber:    data.showTaxNumber ?? false,
    showQrCode:       data.showQrCode    ?? false,
    showDiscount:     data.showDiscount  ?? true,
    showTaxBreakdown: data.showTaxBreakdown ?? false,
    showFooter:       data.showFooter    ?? true,
    showSignatureLine:data.showSignatureLine ?? false,
    headerTitle:      data.headerTitle   ?? null,
    headerSubtitle:   data.headerSubtitle ?? null,
    footerText:       data.footerText    ?? null,
    fontSize:         data.fontSize      ?? 'md',
    createdBy:        data.createdBy     ?? null,
    updatedAt:        new Date().toISOString(),
  }).run();

  return id;
}

export async function updateTemplate(id: string, data: Partial<Parameters<typeof createTemplate>[0]>): Promise<void> {
  const db = database as any;
  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const fields = ['name','templateJson','templateHtml','isDefault','showLogo','showCompanyName',
    'showAddress','showPhone','showTaxNumber','showQrCode','showDiscount','showTaxBreakdown',
    'showFooter','showSignatureLine','headerTitle','headerSubtitle','footerText','fontSize'];
  for (const f of fields) {
    if ((data as any)[f] !== undefined) update[f] = (data as any)[f];
  }
  await db.update(schema.printTemplates).set(update).where(eq(schema.printTemplates.id, id)).run();
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = database as any;
  await db.delete(schema.printTemplates).where(eq(schema.printTemplates.id, id)).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Printer CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function listPrinters(companyId?: string): Promise<any[]> {
  const db = database as any;
  const rows = await db.select().from(schema.printers)
    .where(companyId ? eq(schema.printers.companyId, companyId) : undefined)
    .all();
  return rows;
}

export async function getPrinter(id: string, companyId?: string | null): Promise<any | null> {
  const db = database as any;
  const [row] = await db.select().from(schema.printers).where(eq(schema.printers.id, id)).all();
  if (!row) return null;
  if (companyId && String(row.companyId || '').trim() !== String(companyId || '').trim()) return null;
  return row ?? null;
}

function printerHandlesDocType(p: any, documentType: string): boolean {
  const raw = String(p.documentTypes || '').trim();
  if (!raw) return true; // legacy rows: treat as all types
  const types = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
  return types.includes(documentType);
}

/**
 * Resolve default printer for a document type (e.g. pos_receipt).
 * Priority:
 * 1) Same branch + isDefault + documentTypes includes doc type
 * 2) Company-wide (no branch) + isDefault + doc type
 * 3) Any isDefault + doc type
 * 4) Company default thermal printer (type=thermal, isDefault)
 * 5) Any isDefault
 * 6) First active row
 */
export async function getDefaultPrinter(
  companyId: string,
  documentType?: string,
  branchId?: string | null,
): Promise<any | null> {
  const db = database as any;
  const rows = await db.select().from(schema.printers)
    .where(and(
      eq(schema.printers.companyId, companyId),
      eq(schema.printers.isActive,  true),
    ))
    .all();

  if (documentType) {
    if (branchId) {
      const branchHit = rows.find((p: any) =>
        String(p.branchId || '') === String(branchId) &&
        p.isDefault &&
        printerHandlesDocType(p, documentType),
      );
      if (branchHit) return branchHit;
    }

    const companyWide = rows.find((p: any) =>
      (p.branchId == null || String(p.branchId) === '') &&
      p.isDefault &&
      printerHandlesDocType(p, documentType),
    );
    if (companyWide) return companyWide;

    const anyDocDefault = rows.find((p: any) =>
      p.isDefault && printerHandlesDocType(p, documentType),
    );
    if (anyDocDefault) return anyDocDefault;
  }

  const thermalDefault = rows.find((p: any) => p.isDefault && p.type === 'thermal');
  if (thermalDefault) return thermalDefault;

  return rows.find((p: any) => p.isDefault) ?? rows[0] ?? null;
}

/**
 * Send raw ESC/POS (base64) to a network thermal printer (TCP, usually port 9100).
 */
export async function sendEscPosTcp(params: {
  host: string;
  port?: number;
  dataBase64: string;
  copies?: number;
}): Promise<void> {
  const port = params.port ?? 9100;
  const copies = Math.min(3, Math.max(1, Number(params.copies) || 1));
  const buf = Buffer.from(params.dataBase64, 'base64');
  if (!buf.length) throw new Error('Empty ESC/POS payload');

  const sendOnce = () =>
    new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: params.host, port });
      socket.setTimeout(12000);
      socket.once('error', reject);
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('TCP print timeout'));
      });
      socket.once('connect', () => {
        socket.write(buf, (err) => {
          if (err) {
            reject(err);
            return;
          }
          socket.end();
        });
      });
      socket.once('close', () => resolve());
    });

  for (let c = 0; c < copies; c++) {
    await sendOnce();
    if (c < copies - 1) await new Promise((r) => setTimeout(r, 80));
  }
}

/**
 * TCP connect-only probe (no ESC/POS payload) — settings / diagnostics.
 */
export async function probeTcpPrinterConnection(
  host: string,
  port?: number,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const p = port ?? 9100;
  if (!Number.isFinite(p) || p < 1 || p > 65535) {
    return { ok: false, code: 'EINVAL_PORT', message: 'Invalid port' };
  }
  const h = String(host || '').trim();
  if (!h) {
    return { ok: false, code: 'EINVAL_HOST', message: 'Host required' };
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host: h, port: p });
    const t = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, code: 'ETIMEDOUT', message: 'Connection timeout' });
    }, 4000);
    socket.once('connect', () => {
      clearTimeout(t);
      socket.destroy();
      resolve({ ok: true });
    });
    socket.once('error', (err: any) => {
      clearTimeout(t);
      resolve({ ok: false, code: String(err?.code || 'ERR'), message: String(err?.message || err) });
    });
  });
}

export async function createPrinter(data: {
  name: string;
  type: string; connectionType: string; address?: string;
  paperSize?: string; isDefault?: boolean; codepage?: string;
  documentTypes?: string; notes?: string;
}, scope: ScopedTenant): Promise<string> {
  const db = database as any;
  const id = newId('prt');
  const scopedCompanyId = normalizeTenantId(scope?.companyId);
  const scopedBranchId = normalizeTenantId(scope?.branchId) || null;
  if (!scopedCompanyId) {
    throw new Error('Company context required');
  }

  if (data.isDefault) {
    await db.update(schema.printers)
      .set({ isDefault: false })
      .where(eq(schema.printers.companyId, scopedCompanyId))
      .run();
  }

  await db.insert(schema.printers).values({
    id,
    companyId:     scopedCompanyId,
    branchId:      scopedBranchId,
    name:          data.name,
    type:          data.type,
    connectionType:data.connectionType,
    address:       data.address       ?? null,
    paperSize:     data.paperSize     ?? 'A4',
    isDefault:     data.isDefault     ?? false,
    isActive:      true,
    codepage:      data.codepage      ?? 'UTF8',
    documentTypes: data.documentTypes ?? null,
    notes:         data.notes         ?? null,
  }).run();

  return id;
}

export async function updatePrinter(id: string, data: Partial<Parameters<typeof createPrinter>[0]>): Promise<void> {
  const db = database as any;
  const update: Record<string, unknown> = {};
  const fields = ['name','type','connectionType','address','paperSize','isDefault','isActive','codepage','documentTypes','notes'];
  for (const f of fields) {
    if ((data as any)[f] !== undefined) update[f] = (data as any)[f];
  }
  await db.update(schema.printers).set(update).where(eq(schema.printers.id, id)).run();
}

export async function deletePrinter(id: string): Promise<void> {
  const db = database as any;
  await db.delete(schema.printers).where(eq(schema.printers.id, id)).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main render orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve template config: from DB row → into TemplateConfig shape.
 */
function templateRowToConfig(row: any): TemplateConfig {
  return {
    showLogo:          row.showLogo         ?? row.show_logo          ?? true,
    showCompanyName:   row.showCompanyName  ?? row.show_company_name  ?? true,
    showAddress:       row.showAddress      ?? row.show_address        ?? true,
    showPhone:         row.showPhone        ?? row.show_phone          ?? true,
    showTaxNumber:     row.showTaxNumber    ?? row.show_tax_number     ?? false,
    showQrCode:        row.showQrCode       ?? row.show_qr_code        ?? false,
    showDiscount:      row.showDiscount     ?? row.show_discount       ?? true,
    showTaxBreakdown:  row.showTaxBreakdown ?? row.show_tax_breakdown  ?? false,
    showFooter:        row.showFooter       ?? row.show_footer         ?? true,
    showSignatureLine: row.showSignatureLine ?? row.show_signature_line ?? false,
    headerTitle:       row.headerTitle      ?? row.header_title,
    headerSubtitle:    row.headerSubtitle   ?? row.header_subtitle,
    footerText:        row.footerText       ?? row.footer_text,
    fontSize:          row.fontSize         ?? row.font_size           ?? 'md',
    format:            row.format,
  };
}

/**
 * Core render function: resolves template, renders to requested output format.
 */
export async function renderPrintDocument(req: PrintRenderRequest): Promise<PrintRenderResult> {
  const isNarrow = req.format === '58mm' || req.format === '80mm';

  // ── 1. Resolve template ───────────────────────────────────────────────────
  let templateRow: any = null;
  let templateId:   string | undefined;
  let templateName: string | undefined;

  if (req.templateId) {
    templateRow = await getTemplate(req.templateId);
  } else if (req.companyId) {
    templateRow = await getDefaultTemplate(req.companyId, req.documentType, req.format);
  }

  if (templateRow) {
    templateId   = templateRow.id;
    templateName = templateRow.name;
  }

  const config: TemplateConfig = {
    ...templateRow ? templateRowToConfig(templateRow) : {},
    ...req.config,
  };

  // ── 2. Render based on document type + format ─────────────────────────────
  const d = req.data as any;

  // If template has a custom HTML override, use it
  if (templateRow?.templateHtml) {
    const ctx = d.invoice
      ? buildInvoiceContext({ invoice: d.invoice, company: d.company ?? {}, config, currencyLabel: d.currencyLabel })
      : d.voucher
        ? buildVoucherContext({ voucher: d.voucher, company: d.company ?? {}, currencyLabel: d.currencyLabel })
        : d;
    const html = renderCustomTemplate(templateRow.templateHtml, ctx, req.format, config.fontSize);
    return { html, format: req.format, templateId, templateName };
  }

  // ── Thermal (narrow) formats ──────────────────────────────────────────────
  if (isNarrow) {
    if (req.documentType === 'kitchen_ticket') {
      const inv = d.invoice;
      let rawItems: any = d.items ?? inv?.items ?? [];
      if (typeof rawItems === 'string') {
        try { rawItems = JSON.parse(rawItems); } catch { rawItems = []; }
      }
      if (!Array.isArray(rawItems)) rawItems = [];
      const kitchenData = {
        storeName:    d.storeName ?? d.company?.name ?? inv?.companyName ?? '',
        queueNumber:  String(d.queueNumber ?? inv?.queueNumber ?? inv?.queue_number ?? ''),
        invoiceNo:    d.invoiceNo ?? inv?.invoiceNumber ?? '',
        dateText:     d.dateText ?? inv?.date ?? '',
        branchName:   d.branchName ?? inv?.branchName,
        orderType:    d.orderType,
        items:        rawItems,
        footerText:   config.footerText ?? d.footerText,
      };
      if (!kitchenData.queueNumber) {
        throw new Error('kitchen_ticket requires queueNumber');
      }
      const kItems = (kitchenData.items || []).map((row: any) => ({
        name: String(row.name ?? row.itemName ?? ''),
        qty: Number(row.qty ?? row.quantity ?? 0),
        note: row.note ?? row.lineNote,
      }));

      if (req.output === 'html') {
        const html = renderKitchenThermalHtml({
          ...kitchenData,
          items: kItems,
          format: req.format as '58mm' | '80mm',
        });
        return { html, format: req.format, templateId, templateName };
      }

      const lines = buildKitchenReceiptLines({
        storeName: kitchenData.storeName,
        queueNumber: kitchenData.queueNumber,
        invoiceNo: kitchenData.invoiceNo,
        dateText: kitchenData.dateText,
        branchName: kitchenData.branchName,
        orderType: kitchenData.orderType,
        items: kItems,
        footerText: kitchenData.footerText,
      });
      const opts: EscPosOptions = {
        paperWidth: req.format as '58mm' | '80mm',
        codepage:   req.codepage ?? 'UTF8',
        autoCut:    true,
      };
      const bytes = buildEscPosCommands(lines, opts);
      if (req.output === 'escpos_base64') {
        return { escposBase64: escPosToBase64(bytes), format: req.format, templateId, templateName };
      }
      return { escposBytes: Array.from(bytes), format: req.format, templateId, templateName };
    }

    const receiptData = {
      storeName:    d.storeName    ?? d.company?.name ?? '',
      storePhone:   d.storePhone   ?? d.company?.phone ?? d.company?.phone1,
      storeAddress: d.storeAddress ?? d.company?.address,
      taxNo:        d.company?.taxNo,
      invoiceNo:    d.invoiceNo    ?? d.invoice?.invoiceNumber ?? '',
      dateText:     d.dateText     ?? d.invoice?.date ?? '',
      customerName: d.customerName ?? d.invoice?.clientName ?? '',
      items:        d.items        ?? d.invoice?.items ?? [],
      discount:     d.discount     ?? d.invoice?.discount,
      paid:         d.paid         ?? d.invoice?.paidAmount,
      currencyLabel:d.currencyLabel ?? 'USD',
      footerText:   config.footerText,
      showTaxNo:    config.showTaxNumber,
      queueNumber:  d.queueNumber ?? d.invoice?.queueNumber ?? (d.invoice as any)?.queue_number,
      cashierName:  d.cashierName ?? d.invoice?.createdByName ?? (d.invoice as any)?.created_by_name,
    };

    if (req.output === 'html') {
      const html = renderThermalHtml({ ...receiptData, format: req.format as '58mm' | '80mm' });
      return { html, format: req.format, templateId, templateName };
    }

    // ESC/POS
    const lines = buildReceiptLines(receiptData);
    const opts: EscPosOptions = {
      paperWidth: req.format as '58mm' | '80mm',
      codepage:   req.codepage ?? 'UTF8',
      autoCut:    true,
    };
    const bytes = buildEscPosCommands(lines, opts);

    if (req.output === 'escpos_base64') {
      return { escposBase64: escPosToBase64(bytes), format: req.format, templateId, templateName };
    }
    return { escposBytes: Array.from(bytes), format: req.format, templateId, templateName };
  }

  // ── A4 / A5 formats ───────────────────────────────────────────────────────
  let html = '';

  if (req.documentType === 'voucher' && d.voucher) {
    html = renderVoucherHtml({
      voucher:       d.voucher,
      company:       d.company ?? {},
      config,
      format:        req.format,
      currencyLabel: d.currencyLabel ?? 'USD',
    });
  } else if (req.documentType === 'report') {
    html = renderReportHtml({
      title:   d.title ?? 'تقرير',
      content: d.content ?? '',
      company: d.company ?? { name: '' },
      format:  req.format,
      fontSize:config.fontSize ?? 'md',
    });
  } else {
    // sale_invoice | purchase_invoice | pos_receipt (A4 version)
    const invoiceParams: InvoiceRenderParams = {
      invoice:       d.invoice ?? d,
      company:       d.company ?? {},
      config,
      format:        req.format,
      currencyLabel: d.currencyLabel ?? 'USD',
    };
    html = renderSaleInvoiceHtml(invoiceParams);
  }

  return { html, format: req.format, templateId, templateName };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default template seeder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure every company has at least one default template per document type.
 * Called during server startup.
 */
export async function ensureDefaultTemplates(companyId: string): Promise<void> {
  const types: Array<[DocumentType, PrintFormat, string]> = [
    ['pos_receipt',       '80mm', 'إيصال نقطة البيع (80mm)'],
    ['pos_receipt',       '58mm', 'إيصال نقطة البيع (58mm)'],
    ['kitchen_ticket',    '80mm', 'تذكرة مطبخ (80mm)'],
    ['kitchen_ticket',    '58mm', 'تذكرة مطبخ (58mm)'],
    ['sale_invoice',      'A4',   'فاتورة مبيعات (A4)'],
    ['sale_invoice',      'A5',   'فاتورة مبيعات (A5)'],
    ['purchase_invoice',  'A4',   'فاتورة شراء (A4)'],
    ['voucher',           'A5',   'سند مالي (A5)'],
    ['report',            'A4',   'تقرير (A4)'],
  ];

  for (const [type, fmt, name] of types) {
    const existing = await getDefaultTemplate(companyId, type, fmt);
    if (!existing) {
      await createTemplate({
        templateType: type, format: fmt, name,
        isDefault: true,
        showLogo: true, showCompanyName: true, showAddress: true, showPhone: true,
        showFooter: true, showDiscount: true,
        showSignatureLine: type === 'voucher',
        footerText: 'شكراً لتعاملكم معنا',
        fontSize: fmt.includes('mm') ? 'sm' : 'md',
      }, { companyId, branchId: null });
    }
  }
}

