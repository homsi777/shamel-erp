/**
 * ESC/POS Command Builder — Arabic-First Thermal Printing
 *
 * Generates ESC/POS binary command sequences for thermal receipt printers.
 * Supports 58mm (32-col) and 80mm (48-col) paper widths.
 *
 * Arabic encoding strategy:
 *   1. Primary: UTF-8 (most modern thermal printers support it via ESC t 0x54)
 *   2. Fallback: CP1256 (Windows Arabic codepage — widely supported)
 *   3. Last resort: PC864 (IBM Arabic codepage — older printers)
 *
 * The output of buildEscPosCommands() is a Uint8Array that can be sent
 * directly to the printer over USB, network (port 9100), or Bluetooth.
 *
 * For browser/Cordova: convert to Base64 for BluetoothPrinter.printRawData()
 * For Electron:        write directly via node's net.Socket or serialport
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;
const CR  = 0x0d;

/** ESC/POS init command */
const CMD_INIT = [ESC, 0x40];

/** Select Arabic codepage — ESC t n */
const CMD_CODEPAGE_UTF8   = [ESC, 0x74, 0x54]; // UTF-8 (page 84)
const CMD_CODEPAGE_CP1256 = [ESC, 0x74, 0x28]; // Windows-1256 (page 40)
const CMD_CODEPAGE_PC864  = [ESC, 0x74, 0x11]; // PC864 (page 17)

/** Text align */
const CMD_ALIGN_LEFT   = [ESC, 0x61, 0x00];
const CMD_ALIGN_CENTER = [ESC, 0x61, 0x01];
const CMD_ALIGN_RIGHT  = [ESC, 0x61, 0x02];

/** Bold on/off */
const CMD_BOLD_ON  = [ESC, 0x45, 0x01];
const CMD_BOLD_OFF = [ESC, 0x45, 0x00];

/** Double width */
const CMD_DOUBLE_WIDTH_ON  = [GS, 0x21, 0x10];
const CMD_DOUBLE_WIDTH_OFF = [GS, 0x21, 0x00];

/** Double height */
const CMD_DOUBLE_HEIGHT_ON  = [GS, 0x21, 0x01];
const CMD_DOUBLE_HEIGHT_OFF = [GS, 0x21, 0x00];

/** Cut paper — full cut */
const CMD_CUT = [GS, 0x56, 0x41, 0x00];

/** Feed N lines */
const feedLines = (n: number) => [ESC, 0x64, n];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PaperWidth = '58mm' | '80mm';
export type Codepage  = 'UTF8' | 'CP1256' | 'PC864';
export type Align     = 'left' | 'center' | 'right';

export interface EscPosOptions {
  paperWidth: PaperWidth;
  codepage:   Codepage;
  autoCut:    boolean;
}

export interface ReceiptLine {
  type: 'text' | 'separator' | 'feed' | 'item' | 'total';
  text?:    string;
  align?:   Align;
  bold?:    boolean;
  double?:  boolean;
  left?:    string;
  right?:   string;
  lines?:   number;
  char?:    string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text encoding
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNS: Record<PaperWidth, number> = { '58mm': 32, '80mm': 48 };

/**
 * Encode a string to bytes for ESC/POS output.
 * For UTF-8: use TextEncoder (Node.js / browser).
 * For CP1256/PC864: use the lookup table.
 */
export function encodeText(text: string, codepage: Codepage): Uint8Array {
  if (codepage === 'UTF8') {
    return new TextEncoder().encode(text);
  }
  // CP1256 / PC864 — use fallback mapping for Arabic characters
  return cp1256Encode(text);
}

/**
 * Simple CP1256 (Windows Arabic) encoder.
 * Maps Arabic Unicode codepoints to their CP1256 byte equivalents.
 * Non-Arabic characters are encoded as ASCII (if printable) or '?'.
 */
function cp1256Encode(text: string): Uint8Array {
  const CP1256_MAP: Record<number, number> = {
    // Arabic letters (U+0600 – U+06FF)
    0x060C: 0xAC, 0x061B: 0xBB, 0x061F: 0xBF,
    0x0621: 0xC1, 0x0622: 0xC2, 0x0623: 0xC3, 0x0624: 0xC4,
    0x0625: 0xC5, 0x0626: 0xC6, 0x0627: 0xC7, 0x0628: 0xC8,
    0x0629: 0xC9, 0x062A: 0xCA, 0x062B: 0xCB, 0x062C: 0xCC,
    0x062D: 0xCD, 0x062E: 0xCE, 0x062F: 0xCF, 0x0630: 0xD0,
    0x0631: 0xD1, 0x0632: 0xD2, 0x0633: 0xD3, 0x0634: 0xD4,
    0x0635: 0xD5, 0x0636: 0xD6, 0x0637: 0xD7, 0x0638: 0xD8,
    0x0639: 0xD9, 0x063A: 0xDA, 0x0641: 0xE1, 0x0642: 0xE2,
    0x0643: 0xE3, 0x0644: 0xE4, 0x0645: 0xE5, 0x0646: 0xE6,
    0x0647: 0xE7, 0x0648: 0xE8, 0x0649: 0xE9, 0x064A: 0xEA,
    0x064B: 0xEB, 0x064C: 0xEC, 0x064D: 0xED, 0x064E: 0xEE,
    0x064F: 0xEF, 0x0650: 0xF0, 0x0651: 0xF1, 0x0652: 0xF2,
    // Common punctuation
    0x2013: 0x96, 0x2014: 0x97, 0x201C: 0x93, 0x201D: 0x94,
    0x2018: 0x91, 0x2019: 0x92,
  };

  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0x3F;
    if (cp < 128) {
      bytes.push(cp); // ASCII range — direct
    } else if (CP1256_MAP[cp] !== undefined) {
      bytes.push(CP1256_MAP[cp]);
    } else {
      bytes.push(0x3F); // '?'
    }
  }
  return new Uint8Array(bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Command helpers
// ─────────────────────────────────────────────────────────────────────────────

function concatBytes(...arrays: (number[] | Uint8Array)[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function pad(str: string, width: number, direction: 'left' | 'right' = 'right'): string {
  const s = String(str ?? '');
  if (s.length >= width) return s.slice(0, width);
  const spaces = ' '.repeat(width - s.length);
  return direction === 'right' ? s + spaces : spaces + s;
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a complete ESC/POS command sequence for a receipt.
 * Returns a Uint8Array ready to send to the printer.
 */
export function buildEscPosCommands(
  lines: ReceiptLine[],
  opts: EscPosOptions = { paperWidth: '80mm', codepage: 'UTF8', autoCut: true },
): Uint8Array {
  const cols   = COLUMNS[opts.paperWidth];
  const encode = (t: string) => encodeText(t, opts.codepage);

  const chunks: (number[] | Uint8Array)[] = [];

  // Init + codepage select
  chunks.push(CMD_INIT);
  if (opts.codepage === 'UTF8')   chunks.push(CMD_CODEPAGE_UTF8);
  if (opts.codepage === 'CP1256') chunks.push(CMD_CODEPAGE_CP1256);
  if (opts.codepage === 'PC864')  chunks.push(CMD_CODEPAGE_PC864);

  for (const line of lines) {
    switch (line.type) {
      case 'feed':
        chunks.push(feedLines(line.lines ?? 1));
        break;

      case 'separator':
        chunks.push(CMD_ALIGN_LEFT);
        chunks.push(encode((line.char ?? '-').repeat(cols)));
        chunks.push([LF]);
        break;

      case 'text': {
        const text  = line.text ?? '';
        const align = line.align ?? 'right';
        if (align === 'center') chunks.push(CMD_ALIGN_CENTER);
        else if (align === 'left') chunks.push(CMD_ALIGN_LEFT);
        else chunks.push(CMD_ALIGN_RIGHT);

        if (line.double) chunks.push(CMD_DOUBLE_WIDTH_ON);
        if (line.bold)   chunks.push(CMD_BOLD_ON);
        chunks.push(encode(text));
        chunks.push([LF]);
        if (line.bold)   chunks.push(CMD_BOLD_OFF);
        if (line.double) chunks.push(CMD_DOUBLE_WIDTH_OFF);
        break;
      }

      case 'item': {
        // Two-column row: left text + right-aligned price
        const left  = String(line.left  ?? '');
        const right = String(line.right ?? '');
        const spacer = cols - right.length;
        const leftTrunc = pad(left, spacer, 'right');
        chunks.push(CMD_ALIGN_LEFT);
        chunks.push(encode(leftTrunc + right));
        chunks.push([LF]);
        break;
      }

      case 'total': {
        // Bold two-column row
        const left  = String(line.left  ?? '');
        const right = String(line.right ?? '');
        const spacer = cols - right.length;
        const leftTrunc = pad(left, spacer, 'right');
        chunks.push(CMD_BOLD_ON);
        chunks.push(CMD_ALIGN_LEFT);
        chunks.push(encode(leftTrunc + right));
        chunks.push([LF]);
        chunks.push(CMD_BOLD_OFF);
        break;
      }
    }
  }

  // Feed before cut
  chunks.push(feedLines(4));
  if (opts.autoCut) chunks.push(CMD_CUT);

  return concatBytes(...chunks);
}

/**
 * Convert ESC/POS Uint8Array to Base64 string (for Bluetooth/Cordova plugins).
 */
export function escPosToBase64(commands: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < commands.length; i++) {
    binary += String.fromCharCode(commands[i]);
  }
  return btoa(binary);
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt layout builders
// ─────────────────────────────────────────────────────────────────────────────

export interface ThermalReceiptData {
  storeName:    string;
  storePhone?:  string;
  storeAddress?:string;
  taxNo?:       string;
  invoiceNo:    string;
  dateText:     string;
  customerName: string;
  items: Array<{ name: string; qty: number; price: number }>;
  discount?:    number;
  paid?:        number;
  currencyLabel:string;
  footerText?:  string;
  showTaxNo?:   boolean;
  /** POS queue / ticket number */
  queueNumber?: string;
  cashierName?: string;
}

/**
 * Build ReceiptLine[] from a standard receipt data object.
 * This is the SAP-style thermal receipt layout.
 */
export function buildReceiptLines(data: ThermalReceiptData): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const fmt = (n: number) => n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty = (n: number) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return '0';
    if (Math.abs(x - Math.round(x)) < 1e-9) {
      return Math.round(x).toLocaleString('ar-EG', { useGrouping: false, maximumFractionDigits: 0 });
    }
    return x.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 6, useGrouping: false });
  };

  const subtotal = data.items.reduce((s, i) => s + i.qty * i.price, 0);
  const discount = data.discount ?? 0;
  const total = subtotal - discount;
  const paid = data.paid ?? total;
  const change = Math.max(0, paid - total);

  lines.push({ type: 'text', text: data.storeName, align: 'center', bold: true, double: true });
  if (data.storePhone) lines.push({ type: 'text', text: `\u0647\u0627\u062a\u0641: ${data.storePhone}`, align: 'center' });
  if (data.storeAddress) lines.push({ type: 'text', text: data.storeAddress, align: 'center' });
  if (data.taxNo && data.showTaxNo) {
    lines.push({ type: 'text', text: `\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0636\u0631\u064a\u0628\u064a: ${data.taxNo}`, align: 'center' });
  }
  lines.push({ type: 'separator', char: '=' });

  lines.push({ type: 'item', left: '\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a', right: '' });
  if (data.queueNumber) {
    lines.push({ type: 'text', text: `\u0631\u0642\u0645 \u0627\u0644\u062f\u0648\u0631: ${data.queueNumber}`, align: 'center', bold: true, double: true });
  }
  lines.push({ type: 'item', left: '\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629:', right: data.invoiceNo });
  lines.push({ type: 'item', left: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e:', right: data.dateText });
  if (data.cashierName) lines.push({ type: 'item', left: '\u0627\u0644\u0643\u0627\u0634\u064a\u0631:', right: data.cashierName });
  if (data.customerName) lines.push({ type: 'item', left: '\u0627\u0644\u0639\u0645\u064a\u0644:', right: data.customerName });
  lines.push({ type: 'separator' });

  lines.push({ type: 'text', text: '\u0627\u0644\u0635\u0646\u0641                 \u0643\u0645\u064a\u0629   \u0633\u0639\u0631    \u0645\u062c\u0645\u0648\u0639', align: 'right' });
  lines.push({ type: 'separator' });

  for (const item of data.items) {
    const itemTotal = item.qty * item.price;
    const name = item.name.length > 20 ? item.name.slice(0, 18) + '..' : item.name;
    lines.push({
      type: 'text',
      text: `${name.padEnd(22)}${fmtQty(item.qty).padStart(4)} ${fmt(item.price).padStart(6)} ${fmt(itemTotal).padStart(7)}` ,
      align: 'left',
    });
  }

  lines.push({ type: 'separator' });

  if (discount > 0) {
    lines.push({ type: 'item', left: '\u0627\u0644\u0645\u062c\u0645\u0648\u0639 \u0627\u0644\u0641\u0631\u0639\u064a:', right: `${fmt(subtotal)} ${data.currencyLabel}` });
    lines.push({ type: 'item', left: '\u0627\u0644\u062d\u0633\u0645:', right: `- ${fmt(discount)} ${data.currencyLabel}` });
  }
  lines.push({ type: 'total', left: '\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a:', right: `${fmt(total)} ${data.currencyLabel}` });
  if (paid > 0) {
    lines.push({ type: 'item', left: '\u0627\u0644\u0645\u062f\u0641\u0648\u0639:', right: `${fmt(paid)}   ${data.currencyLabel}` });
    if (change > 0.001) {
      lines.push({ type: 'item', left: '\u0627\u0644\u0628\u0627\u0642\u064a:', right: `${fmt(change)} ${data.currencyLabel}` });
    }
  }

  lines.push({ type: 'separator', char: '=' });
  lines.push({ type: 'text', text: data.footerText ?? '\u0634\u0643\u0631\u0627\u064b \u0644\u062a\u0639\u0627\u0645\u0644\u0643\u0645 \u0645\u0639\u0646\u0627', align: 'center' });
  lines.push({ type: 'feed', lines: 1 });

  return lines;
}
export function buildKitchenReceiptLines(data: KitchenTicketData): ReceiptLine[] {
  const lines: ReceiptLine[] = [];

  lines.push({ type: 'text', text: data.storeName, align: 'center', bold: true });
  lines.push({ type: 'separator', char: '=' });
  lines.push({ type: 'text', text: '\u0645\u0637\u0628\u062e / \u062a\u062c\u0647\u064a\u0632', align: 'center', bold: true });
  lines.push({ type: 'feed', lines: 1 });
  lines.push({ type: 'text', text: `> ${data.queueNumber} <`, align: 'center', bold: true, double: true });
  lines.push({ type: 'text', text: `\u0627\u0644\u062f\u0648\u0631 ${data.queueNumber}`, align: 'center', bold: true });
  lines.push({ type: 'separator' });
  if (data.invoiceNo) lines.push({ type: 'item', left: '\u0641\u0627\u062a\u0648\u0631\u0629:', right: data.invoiceNo });
  lines.push({ type: 'item', left: '\u0627\u0644\u0648\u0642\u062a:', right: data.dateText });
  if (data.branchName) lines.push({ type: 'text', text: data.branchName, align: 'center' });
  if (data.orderType) lines.push({ type: 'text', text: data.orderType, align: 'center' });
  lines.push({ type: 'separator', char: '-' });

  for (const it of data.items) {
    const nm = it.name.length > 26 ? `${it.name.slice(0, 24)}..` : it.name;
    lines.push({ type: 'text', text: `${nm}  x${it.qty}`, align: 'right', bold: true });
    if (it.note) lines.push({ type: 'text', text: `  - ${it.note}`, align: 'right' });
  }

  lines.push({ type: 'separator', char: '=' });
  lines.push({ type: 'text', text: data.footerText ?? '\u062a\u062c\u0647\u064a\u0632 \u0627\u0644\u0637\u0644\u0628', align: 'center' });
  lines.push({ type: 'feed', lines: 2 });

  return lines;
}
