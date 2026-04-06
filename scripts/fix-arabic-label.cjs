const fs = require('fs');
const file = 'src/printing/thermalPrinter.ts';
let c = fs.readFileSync(file, 'utf8');
const R = '\uFFFD';

// رقم الفاتورة = 12 chars but has a space = 3 + space + 8 = but we saw 8 FFFD
// Actually رقم الفاتورة = ر ق م (space) ا ل ف ا ت و ر ة = 3 + 1 space + 8 = 12 chars BUT
// the corrupted version has 8 FFFD contiguous (no space) — maybe the label was "الفاتورة" (8 chars) not "رقم الفاتورة"
// "الفاتورة" = ا ل ف ا ت و ر ة = 8 chars ✓

const old = '<span class="th-meta-label">' + R.repeat(8) + '</span>';
const newLabel = '<span class="th-meta-label">\u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629</span>'; // الفاتورة
if (c.includes(old)) {
  c = c.split(old).join(newLabel);
  console.log('Fixed: الفاتورة (8 chars)');
} else {
  console.log('Still not found with 8 chars');
}

// Fix المدفوع in paid template context
const oldPaid = 'paid > 0 ? `<div class="th-total-row"><span class="th-total-label">\u0627\u0644\u0645\u062c\u0645\u0648\u0639</span>';
const newPaid = 'paid > 0 ? `<div class="th-total-row"><span class="th-total-label">\u0627\u0644\u0645\u062f\u0641\u0648\u0639</span>';
if (c.includes(oldPaid)) {
  c = c.split(oldPaid).join(newPaid);
  console.log('Fixed: المدفوع (wrongly المجموع)');
} else {
  console.log('المدفوع context not found — checking lines:');
  const lines = c.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('paid > 0')) console.log(`L${i+1}: ${l.slice(0,120)}`);
  });
}

fs.writeFileSync(file, c, 'utf8');
console.log('Saved.');
