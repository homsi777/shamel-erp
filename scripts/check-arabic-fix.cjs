const fs = require('fs');
const file = 'src/printing/thermalPrinter.ts';
const c = fs.readFileSync(file, 'utf8');
const lines = c.split('\n');
const checkLines = [408, 409, 410, 411, 412, 413, 416, 417, 418, 422, 423, 424, 425, 426, 427, 428];
for (const i of checkLines) {
  const line = lines[i];
  if (!line) continue;
  const hasFFD = line.includes('\uFFFD');
  const preview = line.replace(/\uFFFD/g, '?').trim().slice(0, 90);
  console.log(`L${i+1} FFFD=${hasFFD}: ${preview}`);
}
