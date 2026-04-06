/**
 * Print Engine — Shamel ERP Frontend
 *
 * Unified client-side print orchestrator that:
 *   1. Calls backend /print/render or /print/preview
 *   2. Opens a print window (HTML → browser print dialog)
 *   3. Sends ESC/POS base64 to Bluetooth / USB printer
 *   4. Triggers PDF export via browser print-to-PDF
 *   5. Falls back to existing thermalPrinter.ts for offline/Cordova
 *
 * All public functions are async and return { success, error? }.
 */

import type { AppSettings, Invoice, PrintSettings } from '../types';
import { invoiceAmountTransaction } from './currencySemantics';
import { getCurrentBranchId, getCurrentOrgId, apiRequest, buildApiUrl, getApiBaseUrl } from './api';
import { openPrintDialog, type PaperSize } from '../printing/thermalPrinter';

export const getApiBase = () => getApiBaseUrl();

// ─────────────────────────────────────────────────────────────────────────────
// API base (matches existing pattern in api.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function apiPost(path: string, body: unknown, companyId?: string, branchId?: string): Promise<Response> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('shamel_token') : null;
  const cid = companyId || getCurrentOrgId();
  const bid = branchId || getCurrentBranchId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (cid) {
    headers['X-Company-Id'] = cid;
    headers['X-Active-Org'] = cid;
  }
  if (bid) {
    headers['X-Branch-Id'] = bid;
  }
  return fetch(buildApiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function apiGet(path: string, companyId?: string, branchId?: string): Promise<Response> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('shamel_token') : null;
  const cid = companyId || getCurrentOrgId();
  const bid = branchId || getCurrentBranchId();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (cid) {
    headers['X-Company-Id'] = cid;
    headers['X-Active-Org'] = cid;
  }
  if (bid) {
    headers['X-Branch-Id'] = bid;
  }
  return fetch(buildApiUrl(path), {
    headers,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PrintDocumentType = 'pos_receipt' | 'kitchen_ticket' | 'sale_invoice' | 'purchase_invoice' | 'voucher' | 'report';
export type PrintFormat       = '58mm' | '80mm' | 'A4' | 'A5';
export type PrintOutput       = 'html' | 'escpos_base64';

export interface PrintRequest {
  documentType:  PrintDocumentType;
  format:        PrintFormat;
  data:          Record<string, unknown>;
  templateId?:   string;
  companyId?:    string;
  output?:       PrintOutput;
  /** Bluetooth MAC or Windows printer name */
  printerId?:    string;
  printerName?:  string;
  /** Skip dialog and print immediately */
  silent?:       boolean;
}

export interface PrintResult {
  success: boolean;
  error?:  string;
}

/** POS receipt payload (matches backend thermal render + ESC/POS). */
export interface PosReceiptPayload {
  storeName: string;
  storePhone?: string;
  storeAddress?: string;
  invoiceNo: string;
  dateText: string;
  customerName: string;
  items: Array<{ name: string; qty: number; price: number }>;
  discount?: number;
  paid?: number;
  currencyLabel: string;
  queueNumber?: string;
  cashierName?: string;
}

/** Kitchen ticket — no prices (rendered server-side). */
export interface KitchenTicketPayload {
  storeName: string;
  queueNumber: string;
  invoiceNo?: string;
  dateText: string;
  branchName?: string;
  orderType?: string;
  items: Array<{ name: string; qty: number; note?: string }>;
}

export type PosPrintMode = 'silent' | 'preview' | 'disabled';

export interface PosSalePrintContext {
  receiptData: PosReceiptPayload;
  /** If set, second print job to kitchen IP (TCP). */
  kitchenTicket?: KitchenTicketPayload | null;
  companyId?: string;
  branchId?: string;
  format: '58mm' | '80mm';
  kitchenFormat?: '58mm' | '80mm';
  printSettings?: PrintSettings;
  invoiceId?: string;
  /** Display invoice number (matches receipt). */
  invoiceNumber?: string;
}

/** Server-side print_jobs row + invoice printed_at (optional). */
export interface PrintJobLogMeta {
  companyId?: string;
  branchId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  queueNumber?: string;
  payloadSummary?: string;
  templateId?: string;
  source: string;
}

function getPrintActor(): { id?: string; name?: string } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('shamel_user') : null;
    if (!raw) return {};
    const u = JSON.parse(raw);
    return { id: u?.id, name: u?.name || u?.username };
  } catch {
    return {};
  }
}

async function recordPrintJobServer(r: {
  printKind: 'customer_receipt' | 'kitchen_ticket';
  documentType: string;
  companyId?: string;
  branchId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  queueNumber?: string;
  payloadSummary?: string;
  templateId?: string;
  source: string;
  printerId?: string | null;
  printerAddress?: string | null;
  printerConnectionType?: string | null;
  copies: number;
  status: 'success' | 'failed';
  errorMessage?: string;
}): Promise<void> {
  const actor = getPrintActor();
  try {
    const res = await apiPost('/print/jobs', {
      printType: r.printKind,
      documentType: r.documentType,
      companyId: r.companyId,
      branchId: r.branchId,
      invoiceId: r.invoiceId ?? null,
      invoiceNumber: r.invoiceNumber ?? null,
      payloadSummary: r.payloadSummary ?? null,
      templateId: r.templateId ?? null,
      printerId: r.printerId ?? null,
      printerAddress: r.printerAddress ?? null,
      printerConnectionType: r.printerConnectionType ?? null,
      copies: r.copies,
      status: r.status,
      errorMessage: r.errorMessage ?? null,
      source: r.source,
      createdById: actor.id,
      createdByName: actor.name,
    }, r.companyId, r.branchId);
    if (!res.ok) console.warn('[printEngine] print job log failed', await res.text());
  } catch (e) {
    console.warn('[printEngine] print job log', e);
  }
}

let lastPosSaleContext: PosSalePrintContext | null = null;

export function setLastPosInvoiceForReprint(ctx: PosSalePrintContext | null): void {
  lastPosSaleContext = ctx;
}

export function getLastPosInvoiceForReprint(): PosSalePrintContext | null {
  return lastPosSaleContext;
}

/** Parse `192.168.1.5:9100` or `[fc00::1]:9100` → host + port (default 9100). */
export function parseNetworkPrinterAddress(address: string | null | undefined): { host: string; port: number } | null {
  if (!address || !String(address).trim()) return null;
  const s = String(address).trim();
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    if (close > 1) {
      const host = s.slice(1, close);
      const rest = s.slice(close + 1);
      const portMatch = rest.match(/^:(\d+)$/);
      const port = portMatch ? parseInt(portMatch[1], 10) : 9100;
      return { host, port };
    }
  }
  if (!s.includes(':')) {
    return { host: s, port: 9100 };
  }
  const parts = s.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { host: parts[0], port: parseInt(parts[1], 10) };
  }
  // IPv6 without brackets — fallback
  return { host: s, port: 9100 };
}

function receiptToData(r: PosReceiptPayload): Record<string, unknown> {
  return {
    storeName: r.storeName,
    storePhone: r.storePhone,
    storeAddress: r.storeAddress,
    invoiceNo: r.invoiceNo,
    dateText: r.dateText,
    customerName: r.customerName,
    items: r.items,
    discount: r.discount,
    paid: r.paid,
    currencyLabel: r.currencyLabel,
    ...(r.queueNumber ? { queueNumber: r.queueNumber } : {}),
    ...(r.cashierName ? { cashierName: r.cashierName } : {}),
  };
}

async function fetchPrinterById(id: string): Promise<any | null> {
  try {
    const res = await apiGet(`/print/printers/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const j = await res.json() as any;
    return j?.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchDefaultPosPrinter(companyId: string, branchId?: string | null): Promise<any | null> {
  try {
    const qs = new URLSearchParams({ companyId, documentType: 'pos_receipt' });
    if (branchId) qs.set('branchId', branchId);
    const res = await apiGet(`/print/printers/default?${qs}`, companyId, branchId || undefined);
    if (!res.ok) return null;
    const j = await res.json() as any;
    return j?.data ?? null;
  } catch {
    return null;
  }
}

function inferConnectionType(printer: any): string {
  const c = String(printer?.connectionType || '').toLowerCase();
  if (c) return c;
  const addr = String(printer?.address || '');
  if (/^\d{1,3}(\.\d{1,3}){3}/.test(addr)) return 'network';
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(addr)) return 'bluetooth';
  return 'windows';
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: render via backend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch HTML preview from backend and open in print window.
 */
export async function printDocument(req: PrintRequest): Promise<PrintResult> {
  try {
    const isNarrow = req.format === '58mm' || req.format === '80mm';
    const output: PrintOutput = req.output ?? (isNarrow ? 'html' : 'html');

    const renderReq = {
      documentType: req.documentType,
      format:       req.format,
      output,
      templateId:   req.templateId,
      companyId:    req.companyId,
      data:         req.data,
    };

    const res = await apiPost('/print/render', { ...renderReq, output: 'html' });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }

    const html = await res.text();

    // Open print window
    const paperSize = req.format as PaperSize;
    await openPrintDialog(html.includes('<body>') ? extractBody(html) : html, req.printerName, paperSize);

    return { success: true };
  } catch (err: any) {
    console.error('[printEngine] printDocument failed:', err);
    return { success: false, error: err?.message ?? 'Print failed' };
  }
}

/**
 * Open a preview in a new tab (no automatic print dialog).
 */
export async function previewDocument(req: Omit<PrintRequest, 'silent'>): Promise<PrintResult> {
  try {
    const res = await apiPost('/print/preview', {
      documentType: req.documentType,
      format:       req.format,
      templateId:   req.templateId,
      companyId:    req.companyId,
      data:         req.data,
      output:       'html',
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }

    const html = await res.text();
    const win  = window.open('', '_blank', 'width=900,height=700');
    if (!win) return { success: false, error: 'يرجى السماح بالنوافذ المنبثقة' };
    win.document.write(html);
    win.document.close();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Preview failed' };
  }
}

/**
 * Silent POS print — routes ESC/POS (or Electron HTML) by printer connection:
 * - network → TCP :9100 (backend relay)
 * - bluetooth → Cordova `BluetoothPrinter.printRawData` (base64)
 * - windows / usb → Electron `printToPrinter` (HTML thermal, silent — no dialog)
 *
 * Does not use the browser print dialog.
 */
export async function printEscPos(opts: {
  receiptData: PosReceiptPayload;
  companyId?: string;
  branchId?: string;
  format?: '58mm' | '80mm';
  copies?: number;
  /** Pre-resolved DB printer row (optional). */
  printer?: any | null;
  thermalSettings?: PrintSettings['thermal'];
  printSettings?: PrintSettings;
  /** When set, persists print_jobs + invoice customer_printed_at on success. */
  logMeta?: PrintJobLogMeta;
}): Promise<PrintResult> {
  const format = (opts.format ?? '80mm') as '58mm' | '80mm';
  const rest = opts.printSettings?.restaurant;
  const defaultCopies = rest?.customerReceiptCopies ?? opts.thermalSettings?.posCopies ?? 1;
  const copies = Math.min(3, Math.max(1, Number(opts.copies ?? defaultCopies) || 1));
  const data = receiptToData(opts.receiptData);
  const tpl = rest?.customerTemplateId || opts.logMeta?.templateId;

  let printer: any | null = opts.printer ?? null;
  const th = opts.thermalSettings;
  let lastSnap: { printerId: string | null; printerAddress: string | null; printerConnectionType: string } | null = null;

  const snapFrom = (p: any) => ({
    printerId: p?.id ? String(p.id) : null,
    printerAddress: p?.address != null ? String(p.address) : null,
    printerConnectionType: inferConnectionType(p),
  });

  const finalizeCustomer = async (
    success: boolean,
    err?: string,
    snap?: { printerId: string | null; printerAddress: string | null; printerConnectionType: string },
  ) => {
    if (!opts.logMeta) return;
    await recordPrintJobServer({
      printKind: 'customer_receipt',
      documentType: 'pos_receipt',
      ...opts.logMeta,
      templateId: opts.logMeta.templateId ?? tpl,
      printerId: snap?.printerId ?? null,
      printerAddress: snap?.printerAddress ?? null,
      printerConnectionType: snap?.printerConnectionType ?? null,
      copies,
      status: success ? 'success' : 'failed',
      errorMessage: err,
    });
  };

  try {
    if (!printer && opts.companyId) {
      if (th?.posPrinterId) {
        printer = await fetchPrinterById(th.posPrinterId);
      }
      if (!printer) {
        printer = await fetchDefaultPosPrinter(opts.companyId, opts.branchId);
      }
    }

    if (!printer && th?.windowsPrinterId) {
      printer = {
        connectionType: 'windows',
        address: th.windowsPrinterName || th.windowsPrinterId,
        type: 'thermal',
        paperSize: th.paperSize || '80mm',
      };
    }

    if (!printer && th?.enabled && th?.printerId) {
      printer = {
        connectionType: 'bluetooth',
        address: th.printerId,
        type: 'thermal',
        paperSize: th.paperSize || '80mm',
      };
    }

    if (!printer) {
      console.warn('[printEngine] No POS printer resolved (company / branch / settings)');
      await finalizeCustomer(false, 'NO_PRINTER');
      return { success: false, error: 'NO_PRINTER' };
    }

    lastSnap = snapFrom(printer);
    const conn = inferConnectionType(printer);
    const escposCodepage = String(printer?.codepage || (th as any)?.codepage || 'CP1256').toUpperCase();

    // ── Network (TCP JetDirect 9100) ─────────────────────────────────────
    if (conn === 'network') {
      const parsed = parseNetworkPrinterAddress(printer.address);
      if (!parsed) {
        await finalizeCustomer(false, 'عنوان شبكة غير صالح للطابعة', lastSnap);
        return { success: false, error: 'عنوان شبكة غير صالح للطابعة' };
      }

      const res = await apiPost('/print/render', {
        documentType: 'pos_receipt',
        format,
        output: 'escpos_base64',
        codepage: escposCodepage,
        companyId: opts.companyId,
        branchId: opts.branchId,
        templateId: tpl || undefined,
        data,
      });
      if (!res.ok) {
        const t = await res.text();
        await finalizeCustomer(false, t, lastSnap);
        return { success: false, error: t };
      }
      const json = await res.json() as any;
      const base64 = json?.data?.escposBase64;
      if (!base64) {
        await finalizeCustomer(false, 'No ESC/POS data', lastSnap);
        return { success: false, error: 'No ESC/POS data' };
      }

      const sendRes = await apiPost('/print/escpos/send-tcp', {
        host: parsed.host,
        port: parsed.port,
        dataBase64: base64,
        copies,
      });
      if (!sendRes.ok) {
        const t = await sendRes.text();
        await finalizeCustomer(false, t, lastSnap);
        return { success: false, error: t };
      }
      await finalizeCustomer(true, undefined, lastSnap);
      return { success: true };
    }

    // ── Bluetooth (raw ESC/POS) ─────────────────────────────────────────
    if (conn === 'bluetooth') {
      const mac = String(printer.address || printer.id || '').trim();
      if (!mac) {
        await finalizeCustomer(false, 'لا يوجد عنوان بلوتوث', lastSnap);
        return { success: false, error: 'لا يوجد عنوان بلوتوث' };
      }

      const res = await apiPost('/print/render', {
        documentType: 'pos_receipt',
        format,
        output: 'escpos_base64',
        codepage: escposCodepage,
        companyId: opts.companyId,
        branchId: opts.branchId,
        templateId: tpl || undefined,
        data,
      });
      if (!res.ok) {
        const t = await res.text();
        await finalizeCustomer(false, t, lastSnap);
        return { success: false, error: t };
      }
      const json = await res.json() as any;
      const base64 = json?.data?.escposBase64;
      if (!base64) {
        await finalizeCustomer(false, 'No ESC/POS data', lastSnap);
        return { success: false, error: 'No ESC/POS data' };
      }

      const bt = (window as any).BluetoothPrinter;
      if (!bt?.printRawData) {
        await finalizeCustomer(false, 'Bluetooth printer plugin not available', lastSnap);
        return { success: false, error: 'Bluetooth printer plugin not available' };
      }

      for (let i = 0; i < copies; i++) {
        await bt.connect({ address: mac, timeout: 12000 });
        await bt.printRawData(base64);
        await bt.disconnect();
        if (i < copies - 1) await new Promise((r) => setTimeout(r, 80));
      }
      await finalizeCustomer(true, undefined, lastSnap);
      return { success: true };
    }

    // ── Windows / USB — Electron silent (HTML thermal, driver-based) ─────
    if (conn === 'windows' || conn === 'usb') {
      const el = (window as any).electronAPI;
      const printerName = String(printer.address || printer.name || '').trim();
      if (!printerName) {
        await finalizeCustomer(false, 'اسم الطابعة غير محدد', lastSnap);
        return { success: false, error: 'اسم الطابعة غير محدد' };
      }
      if (!el?.printToPrinter) {
        await finalizeCustomer(false, 'NO_SILENT_PATH', lastSnap);
        return { success: false, error: 'NO_SILENT_PATH' };
      }

      const hres = await apiPost('/print/render', {
        documentType: 'pos_receipt',
        format,
        output: 'html',
        companyId: opts.companyId,
        branchId: opts.branchId,
        templateId: tpl || undefined,
        data,
      });
      if (!hres.ok) {
        const t = await hres.text();
        await finalizeCustomer(false, t, lastSnap);
        return { success: false, error: t };
      }
      const html = await hres.text();

      for (let i = 0; i < copies; i++) {
        const ok = await el.printToPrinter(printerName, html, format);
        if (!ok) {
          await finalizeCustomer(false, 'فشل إرسال الطباعة الصامتة', lastSnap);
          return { success: false, error: 'فشل إرسال الطباعة الصامتة' };
        }
        if (i < copies - 1) await new Promise((r) => setTimeout(r, 80));
      }
      await finalizeCustomer(true, undefined, lastSnap);
      return { success: true };
    }

    await finalizeCustomer(false, 'نوع اتصال الطابعة غير مدعوم', lastSnap);
    return { success: false, error: 'نوع اتصال الطابعة غير مدعوم' };
  } catch (err: any) {
    console.error('[printEngine] printEscPos', err);
    await finalizeCustomer(false, err?.message ?? 'ESC/POS print failed', lastSnap ?? undefined);
    return { success: false, error: err?.message ?? 'ESC/POS print failed' };
  }
}

/**
 * Kitchen ticket → TCP only (ESC/POS). Used for second printer in restaurant flow.
 */
export async function printKitchenTicketTcp(opts: {
  kitchen: NonNullable<PrintSettings['restaurant']>;
  companyId?: string;
  branchId?: string;
  kitchenTicket: KitchenTicketPayload;
  format?: '58mm' | '80mm';
  logMeta?: PrintJobLogMeta;
}): Promise<PrintResult> {
  const fmt = (opts.format ?? opts.kitchen.kitchenPaperSize ?? '80mm') as '58mm' | '80mm';
  const host = String(opts.kitchen.kitchenHost || '').trim();
  const port = Number(opts.kitchen.kitchenPort ?? 9100) || 9100;
  const copies = Math.min(3, Math.max(1, Number(opts.kitchen.kitchenCopies ?? 1) || 1));
  const tpl = opts.kitchen.kitchenTemplateId || opts.logMeta?.templateId;

  const finalizeKitchen = async (success: boolean, err?: string) => {
    if (!opts.logMeta) return;
    await recordPrintJobServer({
      printKind: 'kitchen_ticket',
      documentType: 'kitchen_ticket',
      ...opts.logMeta,
      templateId: opts.logMeta.templateId ?? tpl,
      printerId: null,
      printerAddress: host ? `${host}:${port}` : null,
      printerConnectionType: 'network',
      copies,
      status: success ? 'success' : 'failed',
      errorMessage: err,
    });
  };

  if (!host) {
    await finalizeKitchen(false, 'NO_KITCHEN_HOST');
    return { success: false, error: 'NO_KITCHEN_HOST' };
  }

  const data = {
    storeName: opts.kitchenTicket.storeName,
    queueNumber: opts.kitchenTicket.queueNumber,
    invoiceNo: opts.kitchenTicket.invoiceNo,
    dateText: opts.kitchenTicket.dateText,
    branchName: opts.kitchenTicket.branchName,
    orderType: opts.kitchenTicket.orderType,
    items: opts.kitchenTicket.items,
    company: { name: opts.kitchenTicket.storeName },
  };

  try {
    const res = await apiPost('/print/render', {
      documentType: 'kitchen_ticket',
      format: fmt,
      output: 'escpos_base64',
      companyId: opts.companyId,
      branchId: opts.branchId,
      templateId: tpl || undefined,
      data,
    });
    if (!res.ok) {
      const t = await res.text();
      await finalizeKitchen(false, t);
      return { success: false, error: t };
    }
    const json = await res.json() as any;
    const base64 = json?.data?.escposBase64;
    if (!base64) {
      await finalizeKitchen(false, 'No kitchen ESC/POS');
      return { success: false, error: 'No kitchen ESC/POS' };
    }

    const sendRes = await apiPost('/print/escpos/send-tcp', {
      host,
      port,
      dataBase64: base64,
      copies,
    });
    if (!sendRes.ok) {
      const t = await sendRes.text();
      await finalizeKitchen(false, t);
      return { success: false, error: t };
    }
    await finalizeKitchen(true);
    return { success: true };
  } catch (e: any) {
    console.error('[printEngine] printKitchenTicketTcp', e);
    await finalizeKitchen(false, e?.message ?? 'Kitchen print failed');
    return { success: false, error: e?.message ?? 'Kitchen print failed' };
  }
}

/**
 * After-sale hook: customer receipt + optional kitchen TCP. Kitchen failure does not fail customer.
 */
export async function onPosSaleCompletedPrint(ctx: PosSalePrintContext): Promise<PrintResult> {
  const th = ctx.printSettings?.thermal;
  const mode: PosPrintMode = th?.posPrintMode ?? 'silent';
  const auto = th?.posAutoPrintAfterSale ?? th?.autoPrintPos ?? true;
  if (!auto) return { success: true };
  if (mode === 'disabled') return { success: true };

  if (mode === 'preview') {
    const r = await previewDocument({
      documentType: 'pos_receipt',
      format: ctx.format,
      companyId: ctx.companyId,
      data: receiptToData(ctx.receiptData),
    });
    if (ctx.kitchenTicket && ctx.printSettings?.restaurant?.kitchenEnabled) {
      void previewDocument({
        documentType: 'kitchen_ticket',
        format: ctx.kitchenFormat ?? '80mm',
        companyId: ctx.companyId,
        data: {
          storeName: ctx.kitchenTicket.storeName,
          queueNumber: ctx.kitchenTicket.queueNumber,
          invoiceNo: ctx.kitchenTicket.invoiceNo,
          dateText: ctx.kitchenTicket.dateText,
          branchName: ctx.kitchenTicket.branchName,
          orderType: ctx.kitchenTicket.orderType,
          items: ctx.kitchenTicket.items,
          company: { name: ctx.kitchenTicket.storeName },
        },
      }).catch(() => {});
    }
    return r;
  }

  const invNo = ctx.invoiceNumber ?? ctx.receiptData.invoiceNo;
  const baseLog: PrintJobLogMeta = {
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    invoiceId: ctx.invoiceId,
    invoiceNumber: invNo,
    queueNumber: ctx.receiptData.queueNumber,
    payloadSummary: `inv:${invNo}|q:${ctx.receiptData.queueNumber ?? '-'}`,
    source: 'pos_auto',
  };

  const customer = await printEscPos({
    receiptData: ctx.receiptData,
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    format: ctx.format,
    thermalSettings: th,
    printSettings: ctx.printSettings,
    logMeta: {
      ...baseLog,
      templateId: ctx.printSettings?.restaurant?.customerTemplateId,
      source: 'pos_auto',
    },
  });

  const rset = ctx.printSettings?.restaurant;
  if (
    customer.success &&
    rset?.kitchenEnabled &&
    rset.kitchenAutoPrint !== false &&
    ctx.kitchenTicket &&
    String(rset.kitchenHost || '').trim()
  ) {
    const kr = await printKitchenTicketTcp({
      kitchen: rset,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      kitchenTicket: ctx.kitchenTicket,
      format: ctx.kitchenFormat,
      logMeta: {
        ...baseLog,
        queueNumber: ctx.kitchenTicket.queueNumber,
        payloadSummary: `inv:${invNo}|q:${ctx.kitchenTicket.queueNumber}|kitchen`,
        templateId: rset.kitchenTemplateId,
        source: 'pos_auto',
      },
    });
    if (!kr.success) {
      console.warn('[printEngine] Kitchen print failed (non-blocking)', kr.error);
    }
  }

  return customer;
}

/** Reprint last POS receipt stored via `setLastPosInvoiceForReprint`. */
export async function reprintLastInvoice(): Promise<PrintResult> {
  if (!lastPosSaleContext) {
    return { success: false, error: 'لا توجد فاتورة سابقة للطباعة' };
  }
  const ctx = lastPosSaleContext;
  const th = ctx.printSettings?.thermal;
  const invNo = ctx.invoiceNumber ?? ctx.receiptData.invoiceNo;
  const logMeta: PrintJobLogMeta = {
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    invoiceId: ctx.invoiceId,
    invoiceNumber: invNo,
    queueNumber: ctx.receiptData.queueNumber,
    payloadSummary: `reprint|inv:${invNo}|q:${ctx.receiptData.queueNumber ?? '-'}`,
    templateId: ctx.printSettings?.restaurant?.customerTemplateId,
    source: 'pos_reprint_customer',
  };
  return printEscPos({
    receiptData: ctx.receiptData,
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    format: ctx.format,
    thermalSettings: {
      ...(th || {}),
      enabled: th?.enabled ?? false,
      printerId: th?.printerId ?? '',
      paperSize: th?.paperSize ?? '80mm',
      autoPrintPos: true,
      posPrintMode: 'silent',
      posAutoPrintAfterSale: true,
    },
    printSettings: ctx.printSettings,
    logMeta,
  });
}

export async function reprintLastKitchenTicket(): Promise<PrintResult> {
  if (!lastPosSaleContext?.kitchenTicket) {
    return { success: false, error: 'لا توجد تذكرة مطبخ سابقة' };
  }
  const ctx = lastPosSaleContext;
  const kt: KitchenTicketPayload = ctx.kitchenTicket as KitchenTicketPayload;
  const r = ctx.printSettings?.restaurant;
  if (!r?.kitchenEnabled || !String(r.kitchenHost || '').trim()) {
    return { success: false, error: 'المطبخ غير مفعّل أو بدون عنوان' };
  }
  const invNo = ctx.invoiceNumber ?? ctx.receiptData.invoiceNo;
  const logMeta: PrintJobLogMeta = {
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    invoiceId: ctx.invoiceId,
    invoiceNumber: invNo,
    queueNumber: kt.queueNumber,
    payloadSummary: `reprint|inv:${invNo}|q:${kt.queueNumber}|kitchen`,
    templateId: r.kitchenTemplateId,
    source: 'pos_reprint_kitchen',
  };
  return printKitchenTicketTcp({
    kitchen: r,
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    kitchenTicket: kt,
    format: ctx.kitchenFormat,
    logMeta,
  });
}

export async function reprintLastBoth(): Promise<{ customer: PrintResult; kitchen: PrintResult }> {
  const customer = await reprintLastInvoice();
  const kitchen = await reprintLastKitchenTicket();
  return { customer, kitchen };
}

export function buildPosReceiptPayloadFromInvoice(inv: Invoice, appSettings: AppSettings): PosReceiptPayload {
  const items = (inv.items || []).map((i: any) => ({
    name: (i.fabricName || i.itemName || '').trim() || '—',
    qty: Number(i.quantity || 0),
    price: Number(i.unitPrice || 0),
  }));
  const q = (inv as any).queueNumber;
  const showQ = appSettings.print?.restaurant?.showQueueOnCustomer !== false;
  return {
    storeName: (appSettings.company?.name || '').trim() || 'ERP',
    storePhone: (appSettings.company?.phone1 || '').trim() || undefined,
    invoiceNo: inv.invoiceNumber,
    dateText: new Date(inv.date).toLocaleString('ar-EG'),
    customerName: inv.clientName || 'عميل نقدي',
    items,
    discount: inv.discount,
    paid: invoiceAmountTransaction(inv, 'paid'),
    currencyLabel: inv.currency || 'USD',
    ...(q && showQ ? { queueNumber: String(q) } : {}),
  };
}

export function buildKitchenTicketFromInvoice(inv: Invoice, appSettings: AppSettings): KitchenTicketPayload | null {
  const r = appSettings.print?.restaurant;
  const q = (inv as any).queueNumber;
  if (!q || !r?.kitchenEnabled) return null;
  return {
    storeName: (appSettings.company?.name || '').trim() || 'ERP',
    queueNumber: String(q),
    invoiceNo: inv.invoiceNumber,
    dateText: new Date(inv.date).toLocaleString('ar-EG'),
    branchName: inv.targetWarehouseName,
    orderType: inv.notes || undefined,
    items: (inv.items || []).map((i: any) => ({
      name: (i.fabricName || i.itemName || '').trim() || '—',
      qty: Number(i.quantity || 0),
    })),
  };
}

/**
 * Reprint thermal customer / kitchen / both from an invoice row (e.g. invoice details screen).
 * Queue number is taken from the invoice — never regenerated here.
 */
export async function reprintInvoicePosThermal(
  inv: Invoice,
  appSettings: AppSettings,
  mode: 'customer' | 'kitchen' | 'both',
): Promise<{ ok: boolean; message: string }> {
  const companyId = getCurrentOrgId() || undefined;
  const branchId = getCurrentBranchId() || undefined;
  const th = appSettings.print?.thermal;
  const paperSize = (th?.paperSize as '58mm' | '80mm') || '80mm';
  const fmt = paperSize === '58mm' ? '58mm' : '80mm';
  const qn = (inv as any).queueNumber;

  const baseMeta = (source: string, templateId?: string): PrintJobLogMeta => ({
    companyId,
    branchId,
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    queueNumber: qn ? String(qn) : undefined,
    payloadSummary: `inv:${inv.invoiceNumber}|q:${qn ?? '-'}`,
    templateId,
    source,
  });

  if (mode === 'customer' || mode === 'both') {
    const receipt = buildPosReceiptPayloadFromInvoice(inv, appSettings);
    const r = await printEscPos({
      receiptData: receipt,
      companyId,
      branchId,
      format: fmt,
      thermalSettings: th,
      printSettings: appSettings.print,
      logMeta: baseMeta('invoice_reprint_customer', appSettings.print?.restaurant?.customerTemplateId),
    });
    if (mode === 'customer') {
      return { ok: r.success, message: r.success ? 'تمت طباعة إيصال الزبون' : (r.error || 'فشلت الطباعة') };
    }
    if (!r.success) {
      return { ok: false, message: r.error || 'فشلت طباعة إيصال الزبون' };
    }
  }

  if (mode === 'kitchen' || mode === 'both') {
    const kt = buildKitchenTicketFromInvoice(inv, appSettings);
    const rset = appSettings.print?.restaurant;
    if (!kt || !rset?.kitchenEnabled || !String(rset.kitchenHost || '').trim()) {
      return { ok: false, message: 'لا يوجد دور محفوظ للفاتورة أو المطبخ غير مهيأ' };
    }
    const kr = await printKitchenTicketTcp({
      kitchen: rset,
      companyId,
      branchId,
      kitchenTicket: kt,
      format: rset.kitchenPaperSize === '58mm' ? '58mm' : '80mm',
      logMeta: baseMeta('invoice_reprint_kitchen', rset.kitchenTemplateId),
    });
    if (!kr.success) {
      return { ok: false, message: kr.error || 'فشلت طباعة المطبخ' };
    }
    if (mode === 'kitchen') {
      return { ok: true, message: 'تمت طباعة تذكرة المطبخ' };
    }
  }

  return { ok: true, message: 'تمت طباعة الإيصال وتذكرة المطبخ' };
}

export async function runTestCustomerPrintDiagnostics(appSettings: AppSettings): Promise<PrintResult> {
  const companyId = getCurrentOrgId() || undefined;
  const branchId = getCurrentBranchId() || undefined;
  const th = appSettings.print?.thermal;
  const paperSize = (th?.paperSize as '58mm' | '80mm') || '80mm';
  const fmt = paperSize === '58mm' ? '58mm' : '80mm';
  const receipt: PosReceiptPayload = {
    storeName: (appSettings.company?.name || '').trim() || 'TEST',
    invoiceNo: 'TEST',
    dateText: new Date().toLocaleString('ar-EG'),
    customerName: 'اختبار',
    items: [{ name: 'صنف تجريبي', qty: 1, price: 0 }],
    currencyLabel: 'USD',
    queueNumber: 'TEST',
  };
  return printEscPos({
    receiptData: receipt,
    companyId,
    branchId,
    format: fmt,
    thermalSettings: th,
    printSettings: appSettings.print,
    logMeta: {
      companyId,
      branchId,
      invoiceNumber: 'TEST',
      queueNumber: 'TEST',
      payloadSummary: 'diagnostic|pos_test_customer',
      source: 'settings_test_customer',
    },
  });
}

export async function runTestKitchenPrintDiagnostics(appSettings: AppSettings): Promise<PrintResult> {
  const r = appSettings.print?.restaurant;
  if (!r?.kitchenEnabled || !String(r.kitchenHost || '').trim()) {
    return { success: false, error: 'المطبخ غير مفعّل أو بدون عنوان' };
  }
  const companyId = getCurrentOrgId() || undefined;
  const branchId = getCurrentBranchId() || undefined;
  const kt: KitchenTicketPayload = {
    storeName: (appSettings.company?.name || '').trim() || 'TEST',
    queueNumber: 'TEST',
    invoiceNo: 'TEST',
    dateText: new Date().toLocaleString('ar-EG'),
    items: [{ name: 'صنف مطبخ تجريبي', qty: 1 }],
  };
  return printKitchenTicketTcp({
    kitchen: r,
    companyId,
    branchId,
    kitchenTicket: kt,
    format: r.kitchenPaperSize === '58mm' ? '58mm' : '80mm',
    logMeta: {
      companyId,
      branchId,
      invoiceNumber: 'TEST',
      queueNumber: 'TEST',
      payloadSummary: 'diagnostic|pos_test_kitchen',
      source: 'settings_test_kitchen',
    },
  });
}

export async function probeKitchenPrinterFromSettings(
  kitchenHost: string,
  kitchenPort?: number,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const res = await apiPost('/print/tcp/probe', { host: kitchenHost.trim(), port: kitchenPort });
    const j = (await res.json()) as any;
    if (!res.ok) return { ok: false, code: 'HTTP', message: j?.error || res.statusText };
    return j?.data ?? { ok: false, code: 'UNKNOWN', message: 'Bad response' };
  } catch (e: any) {
    return { ok: false, code: 'ERR', message: e?.message ?? 'probe failed' };
  }
}

/** User-facing Arabic for TCP probe / print diagnostics. */
export function arabicPrintDiagnosticMessage(
  result: { ok: true } | { ok: false; code?: string; message?: string },
): string {
  if (result.ok) return 'تم الاتصال بالطابعة بنجاح.';
  const code = String((result as any).code || '');
  const msg = String((result as any).message || '');
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return 'انتهت مهلة الاتصال — تحقق من الشبكة أو الطابعة.';
  }
  if (code === 'ECONNREFUSED') {
    return 'رفض الاتصال — تأكد من تشغيل الطابعة والمنفذ (مثلاً 9100).';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'لا يمكن الوصول للعنوان — تحقق من IP أو الشبكة.';
  }
  if (code === 'EINVAL_PORT') return 'منفذ غير صالح — يجب أن يكون بين 1 و 65535.';
  if (code === 'EINVAL_HOST') return 'عنوان الطابعة غير محدد.';
  return `فشل الاتصال: ${msg || code}`;
}

/**
 * Export document as PDF using browser print-to-PDF.
 * Opens print dialog with PDF instructions for the user.
 */
export async function exportPdf(req: Omit<PrintRequest, 'silent' | 'printerId'>): Promise<PrintResult> {
  try {
    const res = await apiPost('/print/preview', {
      documentType: req.documentType,
      format:       req.format,
      templateId:   req.templateId,
      companyId:    req.companyId,
      data:         req.data,
      output:       'html',
    });

    if (!res.ok) return { success: false, error: await res.text() };

    const html = await res.text();
    const win  = window.open('', '_blank', 'width=900,height=700');
    if (!win) return { success: false, error: 'يرجى السماح بالنوافذ المنبثقة' };

    win.document.write(html);
    win.document.close();
    win.onload = () => {
      setTimeout(() => {
        win.print();
      }, 500);
    };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'PDF export failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Template & Printer API helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTemplates(companyId?: string): Promise<any[]> {
  try {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    const res = await apiGet(`/print/templates${qs}`);
    const json = await res.json() as any;
    return json?.data ?? [];
  } catch { return []; }
}

export async function fetchPrinters(companyId?: string): Promise<any[]> {
  try {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    const res = await apiGet(`/print/printers${qs}`);
    const json = await res.json() as any;
    return json?.data ?? [];
  } catch { return []; }
}

export async function saveTemplate(data: Record<string, unknown>): Promise<{ id: string } | null> {
  try {
    const hasId = Boolean(data?.id);
    const method = hasId ? 'PUT' : 'POST';
    const endpoint = hasId ? `print/templates/${encodeURIComponent(String(data.id))}` : 'print/templates';
    const response = await apiRequest(endpoint, {
      method,
      body: JSON.stringify(data),
    });
    if (hasId) return { id: String(data.id) };
    const id = response?.data?.id ?? response?.id;
    return id ? { id: String(id) } : null;
  } catch {
    return null;
  }
}

export async function savePrinter(data: Record<string, unknown>): Promise<{ id: string } | null> {
  try {
    const hasId = Boolean(data?.id);
    const method = hasId ? 'PUT' : 'POST';
    const endpoint = hasId ? `print/printers/${encodeURIComponent(String(data.id))}` : 'print/printers';
    const response = await apiRequest(endpoint, {
      method,
      body: JSON.stringify(data),
    });
    if (hasId) return { id: String(data.id) };
    const id = response?.data?.id ?? response?.id;
    return id ? { id: String(id) } : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POS quick-print helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fast POS receipt print — wraps an invoice into a thermal receipt request.
 * Compatible with the existing printSaleInvoice() API.
 */
export async function posPrint(params: {
  storeName:    string;
  storePhone?:  string;
  storeAddress?:string;
  invoiceNo:    string;
  dateText:     string;
  customerName: string;
  items:        Array<{ name: string; qty: number; price: number }>;
  discount?:    number;
  paid?:        number;
  currencyLabel:string;
  paperSize?:   '58mm' | '80mm';
  printerName?: string;
  companyId?:   string;
  templateId?:  string;
}): Promise<PrintResult> {
  return printDocument({
    documentType: 'pos_receipt',
    format:       params.paperSize ?? '80mm',
    printerName:  params.printerName,
    companyId:    params.companyId,
    templateId:   params.templateId,
    data: {
      storeName:    params.storeName,
      storePhone:   params.storePhone,
      storeAddress: params.storeAddress,
      invoiceNo:    params.invoiceNo,
      dateText:     params.dateText,
      customerName: params.customerName,
      items:        params.items,
      discount:     params.discount,
      paid:         params.paid,
      currencyLabel:params.currencyLabel,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function extractBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : html;
}
