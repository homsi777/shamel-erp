/**
 * HTML Renderer ? A4/A5 Invoice & Document Templates
 *
 * Generates production-ready, RTL Arabic HTML for printing/PDF export.
 * Every template is self-contained (inline CSS) so it renders correctly
 * in any browser print dialog or headless PDF converter.
 *
 * Templates:
 *   - renderSaleInvoiceHtml     ? Sales invoice / POS receipt (A4 / A5)
 *   - renderPurchaseInvoiceHtml -> Purchase invoice (A4)
 *   - renderVoucherHtml         -> Receipt/Payment voucher (A5)
 *   - renderReportHtml          -> Generic report wrapper (A4)
 *   - renderCustomTemplate      -> User-defined template (template engine)
 */

import { renderTemplate, buildInvoiceContext, buildVoucherContext, type TemplateConfig, type TemplateContext } from './templateEngine';

// -----------------------------------------------------------------------------
// Shared CSS
// -----------------------------------------------------------------------------

const FONT_SIZE_MAP = { sm: '9pt', md: '10pt', lg: '12pt' };

/** Thermal: content width = paper width minus symmetric @page margins. */
function thermalContentWidthMm(format: string): string {
  /* 58/80: @page 2.5mm L+R ? usable ~53/75mm; body slightly narrower for printer tolerance */
  if (format === '58mm') return '50mm';
  if (format === '80mm') return '72mm';
  return '100%';
}

function baseCss(format: string, fontSize = 'md'): string {
  const fz = FONT_SIZE_MAP[fontSize as keyof typeof FONT_SIZE_MAP] ?? '10pt';
  const isNarrow = format === '58mm' || format === '80mm';
  const ticketWidth = thermalContentWidthMm(format);
  const pageWidth = { '58mm': '58mm', '80mm': '80mm', 'A4': '210mm', 'A5': '148mm' }[format] ?? '210mm';
  const pageHeight = isNarrow ? 'auto' : (format === 'A5' ? '210mm' : '297mm');
  /* Thermal: same margin L+R so receipt is visually centered (not shifted to one edge) */
  const pageMargin = isNarrow ? '0 2.5mm 0 2.5mm' : '10mm';

  return `
    @page { size: ${pageWidth} ${pageHeight}; margin: ${pageMargin}; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      /* Windows Arabic shaping: Segoe UI Arabic + Tahoma fallbacks */
      font-family: 'Segoe UI', 'Segoe UI Arabic', 'Tahoma', 'Arial Unicode MS', 'Simplified Arabic', 'Traditional Arabic', 'Arial', sans-serif;
      font-size: ${fz};
      direction: rtl;
      text-align: right;
      color: #1a1a1a;
      background: #fff;
      /* Use 100% so the @page margin handles safe area */
      width: 100%;
      max-width: ${isNarrow ? ticketWidth : 'none'};
      overflow-wrap: anywhere;
      /* Force Unicode / UTF-8 text rendering */
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
      font-feature-settings: "liga" 1, "kern" 1;
    }
    .page {
      width: 100%;
      max-width: ${isNarrow ? ticketWidth : pageWidth};
      margin: 0 auto;
      padding: ${isNarrow ? '1mm 0' : '0'};
    }
    .header { text-align: center; border-bottom: 2px solid #2c3e50; padding-bottom: ${isNarrow ? '4px' : '8px'}; margin-bottom: ${isNarrow ? '6px' : '10px'}; }
    .company-name { font-size: ${isNarrow ? '14pt' : '18pt'}; font-weight: bold; color: #2c3e50; }
    .company-info { font-size: ${isNarrow ? '8pt' : '9pt'}; color: #555; margin-top: 3px; }
    .logo { max-height: 60px; max-width: 120px; margin-bottom: 6px; }
    .doc-title {
      font-size: ${isNarrow ? '10.5pt' : '15pt'};
      font-weight: bold;
      text-align: center;
      background: #2c3e50;
      color: #fff;
      padding: ${isNarrow ? '3px 4px' : '8px'};
      margin: ${isNarrow ? '6px 0' : '8px 0'};
      border-radius: 3px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 12px;
      margin: 8px 0;
      font-size: ${isNarrow ? '8pt' : '9pt'};
    }
    .meta-row { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; }
    .meta-label { font-weight: bold; color: #444; }
    .meta-value { color: #111; }
    table { width: 100%; border-collapse: collapse; margin: ${isNarrow ? '4px 0' : '8px 0'}; table-layout: fixed; }
    .items-table th {
      background: #2c3e50; color: #fff;
      padding: ${isNarrow ? '2px 1px' : '6px 4px'};
      font-size: ${isNarrow ? '8pt' : '9pt'};
      border: 1px solid #bbb;
    }
    .items-table td {
      padding: ${isNarrow ? '2px 1px' : '5px 4px'};
      font-size: ${isNarrow ? '7.5pt' : '9pt'};
      border: 1px solid #ddd;
      vertical-align: middle;
      white-space: normal;
      word-break: break-word;
    }
    .items-table tr:nth-child(even) td { background: #f9f9f9; }
    .col-name  { text-align: right; }
    .col-num   { text-align: center; }
    .totals { margin-top: 8px; border-top: 2px solid #2c3e50; padding-top: 6px; }
    .total-row { display: flex; justify-content: space-between; padding: ${isNarrow ? '2px 4px' : '3px 8px'}; font-size: ${isNarrow ? '8pt' : fz}; }
    .total-grand { font-weight: bold; font-size: ${isNarrow ? '10pt' : '14pt'}; background: #2c3e50; color: #fff; border-radius: 4px; margin-top: 4px; }
    .footer { text-align: center; margin-top: ${isNarrow ? '8px' : '12px'}; padding-top: ${isNarrow ? '6px' : '8px'}; border-top: 1px dashed #aaa; font-size: ${isNarrow ? '7.5pt' : '9pt'}; color: #666; }
    .signature-area { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
    .signature-box { border-top: 1px solid #333; text-align: center; padding-top: 4px; font-size: 9pt; color: #555; }
    .qr-placeholder { text-align: center; margin-top: 8px; font-size: 8pt; color: #888; }
    @media print {
      body { background: white; margin: 0; }
      .no-print { display: none !important; }
      .page { page-break-after: always; }
    }
  `;
}

function wrapHtml(body: string, format: string, fontSize = 'md', title = '\u0645\u0633\u062a\u0646\u062f'): string {
  const isNarrow = format === '58mm' || format === '80mm';
  const narrowExtra = isNarrow ? `
    /* Thermal: fixed table layout but do not clip Arabic glyphs */
    table { table-layout: fixed; }
    td, th { overflow: visible; word-break: break-word; overflow-wrap: anywhere; }
  ` : '';
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=${isNarrow ? '300' : 'device-width'},initial-scale=1">
  <title>${title}</title>
  <style>@charset "UTF-8";${baseCss(format, fontSize)}${narrowExtra}</style>
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// Invoice items table
// -----------------------------------------------------------------------------

type PrintableInvoiceItem = {
  name: string;
  qty: number;
  price: number;
  unit?: string;
  discount?: number;
  textileColorName?: string;
  textileRollCount?: number;
  textileBaseUom?: string;
  textileDecompositionPayload?: Array<{
    sequence?: number;
    lengthValue?: number;
    length?: number;
    unit?: string;
  }> | string;
};

const escapeInlineHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeTextileDecomposition = (payload: PrintableInvoiceItem['textileDecompositionPayload']) => {
  const source = typeof payload === 'string'
    ? (() => {
        try { return JSON.parse(payload); } catch { return []; }
      })()
    : payload;
  return Array.isArray(source) ? source : [];
};

const renderTextileItemMeta = (item: PrintableInvoiceItem) => {
  const color = String(item.textileColorName || '').trim();
  const rollCount = Number(item.textileRollCount || 0);
  const baseUom = String(item.textileBaseUom || item.unit || '').trim();
  const decomposition = normalizeTextileDecomposition(item.textileDecompositionPayload);

  if (!color && !rollCount && decomposition.length === 0) return '';

  const parts: string[] = [];
  if (color) parts.push(`اللون: ${escapeInlineHtml(color)}`);
  if (rollCount > 0) parts.push(`الرولات: ${rollCount}`);
  if (decomposition.length > 0) {
    const details = decomposition
      .map((entry: any, index: number) => {
        const seq = Number(entry?.sequence || index + 1);
        const lengthValue = Number(entry?.lengthValue ?? entry?.length ?? 0);
        const unit = String(entry?.unit || baseUom || '').trim();
        if (!(lengthValue > 0)) return '';
        return `${seq}) ${lengthValue.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${unit ? ` ${escapeInlineHtml(unit)}` : ''}`;
      })
      .filter(Boolean)
      .join(' | ');
    if (details) parts.push(`تفنيد الأطوال: ${details}`);
  }

  if (!parts.length) return '';

  return `<div style="margin-top:4px;font-size:8pt;line-height:1.5;color:#4b5563">${parts.join(' | ')}</div>`;
};

function renderItemsTable(items: PrintableInvoiceItem[], currencyLabel: string): string {
  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2 });
  const rows = items.map((item, i) => {
    const total = (item.qty ?? 0) * (item.price ?? 0);
    return `<tr>
      <td class="col-num">${i + 1}</td>
      <td class="col-name">${escapeInlineHtml(item.name)}${renderTextileItemMeta(item)}</td>
      <td class="col-num">${item.qty}${item.unit ? ' ' + item.unit : ''}</td>
      <td class="col-num">${fmt(item.price)}</td>
      ${item.discount ? `<td class="col-num">${fmt(item.discount)}</td>` : ''}
      <td class="col-num" style="font-weight:600">${fmt(total)}</td>
    </tr>`;
  }).join('\n');

  const hasDiscount = items.some(i => i.discount);

  return `<table class="items-table">
    <thead>
      <tr>
        <th class="col-num" style="width:30px">#</th>
        <th class="col-name">الصنف / البيان</th>
        <th class="col-num">الكمية</th>
        <th class="col-num">سعر الوحدة (${currencyLabel})</th>
        ${hasDiscount ? '<th class="col-num">الخصم</th>' : ''}
        <th class="col-num">الإجمالي (${currencyLabel})</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// -----------------------------------------------------------------------------
// Public renderers
// -----------------------------------------------------------------------------

export interface InvoiceRenderParams {
  invoice: {
    invoiceNumber: string;
    date: string;
    type: string;
    clientName?: string;
    notes?: string;
    totalAmount: number;
    discount?: number;
    paidAmount?: number;
    remainingAmount?: number;
    exchangeRate?: number;
    currency?: string;
    items?: PrintableInvoiceItem[];
  };
  company: { name: string; phone?: string; phone1?: string; address?: string; logo?: string; taxNo?: string };
  config?: TemplateConfig;
  format?: string;
  currencyLabel?: string;
}

export function renderSaleInvoiceHtml(params: InvoiceRenderParams): string {
  const { invoice, company, config = {}, format = 'A4', currencyLabel = 'USD' } = params;
  const items  = invoice.items ?? [];
  const fmt    = (n: number) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2 });
  const subtotal  = items.reduce((s, i) => s + i.qty * i.price, 0);
  const discount  = Number(invoice.discount ?? 0);
  const total     = Number(invoice.totalAmount ?? subtotal - discount);
  const paid      = Number(invoice.paidAmount ?? 0);
  const remaining = Number(invoice.remainingAmount ?? total - paid);
  const isPurchase = String(invoice.type || '').toLowerCase().includes('purchase');

  const body = `
    <div class="header">
      ${config.showLogo && company.logo ? `<img class="logo" src="${company.logo}" alt="الشعار">` : ''}
      ${config.showCompanyName !== false ? `<div class="company-name">${company.name}</div>` : ''}
      ${config.showPhone !== false && company.phone ? `<div class="company-info">الهاتف: ${company.phone ?? company.phone1 ?? ''}</div>` : ''}
      ${config.showAddress !== false && company.address ? `<div class="company-info">${company.address}</div>` : ''}
      ${config.showTaxNumber && company.taxNo ? `<div class="company-info">الرقم الضريبي: ${company.taxNo}</div>` : ''}
      ${config.headerTitle ? `<div class="company-info" style="margin-top:4px;font-style:italic">${config.headerTitle}</div>` : ''}
    </div>

    <div class="doc-title">${isPurchase ? 'فاتورة شراء' : 'فاتورة بيع'}</div>

    <div class="meta-grid">
      <div class="meta-row"><span class="meta-label">رقم الفاتورة:</span><span class="meta-value">${invoice.invoiceNumber}</span></div>
      <div class="meta-row"><span class="meta-label">التاريخ:</span><span class="meta-value">${invoice.date}</span></div>
      <div class="meta-row"><span class="meta-label">${isPurchase ? 'المورد:' : 'العميل:'}</span><span class="meta-value">${invoice.clientName ?? ''}</span></div>
      ${invoice.currency && invoice.currency !== 'USD' ? `<div class="meta-row"><span class="meta-label">العملة / الصرف:</span><span class="meta-value">${invoice.currency} @ ${invoice.exchangeRate ?? 1}</span></div>` : ''}
    </div>

    ${renderItemsTable(items, currencyLabel)}

    <div class="totals">
      ${discount > 0 ? `
        <div class="total-row"><span>الإجمالي قبل الخصم:</span><span>${fmt(subtotal)} ${currencyLabel}</span></div>
        <div class="total-row" style="color:#c00"><span>الخصم:</span><span>- ${fmt(discount)} ${currencyLabel}</span></div>
      ` : ''}
      <div class="total-row total-grand"><span>الإجمالي:</span><span>${fmt(total)} ${currencyLabel}</span></div>
      ${paid > 0 ? `<div class="total-row"><span>المدفوع:</span><span>${fmt(paid)} ${currencyLabel}</span></div>` : ''}
      ${remaining > 0.01 ? `<div class="total-row" style="color:#b00"><span>المتبقي:</span><span>${fmt(remaining)} ${currencyLabel}</span></div>` : ''}
    </div>

    ${invoice.notes ? `<div style="margin-top:10px;font-size:9pt;color:#555;border:1px dashed #ccc;padding:6px;border-radius:4px"><strong>ملاحظات:</strong> ${invoice.notes}</div>` : ''}

    ${config.showSignatureLine ? `
    <div class="signature-area">
      <div class="signature-box">توقيع المستلم</div>
      <div class="signature-box">توقيع المحاسب</div>
    </div>` : ''}

    ${config.showQrCode ? `<div class="qr-placeholder">[ رمز QR - ${invoice.invoiceNumber} ]</div>` : ''}

    ${config.showFooter !== false ? `<div class="footer">${config.footerText ?? 'شكراً لتعاملكم معنا'}<br><small>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</small></div>` : ''}
  `;

  return wrapHtml(body, format, config.fontSize, `فاتورة ${invoice.invoiceNumber}`);
}

export function renderVoucherHtml(params: {
  voucher: { id: string; type: string; date: string; amount: number; clientName?: string; description?: string; referenceNumber?: string; currency?: string; cashBoxName?: string };
  company: { name: string; phone?: string; phone1?: string; address?: string; logo?: string };
  config?: TemplateConfig;
  format?: string;
  currencyLabel?: string;
}): string {
  const { voucher, company, config = {}, format = 'A5', currencyLabel = 'USD' } = params;
  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2 });
  const isReceipt = String(voucher.type || '').toLowerCase().includes('receipt') || String(voucher.type || '').includes('قبض');

  const body = `
    <div class="header">
      ${config.showCompanyName !== false ? `<div class="company-name">${company.name}</div>` : ''}
      ${config.showPhone !== false && (company.phone ?? company.phone1) ? `<div class="company-info">الهاتف: ${company.phone ?? company.phone1 ?? ''}</div>` : ''}
    </div>
    <div class="doc-title">${isReceipt ? 'سند قبض' : 'سند صرف'}</div>
    <div class="meta-grid" style="margin-top:12px">
      <div class="meta-row"><span class="meta-label">رقم السند:</span><span class="meta-value">${voucher.referenceNumber ?? voucher.id}</span></div>
      <div class="meta-row"><span class="meta-label">التاريخ:</span><span class="meta-value">${voucher.date}</span></div>
      <div class="meta-row"><span class="meta-label">${isReceipt ? 'استلمنا من:' : 'سلّمنا إلى:'}</span><span class="meta-value">${voucher.clientName ?? ''}</span></div>
      ${voucher.cashBoxName ? `<div class="meta-row"><span class="meta-label">الصندوق:</span><span class="meta-value">${voucher.cashBoxName}</span></div>` : ''}
    </div>
    <div style="margin:16px 0;padding:12px;border:2px solid #2c3e50;border-radius:6px;text-align:center">
      <div style="font-size:11pt;color:#555;margin-bottom:4px">المبلغ</div>
      <div style="font-size:20pt;font-weight:bold;color:#2c3e50">${fmt(voucher.amount)} ${currencyLabel}</div>
    </div>
    ${voucher.description ? `<div style="margin:8px 0"><strong>البيان:</strong> ${voucher.description}</div>` : ''}
    ${config.showSignatureLine !== false ? `
    <div class="signature-area" style="margin-top:30px">
      <div class="signature-box">توقيع ${isReceipt ? 'المستلم' : 'المسلّم'}</div>
      <div class="signature-box">توقيع المحاسب</div>
    </div>` : ''}
    ${config.showFooter !== false ? `<div class="footer"><small>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</small></div>` : ''}
  `;

  return wrapHtml(body, format, config.fontSize, `سند ${voucher.referenceNumber ?? voucher.id}`);
}

/**
 * Wrap arbitrary HTML content in a clean A4 print shell.
 * Used for reports (trial balance, statements, etc.).
 */
export function renderReportHtml(params: {
  title: string;
  content: string;
  company: { name: string };
  format?: string;
  fontSize?: string;
}): string {
  const { title, content, company, format = 'A4', fontSize = 'md' } = params;
  const body = `
    <div class="header">
      <div class="company-name">${company.name}</div>
      <div class="doc-title">${title}</div>
      <div class="company-info">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</div>
    </div>
    ${content}
  `;
  return wrapHtml(body, format, fontSize, title);
}

/**
 * Render a user-defined custom template (from DB templateHtml field).
 * Variables are resolved using the template engine.
 */
export function renderCustomTemplate(templateHtml: string, ctx: TemplateContext, format = 'A4', fontSize = 'md'): string {
  const rendered = renderTemplate(templateHtml, ctx, true);
  // If the template already has <html>, return as-is; otherwise wrap it
  if (rendered.trimStart().startsWith('<!DOCTYPE') || rendered.trimStart().startsWith('<html')) {
    return rendered;
  }
  return wrapHtml(rendered, format, fontSize);
}

/**
 * Build a complete thermal receipt HTML page (for window.print() / ESC-HTML path).
 * Matches the existing thermalPrinter.ts style but powered by the template engine.
 */
export function renderThermalHtml(params: {
  storeName: string;
  storePhone?: string;
  storeAddress?: string;
  taxNo?: string;
  invoiceNo: string;
  dateText: string;
  customerName: string;
  items: Array<PrintableInvoiceItem>;
  discount?: number;
  paid?: number;
  currencyLabel: string;
  footerText?: string;
  format?: '58mm' | '80mm';
  showTaxNo?: boolean;
  queueNumber?: string;
  cashierName?: string;
}): string {
  const { format = '80mm', ...data } = params;
  const is58 = format === '58mm';
  /* Unicode labels ? avoids mojibake if source file encoding is wrong */
  const T = {
    saleTitle: '\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a',
    taxNo: '\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0636\u0631\u064a\u0628\u064a',
    queue: '\u0627\u0644\u062f\u0648\u0631',
    invoiceNo: '\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629',
    date: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e',
    cashier: '\u0627\u0644\u0643\u0627\u0634\u064a\u0631',
    customer: '\u0627\u0644\u0639\u0645\u064a\u0644',
    /** Material / item column label in thermal invoice tables. */
    colMaterial: '\u0627\u0644\u0645\u0627\u062f\u0629',
    colQty: '\u0627\u0644\u0643\u0645\u064a\u0629',
    colPrice: '\u0627\u0644\u0633\u0639\u0631',
    colLine: '\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a',
    subtotal: '\u0627\u0644\u0645\u062c\u0645\u0648\u0639',
    discount: '\u0627\u0644\u062e\u0635\u0645',
    grand: '\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a',
    paid: '\u0627\u0644\u0645\u062f\u0641\u0648\u0639',
    change: '\u0627\u0644\u0628\u0627\u0642\u064a',
    footerDefault: '\u0634\u0643\u0631\u0627\u064b \u0644\u062a\u0639\u0627\u0645\u0644\u0643\u0645 \u0645\u0639\u0646\u0627',
  };
  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** Quantity formatting: integers without decimals, otherwise keep up to 2 decimals. */
  const fmtQty = (n: number) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return '0';
    if (Math.abs(x - Math.round(x)) < 1e-9) {
      return Math.round(x).toLocaleString('ar-EG', { useGrouping: false, maximumFractionDigits: 0 });
    }
    return x.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 6, useGrouping: false });
  };
  const escapeHtml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const subtotal = data.items.reduce((s, i) => s + i.qty * i.price, 0);
  const discount = data.discount ?? 0;
  const total = subtotal - discount;
  const paid = data.paid ?? total;
  const change = Math.max(0, paid - total);

  const ticketWidth = thermalContentWidthMm(format);
  const itemRows = data.items.map((item) => `
    <div class="th-item-row">
      <span class="th-col-name">${escapeHtml(item.name)}${renderTextileItemMeta(item).replace('font-size:8pt;line-height:1.5;color:#4b5563', 'font-size:7.3px;line-height:1.45;color:#475569')}</span>
      <span class="th-col-num"><bdi>${fmtQty(item.qty)}</bdi></span>
      <span class="th-col-num"><bdi>${fmt(item.price)}</bdi></span>
      <span class="th-col-num th-col-line"><bdi>${fmt(item.qty * item.price)}</bdi></span>
    </div>`).join('');

  const body = `
    <style>
      :root {
        --ticket-width: ${ticketWidth};
        --font-main: ${is58 ? '9px' : '10px'};
        --font-small: ${is58 ? '7.8px' : '8.6px'};
        --font-title: ${is58 ? '12.5px' : '13.5px'};
        --line-tight: 1.18;
      }
      html, body {
        width: var(--ticket-width) !important;
        max-width: var(--ticket-width) !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
      }
      * {
        box-sizing: border-box;
      }
      .page {
        width: var(--ticket-width) !important;
        max-width: var(--ticket-width) !important;
        margin: 0 auto !important;
        /* symmetric horizontal padding ? keeps block centered in the ticket strip */
        padding: 0.8mm 0.3mm 0.5mm !important;
      }
      .th-ticket {
        width: 100%;
        max-width: 100%;
        direction: rtl;
        text-align: right;
        unicode-bidi: isolate;
        color: #000;
        font-family: 'Segoe UI', 'Segoe UI Arabic', 'Tahoma', 'Arial Unicode MS', 'Simplified Arabic', sans-serif;
        font-size: var(--font-main);
        line-height: var(--line-tight);
        overflow: visible;
      }
      .th-center { text-align: center; }
      .th-store {
        font-size: var(--font-title);
        font-weight: 700;
        line-height: 1.12;
        margin: 0 0 0.5mm;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      .th-sub {
        font-size: var(--font-small);
        margin-top: 0.15mm;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      .th-title {
        margin-top: 1mm;
        font-size: var(--font-main);
        font-weight: 700;
      }
      .th-queue {
        text-align: center;
        font-size: ${is58 ? '12px' : '13px'};
        font-weight: 800;
        line-height: 1.05;
        margin: 1mm 0 0.7mm;
      }
      .th-sep {
        border-top: 1px dashed #000;
        margin: 0.9mm 0;
      }
      .th-meta-row,
      .th-total-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 2mm;
        padding: 0.45mm 0;
      }
      .th-meta-label,
      .th-total-label {
        white-space: nowrap;
        font-weight: 700;
        flex: 0 0 auto;
      }
      .th-meta-value,
      .th-total-value {
        flex: 1;
        text-align: left;
        direction: ltr;
        unicode-bidi: plaintext;
        white-space: nowrap;
        overflow: visible;
        min-width: 0;
      }
      .th-customer {
        direction: rtl;
        text-align: right;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      .th-items {
        margin-top: 0.6mm;
      }
      /* 4 columns: item | qty | price | line total */
      .th-items-head,
      .th-item-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) ${is58 ? '2.5em' : '2.75em'} ${is58 ? '2.7em' : '2.85em'} ${is58 ? '3.35em' : '3.65em'};
        column-gap: 0.55mm;
        align-items: center;
        direction: rtl;
      }
      .th-items-head {
        padding: 0 0 0.6mm;
        border-bottom: 1px solid #000;
        font-size: var(--font-small);
        font-weight: 700;
      }
      .th-items-head span {
        text-align: center;
      }
      .th-items-head .th-col-name {
        text-align: right;
        font-weight: 700;
      }
      .th-item-row {
        padding: 0.45mm 0;
        border-bottom: 1px dotted #b7b7b7;
        font-size: var(--font-main);
      }
      .th-col-name {
        text-align: right;
        font-weight: 600;
        line-height: 1.2;
        word-break: break-word;
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .th-col-num {
        text-align: center;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .th-col-num bdi {
        direction: ltr;
        unicode-bidi: isolate;
      }
      .th-col-line {
        font-weight: 800;
      }
      .th-total-row.th-grand {
        font-size: calc(var(--font-main) + 1px);
        font-weight: 800;
        border-top: 1px solid #000;
        padding-top: 1mm;
        margin-top: 0.7mm;
      }
      .th-footer {
        text-align: center;
        font-size: var(--font-small);
        margin-top: 1.2mm;
        line-height: 1.2;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
    </style>
    <div class="th-ticket">
      <div class="th-center th-store">${escapeHtml(data.storeName)}</div>
      ${data.storePhone ? `<div class="th-center th-sub">${escapeHtml(data.storePhone)}</div>` : ''}
      ${data.storeAddress ? `<div class="th-center th-sub">${escapeHtml(data.storeAddress)}</div>` : ''}
      ${data.taxNo && data.showTaxNo ? `<div class="th-center th-sub">${T.taxNo}: ${escapeHtml(data.taxNo)}</div>` : ''}
      <div class="th-center th-title">${T.saleTitle}</div>
      ${data.queueNumber ? `<div class="th-queue">${T.queue} ${escapeHtml(data.queueNumber)}</div>` : ''}
      <div class="th-sep"></div>
      <div class="th-meta-row"><span class="th-meta-label">${T.invoiceNo}</span><span class="th-meta-value"><bdi>${escapeHtml(data.invoiceNo)}</bdi></span></div>
      <div class="th-meta-row"><span class="th-meta-label">${T.date}</span><span class="th-meta-value"><bdi>${escapeHtml(data.dateText)}</bdi></span></div>
      ${data.cashierName ? `<div class="th-meta-row"><span class="th-meta-label">${T.cashier}</span><span class="th-meta-value"><bdi>${escapeHtml(data.cashierName)}</bdi></span></div>` : ''}
      ${data.customerName ? `<div class="th-meta-row"><span class="th-meta-label">${T.customer}</span><span class="th-meta-value th-customer">${escapeHtml(data.customerName)}</span></div>` : ''}
      <div class="th-sep"></div>
      <div class="th-items">
        <div class="th-items-head">
          <span class="th-col-name">${T.colMaterial}</span>
          <span>${T.colQty}</span>
          <span>${T.colPrice}</span>
          <span>${T.colLine}</span>
        </div>
        ${itemRows}
      </div>
      <div class="th-total-row"><span class="th-total-label">${T.subtotal}</span><span class="th-total-value"><bdi>${fmt(subtotal)} ${escapeHtml(data.currencyLabel)}</bdi></span></div>
      ${discount > 0 ? `<div class="th-total-row"><span class="th-total-label">${T.discount}</span><span class="th-total-value"><bdi>- ${fmt(discount)} ${escapeHtml(data.currencyLabel)}</bdi></span></div>` : ''}
      <div class="th-total-row th-grand"><span class="th-total-label">${T.grand}</span><span class="th-total-value"><bdi>${fmt(total)} ${escapeHtml(data.currencyLabel)}</bdi></span></div>
      ${paid > 0 ? `<div class="th-total-row"><span class="th-total-label">${T.paid}</span><span class="th-total-value"><bdi>${fmt(paid)} ${escapeHtml(data.currencyLabel)}</bdi></span></div>` : ''}
      ${change > 0.001 ? `<div class="th-total-row"><span class="th-total-label">${T.change}</span><span class="th-total-value"><bdi>${fmt(change)} ${escapeHtml(data.currencyLabel)}</bdi></span></div>` : ''}
      <div class="th-sep"></div>
      <div class="th-footer">${escapeHtml(data.footerText ?? T.footerDefault)}</div>
    </div>
  `;

  return wrapHtml(body, format, 'sm', T.saleTitle);
}

/**
 * Kitchen ticket HTML ? no prices (thermal width).
 */
export function renderKitchenThermalHtml(params: {
  storeName: string;
  queueNumber: string;
  invoiceNo?: string;
  dateText: string;
  branchName?: string;
  orderType?: string;
  items: Array<{ name: string; qty: number; note?: string }>;
  footerText?: string;
  format?: '58mm' | '80mm';
}): string {
  const { format = '80mm', ...data } = params;
  const rows = data.items.map((item) => `
    <tr>
      <td style="text-align:right;padding:4px 2px;font-weight:700;font-size:11pt">${item.name}</td>
      <td style="text-align:center;padding:4px 2px;font-weight:900;font-size:12pt">?${item.qty}</td>
    </tr>
    ${item.note ? `<tr><td colspan="2" style="font-size:8pt;color:#555;padding:0 2px 4px">? ${item.note}</td></tr>` : ''}
  `).join('');

  const body = `
    <div class="header">
      <div class="company-name">${data.storeName}</div>
      <div class="doc-title" style="margin-top:4px">مطبخ / تجهيز</div>
    </div>
    <div style="text-align:center;margin:10px 0;padding:10px;border:3px solid #000;border-radius:8px;background:#fafafa">
      <div style="font-size:10pt;font-weight:700">رقم الطلب</div>
      <div style="font-size:28pt;font-weight:900;line-height:1.1;letter-spacing:2px">${data.queueNumber}</div>
    </div>
    <div style="margin:3px 0;font-size:">
      ${data.invoiceNo ? `<div style="display:flex;justify-content:space-between"><span>الفاتورة:</span><span>${data.invoiceNo}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between"><span>التاريخ:</span><span>${data.dateText}</span></div>
      ${data.branchName ? `<div style="text-align:center;font-weight:700;margin-top:4px">${data.branchName}</div>` : ''}
      ${data.orderType ? `<div style="text-align:center;font-size:9pt">${data.orderType}</div>` : ''}
    </div>
    <table class="items-table" style="width:100%;margin-top:6px">
      <thead><tr>
        <th style="text-align:right">الصنف</th>
        <th style="text-align:center;width:48px">الكمية</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer" style="margin-top:10px;font-weight:700">${data.footerText ?? 'تم التجهيز'}</div>
  `;

  return wrapHtml(body, format, 'sm');
}


