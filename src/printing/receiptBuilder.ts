export type Paper = '58mm' | '80mm';

export type ReceiptItem = { name: string; qty: number; price: number };
export type ReceiptData = {
  storeName: string;
  storePhone?: string;
  invoiceNo: string;
  dateText: string;
  customerName?: string;
  items: ReceiptItem[];
  discount?: number;
  paid: number;
  currencyLabel?: string;
};

export type DeliveryNoticeItem = { name: string; qty: number; unit?: string };
export type DeliveryNoticeData = {
  storeName: string;
  noticeNo: string;
  dateText: string;
  warehouseName?: string;
  receiverName?: string;
  items: DeliveryNoticeItem[];
  totalQty: number;
  notes?: string;
};

function colsForPaper(p: Paper) {
  return p === '58mm' ? 32 : 48;
}

function line(cols: number, ch = '-') {
  return ch.repeat(cols);
}

function padRight(s: string, w: number) {
  const str = String(s || '');
  return str.length >= w ? str.slice(0, w) : str + ' '.repeat(w - str.length);
}

function padLeft(s: string, w: number) {
  const str = String(s || '');
  return str.length >= w ? str.slice(0, w) : ' '.repeat(w - str.length) + str;
}

function money(n: number) {
  return Number(n || 0).toFixed(2);
}

function ensureFeed(text: string) {
  return text.endsWith('\n\n\n') ? text : `${text}\n\n\n`;
}

function renderItemsTable(items: ReceiptItem[], paper: Paper) {
  const cols = colsForPaper(paper);
  const spec = paper === '58mm'
    ? { name: 14, qty: 4, price: 6, total: 8 }
    : { name: 20, qty: 6, price: 10, total: 12 };

  const header =
    padRight('\u0627\u0644\u0645\u0627\u062f\u0629', spec.name) +
    padLeft('\u0627\u0644\u0643\u0645\u064a\u0629', spec.qty) +
    padLeft('\u0627\u0644\u0633\u0639\u0631', spec.price) +
    padLeft('\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a', spec.total);

  const rows = items.map((it) => {
    const total = it.qty * it.price;
    return (
      padRight(it.name, spec.name) +
      padLeft(String(it.qty), spec.qty) +
      padLeft(money(it.price), spec.price) +
      padLeft(money(total), spec.total)
    );
  });

  return [header, line(cols), ...rows].join('\n');
}

export function buildSaleReceiptText(data: ReceiptData, paper: Paper) {
  const cols = colsForPaper(paper);
  const subtotal = data.items.reduce((a, x) => a + (x.qty * x.price), 0);
  const discount = data.discount ?? 0;
  const total = subtotal - discount;
  const change = data.paid - total;
  const cur = data.currencyLabel ? ` ${data.currencyLabel}` : '';

  const parts = [
    `[C]<b><font size='big'>${data.storeName}</font></b>`,
    data.storePhone ? `[C]${data.storePhone}` : '',
    `[C]\u0641\u0627\u062a\u0648\u0631\u0629 \u0628\u064a\u0639`,
    `[L]\u0631\u0642\u0645: ${data.invoiceNo}`,
    `[L]\u0627\u0644\u062a\u0627\u0631\u064a\u062e: ${data.dateText}`,
    data.customerName ? `[L]\u0627\u0644\u0632\u0628\u0648\u0646: ${data.customerName}` : '',
    `[L]${line(cols)}`,
    `[L]${renderItemsTable(data.items, paper)}`,
    `[L]${line(cols)}`,
    `[L]\u0627\u0644\u0645\u062c\u0645\u0648\u0639: ${money(subtotal)}${cur}`,
    discount ? `[L]\u0627\u0644\u062d\u0633\u0645: ${money(discount)}${cur}` : '',
    `[L]<b>\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a: ${money(total)}${cur}</b>`,
    `[L]\u0627\u0644\u0645\u062f\u0641\u0648\u0639: ${money(data.paid)}${cur}`,
    `[L]\u0627\u0644\u0628\u0627\u0642\u064a: ${money(change)}${cur}`,
    `[L]${line(cols)}`,
    `[C]\u0634\u0643\u0631\u0627\u064b \u0644\u0632\u064a\u0627\u0631\u062a\u0643\u0645 - \u0625\u062f\u0627\u0631\u0629 ERP`,
    '\n\n\n',
  ];

  return ensureFeed(parts.filter(Boolean).join('\n'));
}

export function buildDeliveryNoticeText(data: DeliveryNoticeData, paper: Paper) {
  const cols = colsForPaper(paper);
  const header = [
    `[C]<b><font size='big'>${data.storeName}</font></b>`,
    `[C]\u0625\u0634\u0639\u0627\u0631 \u062a\u0633\u0644\u064a\u0645`,
    `[L]\u0631\u0642\u0645: ${data.noticeNo}`,
    `[L]\u0627\u0644\u062a\u0627\u0631\u064a\u062e: ${data.dateText}`,
    data.warehouseName ? `[L]\u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639: ${data.warehouseName}` : '',
    data.receiverName ? `[L]\u0627\u0644\u0645\u0633\u062a\u0644\u0645: ${data.receiverName}` : '',
    `[L]${line(cols)}`,
  ].filter(Boolean);

  const itemLines = data.items.map((it) => {
    const name = padRight(it.name, paper === '58mm' ? 20 : 30);
    const qty = padLeft(String(it.qty), paper === '58mm' ? 6 : 8);
    const unit = it.unit ? ` ${it.unit}` : '';
    return `${name}${qty}${unit}`;
  });

  const footer = [
    `[L]${line(cols)}`,
    `[L]\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0643\u0645\u064a\u0629: ${data.totalQty}`,
    data.notes ? `[L]\u0645\u0644\u0627\u062d\u0638\u0627\u062a: ${data.notes}` : '',
    '\n\n\n',
  ].filter(Boolean);

  return ensureFeed([...header, ...itemLines, ...footer].join('\n'));
}
