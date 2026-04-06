/**
 * One-time fix: replace corrupted Arabic (U+FFFD sequences) in thermalPrinter.ts
 * with correct Unicode Arabic text.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'printing', 'thermalPrinter.ts');
let content = fs.readFileSync(filePath, 'utf8');

const REPL = '\uFFFD'; // replacement character

// Each entry: [pattern-description, search-string, replacement-string]
// All search strings contain sequences of REPL characters matching the original corrupt glyphs.
const fixes = [
  // Line 404: فاتورة مبيعات (6 chars + space + 6 chars)
  [
    'title: فاتورة مبيعات',
    `<div class="th-center th-title">${REPL.repeat(6)} ${REPL.repeat(6)}</div>`,
    `<div class="th-center th-title">\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a</div>`,
  ],
  // Line 406 meta-label: رقم الفاتورة (8 chars with space = 3+1+8)
  [
    'label: رقم الفاتورة',
    `<span class="th-meta-label">${REPL.repeat(3)} ${REPL.repeat(8)}</span>`,
    `<span class="th-meta-label">\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629</span>`,
  ],
  // Line 407 meta-label: التاريخ (7 chars)
  [
    'label: التاريخ',
    `<span class="th-meta-label">${REPL.repeat(7)}</span>`,
    `<span class="th-meta-label">\u0627\u0644\u062a\u0627\u0631\u064a\u062e</span>`,
  ],
  // Line 408 meta-label: العميل (6 chars)
  [
    'label: العميل',
    `<span class="th-meta-label">${REPL.repeat(6)}</span>`,
    `<span class="th-meta-label">\u0627\u0644\u0639\u0645\u064a\u0644</span>`,
  ],
  // Line 408 default customer: نقدي (4 chars)
  [
    'default customer: نقدي',
    `data.customerName || '${REPL.repeat(4)}'`,
    `data.customerName || '\u0646\u0642\u062f\u064a'`,
  ],
  // Lines 412-414 items header: الكمية (6), السعر (5), الإجمالي (8)
  [
    'items-head: الكمية',
    `<span>${REPL.repeat(6)}</span>`,
    `<span>\u0627\u0644\u0643\u0645\u064a\u0629</span>`,
  ],
  [
    'items-head: السعر',
    `<span>${REPL.repeat(5)}</span>`,
    `<span>\u0627\u0644\u0633\u0639\u0631</span>`,
  ],
  [
    'items-head: الإجمالي',
    `<span>${REPL.repeat(8)}</span>`,
    `<span>\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a</span>`,
  ],
  // Line 418 total-label: المجموع (7 chars)
  [
    'total-label: المجموع',
    `<span class="th-total-label">${REPL.repeat(7)}</span>`,
    `<span class="th-total-label">\u0627\u0644\u0645\u062c\u0645\u0648\u0639</span>`,
  ],
  // Line 419 total-label in template: الخصم (5 chars)
  [
    'total-label: الخصم',
    `<span class="th-total-label">${REPL.repeat(5)}</span>`,
    `<span class="th-total-label">\u0627\u0644\u062e\u0635\u0645</span>`,
  ],
  // Line 420 total-label grand: الإجمالي (8 chars) — already matched above if unique
  // (المجموع is 7, الإجمالي is 8, they differ, so المجموع→7 and الإجمالي→8 are distinct)
  // Line 420 grand uses same as items-head: already handled by 8-char span above? No, that was <span>,
  // this uses <span class="th-total-label">. Let's handle separately:
  [
    'total-label grand: الإجمالي',
    `<span class="th-total-label">${REPL.repeat(8)}</span>`,
    `<span class="th-total-label">\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a</span>`,
  ],
  // Line 421 total-label: المدفوع (7 chars — same as المجموع)
  // After المجموع is replaced, المدفوع is next 7-char occurrence → already handled
  // But المدفوع and المجموع have same char count! We need to be more careful.
  // Actually after المجموع replacement above, the next المدفوع occurrence will be different surrounding context.
  // Let's use surrounding context for المدفوع:
  [
    'total-label المدفوع in paid template',
    `paid > 0 ? \`<div class="th-total-row"><span class="th-total-label">${REPL.repeat(7)}</span>`,
    `paid > 0 ? \`<div class="th-total-row"><span class="th-total-label">\u0627\u0644\u0645\u062f\u0641\u0648\u0639</span>`,
  ],
  // Line 422 total-label: الباقي (6 chars — same as العميل)
  // Use context to differentiate:
  [
    'total-label الباقي in change template',
    `change > 0 ? \`<div class="th-total-row"><span class="th-total-label">${REPL.repeat(6)}</span>`,
    `change > 0 ? \`<div class="th-total-row"><span class="th-total-label">\u0627\u0644\u0628\u0627\u0642\u064a</span>`,
  ],
  // Line 424 footer: شكراً لتعاملكم معنا
  [
    'footer: شكراً لتعاملكم معنا',
    `<div class="th-footer">${REPL.repeat(5)} ${REPL.repeat(8)} ${REPL.repeat(4)}</div>`,
    `<div class="th-footer">\u0634\u0643\u0631\u0627\u064b \u0644\u062a\u0639\u0627\u0645\u0644\u0643\u0645 \u0645\u0639\u0646\u0627</div>`,
  ],
];

let fixCount = 0;
for (const [desc, search, replacement] of fixes) {
  if (content.includes(search)) {
    content = content.split(search).join(replacement);
    console.log(`✅ Fixed: ${desc}`);
    fixCount++;
  } else {
    console.warn(`⚠  Not found (may already be fixed): ${desc}`);
  }
}

// Also fix the openPrintDialog margin for 80mm to prevent right-edge crop
// Change margin: 0 to margin: 0 3mm for narrow pages
const oldDialogPageRule = `                    @page {\n                        size: \${dim.width} auto;\n                        margin: 0;\n                    }`;
const newDialogPageRule = `                    @page {\n                        size: \${dim.width} auto;\n                        margin: \${isNarrow ? '0 3mm' : '0'};\n                    }`;
if (content.includes(oldDialogPageRule)) {
  content = content.replace(oldDialogPageRule, newDialogPageRule);
  console.log('✅ Fixed: openPrintDialog @page margin for narrow paper');
  fixCount++;
} else {
  console.warn('⚠  openPrintDialog @page rule not matched with exact whitespace - skipping');
}

// Change body width for 80mm from dim.width to a safer content width to prevent right crop
const oldBodyWidth = `                        width: \${dim.width};\n                        max-width: \${dim.width};`;
const newBodyWidth = `                        width: \${isNarrow ? contentWidth : dim.width};\n                        max-width: \${isNarrow ? contentWidth : dim.width};`;
if (content.includes(oldBodyWidth)) {
  content = content.replace(oldBodyWidth, newBodyWidth);
  console.log('✅ Fixed: openPrintDialog body width for narrow paper');
  fixCount++;
} else {
  console.warn('⚠  openPrintDialog body width not matched - skipping');
}

// Update THERMAL_CONTENT_WIDTH for 80mm from 74mm to 72mm for safer margins
content = content.replace(`'80mm': '74mm'`, `'80mm': '72mm'`);
console.log('✅ Fixed: THERMAL_CONTENT_WIDTH 80mm 74mm → 72mm');

fs.writeFileSync(filePath, content, 'utf8');
console.log(`\nDone. ${fixCount} fixes applied. File saved.`);
