/**
 * Printing System — Unit Tests
 *
 * Tests for:
 *   1.  Template engine: simple variable interpolation
 *   2.  Template engine: nested path resolution
 *   3.  Template engine: {{#if}} conditional — truthy
 *   4.  Template engine: {{#if}} conditional — falsy (block removed)
 *   5.  Template engine: {{#each}} loop rendering
 *   6.  Template engine: {{#ifnot}} inverse conditional
 *   7.  Arabic text HTML escaping
 *   8.  Invoice context builder — correct totals
 *   9.  HTML renderer — sale invoice contains required sections
 *   10. HTML renderer — thermal receipt 80mm
 *   11. HTML renderer — voucher
 *   12. ESC/POS — buildReceiptLines produces correct structure
 *   13. ESC/POS — CP1256 encoding: Arabic char maps correctly
 *   14. ESC/POS — bytes start with ESC @ (init command)
 *   15. ESC/POS — ends with cut command
 */

import assert from 'assert';
import { renderTemplate, resolvePath, escapeHtml, buildInvoiceContext, buildVoucherContext, formatValue } from '../backend/services/templateEngine';
import { renderSaleInvoiceHtml, renderVoucherHtml, renderThermalHtml } from '../backend/services/htmlRenderer';
import { buildEscPosCommands, buildReceiptLines, encodeText } from '../backend/services/escpos';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_INVOICE = {
  invoiceNumber: 'INV-2025-999',
  date:          '2025-12-31',
  type:          'sale',
  clientName:    'شركة الأمل',
  totalAmount:   1500,
  discount:      50,
  paidAmount:    1450,
  currency:      'SYP',
  exchangeRate:  15000,
  items: [
    { name: 'صابون',     qty: 3, price: 200 },
    { name: 'شامبو',     qty: 2, price: 300 },
    { name: 'معجون أسنان', qty: 5, price: 120 },
  ],
};

const SAMPLE_COMPANY = {
  name:    'شركة شامل التجارية',
  phone:   '+963 11 222 3344',
  address: 'دمشق — شارع الثورة',
  taxNo:   '987654321',
};

// ─────────────────────────────────────────────────────────────────────────────
// Template engine tests
// ─────────────────────────────────────────────────────────────────────────────

// Case 1: Simple interpolation
{
  const result = renderTemplate('مرحباً {{name}}!', { name: 'أحمد' }, false);
  assert.strictEqual(result, 'مرحباً أحمد!', 'Case 1: simple variable');
  console.log('✅ Case 1 — Simple variable interpolation');
}

// Case 2: Nested path
{
  const result = renderTemplate('{{invoice.number}}', { invoice: { number: 'INV-001' } }, false);
  assert.strictEqual(result, 'INV-001', 'Case 2: nested path');
  console.log('✅ Case 2 — Nested path resolution');
}

// Case 3: #if truthy
{
  const result = renderTemplate('{{#if show}}مرئي{{/if}}', { show: true }, false);
  assert.strictEqual(result, 'مرئي', 'Case 3: #if truthy');
  console.log('✅ Case 3 — {{#if}} truthy block');
}

// Case 4: #if falsy — block removed
{
  const result = renderTemplate('قبل{{#if show}}إخفاء{{/if}}بعد', { show: false }, false);
  assert.strictEqual(result, 'قبلبعد', 'Case 4: #if falsy removes block');
  console.log('✅ Case 4 — {{#if}} falsy → block removed');
}

// Case 5: #each loop
{
  const result = renderTemplate(
    '{{#each items}}<li>{{name}}</li>{{/each}}',
    { items: [{ name: 'صابون' }, { name: 'شامبو' }] },
    false,
  );
  assert.ok(result.includes('<li>صابون</li>'), 'Case 5: first item');
  assert.ok(result.includes('<li>شامبو</li>'), 'Case 5: second item');
  console.log('✅ Case 5 — {{#each}} loop');
}

// Case 6: #ifnot
{
  const result = renderTemplate('{{#ifnot empty}}هناك محتوى{{/ifnot}}', { empty: false }, false);
  assert.strictEqual(result, 'هناك محتوى', 'Case 6: #ifnot with falsy value shows block');
  const result2 = renderTemplate('{{#ifnot full}}مخفي{{/ifnot}}', { full: true }, false);
  assert.strictEqual(result2, '', 'Case 6: #ifnot with truthy value hides block');
  console.log('✅ Case 6 — {{#ifnot}} inverse conditional');
}

// Case 7: HTML escaping
{
  const result = renderTemplate('{{input}}', { input: '<script>alert("xss")</script>' }, true);
  assert.ok(!result.includes('<script>'), 'Case 7: script tags escaped');
  assert.ok(result.includes('&lt;script&gt;'), 'Case 7: lt/gt encoded');
  console.log('✅ Case 7 — XSS / HTML escaping');
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice context builder
// ─────────────────────────────────────────────────────────────────────────────

// Case 8: Invoice context — totals
{
  const ctx = buildInvoiceContext({
    invoice:      SAMPLE_INVOICE,
    company:      SAMPLE_COMPANY,
    currencyLabel:'SYP',
  }) as any;

  assert.strictEqual(ctx.invoice.number,   'INV-2025-999', 'Case 8: invoice number');
  assert.strictEqual(ctx.company.name,     'شركة شامل التجارية', 'Case 8: company name');
  assert.strictEqual(ctx.invoice.discount,  50,             'Case 8: discount');
  assert.strictEqual(ctx.invoice.total,    1500,            'Case 8: total');
  assert.strictEqual(ctx.invoice.items.length, 3,          'Case 8: items count');
  assert.ok(ctx.invoice.hasDiscount === true, 'Case 8: hasDiscount flag');
  console.log('✅ Case 8 — Invoice context builder');
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML renderer tests
// ─────────────────────────────────────────────────────────────────────────────

// Case 9: Sale invoice HTML — required sections
{
  const html = renderSaleInvoiceHtml({
    invoice:      SAMPLE_INVOICE,
    company:      SAMPLE_COMPANY,
    format:       'A4',
    currencyLabel:'SYP',
    config:       { showLogo: false, showFooter: true, showSignatureLine: true, footerText: 'شكراً جزيلاً' },
  });

  assert.ok(html.includes('<!DOCTYPE html>'),         'Case 9: valid HTML doc');
  assert.ok(html.includes('dir="rtl"'),               'Case 9: RTL direction');
  assert.ok(html.includes('INV-2025-999'),             'Case 9: invoice number present');
  assert.ok(html.includes('شركة شامل التجارية'),       'Case 9: company name present');
  assert.ok(html.includes('شركة الأمل'),               'Case 9: customer name present');
  assert.ok(html.includes('فاتورة مبيعات'),            'Case 9: document title');
  assert.ok(html.includes('صابون'),                   'Case 9: item name present');
  assert.ok(html.includes('شكراً جزيلاً'),            'Case 9: custom footer text');
  assert.ok(html.includes('توقيع'),                   'Case 9: signature line');
  assert.ok(html.includes('@page'),                   'Case 9: print CSS present');
  console.log('✅ Case 9 — Sale invoice HTML renderer (A4)');
}

// Case 10: Thermal receipt HTML — 80mm
{
  const html = renderThermalHtml({
    storeName:    'متجر الأمل',
    storePhone:   '0911222333',
    invoiceNo:    'R-001',
    dateText:     '2025-12-31',
    customerName: 'أحمد محمد',
    items:        [{ name: 'تفاح', qty: 2, price: 1000 }],
    discount:     100,
    paid:         1900,
    currencyLabel:'SYP',
    format:       '80mm',
  });

  assert.ok(html.includes('متجر الأمل'), 'Case 10: store name');
  assert.ok(html.includes('R-001'),       'Case 10: receipt number');
  assert.ok(html.includes('تفاح'),        'Case 10: item name');
  assert.ok(html.includes('80mm'),        'Case 10: 80mm page size');
  assert.ok(html.includes('dir="rtl"'),   'Case 10: RTL');
  console.log('✅ Case 10 — Thermal receipt HTML (80mm)');
}

// Case 11: Voucher HTML
{
  const html = renderVoucherHtml({
    voucher: { id: 'V-001', type: 'receipt', date: '2025-12-31', amount: 500, clientName: 'سامي علي', referenceNumber: 'SND-555', cashBoxName: 'صندوق رئيسي' },
    company: SAMPLE_COMPANY,
    format:  'A5',
    currencyLabel: 'USD',
  });

  assert.ok(html.includes('سند قبض'),    'Case 11: voucher type label');
  assert.ok(html.includes('SND-555'),    'Case 11: reference number');
  assert.ok(html.includes('سامي علي'),  'Case 11: client name');
  assert.ok(html.includes('500') || html.includes('٥٠٠'), 'Case 11: amount');
  assert.ok(html.includes('148mm'),      'Case 11: A5 size');
  console.log('✅ Case 11 — Voucher HTML (A5)');
}

// ─────────────────────────────────────────────────────────────────────────────
// ESC/POS tests
// ─────────────────────────────────────────────────────────────────────────────

// Case 12: buildReceiptLines structure
{
  const lines = buildReceiptLines({
    storeName:    'متجر الاختبار',
    invoiceNo:    'T-001',
    dateText:     '2025-12-31',
    customerName: 'عميل تجريبي',
    items:        [{ name: 'منتج', qty: 1, price: 100 }],
    currencyLabel:'USD',
  });

  assert.ok(Array.isArray(lines),          'Case 12: returns array');
  assert.ok(lines.length > 5,              'Case 12: has multiple lines');
  assert.ok(lines.some(l => l.type === 'text' && l.double === true), 'Case 12: store name is double-width');
  assert.ok(lines.some(l => l.type === 'separator'), 'Case 12: has separator line');
  assert.ok(lines.some(l => l.type === 'total'),     'Case 12: has total line');
  console.log('✅ Case 12 — buildReceiptLines structure');
}

// Case 13: CP1256 encoding — Arabic char
{
  const bytes = encodeText('ب', 'CP1256'); // ب (ba) = U+0628 → CP1256 = 0xC8
  assert.strictEqual(bytes.length, 1,     'Case 13: single byte');
  assert.strictEqual(bytes[0],    0xC8,   'Case 13: ب encodes to 0xC8 in CP1256');
  console.log('✅ Case 13 — CP1256 Arabic encoding');
}

// Case 14: ESC/POS bytes start with ESC @ (init)
{
  const lines = buildReceiptLines({ storeName: 'Test', invoiceNo: 'X', dateText: '2025', customerName: '', items: [], currencyLabel: 'USD' });
  const bytes = buildEscPosCommands(lines, { paperWidth: '80mm', codepage: 'UTF8', autoCut: false });
  assert.strictEqual(bytes[0], 0x1b, 'Case 14: first byte = ESC');
  assert.strictEqual(bytes[1], 0x40, 'Case 14: second byte = @ (init)');
  console.log('✅ Case 14 — ESC/POS starts with ESC @ init');
}

// Case 15: ESC/POS with autoCut=true ends with GS V cut command
{
  const lines = buildReceiptLines({ storeName: 'CutTest', invoiceNo: '1', dateText: '2025', customerName: '', items: [], currencyLabel: 'USD' });
  const bytes = buildEscPosCommands(lines, { paperWidth: '80mm', codepage: 'UTF8', autoCut: true });
  // GS V 41 00 (0x1d 0x56 0x41 0x00)
  const last4 = Array.from(bytes.slice(-4));
  assert.deepStrictEqual(last4, [0x1d, 0x56, 0x41, 0x00], 'Case 15: ends with cut command');
  console.log('✅ Case 15 — ESC/POS ends with paper cut command');
}

console.log('\n🎯 All 15 Printing tests passed.');
