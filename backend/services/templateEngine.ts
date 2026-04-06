/**
 * Template Engine — Shamel ERP Printing System
 *
 * A lightweight, Arabic-first template engine that:
 *   1. Resolves {{variable}} placeholders from a flat data context
 *   2. Evaluates {{#if condition}}...{{/if}} conditional blocks
 *   3. Renders {{#each items}}...{{/each}} loops
 *   4. Supports nested paths: {{invoice.customer.name}}
 *   5. Formats numbers and dates per Arabic locale
 *
 * Design principles:
 *   - No external dependencies (pure TypeScript)
 *   - Both HTML and text (ESC/POS) templates supported
 *   - XSS-safe for HTML output (escapes user data)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateContext = Record<string, unknown>;

export interface TemplateConfig {
  showLogo?:          boolean;
  showCompanyName?:   boolean;
  showAddress?:       boolean;
  showPhone?:         boolean;
  showTaxNumber?:     boolean;
  showQrCode?:        boolean;
  showDiscount?:      boolean;
  showTaxBreakdown?:  boolean;
  showFooter?:        boolean;
  showSignatureLine?: boolean;
  headerTitle?:       string;
  headerSubtitle?:    string;
  footerText?:        string;
  fontSize?:          'sm' | 'md' | 'lg';
  format?:            '58mm' | '80mm' | 'A4' | 'A5';
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolvers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a dot-path like "invoice.customer.name" against a context object.
 */
export function resolvePath(path: string, ctx: TemplateContext): unknown {
  return path.split('.').reduce((obj: unknown, key: string) => {
    if (obj == null) return undefined;
    return (obj as Record<string, unknown>)[key];
  }, ctx as unknown);
}

/**
 * Format a value for display.
 * Numbers → Arabic locale with 2 decimals if numeric-looking.
 * Dates  → localized Arabic date.
 * Null/undefined → empty string.
 */
export function formatValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    return value.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  return String(value);
}

/**
 * Escape HTML special characters in a string (for user-supplied data).
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Core render function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a template string with the given context.
 *
 * Supported syntax:
 *   {{variable}}              Simple value interpolation
 *   {{obj.nested.key}}        Nested path
 *   {{#if condition}}...{{/if}}       Conditional block (truthy check)
 *   {{#ifnot condition}}...{{/ifnot}} Inverse conditional
 *   {{#each items}}...{{/each}}       Loop — item is exposed as {{this.*}} or {{item.*}}
 *
 * @param template  Template string (HTML or plain text)
 * @param ctx       Data context
 * @param escape    Whether to HTML-escape interpolated values (true for HTML)
 */
export function renderTemplate(
  template: string,
  ctx: TemplateContext,
  escape = true,
): string {
  let result = template;

  // ── 1. Process {{#each items}}...{{/each}} loops ─────────────────────────
  result = result.replace(/\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, pathExpr, body) => {
    const items = resolvePath(pathExpr.trim(), ctx);
    if (!Array.isArray(items) || items.length === 0) return '';
    return items.map((item, idx) => {
      const loopCtx: TemplateContext = {
        ...ctx,
        this: item,
        item,
        index: idx,
        index1: idx + 1,
        isFirst: idx === 0,
        isLast: idx === items.length - 1,
        ...(typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}),
      };
      return renderTemplate(body, loopCtx, escape);
    }).join('');
  });

  // ── 2. Process {{#if condition}}...{{/if}} ───────────────────────────────
  result = result.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, pathExpr, body) => {
    const val = resolvePath(pathExpr.trim(), ctx);
    const truthy = val !== false && val !== null && val !== undefined && val !== '' && val !== 0;
    return truthy ? renderTemplate(body, ctx, escape) : '';
  });

  // ── 3. Process {{#ifnot condition}}...{{/ifnot}} ─────────────────────────
  result = result.replace(/\{\{#ifnot\s+([\w.]+)\}\}([\s\S]*?)\{\{\/ifnot\}\}/g, (_, pathExpr, body) => {
    const val = resolvePath(pathExpr.trim(), ctx);
    const falsy = !val || val === '' || val === 0;
    return falsy ? renderTemplate(body, ctx, escape) : '';
  });

  // ── 4. Process {{variable}} interpolations ────────────────────────────────
  result = result.replace(/\{\{([\w.]+)\}\}/g, (_, pathExpr) => {
    const val = resolvePath(pathExpr.trim(), ctx);
    const str = formatValue(val);
    return escape ? escapeHtml(str) : str;
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a standard template context from invoice + company data.
 * This is the canonical shape expected by all built-in templates.
 */
export function buildInvoiceContext(params: {
  invoice: {
    invoiceNumber: string;
    date: string;
    type: string;
    clientName?: string;
    clientId?: string;
    notes?: string;
    totalAmount: number;
    totalAmountBase?: number;
    discount?: number;
    paidAmount?: number;
    remainingAmount?: number;
    exchangeRate?: number;
    currency?: string;
    items?: Array<{
      name: string;
      qty: number;
      price: number;
      unit?: string;
      discount?: number;
    }>;
  };
  company: {
    name: string;
    phone?: string;
    phone1?: string;
    phone2?: string;
    address?: string;
    logo?: string;
    taxNo?: string;
  };
  config?: TemplateConfig;
  currencyLabel?: string;
}): TemplateContext {
  const { invoice, company, config, currencyLabel = 'USD' } = params;

  const items = (invoice.items || []).map(item => ({
    ...item,
    total: (item.qty ?? 0) * (item.price ?? 0),
    totalFormatted: ((item.qty ?? 0) * (item.price ?? 0)).toLocaleString('ar-EG', { minimumFractionDigits: 2 }),
    priceFormatted: (item.price ?? 0).toLocaleString('ar-EG', { minimumFractionDigits: 2 }),
    qtyFormatted:   String(item.qty ?? ''),
  }));

  const subtotal  = items.reduce((s, i) => s + i.total, 0);
  const discount  = Number(invoice.discount ?? 0);
  const total     = Number(invoice.totalAmount ?? subtotal - discount);
  const paid      = Number(invoice.paidAmount ?? 0);
  const remaining = Number(invoice.remainingAmount ?? total - paid);

  return {
    invoice: {
      number:      invoice.invoiceNumber,
      date:        invoice.date,
      type:        invoice.type,
      typeLabel:   invoice.type?.includes('purchase') ? 'فاتورة شراء' : 'فاتورة مبيعات',
      notes:       invoice.notes ?? '',
      currency:    invoice.currency ?? 'USD',
      exchangeRate: invoice.exchangeRate ?? 1,
      items,
      subtotal,
      subtotalFormatted: subtotal.toLocaleString('ar-EG', { minimumFractionDigits: 2 }),
      discount,
      discountFormatted: discount.toLocaleString('ar-EG', { minimumFractionDigits: 2 }),
      hasDiscount:       discount > 0,
      total,
      totalFormatted:    total.toLocaleString('ar-EG', { minimumFractionDigits: 2 }),
      paid,
      paidFormatted:     paid.toLocaleString('ar-EG', { minimumFractionDigits: 2 }),
      remaining,
      remainingFormatted: remaining.toLocaleString('ar-EG', { minimumFractionDigits: 2 }),
      hasRemaining:       remaining > 0.01,
    },
    customer: {
      name: invoice.clientName ?? '',
      id:   invoice.clientId   ?? '',
    },
    company: {
      name:    company.name,
      phone:   company.phone ?? company.phone1 ?? '',
      phone2:  company.phone2 ?? '',
      address: company.address ?? '',
      logo:    company.logo    ?? '',
      taxNo:   company.taxNo   ?? '',
    },
    currency: currencyLabel,
    config:   config ?? {},
    printDate: new Date().toLocaleDateString('ar-EG'),
    printTime: new Date().toLocaleTimeString('ar-EG'),
  };
}

/**
 * Build context for a voucher (receipt/payment).
 */
export function buildVoucherContext(params: {
  voucher: {
    id: string;
    type: string;
    date: string;
    amount: number;
    clientName?: string;
    description?: string;
    referenceNumber?: string;
    currency?: string;
    cashBoxName?: string;
  };
  company: { name: string; phone?: string; phone1?: string; address?: string };
  currencyLabel?: string;
}): TemplateContext {
  const { voucher, company, currencyLabel = 'USD' } = params;
  const isReceipt = String(voucher.type || '').toLowerCase().includes('receipt') ||
                    String(voucher.type || '').includes('قبض');
  return {
    voucher: {
      ...voucher,
      typeLabel:    isReceipt ? 'سند قبض' : 'سند صرف',
      amountFormatted: Number(voucher.amount).toLocaleString('ar-EG', { minimumFractionDigits: 2 }),
    },
    company: {
      name:    company.name,
      phone:   company.phone ?? company.phone1 ?? '',
      address: company.address ?? '',
    },
    currency:  currencyLabel,
    printDate: new Date().toLocaleDateString('ar-EG'),
    printTime: new Date().toLocaleTimeString('ar-EG'),
  };
}
